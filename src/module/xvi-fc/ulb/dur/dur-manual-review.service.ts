import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, PipelineStage, Types } from 'mongoose';
import type { Readable } from 'stream';
import type ExcelJS from 'exceljs';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { MANUAL_REVIEW_SLA_HOURS } from 'src/schemas/xvi-fc/manual-review-request.schema';
import { XviFcDur, XviFcDurDocument, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';
import {
  XviFcDurManualReviewRequest,
  XviFcDurManualReviewRequestDocument,
} from 'src/schemas/xvi-fc/dur-manual-review-request.schema';
import {
  XviFcDurUploadHistory,
  XviFcDurUploadHistoryDocument,
} from 'src/schemas/xvi-fc/dur-upload-history.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { buildDecisionRecord, resolveDeciderName } from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';
import {
  buildContentDisposition,
  getContentType,
  getErrorMessage,
  isS3NotFoundError,
  sanitizeFilename,
} from 'src/module/file/file-response.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import {
  MAX_POST_REJECTION_ATTEMPTS,
  MANUAL_REVIEW_SUPPORT_EMAIL,
  UPLOAD_BLOCKED_MESSAGE,
  isUploadBlocked,
} from 'src/common/utils/manual-review-cooldown.util';
import { ManualReviewDecisionDto } from 'src/module/xvi-fc/ulb/annual_accounts/dto/manual-review-decision.dto';
import { ManualReviewQueueQueryDto } from 'src/module/xvi-fc/ulb/annual_accounts/dto/manual-review-queue-query.dto';
import { ExcelService } from 'src/services/excel/excel.service';
import { getPortalUrl } from 'src/core/utils/portal-urls.util';
import { DurManualReviewHistoryQueryDto } from './dto/dur-manual-review-history-query.dto';
import { DurManualReviewHistoryStatsQueryDto } from './dto/dur-manual-review-history-stats-query.dto';
import { DurService } from './dur.service';

/** Everything the controller needs to stream a DUR document's file to the client — same shape as
 *  FileService.PreparedDownload, but resolved by {durId, docId} + a live auth check instead of a
 *  signed, self-expiring token. */
export interface DurDocumentDownload {
  key: string;
  stream: Readable;
  headers: { contentType: string; contentDisposition: string };
}

/**
 * DUR's manual-review workflow — same shape as AnnualAccountManualReviewService, retargeted at
 * XviFcDur/XviFcDurManualReviewRequest. Kept as its own service/collection rather than a shared
 * one (see project memory on the DUR feature for why) — mirror, not reuse, since the underlying
 * document/collection differs.
 */
@Injectable()
export class DurManualReviewService {
  private readonly logger = new Logger(DurManualReviewService.name);

