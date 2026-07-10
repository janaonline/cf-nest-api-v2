import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { FormJsonService } from '../../../../form-json/form-json.service';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../../s3-upload/s3-upload.service';
import {
  AnnualAccountFormStatus,
  FORM_STATUS_ID,
  XviFcAnnualAccount,
  XviFcAnnualAccountDocument,
} from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { DOC_TYPE_MAP } from './constants/doc-type-map.constant';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { Scope, Permission } from '../../../auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from '../../../auth/permissions.map';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';

@Injectable()
export class AnnualAccountsService implements OnModuleInit {
  private readonly logger = new Logger(AnnualAccountsService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    private readonly s3Service: S3Service,

    private readonly s3UploadService: S3UploadService,

    @InjectQueue(ANNUAL_ACCOUNT_PROCESSING_QUEUE)
    private readonly ocrQueue: Queue<AnnualAccountOcrJobData>,

    private readonly formJsonService: FormJsonService,
  ) {}

  async onModuleInit() {
    // Drop legacy requirementId-based indexes replaced by docId indexes.
    // Mongoose autoIndex creates new indexes but never drops renamed ones.
    try {
      await this.uploadHistoryModel.collection.dropIndex('annualAccountId_1_section_1_requirementId_1_version_1');
      this.logger.log('Dropped legacy requirementId+version unique index from upload history');
    } catch {
      /* already gone — ignore */
    }
    try {
      await this.uploadHistoryModel.collection.dropIndex('annualAccountId_1_section_1_requirementId_1');
      this.logger.log('Dropped legacy requirementId compound index from upload history');
    } catch {
      /* already gone — ignore */
    }
  }

  // ─── Presign upload URL ──────────────────────────────────────────────────────

  async presignUpload(dto: PresignUploadDto, user: AuthUser) {
    this.validateUploadPermission(user, { ulbId: dto.ulbId, section: dto.section } as UploadDocumentDto);

    const ext = dto.fileName.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf') {
      throw new BadRequestException('Only PDF files are allowed');
    }

    if (!DOC_TYPE_MAP[dto.docId]) {
      throw new BadRequestException(`Unknown docId: ${dto.docId}`);
    }

    const uploadId = uuidv4();
    const folder = `xvi-fc/annual-accounts/${dto.ulbId}/${dto.designYearId}/${dto.section}/${dto.docId}`;
    const expiresIn = 300;

    const result = await this.s3UploadService.generatePutSignedUrl({
      fileName: dto.fileName,
      folder,
      mimeType: 'application/pdf',
      uploadId,
      expiresIn,
    });

    this.logger.log(`Presign URL generated — uploadId=${uploadId} docId=${dto.docId}`);

