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
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Model, PipelineStage, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../../../core/s3/s3.service';
import { EmailQueueService } from '../../../../core/queue/email-queue/email-queue.service';
import { S3UploadService } from '../../../file/s3-upload.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { assertValidFormStatusTransition } from '../../../../common/utils/form-status-transitions';
import {
  AnnualAccountFormStatus,
  AnnualAccountSectionType,
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
import { User, UserDocument } from '../../../../schemas/user/user.schema';
import { Role } from '../../../auth/enum/role.enum';
import { UlbEligibilityService } from '../../../ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from '../../../ulb-eligibility/ulb-eligibility.constants';
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
  isAwaitingManualReviewDecision,
} from './annual-account-status-access.util';

/** 'auditedData' | 'unauditedData' section keys as they appear in DTOs/query params, mapped to
 *  the physical-document discriminator (XviFcAnnualAccount.sectionType) below. */
export type AnnualAccountSectionKey = 'auditedData' | 'unauditedData';

const SECTION_KEY_TO_TYPE: Record<AnnualAccountSectionKey, AnnualAccountSectionType> = {
  auditedData: 'audited',
  unauditedData: 'unaudited',
};

/** formId for each section, per the active upload-config formjson documents (30 = audited, 31 = provisional). */
const SECTION_FORM_IDS: Record<AnnualAccountSectionKey, number> = { auditedData: 30, unauditedData: 31 };

/**
 * How long a document may sit at PROCESSING before it's treated as stuck (e.g. the worker
 * died mid-job on a server restart, with nothing left to ever mark it FAILED). Past this
 * threshold, the ULB gets Retry/Re-upload instead of an infinite spinner.
 */