  constructor(
    @InjectModel(XviFcDur.name)
    private readonly durModel: Model<XviFcDurDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    @InjectModel(XviFcDurManualReviewRequest.name)
    private readonly manualReviewRequestModel: Model<XviFcDurManualReviewRequestDocument>,

    @InjectModel(XviFcDurUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcDurUploadHistoryDocument>,

    private readonly durService: DurService,
    private readonly fileTokenService: FileTokenService,
    private readonly s3Service: S3Service,
    private readonly excelService: ExcelService,
    private readonly configService: ConfigService,
  ) {}

  // ─── ULB requests manual review of a failed validation ───────────────────────

  async requestManualReview(
    id: string,
    docId: XviFcDurDocId,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    if (user.scope !== Scope.ULB) {
      throw new ForbiddenException('Only ULB users may request manual review');
    }

    const dur = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!dur) throw new NotFoundException('DUR form not found');
    await this.durService.validateViewAccess(dur, user);

    const docSlot = dur.documents.find((d) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('Document not found');

    if (docSlot.currentUpload.ocrInfo?.validationStatus !== 'FAIL') {
      throw new BadRequestException('Manual review can only be requested for a failed validation.');
    }
    if (docSlot.currentUpload.ocrInfo?.isManualReviewRequested) {
      throw new BadRequestException('Manual review has already been requested for this document.');
    }
    if (isUploadBlocked(docSlot.uploadBlockedUntil)) {
      throw new ForbiddenException(UPLOAD_BLOCKED_MESSAGE);
    }
    if (
      docSlot.manualReviewDecision?.status === 'RETURNED' &&
      (docSlot.postRejectionAttemptsUsed ?? 0) < MAX_POST_REJECTION_ATTEMPTS
    ) {
      throw new BadRequestException(
        `Manual review was already declined for this document. Please correct the file and re-upload — ` +
          `you have ${MAX_POST_REJECTION_ATTEMPTS - (docSlot.postRejectionAttemptsUsed ?? 0)} attempt(s) left before you can request another review. ` +
          `After that, uploads will be temporarily blocked. For further details, please email ${MANUAL_REVIEW_SUPPORT_EMAIL}.`,
      );
    }

    const requestedAt = new Date();
    await this.durModel.updateOne(
      { _id: dur._id, 'documents.docId': docId },
      {
        $set: {
          'documents.$.currentUpload.ocrInfo.isManualReviewRequested': true,
          'documents.$.currentUpload.ocrInfo.manualReviewRequestedAt': requestedAt,
          'documents.$.manualReviewDecision': null,
        },
      },
    );

    await this.manualReviewRequestModel.create({
      durId: dur._id,
      ulb: dur.ulb,
      designYear: dur.design_year,
      docId,
      uploadId: docSlot.currentUpload.uploadId,
      ocrJobId: docSlot.currentUpload.ocrInfo?.jobId ?? null,
      filePath: docSlot.currentUpload.file?.path ?? null,
      status: 'PENDING',
      requestedAt,
      requestedBy: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      dueAt: new Date(requestedAt.getTime() + MANUAL_REVIEW_SLA_HOURS * 60 * 60 * 1000),
    });

    this.logger.log(`DUR manual review requested — durId=${id} docId=${docId} by user=${user._id}`);

    return this.durService.getProcessingStatus(id, user);
  }

  // ─── ADMIN approves/rejects a ULB's manual-review request ────────────────────

  async decideManualReview(
    id: string,
    docId: XviFcDurDocId,
    dto: ManualReviewDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may decide a manual review request');
    }

    const dur = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!dur) throw new NotFoundException('DUR form not found');

    const docSlot = dur.documents.find((d) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('Document not found');
    if (!docSlot.currentUpload.ocrInfo?.isManualReviewRequested) {
      throw new BadRequestException('No manual review has been requested for this document.');
    }
    // isManualReviewRequested is never reset once set, so without this a second decideManualReview
    // call (double-click, or a genuine repeat) would silently overwrite the first decision and
    // create a duplicate manualReviewRequestModel row (its own PENDING-status lookup below would
    // no longer match after the first call's write).
    if (docSlot.manualReviewDecision != null) {
      throw new BadRequestException('This manual review request has already been decided.');
    }

    const deciderName = await resolveDeciderName(this.userModel, user._id);
    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent, deciderName);

    const rejectionUpdate: Record<string, unknown> = {};
    if (dto.decision === 'RETURNED') {
      rejectionUpdate['documents.$.manualReviewRejectionCount'] = (docSlot.manualReviewRejectionCount ?? 0) + 1;
      rejectionUpdate['documents.$.postRejectionAttemptsUsed'] = 0;
    }

    // $elemMatch (not two separate 'documents.x' filters) so both conditions bind to the same
    // array element — combined with the in-memory check above, this also closes the race where
    // two concurrent decideManualReview calls both pass that check before either write lands:
    // only the first updateOne can still match once manualReviewDecision is no longer null.
    const updateResult = await this.durModel.updateOne(
      { _id: dur._id, documents: { $elemMatch: { docId, manualReviewDecision: null } } },
      {
        $set: {
          'documents.$.manualReviewDecision': decision,
          ...(dto.decision === 'APPROVED' && { 'documents.$.processingStatus': 'PASSED' }),
          ...rejectionUpdate,
        },
      },
    );
    if (updateResult.matchedCount === 0) {
      throw new ConflictException('This manual review request has already been decided.');
    }

    const decidedBy = { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent };
    const updatedRequest = await this.manualReviewRequestModel.findOneAndUpdate(
      { durId: dur._id, docId, uploadId: docSlot.currentUpload.uploadId, status: 'PENDING' },
      { $set: { status: dto.decision, decidedAt: decision.decidedAt, decidedBy, decisionNote: dto.note ?? null } },
      { sort: { requestedAt: -1 } },
    );