    return { uploadId, presignedUrl: result.url, s3Key: result.path, expiresIn };
  }

  // ─── Confirm upload (presigned URL flow) ─────────────────────────────────────

  async confirmUpload(
    dto: ConfirmUploadDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    this.validateUploadPermission(user, dto as unknown as UploadDocumentDto);

    const expectedDocType = DOC_TYPE_MAP[dto.docId];
    if (!expectedDocType) {
      throw new BadRequestException(`Unknown docId: ${dto.docId}`);
    }

    const expectedKeyPrefix = `xvi-fc/annual-accounts/${dto.ulbId}/${dto.designYearId}/${dto.section}/${dto.docId}/`;
    if (!dto.s3Key.startsWith(expectedKeyPrefix)) {
      throw new BadRequestException('Invalid s3Key for this upload');
    }

    try {
      await this.s3Service.headObject(dto.s3Key);
    } catch {
      throw new BadRequestException('File not found in S3 — upload may have failed or expired');
    }

    const pdfBuffer = await this.s3Service.getPdfBufferFromS3(dto.s3Key);
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
    const sizeKb = Math.round((dto.fileSize / 1024) * 100) / 100;
    const pages = await this.s3Service.getPdfPageCountFromBuffer(pdfBuffer);

    const annualAccountId = await this.findOrInitialize(dto.ulbId, dto.designYearId, user);

    const existingCount = await this.uploadHistoryModel.countDocuments({
      annualAccountId: new Types.ObjectId(annualAccountId),
      section: dto.section,
      docId: dto.docId,
    });
    const version = existingCount + 1;
    const versionLabel = `v${version}`;

    const now = new Date();

    const fileInfo = {
      originalName: dto.originalName,
      mimeType: 'application/pdf',
      extension: 'pdf',
      pageCount: pages,
      sizeKb,
      path: dto.s3Key,
      sha256,
    };

    const ocrInfoInit = {
      jobId: null,
      status: null,
      progressStep: null,
      submittedAt: null,
      completedAt: null,
      validationStatus: null,
      validationDetails: null,
      failedChecks: [],
    };

    const currentUpload = {
      uploadId: dto.uploadId,
      version,
      versionLabel,
      file: fileInfo,
      ocrInfo: ocrInfoInit,
      userInfo: {
        userId: new Types.ObjectId(user._id),
        role: user.role,
        ipAddress,
        userAgent,
      },
      uploadedAt: now,
    };

    await this.upsertDocumentSlot(annualAccountId, dto as unknown as UploadDocumentDto, currentUpload);

    await this.uploadHistoryModel.create({
      annualAccountId: new Types.ObjectId(annualAccountId),
      ulb: new Types.ObjectId(dto.ulbId),
      designYear: new Types.ObjectId(dto.designYearId),
      section: dto.section,
      docId: dto.docId,
      uploadId: dto.uploadId,
      version,
      versionLabel,
      file: fileInfo,
      processingStatus: 'PROCESSING',
      ocrInfo: ocrInfoInit,
      queue: {
        name: ANNUAL_ACCOUNT_PROCESSING_QUEUE,
        bullJobId: null,
        status: 'waiting',
        attempts: 0,
        maxAttempts: 3,
      },
      error: null,
      startedAt: null,
      userInfo: {
        userId: new Types.ObjectId(user._id),
        role: user.role,
        ipAddress,
        userAgent,
      },
      uploadedAt: now,
    });

    await this.enqueueOcrJob({
      uploadId: dto.uploadId,
      annualAccountId,
      ulbId: dto.ulbId,
      section: dto.section,
      docId: dto.docId,
      s3Key: dto.s3Key,
      expectedDocType,
      financialYear: dto.year,
    });

    this.logger.log(`Upload confirmed — annualAccountId=${annualAccountId} uploadId=${dto.uploadId}`);

    return {
      annualAccountId,
      uploadId: dto.uploadId,
      section: dto.section,
      docId: dto.docId,
      version,
      versionLabel,
      processingStatus: 'PROCESSING',
      uploadedAt: now,
    };
  }

  // ─── Retry failed upload ─────────────────────────────────────────────────────

  async retryUpload(id: string, uploadId: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    this.validateViewAccess(doc, user);

    const historyDoc = await this.uploadHistoryModel
      .findOne({ annualAccountId: new Types.ObjectId(id), uploadId })
      .lean()
      .exec();

    if (!historyDoc) throw new NotFoundException('Upload not found');
    if (historyDoc.processingStatus !== 'FAILED') {
      throw new BadRequestException('Only FAILED uploads can be retried');
    }

    const expectedDocType = DOC_TYPE_MAP[historyDoc.docId];
    if (!expectedDocType) throw new BadRequestException(`Unknown docId: ${historyDoc.docId}`);

    await Promise.all([
      this.uploadHistoryModel.updateOne(
        { uploadId },
        {
          $set: {
            processingStatus: 'PROCESSING',
            error: null,
            startedAt: null,
            'ocrInfo.jobId': null,
            'ocrInfo.status': null,
            'ocrInfo.progressStep': null,
            'ocrInfo.submittedAt': null,
            'ocrInfo.completedAt': null,
            'ocrInfo.validationStatus': null,
            'ocrInfo.validationDetails': null,
            'ocrInfo.failedChecks': [],
            'queue.bullJobId': null,
            'queue.status': 'waiting',
            'queue.attempts': (historyDoc.queue?.attempts ?? 0) + 1,
          },
        },
      ),

      this.annualAccountModel.updateOne(
        {
          _id: new Types.ObjectId(id),
          [`${historyDoc.section}.documents.docId`]: historyDoc.docId,
        },
        {
          $set: {
            [`${historyDoc.section}.documents.$.processingStatus`]: 'PROCESSING',
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.jobId`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.status`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.progressStep`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.submittedAt`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.completedAt`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.validationStatus`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.validationDetails`]: null,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.failedChecks`]: [],
          },
        },
      ),
    ]);

    const sectionData = (doc as any)[historyDoc.section];
    await this.enqueueOcrJob({
      uploadId,
      annualAccountId: id,
      ulbId: doc.ulb.toString(),
      section: historyDoc.section,
      docId: historyDoc.docId,
      s3Key: historyDoc.file.path,
      expectedDocType,
      financialYear: sectionData?.year ?? '',
    });

    return { uploadId, status: 'PROCESSING', message: 'Retry queued successfully' };
  }

  // ─── Lookup by ULB + design year ─────────────────────────────────────────────

  async findByUlbAndYear(ulbId: string, designYearId: string, user: AuthUser) {
    const doc = await this.annualAccountModel
      .findOne({
        ulb: new Types.ObjectId(ulbId),
        design_year: new Types.ObjectId(designYearId),
      })
      .lean()
      .exec();

    if (!doc) return null;
    this.validateViewAccess(doc, user);
    return this.getProcessingStatus(doc._id.toString(), user);
  }

  // ─── Get full details ────────────────────────────────────────────────────────

  async getDetails(id: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    this.validateViewAccess(doc, user);
    return this.stripS3Keys(doc);
  }

  // ─── Polling status ───────────────────────────────────────────────────────────

  async getProcessingStatus(id: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    this.validateViewAccess(doc, user);

    const buildSectionStatus = (section: any) => {
      if (!section)
        return {
          form_status: AnnualAccountFormStatus.NOT_STARTED,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.NOT_STARTED],
          documents: [],
        };
      const fs = (section.form_status ?? AnnualAccountFormStatus.IN_PROGRESS) as AnnualAccountFormStatus;
      return {
        form_status: fs,
        form_status_id: FORM_STATUS_ID[fs] ?? 2,
        yearId: section.yearId,
        year: section.year,
        documents: (section.documents ?? []).map((d: any) => ({
          docId: d.docId,
          uploadStatus: d.uploadStatus,
          processingStatus: d.processingStatus,
          currentUpload: d.currentUpload
            ? {
                uploadId: d.currentUpload.uploadId,
                version: d.currentUpload.version,
                versionLabel: d.currentUpload.versionLabel,
                file: {
                  originalName: d.currentUpload.file?.originalName,
                  mimeType: d.currentUpload.file?.mimeType,
                  pages: d.currentUpload.file?.pages,
                  sizeKb: d.currentUpload.file?.sizeKb,
                },
                ocrInfo: d.currentUpload.ocrInfo,
                userInfo: d.currentUpload.userInfo,
                uploadedAt: d.currentUpload.uploadedAt,
              }
            : null,
        })),
      };
    };

    return {
      annualAccountId: doc._id,
      auditedData: buildSectionStatus(doc.auditedData),
      unauditedData: buildSectionStatus(doc.unauditedData),
    };
  }

  // ─── Signed URL for file viewing ─────────────────────────────────────────────

  async getSignedUrl(id: string, uploadId: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    this.validateViewAccess(doc, user);

    let s3Key: string | null = null;
    for (const sectionKey of ['auditedData', 'unauditedData'] as const) {
      const section = doc[sectionKey];
      if (!section?.documents) continue;
      const found = section.documents.find((d: any) => d.currentUpload?.uploadId === uploadId);
      if (found?.currentUpload?.file?.path) {
        s3Key = found.currentUpload.file.path;
        break;
      }
    }

    if (!s3Key) throw new NotFoundException('Upload not found');
    const url = await this.s3Service.presignGet(s3Key);
    return { url };
  }

  // ─── Remove (hard-delete) a document slot ────────────────────────────────────

  async removeDocument(id: string, section: 'auditedData' | 'unauditedData', docId: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    this.validateViewAccess(doc, user);

    const sectionData = (doc as any)[section];
    if (!sectionData) throw new NotFoundException('Section not found');

    const docSlot = (sectionData.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id), [`${section}.documents.docId`]: docId },
      {
        $set: {
          [`${section}.documents.$.currentUpload`]: null,
          [`${section}.documents.$.uploadStatus`]: 'NOT_UPLOADED',
          [`${section}.documents.$.processingStatus`]: 'NOT_STARTED',
          updatedAt: new Date(),
        },
      },
    );

    this.logger.log(`Document removed — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`);
    return { annualAccountId: id, section, docId, message: 'Document removed successfully' };
  }

  // ─── Submit section to State DMA ─────────────────────────────────────────────

  async submitSection(
    id: string,
    section: 'auditedData' | 'unauditedData',
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    // this.validateSubmitAccess(doc, user);

    const sectionData = (doc as any)[section];
    if (!sectionData?.documents?.length) {
      throw new BadRequestException('No documents found in this section');
    }

    // Resolve which docIds are currently required by the active upload config.
    // This means documents that were previously uploaded but are now hidden in the
    // config (e.g. receipts-payments while temporarily hidden) are not blocking.
    const FORM_IDS: Record<string, number> = { auditedData: 30, unauditedData: 31 };
    const designYearId = doc.design_year?.toString();
    let requiredDocIds: string[] | null = null;
    try {
      const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(designYearId, FORM_IDS[section]);
      requiredDocIds = ((formJson.data ?? []) as Array<{ key: string }>).map((f) => f.key);
    } catch {
      // Formjson not found — fall back to checking all uploaded docs
    }

    const docsToCheck = requiredDocIds
      ? sectionData.documents.filter((d: any) => requiredDocIds!.includes(d.docId))
      : sectionData.documents;

    if (!docsToCheck.length) {
      throw new BadRequestException('No documents found in this section');
    }

    const allPassed = docsToCheck.every((d: any) => d.processingStatus === 'PASSED');
    if (!allPassed) {
      throw new BadRequestException('All documents must pass verification before submitting');
    }

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          [`${section}.form_status`]: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
          [`${section}.form_status_id`]: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
          [`${section}.selfDeclared`]: true,
          [`${section}.declaredBy`]: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
          [`${section}.declaredAt`]: new Date(),
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    this.logger.log(`Section ${section} submitted with self-declaration — annualAccountId=${id} by user=${user._id}`);

    return {
      annualAccountId: id,
      section,
      form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
      form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async enqueueOcrJob(data: AnnualAccountOcrJobData) {
    const bullJob = await this.ocrQueue.add(`ocr-${data.section}-${data.docId}-${data.uploadId}`, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    await this.uploadHistoryModel.updateOne(
      { uploadId: data.uploadId },
      { $set: { 'queue.bullJobId': String(bullJob.id), 'queue.status': 'waiting' } },
    );
  }

  private async findOrInitialize(ulbId: string, designYearId: string, user: AuthUser): Promise<string> {
    const filter = {
      ulb: new Types.ObjectId(ulbId),
      design_year: new Types.ObjectId(designYearId),
    };

    // Atomic upsert — eliminates the find→create race condition that caused
    // duplicate-key 11000 errors when multiple uploads arrived simultaneously.
    const doc = await this.annualAccountModel
      .findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            auditedData: null,
            unauditedData: null,
            createdBy: new Types.ObjectId(user._id),
            modifiedBy: new Types.ObjectId(user._id),
          },
        },
        { upsert: true, new: true },
      )
      .select('_id')
      .lean()
      .exec();

    return doc!._id.toString();
  }

  private async upsertDocumentSlot(
    annualAccountId: string,
    dto: UploadDocumentDto,
    currentUpload: Record<string, unknown>,
  ) {
    const { section, docId, yearId, year } = dto;
    const annAccountObjId = new Types.ObjectId(annualAccountId);

    await this.annualAccountModel.updateOne(
      { _id: annAccountObjId, [section]: null },
      {
        $set: {
          [section]: {
            yearId: new Types.ObjectId(yearId),
            year,
            form_status: AnnualAccountFormStatus.IN_PROGRESS,
            form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
            documents: [],
          },
        },
      },
    );

    // Ensure form_status is IN_PROGRESS even if section already existed
    await this.annualAccountModel.updateOne(
      { _id: annAccountObjId, [`${section}.form_status`]: { $ne: AnnualAccountFormStatus.IN_PROGRESS } },
      {
        $set: {
          [`${section}.form_status`]: AnnualAccountFormStatus.IN_PROGRESS,
          [`${section}.form_status_id`]: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
        },
      },
    );

    const updated = await this.annualAccountModel.updateOne(
      {
        _id: annAccountObjId,
        [`${section}.documents.docId`]: docId,
      },
      {
        $set: {
          [`${section}.documents.$.currentUpload`]: currentUpload,
          [`${section}.documents.$.uploadStatus`]: 'UPLOADED',
          [`${section}.documents.$.processingStatus`]: 'PROCESSING',
          updatedAt: new Date(),
        },
      },
    );

    if (updated.modifiedCount === 0) {
      await this.annualAccountModel.updateOne(
        { _id: annAccountObjId },
        {
          $push: {
            [`${section}.documents`]: {
              docId,
              uploadStatus: 'UPLOADED',
              processingStatus: 'PROCESSING',
              currentUpload,
            },
          },
          $set: { updatedAt: new Date() },
        },
      );
    }
  }

  private validateUploadPermission(user: AuthUser, dto: UploadDocumentDto) {
    if (user.accessLevel === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot upload documents');
    }

    if (user.scope === 'ULB') {
      const userUlbId = user.ulb?.toString();
      if (userUlbId !== dto.ulbId) {
        throw new ForbiddenException('You can only upload documents for your own ULB');
      }
    }
  }

  private validateViewAccess(doc: any, user: AuthUser) {
    if (user.scope === 'ULB') {
      if (doc.ulb?.toString() !== user.ulb?.toString()) {
        throw new ForbiddenException('Access denied');
      }
    }
  }

  private validateSubmitAccess(doc: any, user: AuthUser) {
    if (user.scope !== Scope.ULB) {
      throw new ForbiddenException('Only ULB users can submit annual accounts');
    }
    if (doc.ulb?.toString() !== user.ulb?.toString()) {
      throw new ForbiddenException('Access denied');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.FINAL_SUBMIT_TO_STATE_DMA)) {
      throw new ForbiddenException('You do not have permission to submit annual accounts');
    }
  }

  private stripS3Keys(doc: any): any {
    const stripSection = (section: any) => {
      if (!section?.documents) return section;
      return {
        ...section,
        documents: section.documents.map((d: any) => ({
          ...d,
          currentUpload: d.currentUpload
            ? {
                ...d.currentUpload,
                file: d.currentUpload.file ? { ...d.currentUpload.file, s3Key: undefined } : d.currentUpload.file,
              }
            : null,
        })),
      };
    };

    return {
      ...doc,
      auditedData: stripSection(doc.auditedData),
      unauditedData: stripSection(doc.unauditedData),
    };
  }

  async getUploadConfig(type: 'audited' | 'provisional', yearId: string) {
    const FORM_IDS: Record<string, number> = { audited: 30, provisional: 31 };
    const formId = FORM_IDS[type];
    if (!formId) throw new NotFoundException(`Unknown upload config type: ${type}`);
    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, formId);
    return { meta: formJson.meta ?? {}, data: formJson.data ?? [] };
  }
}
