import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { FormJsonService } from '../../../../master/form-json/form-json.service';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Model, PipelineStage, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../file/s3-upload.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { assertValidFormStatusTransition } from '../../../../common/utils/form-status-transitions';
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
import {
  FormLogDocumentEntry,
  buildFormLogDocumentEntry,
  XviFcAnnualAccountFormLog,
  XviFcAnnualAccountFormLogDocument,
} from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import {
  DocumentActionGateDocument,
  XviFcDocumentActionGate,
} from '../../../../schemas/xvi-fc/document-action-gate.schema';
import { DOC_TYPE_MAP, NO_OCR_DOC_IDS } from './constants/doc-type-map.constant';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { DocumentDecisionDto } from './dto/document-decision.dto';
import { SectionDecisionDto } from './dto/section-decision.dto';
import { BulkSectionDecisionDto } from './dto/bulk-section-decision.dto';
import { UlbSubmissionsQueryDto } from './dto/ulb-submissions-query.dto';
import { ManualReviewDecisionDto } from './dto/manual-review-decision.dto';
import { ManualReviewQueueQueryDto } from './dto/manual-review-queue-query.dto';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { Scope, Permission } from '../../../auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from '../../../auth/permissions.map';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { canUlbEditForm, canUlbSubmitForm } from '../../common/utils/xvi-fc-form-status-access.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { resolveStateScopeFilter } from 'src/module/xvi-fc/common/utils/xvi-fc-scope-filter.util';
import {
  buildDecisionRecord,
  runBulkDecision,
  type BulkDecisionResult,
} from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import {
  AnnualAccountPermissions,
  canMohuaDecideAnnualAccount,
  canMohuaReviewAnnualAccount,
  canStateDecideAnnualAccount,
  canStateReviewAnnualAccount,
  canStateUndoSectionApproval,
  canUlbReuploadDocument,
} from './annual-account-status-access.util';

/** formId for each section, per the active upload-config formjson documents (30 = audited, 31 = provisional). */
const SECTION_FORM_IDS: Record<'auditedData' | 'unauditedData', number> = { auditedData: 30, unauditedData: 31 };

interface UlbSubmissionRow {
  ulbId: Types.ObjectId;
  ulbCode: string;
  censusCode: string;
  ulbName: string;
  formStatus: AnnualAccountFormStatus;
  formStatusId: number;
  lastUpdatedAt: Date | null;
  annualAccountId: Types.ObjectId | null;
  hasManualReviewRequests: boolean;
}

interface UlbSubmissionsFacetResult {
  data: UlbSubmissionRow[];
  totalCount: Array<{ count: number }>;
  counts: Array<{ _id: AnnualAccountFormStatus; count: number }>;
}

