import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { MANUAL_REVIEW_SLA_HOURS } from 'src/schemas/xvi-fc/manual-review-request.schema';
import { XviFcDur, XviFcDurDocument, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';
import {
  XviFcDurManualReviewRequest,
  XviFcDurManualReviewRequestDocument,
} from 'src/schemas/xvi-fc/dur-manual-review-request.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { buildDecisionRecord, resolveDeciderName } from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import {
  MAX_POST_REJECTION_ATTEMPTS,
  MANUAL_REVIEW_SUPPORT_EMAIL,
  UPLOAD_BLOCKED_MESSAGE,
  isUploadBlocked,
} from 'src/common/utils/manual-review-cooldown.util';
import { ManualReviewDecisionDto } from 'src/module/xvi-fc/ulb/annual_accounts/dto/manual-review-decision.dto';
import { ManualReviewQueueQueryDto } from 'src/module/xvi-fc/ulb/annual_accounts/dto/manual-review-queue-query.dto';
import { DurService } from './dur.service';

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

    private readonly durService: DurService,
    private readonly fileTokenService: FileTokenService,
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
    const rows = (result?.data ?? []).map(({ filePath, ...row }: any) => ({
      ...row,
      fileUrl: filePath ? this.fileTokenService.signFileUrl(filePath, 'inline') : null,
    }));
    const total = result?.totalCount?.[0]?.count ?? 0;

    return { total, page, pageSize, rows };
  }
}