const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000;
const SECTION_LABELS: Record<AnnualAccountSectionKey, string> = {
  auditedData: 'Audited',
  unauditedData: 'Provisional',
};

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

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    @InjectModel(XviFcDocumentActionGate.name)
    private readonly actionGateModel: Model<DocumentActionGateDocument>,

    private readonly s3Service: S3Service,

    private readonly s3UploadService: S3UploadService,

    @InjectQueue(ANNUAL_ACCOUNT_PROCESSING_QUEUE)
    private readonly ocrQueue: Queue<AnnualAccountOcrJobData>,

    private readonly formJsonService: FormJsonService,

    private readonly fileTokenService: FileTokenService,

    private readonly emailQueueService: EmailQueueService,

    private readonly configService: ConfigService,

    private readonly ulbEligibilityService: UlbEligibilityService,
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
    await this.validateUploadPermission(user, { ulbId: dto.ulbId, section: dto.section } as UploadDocumentDto);

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
    await this.validateUploadPermission(user, dto as unknown as UploadDocumentDto);
    await this.assertCanUlbUpload(
      dto.ulbId,
      dto.designYearId,
      dto.section as AnnualAccountSectionKey,
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

    // Always the 'audited' anchor document's id, regardless of which section is being
    // uploaded to — see resolveSectionDocument for why every external annualAccountId is
    // this id.
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
      retryValidationCount: 0,
    };

    const initialProcessingStatus = isNoOcrDoc ? 'PASSED' : 'PROCESSING';

    await this.upsertDocumentSlot(
      annualAccountId,
      dto as unknown as UploadDocumentDto,
      currentUpload,
      user,
      initialProcessingStatus,
    );

    await this.uploadHistoryModel.create({
      annualAccountId: new Types.ObjectId(annualAccountId),
      ulb: new Types.ObjectId(dto.ulbId),
      designYear: new Types.ObjectId(dto.designYearId),
      section: dto.section,
      auditType: dto.auditType,
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
        auditType: dto.auditType,
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
    const anchor = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!anchor) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(anchor, user);

    const historyDoc = await this.uploadHistoryModel
      .findOne({ annualAccountId: new Types.ObjectId(id), uploadId })
      .lean()
      .exec();

    if (!historyDoc) throw new NotFoundException('Upload not found');

    const isStalledProcessing =
      historyDoc.processingStatus === 'PROCESSING' &&
      !!historyDoc.startedAt &&
      Date.now() - historyDoc.startedAt.getTime() > STALE_PROCESSING_THRESHOLD_MS;

    if (historyDoc.processingStatus !== 'FAILED' && !isStalledProcessing) {
      throw new BadRequestException('Only FAILED or stalled uploads can be retried');
    }

    const expectedDocType = DOC_TYPE_MAP[historyDoc.docId];
    if (!expectedDocType) throw new BadRequestException(`Unknown docId: ${historyDoc.docId}`);

    const sectionDoc = await this.lookupSectionDoc(anchor, historyDoc.section as AnnualAccountSectionKey);
    if (!sectionDoc) throw new NotFoundException('Section not found');

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === historyDoc.docId);
    if (isAwaitingManualReviewDecision(docSlot?.currentUpload?.ocrInfo?.isManualReviewRequested, docSlot?.manualReviewDecision)) {
      throw new ForbiddenException(
        'This document is awaiting manual review and cannot be retried until an ADMIN makes a decision.',
      );
    }

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
          _id: sectionDoc._id,
          'documents.docId': historyDoc.docId,
        },
        {
          $set: {
            'documents.$.processingStatus': 'PROCESSING',
            'documents.$.currentUpload.ocrInfo.jobId': null,
            'documents.$.currentUpload.ocrInfo.status': null,
            'documents.$.currentUpload.ocrInfo.progressStep': null,
            'documents.$.currentUpload.ocrInfo.submittedAt': null,
            'documents.$.currentUpload.ocrInfo.completedAt': null,
            'documents.$.currentUpload.ocrInfo.validationStatus': null,
            'documents.$.currentUpload.ocrInfo.validationDetails': null,
            'documents.$.currentUpload.ocrInfo.failedChecks': [],
            'documents.$.currentUpload.ocrInfo.isManualReviewRequested': false,
            'documents.$.currentUpload.ocrInfo.manualReviewRequestedAt': null,
          },
          $inc: { 'documents.$.currentUpload.retryValidationCount': 1 },
        },
      ),
    ]);

    await this.enqueueOcrJob({
      uploadId,
      annualAccountId: id,
      ulbId: anchor.ulb.toString(),
      section: historyDoc.section,
      auditType: historyDoc.auditType,
      docId: historyDoc.docId,
      s3Key: historyDoc.file.path,
      expectedDocType,
      financialYear: sectionDoc.year ?? '',
    });

    return { uploadId, status: 'PROCESSING', message: 'Retry queued successfully' };
  }

  // ─── Lookup by ULB + design year ─────────────────────────────────────────────

  async findByUlbAndYear(
    ulbId: string,
    designYearId: string,
    section: AnnualAccountSectionKey,
    user: AuthUser,
  ) {
    // Always look up the 'audited' anchor regardless of which section was requested — that's
    // the id resolveSectionDocument (via getProcessingStatus) expects to resolve against.
    const doc = await this.annualAccountModel
      .findOne({
        ulb: new Types.ObjectId(ulbId),
        design_year: new Types.ObjectId(designYearId),
        sectionType: 'audited',
      })
      .lean()
      .exec();

    if (!doc) return null;
    await this.validateViewAccess(doc, user);
    return this.getProcessingStatus(doc._id.toString(), section, user);
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
    const wantSectionType = SECTION_KEY_TO_TYPE[dto.section];

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      // 'audited' is always the anchor doc's own id — every annualAccountId this endpoint
      // hands back must be that id regardless of which section tab is being listed.
      {
        $lookup: {
          from: 'xvifc_annualaccounts',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$ulb', '$$ulbId'] },
                    { $eq: ['$design_year', new Types.ObjectId(dto.designYearId)] },
                    { $eq: ['$sectionType', 'audited'] },
                  ],
                },
              },
            },
          ],
          as: 'anchorAccount',
        },
      },
      { $addFields: { anchorAccount: { $arrayElemAt: ['$anchorAccount', 0] } } },
      {
        $lookup: {
          from: 'xvifc_annualaccounts',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$ulb', '$$ulbId'] },
                    { $eq: ['$design_year', new Types.ObjectId(dto.designYearId)] },
                    { $eq: ['$sectionType', wantSectionType] },
                  ],
                },
              },
            },
          ],
          as: 'sectionAccount',
        },
      },
      { $addFields: { sectionAccount: { $arrayElemAt: ['$sectionAccount', 0] } } },
      {
        $addFields: {
          formStatus: { $ifNull: ['$sectionAccount.form_status', notStarted] },
          formStatusId: { $ifNull: ['$sectionAccount.form_status_id', FORM_STATUS_ID[notStarted]] },
          lastUpdatedAt: { $ifNull: ['$sectionAccount.updatedAt', null] },
          hasManualReviewRequests: {
            $anyElementTrue: {
              $map: {
                input: { $ifNull: ['$sectionAccount.documents', []] },
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
              annualAccountId: { $ifNull: ['$anchorAccount._id', null] },
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

  async getDetails(id: string, section: AnnualAccountSectionKey, user: AuthUser) {
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    await this.validateViewAccess(anchor, user);

    return { annualAccountId: anchor._id, data: sectionDoc ? this.stripS3Keys(sectionDoc) : null };
  }

  // ─── Polling status ───────────────────────────────────────────────────────────

  async getProcessingStatus(id: string, section: AnnualAccountSectionKey, user: AuthUser) {
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    await this.validateViewAccess(anchor, user);

    const hasStateAccess = await this.hasStateAccessToUlb(user, anchor.ulb);

    // Batch-fetch startedAt for every currently-PROCESSING document in this section, so a
    // long-stuck upload (e.g. the worker died mid-job on a server restart) can be flagged stale
    // instead of spinning forever with no way out.
    const processingUploadIds: string[] = (sectionDoc?.documents ?? [])
      .filter((d: any) => d.processingStatus === 'PROCESSING' && d.currentUpload?.uploadId)
      .map((d: any) => d.currentUpload.uploadId);

    const startedAtByUploadId = new Map<string, Date>();
    if (processingUploadIds.length) {
      const histories = await this.uploadHistoryModel
        .find({ uploadId: { $in: processingUploadIds } }, 'uploadId startedAt')
        .lean()
        .exec();
      histories.forEach((h) => {
        if (h.startedAt) startedAtByUploadId.set(h.uploadId, h.startedAt);
      });
    }

    const isDocStale = (d: any): boolean => {
      if (d.processingStatus !== 'PROCESSING' || !d.currentUpload?.uploadId) return false;
      const startedAt = startedAtByUploadId.get(d.currentUpload.uploadId);
      return !!startedAt && Date.now() - startedAt.getTime() > STALE_PROCESSING_THRESHOLD_MS;
    };

    const buildSectionStatus = (section: any) => {
      // A section is "not started" either because its document doesn't exist yet (unaudited,
      // never touched) or because it exists only as the anchor placeholder created by the
      // very first upload to *either* section (audited, materialized but never itself
      // uploaded to) — both cases render identically.
      if (!section || section.form_status === AnnualAccountFormStatus.NOT_STARTED) {
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
          isStale: isDocStale(d),
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
                retryValidationCount: d.currentUpload.retryValidationCount ?? 0,
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

    const ulb = await this.ulbModel.findById(anchor.ulb).select('name code').lean().exec();

    return {
      annualAccountId: anchor._id,
      ulbName: ulb?.name ?? null,
      ulbCode: ulb?.code ?? null,
      data: buildSectionStatus(sectionDoc),
    };
  }

  // ─── Form status audit log ────────────────────────────────────────────────────

  async getFormLogs(id: string, section: AnnualAccountSectionKey | undefined, user: AuthUser) {
    const doc = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!doc) throw new NotFoundException('Annual account not found');
    await this.validateViewAccess(doc, user);

    // Every form-log entry (either section) is stamped with the anchor id — see
    // resolveSectionDocument.
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

  async removeDocument(id: string, section: AnnualAccountSectionKey, docId: string, user: AuthUser) {
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    await this.validateViewAccess(anchor, user);
    if (!sectionDoc) throw new NotFoundException('Section not found');

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    if (!canUlbReuploadDocument(sectionDoc.form_status_id, docSlot.stateDecision)) {
      throw new ForbiddenException('This document has already been approved and cannot be removed.');
    }

    if (isAwaitingManualReviewDecision(docSlot.currentUpload?.ocrInfo?.isManualReviewRequested, docSlot.manualReviewDecision)) {
      throw new ForbiddenException(
        'This document is awaiting manual review and cannot be removed until an ADMIN makes a decision.',
      );
    }

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id, 'documents.docId': docId },
      {
        $set: {
          'documents.$.currentUpload': null,
          'documents.$.uploadStatus': 'NOT_UPLOADED',
          'documents.$.processingStatus': 'NOT_STARTED',
          updatedAt: new Date(),
        },
      },
    );

    this.logger.log(`Document removed — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`);
    return { annualAccountId: id, section, docId, message: 'Document removed successfully' };
  }

  // ─── ULB requests manual review of a failed OCR validation ───────────────────

  async requestManualReview(id: string, section: AnnualAccountSectionKey, docId: string, user: AuthUser) {
    if (user.scope !== Scope.ULB) {
      throw new ForbiddenException('Only ULB users may request manual review');
    }

    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    await this.validateViewAccess(anchor, user);
    if (!sectionDoc) throw new NotFoundException('Section not found');

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === docId);
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
        { _id: sectionDoc._id, 'documents.docId': docId },
        {
          $set: {
            'documents.$.currentUpload.ocrInfo.isManualReviewRequested': true,
            'documents.$.currentUpload.ocrInfo.manualReviewRequestedAt': requestedAt,
            // A fresh request supersedes whatever ADMIN decided last cycle (e.g. after a retry).
            'documents.$.manualReviewDecision': null,
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

    this.notifyManualReviewRequested(anchor, section, docSlot, requestedAt).catch((err: unknown) => {
      this.logger.error(`Failed to queue manual-review-requested notification for annualAccountId=${id}:`, err);
    });

    return this.getProcessingStatus(id, section, user);
  }

  private async notifyManualReviewRequested(
    doc: { ulb: Types.ObjectId },
    section: AnnualAccountSectionKey,
    docSlot: { docId: string; currentUpload: { file?: { originalName?: string | null } | null } },
    requestedAt: Date,
  ): Promise<void> {
    const notifyEmail = this.configService.get<string>('MANUAL_REVIEW_NOTIFY_EMAIL');
    if (!notifyEmail) return;

    const ulbDoc = await this.ulbModel.findById(doc.ulb).select('name code').lean().exec();
    const clientUrl = this.configService.get<string>('CLIENT_URL', 'https://cityfinance.in');

    await this.emailQueueService.addEmailJob({
      to: notifyEmail,
      subject: 'XVI-FC: Manual review requested for a ULB annual account document',
      templateName: './annual-account-manual-review-requested',
      mailData: {
        ulbName: ulbDoc?.name ?? 'Unknown ULB',
        ulbCode: ulbDoc?.code ?? '—',
        section: SECTION_LABELS[section],
        docId: docSlot.docId,
        fileName: docSlot.currentUpload.file?.originalName ?? docSlot.docId,
        requestedAt: requestedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
        reviewQueueUrl: `${clientUrl}/xvifc`,
      },
    });
  }

  // ─── ADMIN approves/rejects a ULB's manual-review request ────────────────────

  async decideManualReview(
    id: string,
    section: AnnualAccountSectionKey,
    docId: string,
    dto: ManualReviewDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may decide a manual review request');
    }

    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    if (!sectionDoc) throw new NotFoundException('Section not found');

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('Document not found in this section');

    if (!docSlot.currentUpload.ocrInfo?.isManualReviewRequested) {
      throw new BadRequestException('No manual review has been requested for this document.');
    }

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id, 'documents.docId': docId },
      {
        $set: {
          'documents.$.manualReviewDecision': decision,
          ...(dto.decision === 'APPROVED' && { 'documents.$.processingStatus': 'PASSED' }),
        },
      },
    );

    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: anchor.ulb,
      designYear: anchor.design_year,
      section,
      formId: SECTION_FORM_IDS[section],
      action: dto.decision,
      toStatus: sectionDoc.form_status,
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

    this.notifyUlbOfManualReviewDecision(anchor, section, docSlot, decision).catch((err: unknown) => {
      this.logger.error(`Failed to queue manual-review-decision notification for annualAccountId=${id}:`, err);
    });

    return this.getProcessingStatus(id, section, user);
  }

  private async notifyUlbOfManualReviewDecision(
    doc: { ulb: Types.ObjectId },
    section: AnnualAccountSectionKey,
    docSlot: { docId: string; currentUpload: { file?: { originalName?: string | null } | null } },
    decision: { status: 'APPROVED' | 'RETURNED'; note?: string | null; decidedAt: Date },
  ): Promise<void> {
    const [ulbDoc, ulbUser] = await Promise.all([
      this.ulbModel.findById(doc.ulb).select('name code').lean().exec(),
      this.userModel.findOne({ ulb: doc.ulb, role: Role.ULB }).select('email name').lean().exec(),
    ]);
    if (!ulbUser?.email) return;

    const clientUrl = this.configService.get<string>('CLIENT_URL', 'https://cityfinance.in');
    const decidedAt = decision.decidedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const templateName =
      decision.status === 'APPROVED'
        ? './annual-account-manual-review-approved'
        : './annual-account-manual-review-returned';

    await this.emailQueueService.addEmailJob({
      to: ulbUser.email,
      subject:
        decision.status === 'APPROVED'
          ? 'XVI-FC: Your manual review request was approved'
          : 'XVI-FC: Your manual review request was returned',
      templateName,
      mailData: {
        name: ulbUser.name,
        ulbName: ulbDoc?.name ?? 'Unknown ULB',
        ulbCode: ulbDoc?.code ?? '—',
        section: SECTION_LABELS[section],
        docId: docSlot.docId,
        fileName: docSlot.currentUpload.file?.originalName ?? docSlot.docId,
        note: decision.note ?? null,
        decidedAt,
        loginUrl: `${clientUrl}/xvifc`,
      },
    });
  }

  // ─── ADMIN's global manual-review queue ──────────────────────────────────────

  async getManualReviewQueue(dto: ManualReviewQueueQueryDto, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review queue');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    // Rooted at the 'audited' document so `$_id` is always the anchor id for both branches
    // below — the unaudited sibling is joined in, never queried as its own starting point.
    const pipeline: PipelineStage[] = [
      { $match: { sectionType: 'audited' } },
      {
        $lookup: {
          from: 'xvifc_annualaccounts',
          let: { ulbId: '$ulb', designYear: '$design_year' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$ulb', '$$ulbId'] },
                    { $eq: ['$design_year', '$$designYear'] },
                    { $eq: ['$sectionType', 'unaudited'] },
                  ],
                },
              },
            },
          ],
          as: 'unauditedSibling',
        },
      },
      { $addFields: { unauditedSibling: { $arrayElemAt: ['$unauditedSibling', 0] } } },
      {
        $facet: {
          auditedRows: [
            // $unwind's default behavior (no preserveNullAndEmptyArrays) already skips documents
            // with no documents — no separate null-guard needed beforehand.
            { $unwind: '$documents' },
            {
              $match: {
                'documents.currentUpload.ocrInfo.isManualReviewRequested': true,
                'documents.manualReviewDecision': null,
              },
            },
            {
              $project: {
                annualAccountId: '$_id',
                ulbId: '$ulb',
                state: '$state',
                section: { $literal: 'auditedData' },
                year: '$year',
                docId: '$documents.docId',
                uploadId: '$documents.currentUpload.uploadId',
                jobId: '$documents.currentUpload.ocrInfo.jobId',
                fileName: '$documents.currentUpload.file.originalName',
                sizeKb: '$documents.currentUpload.file.sizeKb',
                validationStatus: '$documents.currentUpload.ocrInfo.validationStatus',
                validationDetails: '$documents.currentUpload.ocrInfo.validationDetails',
                failedChecks: '$documents.currentUpload.ocrInfo.failedChecks',
                manualReviewRequestedAt: '$documents.currentUpload.ocrInfo.manualReviewRequestedAt',
              },
            },
          ],
          unauditedRows: [
            { $unwind: '$unauditedSibling.documents' },
            {
              $match: {
                'unauditedSibling.documents.currentUpload.ocrInfo.isManualReviewRequested': true,
                'unauditedSibling.documents.manualReviewDecision': null,
              },
            },
            {
              $project: {
                // Anchor's own _id, not the unaudited sibling's — the external annualAccountId
                // is always the audited document's id.
                annualAccountId: '$_id',
                ulbId: '$ulb',
                state: '$state',
                section: { $literal: 'unauditedData' },
                year: '$unauditedSibling.year',
                docId: '$unauditedSibling.documents.docId',
                uploadId: '$unauditedSibling.documents.currentUpload.uploadId',
                jobId: '$unauditedSibling.documents.currentUpload.ocrInfo.jobId',
                fileName: '$unauditedSibling.documents.currentUpload.file.originalName',
                sizeKb: '$unauditedSibling.documents.currentUpload.file.sizeKb',
                validationStatus: '$unauditedSibling.documents.currentUpload.ocrInfo.validationStatus',
                validationDetails: '$unauditedSibling.documents.currentUpload.ocrInfo.validationDetails',
                failedChecks: '$unauditedSibling.documents.currentUpload.ocrInfo.failedChecks',
                manualReviewRequestedAt: '$unauditedSibling.documents.currentUpload.ocrInfo.manualReviewRequestedAt',
              },
            },
          ],
        },
      },
      { $project: { rows: { $concatArrays: ['$auditedRows', '$unauditedRows'] } } },
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
    section: AnnualAccountSectionKey,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    // this.validateSubmitAccess(doc, user);
    await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
      anchor.ulb,
      'XVIFC',
      CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
    );

    if (!sectionDoc?.documents?.length) {
      throw new BadRequestException('No documents found in this section');
    }

    if (!canUlbSubmitForm(sectionDoc.form_status_id)) {
      throw new ForbiddenException(`This section cannot be submitted while its status is ${sectionDoc.form_status}.`);
    }

    // Resolve which docIds are currently required by the active upload config.
    // This means documents that were previously uploaded but are now hidden in the
    // config (e.g. receipts-payments while temporarily hidden) are not blocking.
    const requiredDocIds = await this.resolveRequiredDocIds(anchor.design_year?.toString(), section);

    const docsToCheck = requiredDocIds
      ? sectionDoc.documents.filter((d: any) => requiredDocIds.includes(d.docId))
      : sectionDoc.documents;

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
      { _id: sectionDoc._id },
      {
        $set: {
          form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
          selfDeclared: true,
          declaredBy: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
          declaredAt: new Date(),
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: anchor.ulb,
      designYear: anchor.design_year,
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
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, dto.section);
    if (!sectionDoc) throw new NotFoundException('Section not found');
    await this.assertCanDecide(anchor, user, sectionDoc.form_status);

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    const requiredDocIds = await this.resolveRequiredDocIds(anchor.design_year?.toString(), dto.section);
    if (requiredDocIds && !requiredDocIds.includes(docId)) {
      throw new BadRequestException('This document is optional and cannot be approved or returned.');
    }

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    // Per-document decisions are informational only — the section's form_status and the
    // form-log audit trail only change on the explicit final "Approve Section"/"Return Section"
    // action (decideSection), not the moment any one document is approved or returned.
    // Provisional until then — STATE can undo it (see undoDocumentDecision) any time before.
    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id, 'documents.docId': docId },
      { $set: { 'documents.$.stateDecision': decision, updatedAt: new Date() } },
    );

    this.logger.log(
      `Document ${dto.decision.toLowerCase()} — annualAccountId=${id} section=${dto.section} docId=${docId} by user=${user._id}`,
    );

    return this.getProcessingStatus(id, dto.section, user);
  }

  /**
   * Reverts a single document's decision back to undecided. Reuses the exact same gate as
   * decideDocument (assertCanDecide) — so once the section itself is finalized (Approve
   * Section/Return Section moves it past UNDER_REVIEW_BY_STATE), undo is no longer possible,
   * same as making a new decision wouldn't be either. No form-log entry — per-document
   * decisions are provisional until the section is finalized, so undoing one isn't an
   * audit-worthy event on its own.
   */
  async undoDocumentDecision(id: string, section: AnnualAccountSectionKey, docId: string, user: AuthUser) {
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    if (!sectionDoc) throw new NotFoundException('Section not found');
    await this.assertCanDecide(anchor, user, sectionDoc.form_status);

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot) throw new NotFoundException('Document not found in this section');

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id, 'documents.docId': docId },
      { $set: { 'documents.$.stateDecision': null, updatedAt: new Date() } },
    );

    this.logger.log(
      `Document decision undone — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`,
    );

    return this.getProcessingStatus(id, section, user);
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
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, dto.section);
    if (!sectionDoc) throw new NotFoundException('Section not found');
    await this.assertCanDecide(anchor, user, sectionDoc.form_status);

    // Optional documents (e.g. notes-to-accounts) are never approved/returned — individually
    // or via this section-wide sweep — so exclude them from every check below.
    const requiredDocIds = await this.resolveRequiredDocIds(anchor.design_year?.toString(), dto.section);
    const isRequired = (docId: string) => !requiredDocIds || requiredDocIds.includes(docId);

    const documents: any[] = (sectionDoc.documents ?? []).filter((d: any) => isRequired(d.docId as string));
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

    assertValidFormStatusTransition(sectionDoc.form_status_id, FORM_STATUS_ID[newStatus]);

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    // Only documents with no live decision (never decided, or stale after a re-upload) are
    // swept into this bulk action — already-decided documents are left exactly as they are.
    const toBulkDecide = effectiveByDoc.filter((d) => d.effective === null).map((d) => d.docId);

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id },
      {
        $set: {
          form_status: newStatus,
          form_status_id: FORM_STATUS_ID[newStatus],
          stateDecision: decision,
          modifiedBy: new Types.ObjectId(user._id),
          ...(toBulkDecide.length > 0 && {
            'documents.$[elem].stateDecision': decision,
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
      ulb: anchor.ulb,
      designYear: anchor.design_year,
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

    return this.getProcessingStatus(id, dto.section, user);
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
    section: AnnualAccountSectionKey,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, section);
    if (!sectionDoc) throw new NotFoundException('Section not found');
    await this.assertCanUndoSectionApproval(anchor, user, sectionDoc.form_status);

    assertValidFormStatusTransition(
      sectionDoc.form_status_id,
      FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
    );

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id },
      {
        $set: {
          form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
          stateDecision: null,
          // Undoing the section-level approval also undoes every document's individual
          // decision — otherwise they'd all still show APPROVED and re-approving the section
          // immediately after would trivially succeed with no real re-review (see decideSection).
          'documents.$[].stateDecision': null,
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    const userInfo = { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent };
    const logBase = {
      annualAccountId: new Types.ObjectId(id),
      ulb: anchor.ulb,
      designYear: anchor.design_year,
      section,
      formId: SECTION_FORM_IDS[section],
      action: 'UNDO' as const,
      actorStage: 'STATE' as const,
      userInfo,
    };

    await this.formLogModel.create({ ...logBase, toStatus: AnnualAccountFormStatus.UNDO });
    await this.formLogModel.create({ ...logBase, toStatus: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE });

    this.logger.log(`Section approval undone — annualAccountId=${id} section=${section} by user=${user._id}`);

    return this.getProcessingStatus(id, section, user);
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
    section: AnnualAccountSectionKey,
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
    const { anchor, sectionDoc } = await this.resolveSectionDocument(id, dto.section);
    if (!sectionDoc) throw new NotFoundException('Section not found');
    this.assertCanMohuaDecide(user, sectionDoc.form_status);

    const newStatus =
      dto.decision === 'APPROVED'
        ? AnnualAccountFormStatus.SUBMISSION_ACKNOWLEDGED_BY_MOHUA
        : AnnualAccountFormStatus.RETURNED_BY_MOHUA;

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id },
      {
        $set: {
          form_status: newStatus,
          form_status_id: FORM_STATUS_ID[newStatus],
          mohuaDecision: decision,
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    // MOHUA has no per-document decision layer — every document is already individually
    // STATE-approved by this point, regardless of MOHUA's own APPROVED/RETURNED verdict here —
    // so there's no per-document breakdown worth recording for either outcome.
    await this.formLogModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: anchor.ulb,
      designYear: anchor.design_year,
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

    return this.getProcessingStatus(id, dto.section, user);
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

  /**
   * Resolves the physical document for {id, section}: `id` always names the 'audited' anchor
   * document (every code path that hands out an annualAccountId returns that id — see
   * findOrInitialize/getProcessingStatus/listUlbSubmissions/getManualReviewQueue), so
   * 'auditedData' resolves to the anchor itself, and 'unauditedData' is looked up by the
   * anchor's own {ulb, design_year}. `sectionDoc` is null when that section hasn't been
   * touched yet (matches the old "embedded sub-object is null" NOT_STARTED semantics) — throws
   * only when `id` itself doesn't resolve to any document at all.
   */
  private async resolveSectionDocument(
    id: string,
    section: AnnualAccountSectionKey,
  ): Promise<{ anchor: any; sectionDoc: any }> {
    const anchor = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!anchor) throw new NotFoundException('Annual account not found');
    const sectionDoc = section === 'auditedData' ? anchor : await this.lookupSectionDoc(anchor, section);
    return { anchor, sectionDoc };
  }

  /** Looks up `section`'s physical document given an already-fetched anchor, or returns it directly when `section` is the anchor's own type. */
  private async lookupSectionDoc(anchor: any, section: AnnualAccountSectionKey): Promise<any> {
    const wantType = SECTION_KEY_TO_TYPE[section];
    if (anchor.sectionType === wantType) return anchor;
    return this.annualAccountModel
      .findOne({ ulb: anchor.ulb, design_year: anchor.design_year, sectionType: wantType })
      .lean()
      .exec();
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
      sectionType: 'audited' as const,
    };

    // Atomic upsert — eliminates the find→create race condition that caused
    // duplicate-key 11000 errors when multiple uploads arrived simultaneously. The anchor is
    // created here regardless of which section the caller is actually uploading to (it's the
    // stable {ulb, design_year} identity both sections resolve against) — its own yearId/year
    // stay null (NOT_STARTED) until an audited document is actually uploaded.
    const doc = await this.annualAccountModel
      .findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            state: new Types.ObjectId(stateId),
            yearId: null,
            year: null,
            form_status: AnnualAccountFormStatus.NOT_STARTED,
            form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.NOT_STARTED],
            documents: [],
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
    user: AuthUser,
    processingStatus: string = 'PROCESSING',
  ) {
    const { section, docId, yearId, year } = dto;
    const wantType = SECTION_KEY_TO_TYPE[section as AnnualAccountSectionKey];

    const anchor = await this.annualAccountModel
      .findById(new Types.ObjectId(annualAccountId))
      .select('ulb state design_year sectionType')
      .lean()
      .exec();
    if (!anchor) throw new NotFoundException('Annual account not found');

    // Lazily create the unaudited sibling on its own first touch — mirrors the anchor's own
    // NOT_STARTED-until-touched initialization in findOrInitialize.
    const target =
      anchor.sectionType === wantType
        ? anchor
        : await this.annualAccountModel
            .findOneAndUpdate(
              { ulb: anchor.ulb, design_year: anchor.design_year, sectionType: wantType },
              {
                $setOnInsert: {
                  state: anchor.state,
                  yearId: null,
                  year: null,
                  form_status: AnnualAccountFormStatus.NOT_STARTED,
                  form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.NOT_STARTED],
                  documents: [],
                  createdBy: new Types.ObjectId(user._id),
                  modifiedBy: new Types.ObjectId(user._id),
                },
              },
              { upsert: true, new: true },
            )
            .select('_id')
            .lean()
            .exec();

    const targetObjId = target._id;

    await this.annualAccountModel.updateOne(
      { _id: targetObjId, yearId: null },
      {
        $set: {
          yearId: new Types.ObjectId(yearId),
          year,
          form_status: AnnualAccountFormStatus.IN_PROGRESS,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
        },
      },
    );

    // Ensure form_status is IN_PROGRESS even if the document was already touched before
    await this.annualAccountModel.updateOne(
      { _id: targetObjId, form_status: { $ne: AnnualAccountFormStatus.IN_PROGRESS } },
      {
        $set: {
          form_status: AnnualAccountFormStatus.IN_PROGRESS,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
        },
      },
    );

    const updated = await this.annualAccountModel.updateOne(
      {
        _id: targetObjId,
        'documents.docId': docId,
      },
      {
        $set: {
          'documents.$.currentUpload': currentUpload,
          'documents.$.uploadStatus': 'UPLOADED',
          'documents.$.processingStatus': processingStatus,
          updatedAt: new Date(),
        },
      },
    );

    if (updated.modifiedCount === 0) {
      await this.annualAccountModel.updateOne(
        { _id: targetObjId },
        {
          $push: {
            documents: {
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

  private async validateUploadPermission(user: AuthUser, dto: UploadDocumentDto): Promise<void> {
    if (user.accessLevel === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot upload documents');
    }

    if (user.scope === 'ULB') {
      const userUlbId = user.ulb?.toString();
      if (userUlbId !== dto.ulbId) {
        throw new ForbiddenException('You can only upload documents for your own ULB');
      }
    }

    await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
      dto.ulbId,
      'XVIFC',
      CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
    );
  }

  /**
   * Two-layer upload gate: the section must be ULB-editable (shared FORM_STATUS gate), and
   * this specific document must not already be individually APPROVED by STATE.
   */
  private async assertCanUlbUpload(
    ulbId: string,
    designYearId: string,
    section: AnnualAccountSectionKey,
    docId: string,
  ): Promise<void> {
    const sectionDoc = await this.annualAccountModel
      .findOne({
        ulb: new Types.ObjectId(ulbId),
        design_year: new Types.ObjectId(designYearId),
        sectionType: SECTION_KEY_TO_TYPE[section],
      })
      .lean()
      .exec();
    if (!sectionDoc) return;

    if (!canUlbEditForm(sectionDoc.form_status_id)) {
      throw new ForbiddenException(`This section cannot be edited while its status is ${sectionDoc.form_status}.`);
    }

    const docSlot = sectionDoc.documents.find((d) => d.docId === docId);
    if (!canUlbReuploadDocument(sectionDoc.form_status_id, docSlot?.stateDecision)) {
      throw new ForbiddenException('This document has already been approved and cannot be re-uploaded.');
    }

    if (isAwaitingManualReviewDecision(docSlot?.currentUpload?.ocrInfo?.isManualReviewRequested, docSlot?.manualReviewDecision)) {
      throw new ForbiddenException(
        'This document is awaiting manual review and cannot be re-uploaded until an ADMIN makes a decision.',
      );
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
    if (!doc?.documents) return doc;
    return {
      ...doc,
      documents: doc.documents.map((d: any) => ({
        ...d,
        currentUpload: d.currentUpload
          ? {
              ...d.currentUpload,
              file: d.currentUpload.file ? { ...d.currentUpload.file, s3Key: undefined } : d.currentUpload.file,
            }
          : null,
      })),
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