@Injectable()
export class AnnualAccountsService implements OnModuleInit {
  private readonly logger = new Logger(AnnualAccountsService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    @InjectModel(XviFcAnnualAccountFormLog.name)
    private readonly formLogModel: Model<XviFcAnnualAccountFormLogDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(XviFcDocumentActionGate.name)
    private readonly actionGateModel: Model<DocumentActionGateDocument>,

    private readonly s3Service: S3Service,

    private readonly s3UploadService: S3UploadService,

    @InjectQueue(ANNUAL_ACCOUNT_PROCESSING_QUEUE)
    private readonly ocrQueue: Queue<AnnualAccountOcrJobData>,

    private readonly formJsonService: FormJsonService,

    private readonly fileTokenService: FileTokenService,
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

    if (!DOC_TYPE_MAP[dto.docId] && !NO_OCR_DOC_IDS.has(dto.docId)) {
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
    await this.assertCanUlbUpload(
      dto.ulbId,
      dto.designYearId,
      dto.section as 'auditedData' | 'unauditedData',
      dto.docId,
    );

    const isNoOcrDoc = NO_OCR_DOC_IDS.has(dto.docId);
    const expectedDocType = isNoOcrDoc ? null : DOC_TYPE_MAP[dto.docId];
    if (!isNoOcrDoc && !expectedDocType) {
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

    const annualAccountId = await this.findOrInitialize(dto.ulbId, dto.stateId, dto.designYearId, user);

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

    const initialProcessingStatus = isNoOcrDoc ? 'PASSED' : 'PROCESSING';

    await this.upsertDocumentSlot(
      annualAccountId,
      dto as unknown as UploadDocumentDto,
      currentUpload,
      initialProcessingStatus,
    );

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
      processingStatus: initialProcessingStatus,
      ocrInfo: ocrInfoInit,
      queue: {
        name: ANNUAL_ACCOUNT_PROCESSING_QUEUE,
        bullJobId: null,
        status: isNoOcrDoc ? 'skipped' : 'waiting',
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

    if (!isNoOcrDoc) {
      await this.enqueueOcrJob({
        uploadId: dto.uploadId,
        annualAccountId,
        ulbId: dto.ulbId,
        section: dto.section,
        docId: dto.docId,
        s3Key: dto.s3Key,
        expectedDocType: expectedDocType!,
        financialYear: dto.year,
      });
    }

    this.logger.log(`Upload confirmed — annualAccountId=${annualAccountId} uploadId=${dto.uploadId}`);

    return {
      annualAccountId,
      uploadId: dto.uploadId,
      section: dto.section,
      docId: dto.docId,
      version,
      versionLabel,
      processingStatus: initialProcessingStatus,
      uploadedAt: now,
    };
  }

  // ─── Retry failed upload ─────────────────────────────────────────────────────

  async retryUpload(id: string, uploadId: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);

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
            'ocrInfo.isManualReviewRequested': false,
            'ocrInfo.manualReviewRequestedAt': null,
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
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.isManualReviewRequested`]: false,
            [`${historyDoc.section}.documents.$.currentUpload.ocrInfo.manualReviewRequestedAt`]: null,
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
    await this.validateViewAccess(doc, user);
    return this.getProcessingStatus(doc._id.toString(), user);
  }

  // ─── State-scoped ULB submissions list ───────────────────────────────────────

  /**
   * Paginated list of every ULB in the requester's state for a given design year,
   * joined against that ULB's Annual Account status for the requested section.
   * ULB is the primary collection (left-joined to the account doc) so ULBs that
   * haven't started at all still appear, reported as NOT_STARTED.
   */
  async listUlbSubmissions(dto: UlbSubmissionsQueryDto, user: AuthUser) {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may list ULB submissions');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }

    const stateId = resolveStateScopeFilter(user, dto.stateId);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (stateId) matchStage.state = stateId;
    if (dto.search?.trim()) {
      const regex = new RegExp(escapeRegex(dto.search.trim()), 'i');
      matchStage.$or = [{ name: regex }, { code: regex }];
    }

    const sortField = dto.sortField ?? 'ulbName';
    const sortDirection = dto.sortDirection === 'desc' ? -1 : 1;
    const sortStage: Record<string, 1 | -1> =
      sortField === 'formStatus' ? { formStatusId: sortDirection } : { name: sortDirection };

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const notStarted = AnnualAccountFormStatus.NOT_STARTED;

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'xvifc_annualaccounts',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$ulb', '$$ulbId'] }, { $eq: ['$design_year', new Types.ObjectId(dto.designYearId)] }],
                },
              },
            },
          ],
          as: 'account',
        },
      },
      { $addFields: { account: { $arrayElemAt: ['$account', 0] } } },
      {
        $addFields: {
          formStatus: { $ifNull: [`$account.${dto.section}.form_status`, notStarted] },
          formStatusId: { $ifNull: [`$account.${dto.section}.form_status_id`, FORM_STATUS_ID[notStarted]] },
          lastUpdatedAt: { $ifNull: ['$account.updatedAt', null] },
          hasManualReviewRequests: {
            $anyElementTrue: {
              $map: {
                input: { $ifNull: [`$account.${dto.section}.documents`, []] },
                as: 'd',
                in: { $ifNull: ['$$d.currentUpload.ocrInfo.isManualReviewRequested', false] },
              },
            },
          },
        },
      },
    ];

    const statusMatch: PipelineStage.FacetPipelineStage[] = dto.status?.length
      ? [{ $match: { formStatus: { $in: dto.status } } }]
      : [];

    pipeline.push({
      $facet: {
        data: [
          ...statusMatch,
          { $sort: sortStage },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              ulbId: '$_id',
              ulbCode: '$code',
              censusCode: { $ifNull: ['$censusCode', '$sbCode'] },
              ulbName: '$name',
              formStatus: 1,
              formStatusId: 1,
              lastUpdatedAt: 1,
              annualAccountId: { $ifNull: ['$account._id', null] },
              hasManualReviewRequests: 1,
            },
          },
        ],
        totalCount: [...statusMatch, { $count: 'count' }],
        // Counts every status bucket regardless of the status filter above, so stat-card
        // totals stay stable no matter which card/bucket is currently selected.
        counts: [{ $group: { _id: '$formStatus', count: { $sum: 1 } } }],
      },
    });

    const [result] = await this.ulbModel.aggregate<UlbSubmissionsFacetResult>(pipeline).exec();
    const rows = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    const counts = Object.fromEntries(
      Object.values(AnnualAccountFormStatus).map((status) => [
        status,
        result?.counts.find((c) => c._id === status)?.count ?? 0,
      ]),
    ) as Record<AnnualAccountFormStatus, number>;

    return { total, page, pageSize, rows, counts };
  }

  /** STATE users are always scoped to their own state; ADMIN may optionally pass one, else sees all. */
  // ─── Get full details ────────────────────────────────────────────────────────

  async getDetails(id: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);
    return this.stripS3Keys(doc);
  }

  // ─── Polling status ───────────────────────────────────────────────────────────

  async getProcessingStatus(id: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);

    const hasStateAccess = await this.hasStateAccessToUlb(user, doc.ulb);

    const buildSectionStatus = (section: any) => {
      if (!section) {
        const status = AnnualAccountFormStatus.NOT_STARTED;
        return {
          form_status: status,
          form_status_id: FORM_STATUS_ID[status],
          documents: [],
          permissions: this.buildAnnualAccountPermissions(user, hasStateAccess, status),
          stateDecision: null,
          mohuaDecision: null,
        };
      }
      const fs = (section.form_status ?? AnnualAccountFormStatus.IN_PROGRESS) as AnnualAccountFormStatus;
      return {
        form_status: fs,
        form_status_id: FORM_STATUS_ID[fs] ?? 2,
        yearId: section.yearId,
        year: section.year,
        permissions: this.buildAnnualAccountPermissions(user, hasStateAccess, fs),
        stateDecision: section.stateDecision
          ? {
              status: section.stateDecision.status,
              note: section.stateDecision.note,
              decidedAt: section.stateDecision.decidedAt,
            }
          : null,
        mohuaDecision: section.mohuaDecision
          ? {
              status: section.mohuaDecision.status,
              note: section.mohuaDecision.note,
              decidedAt: section.mohuaDecision.decidedAt,
            }
          : null,
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
                  fileUrl: d.currentUpload.file?.path
                    ? this.fileTokenService.signFileUrl(d.currentUpload.file.path, 'inline')
                    : null,
                },
                ocrInfo: d.currentUpload.ocrInfo,
                userInfo: d.currentUpload.userInfo,
                uploadedAt: d.currentUpload.uploadedAt,
              }
            : null,
          stateDecision: d.stateDecision
            ? { status: d.stateDecision.status, note: d.stateDecision.note, decidedAt: d.stateDecision.decidedAt }
            : null,
          manualReviewDecision: d.manualReviewDecision
            ? {
                status: d.manualReviewDecision.status,
                note: d.manualReviewDecision.note,
                decidedAt: d.manualReviewDecision.decidedAt,
              }
            : null,
        })),
      };
    };

    const ulb = await this.ulbModel.findById(doc.ulb).select('name code').lean().exec();

    return {
      annualAccountId: doc._id,
      ulbName: ulb?.name ?? null,
      ulbCode: ulb?.code ?? null,
      auditedData: buildSectionStatus(doc.auditedData),
      unauditedData: buildSectionStatus(doc.unauditedData),
    };
  }

  // ─── Form status audit log ────────────────────────────────────────────────────

  async getFormLogs(id: string, section: 'auditedData' | 'unauditedData' | undefined, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);

    const filter: Record<string, unknown> = { annualAccountId: new Types.ObjectId(id) };
    if (section) filter.section = section;

    const logs = await this.formLogModel.find(filter).sort({ createdAt: -1 }).lean().exec();

    return logs.map((log) => ({
      section: log.section,
      action: log.action,
      toStatus: log.toStatus,
      actorStage: log.actorStage,
      actorRole: log.userInfo.role,
      note: log.note ?? null,
      batchId: log.batchId ?? null,
      documents: log.documents ?? [],
      createdAt: (log as unknown as { createdAt: Date }).createdAt,
    }));
  }

  // ─── Remove (hard-delete) a document slot ────────────────────────────────────

  async removeDocument(id: string, section: 'auditedData' | 'unauditedData', docId: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);

    const sectionData = (doc as any)[section];
    if (!sectionData) throw new NotFoundException('Section not found');

    const docSlot = (sectionData.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    if (!canUlbReuploadDocument(sectionData.form_status_id, docSlot.stateDecision)) {
      throw new ForbiddenException('This document has already been approved and cannot be removed.');
    }

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

  // ─── ULB requests manual review of a failed OCR validation ───────────────────

  async requestManualReview(id: string, section: 'auditedData' | 'unauditedData', docId: string, user: AuthUser) {
    if (user.scope !== Scope.ULB) {
      throw new ForbiddenException('Only ULB users may request manual review');
    }

    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);

    const sectionData = (doc as any)[section];
    if (!sectionData) throw new NotFoundException('Section not found');

    const docSlot = (sectionData.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('Document not found in this section');

    if (docSlot.currentUpload.ocrInfo?.validationStatus !== 'FAIL') {
      throw new BadRequestException('Manual review can only be requested for a failed OCR validation.');
    }
    if (docSlot.currentUpload.ocrInfo?.isManualReviewRequested) {
      throw new BadRequestException('Manual review has already been requested for this document.');
    }

    const requestedAt = new Date();
    await Promise.all([
      this.annualAccountModel.updateOne(
        { _id: new Types.ObjectId(id), [`${section}.documents.docId`]: docId },
        {
          $set: {
            [`${section}.documents.$.currentUpload.ocrInfo.isManualReviewRequested`]: true,
            [`${section}.documents.$.currentUpload.ocrInfo.manualReviewRequestedAt`]: requestedAt,
            // A fresh request supersedes whatever ADMIN decided last cycle (e.g. after a retry).
            [`${section}.documents.$.manualReviewDecision`]: null,
          },
        },
      ),
      this.uploadHistoryModel.updateOne(
        { uploadId: docSlot.currentUpload.uploadId },
        { $set: { 'ocrInfo.isManualReviewRequested': true, 'ocrInfo.manualReviewRequestedAt': requestedAt } },
      ),
    ]);

    this.logger.log(
      `Manual review requested — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`,
    );
    return this.getProcessingStatus(id, user);
  }

  // ─── ADMIN approves/rejects a ULB's manual-review request ────────────────────

  async decideManualReview(
    id: string,
    section: 'auditedData' | 'unauditedData',
    docId: string,
    dto: ManualReviewDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may decide a manual review request');
    }

    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');

    const sectionData = (doc as any)[section];
    if (!sectionData) throw new NotFoundException('Section not found');

    const docSlot = (sectionData.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('Document not found in this section');

    if (!docSlot.currentUpload.ocrInfo?.isManualReviewRequested) {
      throw new BadRequestException('No manual review has been requested for this document.');
    }

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id), [`${section}.documents.docId`]: docId },
      {
        $set: {
          [`${section}.documents.$.manualReviewDecision`]: decision,
          ...(dto.decision === 'APPROVED' && { [`${section}.documents.$.processingStatus`]: 'PASSED' }),
        },
      },
    );

    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: doc.ulb,
      designYear: doc.design_year,
      section,
      formId: SECTION_FORM_IDS[section],
      action: dto.decision,
      toStatus: sectionData.form_status,
      actorStage: 'ADMIN',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      ...(dto.note != null && { note: dto.note }),
      documents: [
        buildFormLogDocumentEntry(docId, dto.decision, dto.note ?? null, docSlot.currentUpload.file?.path ?? null),
      ],
    });

    this.logger.log(
      `Manual review ${dto.decision.toLowerCase()} — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`,
    );
    return this.getProcessingStatus(id, user);
  }

  // ─── ADMIN's global manual-review queue ──────────────────────────────────────

  async getManualReviewQueue(dto: ManualReviewQueueQueryDto, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review queue');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const sectionToRows = (section: 'auditedData' | 'unauditedData'): PipelineStage.FacetPipelineStage[] => [
      // $unwind's default behavior (no preserveNullAndEmptyArrays) already skips documents where
      // the section itself is null (never started) — no separate null-guard needed beforehand.
      { $unwind: `$${section}.documents` },
      {
        $match: {
          [`${section}.documents.currentUpload.ocrInfo.isManualReviewRequested`]: true,
          [`${section}.documents.manualReviewDecision`]: null,
        },
      },
      {
        $project: {
          annualAccountId: '$_id',
          ulbId: '$ulb',
          state: '$state',
          section: { $literal: section },
          year: `$${section}.year`,
          docId: `$${section}.documents.docId`,
          uploadId: `$${section}.documents.currentUpload.uploadId`,
          jobId: `$${section}.documents.currentUpload.ocrInfo.jobId`,
          fileName: `$${section}.documents.currentUpload.file.originalName`,
          sizeKb: `$${section}.documents.currentUpload.file.sizeKb`,
          validationStatus: `$${section}.documents.currentUpload.ocrInfo.validationStatus`,
          validationDetails: `$${section}.documents.currentUpload.ocrInfo.validationDetails`,
          failedChecks: `$${section}.documents.currentUpload.ocrInfo.failedChecks`,
          manualReviewRequestedAt: `$${section}.documents.currentUpload.ocrInfo.manualReviewRequestedAt`,
        },
      },
    ];

    const pipeline: PipelineStage[] = [
      {
        $facet: {
          auditedData: sectionToRows('auditedData'),
          unauditedData: sectionToRows('unauditedData'),
        },
      },
      { $project: { rows: { $concatArrays: ['$auditedData', '$unauditedData'] } } },
      { $unwind: '$rows' },
      { $replaceRoot: { newRoot: '$rows' } },
      {
        $lookup: {
          from: 'ulbs',
          localField: 'ulbId',
          foreignField: '_id',
          as: 'ulbDoc',
        },
      },
      { $addFields: { ulbDoc: { $arrayElemAt: ['$ulbDoc', 0] } } },
      {
        $lookup: {
          from: 'states',
          localField: 'state',
          foreignField: '_id',
          as: 'stateDoc',
        },
      },
      { $addFields: { stateDoc: { $arrayElemAt: ['$stateDoc', 0] } } },
      {
        $addFields: {
          ulbName: '$ulbDoc.name',
          ulbCode: '$ulbDoc.code',
          stateName: '$stateDoc.name',
        },
      },
      ...(dto.search?.trim()
        ? [
            {
              $match: {
                $or: [
                  { ulbName: new RegExp(escapeRegex(dto.search.trim()), 'i') },
                  { ulbCode: new RegExp(escapeRegex(dto.search.trim()), 'i') },
                ],
              },
            } as PipelineStage,
          ]
        : []),
      { $sort: { manualReviewRequestedAt: 1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            {
              $project: {
                _id: 0,
                annualAccountId: 1,
                ulbId: 1,
                ulbName: 1,
                ulbCode: 1,
                stateName: 1,
                section: 1,
                year: 1,
                docId: 1,
                uploadId: 1,
                jobId: 1,
                fileName: 1,
                sizeKb: 1,
                validationStatus: 1,
                validationDetails: 1,
                failedChecks: 1,
                manualReviewRequestedAt: 1,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.annualAccountModel.aggregate(pipeline).exec();
    const rows = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    return { total, page, pageSize, rows };
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

    if (!canUlbSubmitForm(sectionData.form_status_id)) {
      throw new ForbiddenException(`This section cannot be submitted while its status is ${sectionData.form_status}.`);
    }

    // Resolve which docIds are currently required by the active upload config.
    // This means documents that were previously uploaded but are now hidden in the
    // config (e.g. receipts-payments while temporarily hidden) are not blocking.
    const requiredDocIds = await this.resolveRequiredDocIds(doc.design_year?.toString(), section);

    const docsToCheck = requiredDocIds
      ? sectionData.documents.filter((d: any) => requiredDocIds.includes(d.docId))
      : sectionData.documents;

    if (!docsToCheck.length) {
      throw new BadRequestException('No documents found in this section');
    }

    const allPassed = docsToCheck.every((d: any) => d.processingStatus === 'PASSED');
    if (!allPassed) {
      throw new BadRequestException('All documents must pass verification before submitting');
    }

    // A document the state returned stays blocking until the ULB re-uploads a corrected file —
    // OCR passing again doesn't clear a live RETURNED decision on its own.
    const stillReturned = docsToCheck
      .filter((d: any) => this.resolveEffectiveDecision(d)?.status === 'RETURNED')
      .map((d: any) => d.docId as string);
    if (stillReturned.length > 0) {
      throw new BadRequestException(
        `Cannot submit — these documents were returned by the state and must be re-uploaded first: ${stillReturned.join(', ')}`,
      );
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

    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: doc.ulb,
      designYear: doc.design_year,
      section,
      formId: SECTION_FORM_IDS[section],
      action: 'SUBMITTED',
      toStatus: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
      actorStage: 'ULB',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      // No note, no batch, and no decisions exist yet at submission — the upload-history
      // collection already covers "what documents existed at this point in time".
    });

    this.logger.log(`Section ${section} submitted with self-declaration — annualAccountId=${id} by user=${user._id}`);

    return {
      annualAccountId: id,
      section,
      form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
      form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
    };
  }

  // ─── State review decisions ───────────────────────────────────────────────────

  /** Per-document approve/return. Informational only — does not change the section's overall status. */
  async decideDocument(
    id: string,
    docId: string,
    dto: DocumentDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');

    const sectionData = (doc as any)[dto.section];
    if (!sectionData) throw new NotFoundException('Section not found');
    await this.assertCanDecide(doc, user, sectionData.form_status);

    const docSlot = (sectionData.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    const requiredDocIds = await this.resolveRequiredDocIds(doc.design_year?.toString(), dto.section);
    if (requiredDocIds && !requiredDocIds.includes(docId)) {
      throw new BadRequestException('This document is optional and cannot be approved or returned.');
    }

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    // Per-document decisions are informational only — the section's form_status and the
    // form-log audit trail only change on the explicit final "Approve Section"/"Return Section"
    // action (decideSection), not the moment any one document is approved or returned.
    // Provisional until then — STATE can undo it (see undoDocumentDecision) any time before.
    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id), [`${dto.section}.documents.docId`]: docId },
      { $set: { [`${dto.section}.documents.$.stateDecision`]: decision, updatedAt: new Date() } },
    );

    this.logger.log(
      `Document ${dto.decision.toLowerCase()} — annualAccountId=${id} section=${dto.section} docId=${docId} by user=${user._id}`,
    );

    return this.getProcessingStatus(id, user);
  }

  /**
   * Reverts a single document's decision back to undecided. Reuses the exact same gate as
   * decideDocument (assertCanDecide) — so once the section itself is finalized (Approve
   * Section/Return Section moves it past UNDER_REVIEW_BY_STATE), undo is no longer possible,
   * same as making a new decision wouldn't be either. No form-log entry — per-document
   * decisions are provisional until the section is finalized, so undoing one isn't an
   * audit-worthy event on its own.
   */
  async undoDocumentDecision(id: string, section: 'auditedData' | 'unauditedData', docId: string, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');

    const sectionData = (doc as any)[section];
    if (!sectionData) throw new NotFoundException('Section not found');
    await this.assertCanDecide(doc, user, sectionData.form_status);

    const docSlot = (sectionData.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id), [`${section}.documents.docId`]: docId },
      { $set: { [`${section}.documents.$.stateDecision`]: null, updatedAt: new Date() } },
    );

    this.logger.log(
      `Document decision undone — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`,
    );

    return this.getProcessingStatus(id, user);
  }

  /**
   * State's final call on a section.
   *
   * APPROVED: legal any time no document currently has a live RETURNED decision. Any
   * document that hasn't been individually decided yet (or whose decision has gone stale
   * because the ULB re-uploaded since) is auto-approved as part of this action, getting its
   * own proper APPROVED entry in stateDecision — the same as if STATE had approved it by hand.
   * Already-approved documents are left untouched.
   *
   * RETURNED: always legal. Only documents with no live decision yet are auto-marked
   * RETURNED (using this same reason) — already-APPROVED documents stay approved and locked
   * (an approved document is never undone by a section-level return), and documents already
   * individually RETURNED keep their own original reason rather than being overwritten.
   */
  async decideSection(
    id: string,
    dto: SectionDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
    batchId: string | null = null,
  ) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');

    const sectionData = (doc as any)[dto.section];
    if (!sectionData) throw new NotFoundException('Section not found');
    await this.assertCanDecide(doc, user, sectionData.form_status);

    // Optional documents (e.g. notes-to-accounts) are never approved/returned — individually
    // or via this section-wide sweep — so exclude them from every check below.
    const requiredDocIds = await this.resolveRequiredDocIds(doc.design_year?.toString(), dto.section);
    const isRequired = (docId: string) => !requiredDocIds || requiredDocIds.includes(docId);

    const documents: any[] = (sectionData.documents ?? []).filter((d: any) => isRequired(d.docId as string));
    const effectiveByDoc = documents.map((d) => ({
      docId: d.docId as string,
      effective: this.resolveEffectiveDecision(d),
      filePath: (d.currentUpload?.file?.path as string | undefined) ?? null,
    }));

    if (dto.decision === 'APPROVED') {
      const stillReturned = effectiveByDoc.filter((d) => d.effective?.status === 'RETURNED').map((d) => d.docId);
      if (stillReturned.length > 0) {
        throw new BadRequestException(
          `Cannot approve — these documents are currently returned and must be resolved first: ${stillReturned.join(', ')}`,
        );
      }
    }

    // State approval now lands on APPROVED_BY_STATE first — STATE can still undo it from
    // there before the (separately-built) Generate Claim Letter feature moves it onward.
    const newStatus =
      dto.decision === 'APPROVED'
        ? AnnualAccountFormStatus.APPROVED_BY_STATE
        : AnnualAccountFormStatus.RETURNED_BY_STATE;

    assertValidFormStatusTransition(sectionData.form_status_id, FORM_STATUS_ID[newStatus]);

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    // Only documents with no live decision (never decided, or stale after a re-upload) are
    // swept into this bulk action — already-decided documents are left exactly as they are.
    const toBulkDecide = effectiveByDoc.filter((d) => d.effective === null).map((d) => d.docId);

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          [`${dto.section}.form_status`]: newStatus,
          [`${dto.section}.form_status_id`]: FORM_STATUS_ID[newStatus],
          [`${dto.section}.stateDecision`]: decision,
          modifiedBy: new Types.ObjectId(user._id),
          ...(toBulkDecide.length > 0 && {
            [`${dto.section}.documents.$[elem].stateDecision`]: decision,
          }),
        },
      },
      toBulkDecide.length > 0 ? { arrayFilters: [{ 'elem.docId': { $in: toBulkDecide } }] } : undefined,
    );

    // Only a RETURNED event can end up with genuinely mixed per-document outcomes (some still
    // individually APPROVED, others RETURNED) — an APPROVED event always has every document
    // APPROVED (enforced by the stillReturned guard above), so the breakdown is omitted there.
    const documentsBreakdown: FormLogDocumentEntry[] | undefined =
      dto.decision === 'RETURNED'
        ? effectiveByDoc.map((d) =>
            buildFormLogDocumentEntry(
              d.docId,
              toBulkDecide.includes(d.docId) ? dto.decision : (d.effective?.status ?? null),
              toBulkDecide.includes(d.docId) ? (dto.note ?? null) : (d.effective?.note ?? null),
              d.filePath,
            ),
          )
        : undefined;

    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: doc.ulb,
      designYear: doc.design_year,
      section: dto.section,
      formId: SECTION_FORM_IDS[dto.section],
      action: dto.decision,
      toStatus: newStatus,
      actorStage: 'STATE',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      ...(dto.note != null && { note: dto.note }),
      ...(batchId != null && { batchId }),
      ...(documentsBreakdown && { documents: documentsBreakdown }),
    });

    this.logger.log(
      `Section ${dto.decision.toLowerCase()} — annualAccountId=${id} section=${dto.section} by user=${user._id}` +
        (toBulkDecide.length > 0 ? ` — bulk-decided ${toBulkDecide.length} document(s)` : ''),
    );

    return this.getProcessingStatus(id, user);
  }

  /**
   * Reverses a STATE-level Approve Section decision — only legal while the section is exactly
   * APPROVED_BY_STATE. Once Generate Claim Letter (built separately) moves it on to
   * AWAITING_CLAIM_LETTER, this door closes for good — mirrors the shared ALLOWED_TRANSITIONS
   * table, which has no entry taking AWAITING_CLAIM_LETTER back to UNDER_REVIEW_BY_STATE.
   *
   * The live document only ever gets ONE atomic write, straight back to UNDER_REVIEW_BY_STATE —
   * status UNDO (10) never actually lives on the main record. It appears only as the `toStatus`
   * of the first of two form-log entries this writes (UNDO, then UNDER_REVIEW_BY_STATE), giving
   * a complete, literal 8→10→3 audit trail without ever persisting an unsupported live state.
   */
  async undoSectionApproval(
    id: string,
    section: 'auditedData' | 'unauditedData',
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');

    const sectionData = (doc as any)[section];
    if (!sectionData) throw new NotFoundException('Section not found');
    await this.assertCanUndoSectionApproval(doc, user, sectionData.form_status);

    assertValidFormStatusTransition(
      sectionData.form_status_id,
      FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
    );

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          [`${section}.form_status`]: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
          [`${section}.form_status_id`]: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
          [`${section}.stateDecision`]: null,
          // Undoing the section-level approval also undoes every document's individual
          // decision — otherwise they'd all still show APPROVED and re-approving the section
          // immediately after would trivially succeed with no real re-review (see decideSection).
          [`${section}.documents.$[].stateDecision`]: null,
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    const userInfo = { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent };
    const logBase = {
      annualAccountId: new Types.ObjectId(id),
      ulb: doc.ulb,
      designYear: doc.design_year,
      section,
      formId: SECTION_FORM_IDS[section],
      action: 'UNDO' as const,
      actorStage: 'STATE' as const,
      userInfo,
    };

    await this.formLogModel.create({ ...logBase, toStatus: AnnualAccountFormStatus.UNDO });
    await this.formLogModel.create({ ...logBase, toStatus: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE });

    this.logger.log(`Section approval undone — annualAccountId=${id} section=${section} by user=${user._id}`);

    return this.getProcessingStatus(id, user);
  }

  private async assertCanUndoSectionApproval(
    doc: any,
    user: AuthUser,
    sectionStatus: AnnualAccountFormStatus,
  ): Promise<void> {
    const hasAccess = await this.hasStateAccessToUlb(user, doc.ulb);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to approve ULB submissions');
    }
    if (sectionStatus !== AnnualAccountFormStatus.APPROVED_BY_STATE) {
      throw new ForbiddenException(`This section's approval cannot be undone while its status is ${sectionStatus}.`);
    }
  }

  /**
   * A document's latest decision only counts against the file it was made on. If the ULB
   * re-uploaded a corrected file after that decision, the old verdict is stale — the document
   * is effectively undecided again until STATE reviews the new file. Mirrors the identical
   * staleness rule the frontend applies when rendering each document's status.
   */
  private resolveEffectiveDecision(docSlot: any): { status: 'APPROVED' | 'RETURNED'; note: string | null } | null {
    const latest = docSlot.stateDecision ?? null;
    if (!latest) return null;

    const uploadedAt = docSlot.currentUpload?.uploadedAt ? new Date(docSlot.currentUpload.uploadedAt).getTime() : null;
    const decidedAt = new Date(latest.decidedAt).getTime();
    if (uploadedAt !== null && uploadedAt > decidedAt) return null;

    return { status: latest.status, note: latest.note };
  }

  /**
   * docIds currently marked required (`required !== false`) in the active upload config for
   * this section, or null if the formjson lookup fails — callers should then treat every
   * document as required (existing safe default). Optional docs (e.g. notes-to-accounts) are
   * excluded so they never block submission, get swept into a bulk section decision, or
   * count against a state reviewer's approve/return gate.
   */
  private async resolveRequiredDocIds(
    designYearId: string | undefined,
    section: 'auditedData' | 'unauditedData',
  ): Promise<string[] | null> {
    try {
      const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(
        designYearId,
        SECTION_FORM_IDS[section],
      );
      return ((formJson.data ?? []) as Array<{ key: string; required?: boolean }>)
        .filter((f) => f.required !== false)
        .map((f) => f.key);
    } catch {
      return null;
    }
  }

  /**
   * Gmail-style bulk approve/return across many ULB submissions in one action.
   * Reuses decideSection per id (same permission + all-or-nothing document check applies
   * to each one individually) rather than a blind bulkWrite — an APPROVED decision still
   * depends on that specific document's own state, which can't be collapsed into one query.
   * Every row succeeds or fails independently; a shared batchId correlates the resulting
   * log entries. Runs sequentially, not queued — fine at the ids cap of 500; revisit only
   * if bulk batches grow large enough to matter.
   */
  async bulkDecideSection(
    dto: BulkSectionDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<BulkDecisionResult> {
    const result = await runBulkDecision(dto.ids, (id, batchId) =>
      this.decideSection(
        id,
        { section: dto.section, decision: dto.decision, note: dto.note },
        user,
        ipAddress,
        userAgent,
        batchId,
      ),
    );

    this.logger.log(
      `Bulk section decision — batchId=${result.batchId} section=${dto.section} decision=${dto.decision} succeeded=${result.succeeded}/${dto.ids.length} by user=${user._id}`,
    );

    return result;
  }

  /**
   * Guards both decision endpoints: requester must have state access to the ULB,
   * hold APPROVE_ULB_SUBMISSIONS, and the section must currently be under review.
   */
  private async assertCanDecide(doc: any, user: AuthUser, sectionStatus: AnnualAccountFormStatus): Promise<void> {
    const hasAccess = await this.hasStateAccessToUlb(user, doc.ulb);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to approve ULB submissions');
    }
    if (!canStateDecideAnnualAccount(sectionStatus)) {
      throw new ForbiddenException(`This section cannot be decided while its status is ${sectionStatus}.`);
    }
  }

  // ─── MOHUA review decisions ───────────────────────────────────────────────────

  /**
   * MOHUA's final call on a section state has already approved and handed off.
   * MOHUA decides on the section as a whole — there is no per-document MOHUA
   * decision layer, since every document is already individually STATE-approved
   * by the time a section reaches UNDER_REVIEW_BY_MOHUA.
   */
  async decideMohuaSection(
    id: string,
    dto: SectionDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');

    const sectionData = (doc as any)[dto.section];
    if (!sectionData) throw new NotFoundException('Section not found');
    this.assertCanMohuaDecide(user, sectionData.form_status);

    const newStatus =
      dto.decision === 'APPROVED'
        ? AnnualAccountFormStatus.SUBMISSION_ACKNOWLEDGED_BY_MOHUA
        : AnnualAccountFormStatus.RETURNED_BY_MOHUA;

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    await this.annualAccountModel.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          [`${dto.section}.form_status`]: newStatus,
          [`${dto.section}.form_status_id`]: FORM_STATUS_ID[newStatus],
          [`${dto.section}.mohuaDecision`]: decision,
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    // MOHUA has no per-document decision layer — every document is already individually
    // STATE-approved by this point, regardless of MOHUA's own APPROVED/RETURNED verdict here —
    // so there's no per-document breakdown worth recording for either outcome.
    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: doc.ulb,
      designYear: doc.design_year,
      section: dto.section,
      formId: SECTION_FORM_IDS[dto.section],
      action: dto.decision,
      toStatus: newStatus,
      actorStage: 'MOHUA',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      ...(dto.note != null && { note: dto.note }),
    });

