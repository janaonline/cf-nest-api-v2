import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../../../core/s3/s3.service';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountProcessingJob,
  XviFcAnnualAccountProcessingJobDocument,
} from '../../../../schemas/xvi-fc/annual-account-processing-jobs.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { DOC_TYPE_MAP } from './constants/doc-type-map.constant';
import { UploadDocumentDto } from './dto/upload-document.dto';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';

@Injectable()
export class AnnualAccountsService {
  private readonly logger = new Logger(AnnualAccountsService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    @InjectModel(XviFcAnnualAccountProcessingJob.name)
    private readonly processingJobModel: Model<XviFcAnnualAccountProcessingJobDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    private readonly s3Service: S3Service,

    @InjectQueue(ANNUAL_ACCOUNT_PROCESSING_QUEUE)
    private readonly ocrQueue: Queue<AnnualAccountOcrJobData>,
  ) {}

  // ─── Upload document ────────────────────────────────────────────────────────

  async uploadDocument(file: Express.Multer.File, dto: UploadDocumentDto, user: AuthUser) {
    this.validateUploadPermission(user, dto);
    this.validateFile(file);

    const expectedDocType = DOC_TYPE_MAP[dto.docId];
    if (!expectedDocType) {
      throw new BadRequestException(`Unknown docId: ${dto.docId}`);
    }

    const annualAccountId = await this.findOrInitialize(dto.ulbId, dto.designYearId, user);

    // Version = count of existing uploads for this slot + 1
    const existingCount = await this.uploadHistoryModel.countDocuments({
      annualAccountId: new Types.ObjectId(annualAccountId),
      section: dto.section,
      requirementId: dto.requirementId,
    });
    const version = existingCount + 1;
    const versionLabel = `v${version}`;
    const uploadId = uuidv4();

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const sizeKb = Math.round((file.size / 1024) * 100) / 100;
    const pages = this.s3Service.getPdfPageCountFromBuffer(file.buffer);

    const s3Key = `xvi-fc/annual-accounts/${dto.ulbId}/${dto.designYearId}/${dto.section}/${dto.requirementId}/${uploadId}.pdf`;
    await this.s3Service.uploadPrivate(s3Key, file.buffer, 'application/pdf');

    const now = new Date();

    const fileInfo = {
      originalName: file.originalname,
      mimeType: file.mimetype,
      pages,
      sizeKb,
      s3Key,
      sha256,
    };

    const currentUpload = {
      uploadId,
      version,
      versionLabel,
      file: fileInfo,
      ocrInfo: {
        jobId: null,
        status: null,
        progressStep: null,
        submittedAt: null,
        completedAt: null,
      },
      validationResult: {
        validationStatus: null,
        validationDetails: null,
        failedChecks: [],
      },
      uploadedBy: {
        userId: new Types.ObjectId(user._id),
        role: user.role,
      },
      uploadedAt: now,
    };

    await this.upsertDocumentSlot(annualAccountId, dto, currentUpload, expectedDocType);

    await this.uploadHistoryModel.create({
      annualAccountId: new Types.ObjectId(annualAccountId),
      ulb: new Types.ObjectId(dto.ulbId),
      designYear: new Types.ObjectId(dto.designYearId),
      section: dto.section,
      requirementId: dto.requirementId,
      docId: dto.docId,
      uploadId,
      version,
      versionLabel,
      file: fileInfo,
      processingStatus: 'PROCESSING',
      ocrInfo: {
        jobId: null,
        status: null,
        progressStep: null,
        submittedAt: null,
        completedAt: null,
      },
      validationResult: {
        validationStatus: null,
        validationDetails: null,
        failedChecks: [],
      },
      uploadedBy: {
        userId: new Types.ObjectId(user._id),
        role: user.role,
      },
      uploadedAt: now,
    });

    await this.processingJobModel.create({
      annualAccountId: new Types.ObjectId(annualAccountId),
      uploadId,
      section: dto.section,
      requirementId: dto.requirementId,
      docId: dto.docId,
      queue: {
        name: ANNUAL_ACCOUNT_PROCESSING_QUEUE,
        bullJobId: null,
        status: 'waiting',
        attempts: 0,
        maxAttempts: 3,
      },
      ocrJob: {
        jobId: null,
        status: null,
        progressStep: null,
      },
      status: 'PENDING',
      error: null,
      startedAt: null,
      completedAt: null,
    });

    // Enqueue OCR job (fire and forget — BullMQ handles retries)
    await this.enqueueOcrJob({
      uploadId,
      annualAccountId,
      ulbId: dto.ulbId,
      section: dto.section,
      requirementId: dto.requirementId,
      docId: dto.docId,
      s3Key,
      expectedDocType,
      financialYear: dto.year,
    });

    this.logger.log(`Document uploaded — annualAccountId=${annualAccountId} uploadId=${uploadId}`);

    return {
      annualAccountId,
      uploadId,
      section: dto.section,
      requirementId: dto.requirementId,
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

    const processingJob = await this.processingJobModel
      .findOne({ annualAccountId: new Types.ObjectId(id), uploadId })
      .lean()
      .exec();

    if (!processingJob) throw new NotFoundException('Processing job not found');
    if (processingJob.status !== 'FAILED') {
      throw new BadRequestException('Only FAILED jobs can be retried');
    }

    const historyDoc = await this.uploadHistoryModel
      .findOne({ uploadId })
      .select('file section requirementId docId')
      .lean()
      .exec();

    if (!historyDoc) throw new NotFoundException('Upload history not found');

    const expectedDocType = DOC_TYPE_MAP[historyDoc.docId];
    if (!expectedDocType) throw new BadRequestException(`Unknown docId: ${historyDoc.docId}`);

    // Reset processingStatus to PROCESSING
    await Promise.all([
      this.processingJobModel.updateOne(
        { uploadId },
        {
          $set: {
            status: 'RETRYING',
            error: null,
            'ocrJob.jobId': null,
            'ocrJob.status': null,
            'ocrJob.progressStep': null,
            'queue.attempts': processingJob.queue.attempts + 1,
            'queue.bullJobId': null,
            'queue.status': 'waiting',
            completedAt: null,
          },
        },
      ),

      this.uploadHistoryModel.updateOne(
        { uploadId },
        {
          $set: {
            processingStatus: 'PROCESSING',
            'ocrInfo.jobId': null,
            'ocrInfo.status': null,
            'ocrInfo.progressStep': null,
            'ocrInfo.submittedAt': null,
            'ocrInfo.completedAt': null,
          },
        },
      ),

      this.annualAccountModel.updateOne(
        {
          _id: new Types.ObjectId(id),
          [`${processingJob.section}.documents.requirementId`]: processingJob.requirementId,
        },
        {
          $set: {
            [`${processingJob.section}.documents.$.processingStatus`]: 'PROCESSING',
            [`${processingJob.section}.documents.$.currentUpload.ocrInfo.jobId`]: null,
            [`${processingJob.section}.documents.$.currentUpload.ocrInfo.status`]: null,
            [`${processingJob.section}.documents.$.currentUpload.ocrInfo.progressStep`]: null,
            [`${processingJob.section}.documents.$.currentUpload.ocrInfo.submittedAt`]: null,
            [`${processingJob.section}.documents.$.currentUpload.ocrInfo.completedAt`]: null,
            [`${processingJob.section}.documents.$.currentUpload.validationResult.validationStatus`]: null,
            [`${processingJob.section}.documents.$.currentUpload.validationResult.failedChecks`]: [],
          },
        },
      ),
    ]);

    const sectionData = (doc as any)[processingJob.section];
    await this.enqueueOcrJob({
      uploadId,
      annualAccountId: id,
      ulbId: doc.ulb.toString(),
      section: processingJob.section,
      requirementId: processingJob.requirementId,
      docId: processingJob.docId,
      s3Key: historyDoc.file.s3Key,
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

  // ─── Polling status (read-only, never mutates DB) ────────────────────────────

  async getProcessingStatus(id: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();

    if (!doc) throw new NotFoundException('Annual account not found');
    this.validateViewAccess(doc, user);

    const buildSectionStatus = (section: any) => {
      if (!section) return null;
      return {
        yearId: section.yearId,
        year: section.year,
        summary: section.summary,
        documents: (section.documents ?? []).map((d: any) => ({
          requirementId: d.requirementId,
          docId: d.docId,
          type: d.type,
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
                validationResult: d.currentUpload.validationResult,
                uploadedBy: d.currentUpload.uploadedBy,
                uploadedAt: d.currentUpload.uploadedAt,
              }
            : null,
        })),
      };
    };

    return {
      annualAccountId: doc._id,
      status: doc.status,
      isDraft: doc.isDraft,
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
      if (found?.currentUpload?.file?.s3Key) {
        s3Key = found.currentUpload.file.s3Key;
        break;
      }
    }

    if (!s3Key) throw new NotFoundException('Upload not found');

    const url = await this.s3Service.presignGet(s3Key);
    return { url };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async enqueueOcrJob(data: AnnualAccountOcrJobData) {
    const bullJob = await this.ocrQueue.add(`ocr-${data.section}-${data.requirementId}-${data.uploadId}`, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    await this.processingJobModel.updateOne(
      { uploadId: data.uploadId },
      { $set: { 'queue.bullJobId': bullJob.id, 'queue.status': 'waiting' } },
    );
  }

  private async findOrInitialize(ulbId: string, designYearId: string, user: AuthUser): Promise<string> {
    const filter = {
      ulb: new Types.ObjectId(ulbId),
      design_year: new Types.ObjectId(designYearId),
    };

    const existing = await this.annualAccountModel.findOne(filter).select('_id').lean().exec();
    if (existing) return existing._id.toString();

    const created = await this.annualAccountModel.create({
      ...filter,
      status: 'DRAFT',
      isDraft: true,
      documentSetVersion: 1,
      auditedData: null,
      unauditedData: null,
      createdBy: new Types.ObjectId(user._id),
      modifiedBy: new Types.ObjectId(user._id),
    });

    return created._id.toString();
  }

  private async upsertDocumentSlot(
    annualAccountId: string,
    dto: UploadDocumentDto,
    currentUpload: Record<string, unknown>,
    expectedDocType: string,
  ) {
    const { section, requirementId, docId, type, yearId, year } = dto;
    const annAccountObjId = new Types.ObjectId(annualAccountId);

    // Ensure section exists (only sets when it is currently null)
    await this.annualAccountModel.updateOne(
      { _id: annAccountObjId, [section]: null },
      {
        $set: {
          [section]: {
            yearId: new Types.ObjectId(yearId),
            year,
            summary: {
              totalRequired: 0,
              uploaded: 0,
              processing: 0,
              passed: 0,
              failed: 0,
              notUploaded: 0,
            },
            documents: [],
          },
        },
      },
    );

    // Try to update an existing document slot matching requirementId
    const updated = await this.annualAccountModel.updateOne(
      {
        _id: annAccountObjId,
        [`${section}.documents.requirementId`]: requirementId,
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

    // If no slot existed yet, push a new document item
    if (updated.modifiedCount === 0) {
      await this.annualAccountModel.updateOne(
        { _id: annAccountObjId },
        {
          $push: {
            [`${section}.documents`]: {
              requirementId,
              docId,
              type,
              expectedDocType,
              required: true,
              sortOrder: 0,
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

  private validateFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' || file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are allowed');
    }

    const maxBytes = 20 * 1024 * 1024; // 20 MB
    if (file.size > maxBytes) {
      throw new BadRequestException('File size must not exceed 20 MB');
    }
  }

  private validateViewAccess(doc: any, user: AuthUser) {
    if (user.scope === 'ULB') {
      if (doc.ulb?.toString() !== user.ulb?.toString()) {
        throw new ForbiddenException('Access denied');
      }
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
}