    if (!updatedRequest) {
      const requestedAt = docSlot.currentUpload.ocrInfo?.manualReviewRequestedAt ?? decision.decidedAt;
      await this.manualReviewRequestModel.create({
        durId: dur._id,
        ulb: dur.ulb,
        designYear: dur.design_year,
        docId,
        uploadId: docSlot.currentUpload.uploadId,
        ocrJobId: docSlot.currentUpload.ocrInfo?.jobId ?? null,
        filePath: docSlot.currentUpload.file?.path ?? null,
        status: dto.decision,
        requestedAt,
        requestedBy: docSlot.currentUpload.userInfo,
        dueAt: new Date(requestedAt.getTime() + MANUAL_REVIEW_SLA_HOURS * 60 * 60 * 1000),
        decidedAt: decision.decidedAt,
        decidedBy,
        decisionNote: dto.note ?? null,
      });
    }

    this.logger.log(`DUR manual review ${dto.decision.toLowerCase()} — durId=${id} docId=${docId} by user=${user._id}`);

    return this.durService.getProcessingStatus(id, user);
  }

  // ─── ADMIN's global manual-review queue ──────────────────────────────────────

  /**
   * Same shape as AnnualAccountManualReviewService.getManualReviewQueue, simpler pipeline: DUR
   * has no audited/unaudited-sibling split, just one `documents` array per form, so this
   * unwinds `xvifc_dur_forms` directly instead of AA's sibling $facet/$lookup dance.
   */
  async getManualReviewQueue(dto: ManualReviewQueueQueryDto, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review queue');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const pipeline: PipelineStage[] = [
      { $unwind: '$documents' },
      {
        $match: {
          'documents.currentUpload.ocrInfo.isManualReviewRequested': true,
          'documents.manualReviewDecision': null,
        },
      },
      {
        $project: {
          durId: '$_id',
          ulbId: '$ulb',
          state: '$state',
          year: '$financialYear',
          docId: '$documents.docId',
          uploadId: '$documents.currentUpload.uploadId',
          jobId: '$documents.currentUpload.ocrInfo.jobId',
          fileName: '$documents.currentUpload.file.originalName',
          filePath: '$documents.currentUpload.file.path',
          sizeKb: '$documents.currentUpload.file.sizeKb',
          validationStatus: '$documents.currentUpload.ocrInfo.validationStatus',
          validationDetails: '$documents.currentUpload.ocrInfo.validationDetails',
          failedChecks: '$documents.currentUpload.ocrInfo.failedChecks',
          manualReviewRequestedAt: '$documents.currentUpload.ocrInfo.manualReviewRequestedAt',
        },
      },
      { $lookup: { from: 'ulbs', localField: 'ulbId', foreignField: '_id', as: 'ulbDoc' } },
      { $addFields: { ulbDoc: { $arrayElemAt: ['$ulbDoc', 0] } } },
      { $lookup: { from: 'states', localField: 'state', foreignField: '_id', as: 'stateDoc' } },
      { $addFields: { stateDoc: { $arrayElemAt: ['$stateDoc', 0] } } },
      {
        $addFields: {
          ulbName: '$ulbDoc.name',
          ulbCode: '$ulbDoc.code',
          stateName: '$stateDoc.name',
          dueAt: { $add: ['$manualReviewRequestedAt', MANUAL_REVIEW_SLA_HOURS * 60 * 60 * 1000] },
        },
      },
      { $addFields: { isBreached: { $lt: ['$dueAt', '$$NOW'] } } },
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
                durId: 1,
                ulbId: 1,
                ulbName: 1,
                ulbCode: 1,
                stateName: 1,
                year: 1,
                docId: 1,
                uploadId: 1,
                jobId: 1,
                fileName: 1,
                filePath: 1,
                sizeKb: 1,
                validationStatus: 1,
                validationDetails: 1,
                failedChecks: 1,
                manualReviewRequestedAt: 1,
                dueAt: 1,
                isBreached: 1,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.durModel.aggregate(pipeline).exec();
    // fileUrl here is a *marker* the frontend uses to decide whether to show a download control at
    // all (see ManualReviewQueueRow.fileUrl) — the actual download goes through
    // getDocumentDownload() below (an authenticated, non-expiring endpoint keyed by
    // {durId, docId, uploadId}), not this signed, 24-minute-expiry token. Kept as a real signed
    // URL (rather than a boolean) only for parity with Annual Account rows, which still use it
    // directly.
    const rows = (result?.data ?? []).map(({ filePath, ...row }: any) => ({
      ...row,
      fileUrl: filePath ? this.fileTokenService.signFileUrl(filePath, 'inline') : null,
    }));
    const total = result?.totalCount?.[0]?.count ?? 0;

    return { total, page, pageSize, rows };
  }

  // ─── ADMIN downloads a document's original uploaded file ────────────────────

  /**
   * Resolves an authenticated, non-expiring download for one DUR document — unlike a signed
   * FileTokenService URL (self-contained, expires ~24 minutes after being issued, valid for
   * anyone who holds it with no live session check), this re-checks the caller's role on every
   * request and never expires on its own. Resolves from XviFcDurUploadHistory first — any past
   * upload (not just the current one) resolves on its own there, since the history row is never
   * overwritten by a later re-upload the way `documents[].currentUpload` is. `uploadId` is
   * optional: when omitted, falls back to whatever the document's current upload is right now.
   *
   * Uploads made before this collection existed have no history row, so a miss there falls back
   * to the live document's `currentUpload` — the only place an older upload's file info can still
   * live — but only when the requested uploadId is still the current one; a pre-migration upload
   * that's since been superseded by a newer one has nowhere left to be recovered from and 404s.
   */
  async getDocumentDownload(
    id: string,
    docId: XviFcDurDocId,
    uploadId: string | undefined,
    user: AuthUser,
  ): Promise<DurDocumentDownload> {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may download manual-review documents');
    }

    type DocSlot = { currentUpload?: { uploadId: string; file: { path: string; originalName?: string | null; mimeType?: string | null } } | null } | undefined;
    let docSlot: DocSlot;
    let docSlotLoaded = false;
    const loadDocSlot = async (): Promise<DocSlot> => {
      if (docSlotLoaded) return docSlot;
      const dur = await this.durModel.findById(new Types.ObjectId(id)).select('documents').lean().exec();
      if (!dur) throw new NotFoundException('DUR form not found');
      docSlot = dur.documents.find((d) => d.docId === docId);
      docSlotLoaded = true;
      return docSlot;
    };

    let resolvedUploadId = uploadId;
    if (!resolvedUploadId) {
      const slot = await loadDocSlot();
      if (!slot?.currentUpload) throw new NotFoundException('Document not found');
      resolvedUploadId = slot.currentUpload.uploadId;
    }

    const uploadRecord = await this.uploadHistoryModel
      .findOne({ durId: new Types.ObjectId(id), docId, uploadId: resolvedUploadId })
      .lean()
      .exec();

    let file = uploadRecord?.file;
    if (!file) {
      const slot = await loadDocSlot();
      if (slot?.currentUpload?.uploadId === resolvedUploadId) file = slot.currentUpload.file;
    }
    if (!file) throw new NotFoundException('Upload not found');

    const key = file.path;
    const filename = sanitizeFilename(file.originalName || 'document.pdf');
    const contentType = file.mimeType || getContentType(filename);
    const contentDisposition = buildContentDisposition(contentType, filename, 'attachment');

    let stream: Readable;
    try {
      stream = await this.s3Service.getObjectStream(key);
    } catch (err: unknown) {
      if (isS3NotFoundError(err)) throw new NotFoundException('File not found in storage');
      this.logger.error(`S3 stream init failed for key "${key}": ${getErrorMessage(err)}`);
      throw new HttpException('Failed to initiate file download', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return { key, stream, headers: { contentType, contentDisposition } };
  }

  // ─── ADMIN's manual-review history (list/stats/excel/detail) ────────────────

  /**
   * Shared lookup stages for the paginated list, the Excel dump, and the single-request detail —
   * everything after $match up to (not including) projection, so all three read exactly the same
   * derived fields. Mirrors AnnualAccountManualReviewService.manualReviewHistoryLookupStages,
   * joining xvifc_dur_upload_history (by uploadId) in place of AA's annual-account upload-history
   * collection — DUR's own upload-history collection, so a past upload's file/validation info
   * resolves here the same way even after a newer upload has superseded `currentUpload`.
   */
  private durManualReviewHistoryLookupStages(): PipelineStage.FacetPipelineStage[] {
    return [
      { $lookup: { from: 'ulbs', localField: 'ulb', foreignField: '_id', as: 'ulbDoc' } },
      { $addFields: { ulbDoc: { $arrayElemAt: ['$ulbDoc', 0] } } },
      { $lookup: { from: 'states', localField: 'ulbDoc.state', foreignField: '_id', as: 'stateDoc' } },
      { $addFields: { stateDoc: { $arrayElemAt: ['$stateDoc', 0] } } },
      { $lookup: { from: 'years', localField: 'designYear', foreignField: '_id', as: 'yearDoc' } },
      { $addFields: { yearDoc: { $arrayElemAt: ['$yearDoc', 0] } } },
      {
        $lookup: {
          from: 'xvifc_dur_upload_history',
          localField: 'uploadId',
          foreignField: 'uploadId',
          as: 'uploadHistory',
        },
      },
      { $addFields: { uploadHistory: { $arrayElemAt: ['$uploadHistory', 0] } } },
      {
        $addFields: {
          ulbName: '$ulbDoc.name',
          ulbCode: '$ulbDoc.code',
          stateName: '$stateDoc.name',
          year: '$yearDoc.year',
          fileName: '$uploadHistory.file.originalName',
          filePath: '$uploadHistory.file.path',
          sizeKb: '$uploadHistory.file.sizeKb',
          validationStatus: '$uploadHistory.ocrInfo.validationStatus',
          validationDetails: '$uploadHistory.ocrInfo.validationDetails',
          failedChecks: { $ifNull: ['$uploadHistory.ocrInfo.failedChecks', []] },
          // Breach is derived here, never stored — see MANUAL_REVIEW_SLA_HOURS' doc comment.
          isBreached: { $lt: ['$dueAt', { $ifNull: ['$decidedAt', '$$NOW'] }] },
        },
      },
    ];
  }

  private durManualReviewHistoryProjectStage(): PipelineStage.Project {
    return {
      $project: {
        _id: 0,
        requestId: '$_id',
        durId: 1,
        ulbId: '$ulb',
        ulbName: 1,
        ulbCode: 1,
        stateName: 1,
        year: 1,
        docId: 1,
        uploadId: 1,
        ocrJobId: 1,
        fileName: 1,
        filePath: 1,
        sizeKb: 1,
        validationStatus: 1,
        validationDetails: 1,
        failedChecks: 1,
        status: 1,
        requestedAt: 1,
        requestedBy: { role: '$requestedBy.role', name: '$requestedBy.name' },
        dueAt: 1,
        isBreached: 1,
        decidedAt: 1,
        decidedBy: {
          $cond: [{ $ifNull: ['$decidedBy', false] }, { role: '$decidedBy.role', name: '$decidedBy.name' }, null],
        },
        decisionNote: 1,
      },
    };
  }

  /**
   * Filter + lookup stages shared by the paginated list and the unpaginated Excel dump — everything
   * up to (not including) sort/pagination, so both read exactly the same rows for a given query.
   */
  private buildDurManualReviewHistoryFilterStages(dto: DurManualReviewHistoryQueryDto): PipelineStage[] {
    const match: Record<string, unknown> = {};
    if (dto.status) match.status = dto.status;
    if (dto.requestedFrom || dto.requestedTo) {
      match.requestedAt = {
        ...(dto.requestedFrom ? { $gte: new Date(dto.requestedFrom) } : {}),
        ...(dto.requestedTo ? { $lte: new Date(dto.requestedTo) } : {}),
      };
    }
    if (dto.decidedFrom || dto.decidedTo) {
      match.decidedAt = {
        ...(dto.decidedFrom ? { $gte: new Date(dto.decidedFrom) } : {}),
        ...(dto.decidedTo ? { $lte: new Date(dto.decidedTo) } : {}),
      };
    }

    return [
      { $match: match },
      ...this.durManualReviewHistoryLookupStages(),
      ...(dto.stateId ? [{ $match: { 'stateDoc._id': new Types.ObjectId(dto.stateId) } } as PipelineStage] : []),
      ...(dto.breachedOnly ? [{ $match: { isBreached: true } } as PipelineStage] : []),
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
    ];
  }

  async listManualReviewRequestHistory(dto: DurManualReviewHistoryQueryDto, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review history');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const pipeline: PipelineStage[] = [
      ...this.buildDurManualReviewHistoryFilterStages(dto),
      { $sort: { requestedAt: -1 } },
      {
        $facet: {
          data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, this.durManualReviewHistoryProjectStage()],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.manualReviewRequestModel.aggregate(pipeline).exec();
    const rows = (result?.data ?? []).map(({ filePath, ...row }: any) => ({
      ...row,
      fileUrl: filePath ? this.fileTokenService.signFileUrl(filePath, 'inline') : null,
    }));
    const total = result?.totalCount?.[0]?.count ?? 0;

    return { total, page, pageSize, rows };
  }

  private static readonly IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  /** Overturn rate is only surfaced to ADMINs once there's a meaningful sample — a 100% rate off
   *  one early approval would be a false alarm, not a signal the validation rule needs re-tuning. */
  private static readonly OVERTURN_RATE_MIN_DECIDED = 5;
  private static readonly OVERTURN_RATE_WARNING_THRESHOLD = 50;

  /** Start of "today" or "this week" (Monday) in IST, as the equivalent UTC instant — null for
   *  'all' (no lower bound). Mirrors AnnualAccountManualReviewService.rangeStartUtc exactly. */
  private rangeStartUtc(range: 'today' | 'week' | 'all'): Date | null {
    if (range === 'all') return null;

    const istNow = new Date(Date.now() + DurManualReviewService.IST_OFFSET_MS);
    const istMidnightToday = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());

    if (range === 'today') {
      return new Date(istMidnightToday - DurManualReviewService.IST_OFFSET_MS);
    }

    const daysSinceMonday = (istNow.getUTCDay() + 6) % 7;
    const istMidnightMonday = istMidnightToday - daysSinceMonday * 24 * 60 * 60 * 1000;
    return new Date(istMidnightMonday - DurManualReviewService.IST_OFFSET_MS);
  }

  /** Summary counts for the history page's REQUESTED time-range tabs — received/pending/approved/
   *  rejected, average request→decision turnaround, SLA-breach count, and the overturn rate (share
   *  of decided requests where the validation flag turned out to be wrong). */
  async getManualReviewHistoryStats(dto: DurManualReviewHistoryStatsQueryDto, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review history');
    }

    const range = dto.range ?? 'all';
    const rangeStart = this.rangeStartUtc(range);
    const match: Record<string, unknown> = rangeStart ? { requestedAt: { $gte: rangeStart } } : {};

    const [result] = await this.manualReviewRequestModel
      .aggregate([
        { $match: match },
        {
          $addFields: {
            isBreached: { $lt: ['$dueAt', { $ifNull: ['$decidedAt', '$$NOW'] }] },
            responseHours: {
              $cond: [
                { $ifNull: ['$decidedAt', false] },
                { $divide: [{ $subtract: ['$decidedAt', '$requestedAt'] }, 1000 * 60 * 60] },
                null,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            received: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ['$status', 'RETURNED'] }, 1, 0] } },
            over48hCount: { $sum: { $cond: ['$isBreached', 1, 0] } },
            avgResponseHours: { $avg: '$responseHours' },
          },
        },
      ])
      .exec();

    const approved = result?.approved ?? 0;
    const rejected = result?.rejected ?? 0;
    const decided = approved + rejected;
    const overturnRatePercent = decided > 0 ? Math.round((approved / decided) * 100) : null;

    return {
      range,
      received: result?.received ?? 0,
      pending: result?.pending ?? 0,
      approved,
      rejected,
      over48hCount: result?.over48hCount ?? 0,
      avgResponseHours: result?.avgResponseHours != null ? Math.round(result.avgResponseHours * 10) / 10 : null,
      overturnRatePercent,
      overturnRateWarning:
        decided >= DurManualReviewService.OVERTURN_RATE_MIN_DECIDED &&
        overturnRatePercent !== null &&
        overturnRatePercent > DurManualReviewService.OVERTURN_RATE_WARNING_THRESHOLD,
    };
  }

  async dumpManualReviewHistoryToExcel(dto: DurManualReviewHistoryQueryDto, user: AuthUser): Promise<ExcelJS.Buffer> {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review history');
    }

    const pipeline: PipelineStage[] = [
      ...this.buildDurManualReviewHistoryFilterStages(dto),
      { $sort: { requestedAt: -1 } },
      this.durManualReviewHistoryProjectStage(),
    ];

    const requests = await this.manualReviewRequestModel.aggregate(pipeline).exec();

    const formatDate = (value: unknown) =>
      value
        ? new Date(value as string).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : '';

    // Unlike Annual Account's Excel dump (which links straight to the OCR vendor's own public
    // download route), DUR's vendor never built an equivalent — the whole reason this service's
    // getDocumentDownload/upload-history collection exist. That endpoint needs a live session
    // (Bearer header), which a plain Excel hyperlink can't carry, so this reuses the same
    // self-hosted signed-URL fileTokenService already uses elsewhere in this file — a direct,
    // no-login-needed link, at the cost of expiring ~24 minutes after the export is generated.
    const rows = requests.map((r: any) => ({
      ulbName: r.ulbName ?? '',
      ulbCode: r.ulbCode ?? '',
      stateName: r.stateName ?? '',
      year: r.year ?? '',
      docId: r.docId ?? '',
      fileName: r.fileName ?? '',
      fileUrl: r.filePath ? this.fileTokenService.signFileUrl(r.filePath, 'inline') : '',
      ocrLogUrl: r.ocrJobId ? getPortalUrl(this.configService, `ocr/dur?jobId=${r.ocrJobId}`) : '',
      status: r.status ?? '',
      requestedAt: formatDate(r.requestedAt),
      requestedBy: r.requestedBy?.name ?? r.requestedBy?.role ?? '',
      dueAt: formatDate(r.dueAt),
      isBreached: r.isBreached ? 'Yes' : 'No',
      decidedAt: formatDate(r.decidedAt),
      decidedBy: r.decidedBy?.name ?? r.decidedBy?.role ?? '',
      decisionNote: r.decisionNote ?? '',
    }));

    return this.excelService.generateExcel(
      [
        { label: 'ULB', key: 'ulbName', width: 28 },
        { label: 'ULB Code', key: 'ulbCode', width: 14 },
        { label: 'State', key: 'stateName', width: 20 },
        { label: 'Year', key: 'year', width: 12 },
        { label: 'Document', key: 'docId', width: 20 },
        { label: 'File Name', key: 'fileName', width: 30 },
        { label: 'File Download URL', key: 'fileUrl', width: 40 },
        { label: 'OCR Log URL', key: 'ocrLogUrl', width: 40 },
        { label: 'Decision', key: 'status', width: 12 },
        { label: 'Requested At', key: 'requestedAt', width: 20 },
        { label: 'Requested By', key: 'requestedBy', width: 20 },
        { label: 'SLA Due At', key: 'dueAt', width: 20 },
        { label: 'SLA Breached', key: 'isBreached', width: 14 },
        { label: 'Decided At', key: 'decidedAt', width: 20 },
        { label: 'Reviewed By', key: 'decidedBy', width: 20 },
        { label: 'Message Sent to the ULB', key: 'decisionNote', width: 40 },
      ],
      rows,
      'Manual Review History',
    );
  }

  async getManualReviewRequestDetail(requestId: string, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view manual-review request details');
    }

    const pipeline: PipelineStage[] = [
      { $match: { _id: new Types.ObjectId(requestId) } },
      ...this.durManualReviewHistoryLookupStages(),
      this.durManualReviewHistoryProjectStage(),
    ];

    const [row] = await this.manualReviewRequestModel.aggregate(pipeline).exec();
    if (!row) throw new NotFoundException('Manual-review request not found');

    const { filePath, ...rest } = row as any;
    return { ...rest, fileUrl: filePath ? this.fileTokenService.signFileUrl(filePath, 'inline') : null };
  }
}