    this.logger.log(
      `Section ${dto.decision.toLowerCase()} by MOHUA — annualAccountId=${id} section=${dto.section} by user=${user._id}`,
    );

    return this.getProcessingStatus(id, user);
  }

  /** Guards the MOHUA decision endpoint: requester must hold MOHUA/ADMIN scope and APPROVE_STATE_SUBMISSIONS. */
  private assertCanMohuaDecide(user: AuthUser, sectionStatus: AnnualAccountFormStatus): void {
    if (!this.hasMohuaAccess(user)) {
      throw new ForbiddenException('Access denied');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_STATE_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review state submissions');
    }
    if (!canMohuaDecideAnnualAccount(sectionStatus)) {
      throw new ForbiddenException(`This section cannot be decided while its status is ${sectionStatus}.`);
    }
  }

  /** MOHUA is a central role — unlike STATE, access isn't scoped to a matching state. */
  private hasMohuaAccess(user: AuthUser): boolean {
    return user.scope === Scope.MOHUA || user.scope === Scope.ADMIN;
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

  private async findOrInitialize(
    ulbId: string,
    stateId: string,
    designYearId: string,
    user: AuthUser,
  ): Promise<string> {
    const ulb = await this.ulbModel.findById(new Types.ObjectId(ulbId)).select('state').lean().exec();
    if (!ulb) throw new NotFoundException('ULB not found');
    if (ulb.state?.toString() !== stateId) {
      throw new BadRequestException("stateId does not match this ULB's state");
    }

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
            state: new Types.ObjectId(stateId),
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

    return doc._id.toString();
  }

  private async upsertDocumentSlot(
    annualAccountId: string,
    dto: UploadDocumentDto,
    currentUpload: Record<string, unknown>,
    processingStatus: string = 'PROCESSING',
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
          [`${section}.documents.$.processingStatus`]: processingStatus,
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
              processingStatus,
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

  /**
   * Two-layer upload gate: the section must be ULB-editable (shared FORM_STATUS gate), and
   * this specific document must not already be individually APPROVED by STATE.
   */
  private async assertCanUlbUpload(
    ulbId: string,
    designYearId: string,
    section: 'auditedData' | 'unauditedData',
    docId: string,
  ): Promise<void> {
    const doc = await this.annualAccountModel
      .findOne({ ulb: new Types.ObjectId(ulbId), design_year: new Types.ObjectId(designYearId) })
      .lean()
      .exec();
    if (!doc) return;

    const sectionData = doc[section];
    if (!sectionData) return;

    if (!canUlbEditForm(sectionData.form_status_id)) {
      throw new ForbiddenException(`This section cannot be edited while its status is ${sectionData.form_status}.`);
    }

    const docSlot = sectionData.documents.find((d) => d.docId === docId);
    if (!canUlbReuploadDocument(sectionData.form_status_id, docSlot?.stateDecision)) {
      throw new ForbiddenException('This document has already been approved and cannot be re-uploaded.');
    }
  }

  /**
   * ULB users may only view their own ULB's account. STATE users may only view ULBs
   * belonging to their own state. ADMIN and MOHUA are unrestricted, matching prior behavior.
   */
  private async validateViewAccess(doc: any, user: AuthUser): Promise<void> {
    if (user.scope === Scope.ULB) {
      if (doc.ulb?.toString() !== user.ulb?.toString()) {
        throw new ForbiddenException('Access denied');
      }
      return;
    }
    if (user.scope === Scope.STATE) {
      const hasAccess = await this.hasStateAccessToUlb(user, doc.ulb);
      if (!hasAccess) {
        throw new ForbiddenException('Access denied');
      }
    }
  }

  /** Returns true when the given STATE (or ADMIN) user may act on the ULB's account. */
  private async hasStateAccessToUlb(user: AuthUser, ulbId: unknown): Promise<boolean> {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope !== Scope.STATE) return false;
    const ulb = await this.ulbModel
      .findById(ulbId as Types.ObjectId)
      .select('state')
      .lean()
      .exec();
    return !!ulb && ulb.state?.toString() === user.state?.toString();
  }

  /**
   * Derives status-aware capability flags for one section (auditedData/unauditedData).
   * canReview/canApprove are false whenever the section status does not allow it,
   * regardless of the user's role — mirrors SfcStatusService.buildFormPermissions.
   */
  private buildAnnualAccountPermissions(
    user: AuthUser,
    hasStateAccess: boolean,
    status: AnnualAccountFormStatus,
  ): AnnualAccountPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasMohuaAccess = this.hasMohuaAccess(user);
    return {
      canView: perms.has(Permission.VIEW_STATUS_REPORTS),
      canUpload: user.scope === Scope.ULB && perms.has(Permission.UPLOAD_DOCUMENTS),
      canReview: hasStateAccess && perms.has(Permission.REVIEW_ULB_SUBMISSIONS) && canStateReviewAnnualAccount(status),
      canApprove:
        hasStateAccess && perms.has(Permission.APPROVE_ULB_SUBMISSIONS) && canStateDecideAnnualAccount(status),
      canUndoApproval:
        hasStateAccess && perms.has(Permission.APPROVE_ULB_SUBMISSIONS) && canStateUndoSectionApproval(status),
      canMohuaReview:
        hasMohuaAccess && perms.has(Permission.REVIEW_STATE_SUBMISSIONS) && canMohuaReviewAnnualAccount(status),
      canMohuaApprove:
        hasMohuaAccess && perms.has(Permission.APPROVE_STATE_SUBMISSIONS) && canMohuaDecideAnnualAccount(status),
    };
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
    const [formJson, actionGates] = await Promise.all([
      this.formJsonService.findActiveByDesignYearAndFormId(yearId, formId),
      this.getActionGates(formId),
    ]);
    return { meta: formJson.meta ?? {}, data: formJson.data ?? [], actionGates };
  }

  /**
   * UI-visibility gates for document/section action buttons — which (role, action) pairs are
   * reachable, and in which section statuses. Not an authorization check; see
   * XviFcDocumentActionGate for why. Returns every active gate scoped to this form (or the
   * module-wide wildcard), across all roles — the caller filters by the viewing user's role.
   */
  private async getActionGates(formId: number) {
    const gates = await this.actionGateModel
      .find({ module: 'XVI-FC', formId: { $in: [null, formId] }, isActive: true })
      .lean()
      .exec();

    return gates.map((g) => ({
      docKey: g.docKey,
      scope: g.scope,
      role: g.role,
      action: g.action,
      statusIds: g.statusIds,
    }));
  }
}
