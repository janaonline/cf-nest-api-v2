import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, PipelineStage, Types } from 'mongoose';
import type ExcelJS from 'exceljs';
import { EmailQueueService } from '../../../../core/queue/email-queue/email-queue.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { ExcelService } from '../../../../services/excel/excel.service';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { User, UserDocument } from '../../../../schemas/user/user.schema';
import {
  MANUAL_REVIEW_SLA_HOURS,
  XviFcManualReviewRequest,
  XviFcManualReviewRequestDocument,
} from '../../../../schemas/xvi-fc/manual-review-request.schema';
import { Role } from '../../../auth/enum/role.enum';
import { Scope } from '../../../auth/enum/roles-xvi-fc.enum';
import { escapeRegex } from 'src/common/utils/regex.util';
import { buildDecisionRecord, resolveDeciderName } from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { ManualReviewDecisionDto } from './dto/manual-review-decision.dto';
import { ManualReviewQueueQueryDto } from './dto/manual-review-queue-query.dto';
import { ManualReviewHistoryQueryDto } from './dto/manual-review-history-query.dto';
import { AnnualAccountsService, AnnualAccountSectionKey, SECTION_LABELS } from './annual_accounts.service';
import { getPortalUrl } from 'src/core/utils/portal-urls.util';

/**
 * Everything related to the ULB "manual review" workflow for a failed OCR validation — the ULB's
 * request, ADMIN's approve/return decision, the resulting notifications, and ADMIN's queue/history/
 * Excel-export views over those requests. Split out of AnnualAccountsService, which still owns the
 * physical annual-account document (section/document resolution, view-access checks, and the
 * processing-status projection this service returns after each mutation) — reused here via
 * dependency injection rather than duplicated.
 */
@Injectable()
export class AnnualAccountManualReviewService {
  private readonly logger = new Logger(AnnualAccountManualReviewService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    @InjectModel(XviFcManualReviewRequest.name)
    private readonly manualReviewRequestModel: Model<XviFcManualReviewRequestDocument>,

    private readonly fileTokenService: FileTokenService,

    private readonly emailQueueService: EmailQueueService,

    private readonly configService: ConfigService,

    private readonly excelService: ExcelService,

    private readonly annualAccountsService: AnnualAccountsService,
  ) {}

  // ─── ULB requests manual review of a failed OCR validation ───────────────────

  async requestManualReview(
    id: string,
    section: AnnualAccountSectionKey,
    docId: string,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ) {
    if (user.scope !== Scope.ULB) {
      throw new ForbiddenException('Only ULB users may request manual review');
    }

    const { anchor, sectionDoc } = await this.annualAccountsService.resolveSectionDocument(id, section);
    await this.annualAccountsService.validateViewAccess(anchor, user);
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

    await this.manualReviewRequestModel.create({
      annualAccountId: new Types.ObjectId(id),
      ulb: anchor.ulb,
      designYear: anchor.design_year,
      section,
      docId,
      uploadId: docSlot.currentUpload.uploadId,
      ocrJobId: docSlot.currentUpload.ocrInfo?.jobId ?? null,
      status: 'PENDING',
      requestedAt,
      requestedBy: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      dueAt: new Date(requestedAt.getTime() + MANUAL_REVIEW_SLA_HOURS * 60 * 60 * 1000),
    });

    this.logger.log(
      `Manual review requested — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`,
    );

    this.notifyManualReviewRequested(anchor, section, docSlot, requestedAt).catch((err: unknown) => {
      this.logger.error(`Failed to queue manual-review-requested notification for annualAccountId=${id}:`, err);
    });

    return this.annualAccountsService.getProcessingStatus(id, section, user);
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

    const { anchor, sectionDoc } = await this.annualAccountsService.resolveSectionDocument(id, section);
    if (!sectionDoc) throw new NotFoundException('Section not found');

    const docSlot = (sectionDoc.documents ?? []).find((d: any) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('Document not found in this section');

    if (!docSlot.currentUpload.ocrInfo?.isManualReviewRequested) {
      throw new BadRequestException('No manual review has been requested for this document.');
    }

    const deciderName = await resolveDeciderName(this.userModel, user._id);
    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent, deciderName);

    await this.annualAccountModel.updateOne(
      { _id: sectionDoc._id, 'documents.docId': docId },
      {
        $set: {
          'documents.$.manualReviewDecision': decision,
          ...(dto.decision === 'APPROVED' && { 'documents.$.processingStatus': 'PASSED' }),
        },
      },
    );

    const decidedBy = { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent };
    const updatedRequest = await this.manualReviewRequestModel.findOneAndUpdate(
      {
        annualAccountId: new Types.ObjectId(id),
        section,
        docId,
        uploadId: docSlot.currentUpload.uploadId,
        status: 'PENDING',
      },
      { $set: { status: dto.decision, decidedAt: decision.decidedAt, decidedBy, decisionNote: dto.note ?? null } },
      { sort: { requestedAt: -1 } },
    );

    if (!updatedRequest) {
      // No PENDING row to match — this request predates the XviFcManualReviewRequest collection.
      // Synthesize one from the embedded requestedAt so the decision isn't lost from the history.
      const requestedAt = docSlot.currentUpload.ocrInfo?.manualReviewRequestedAt ?? decision.decidedAt;
      await this.manualReviewRequestModel.create({
        annualAccountId: new Types.ObjectId(id),
        ulb: anchor.ulb,
        designYear: anchor.design_year,
        section,
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

    this.logger.log(
      `Manual review ${dto.decision.toLowerCase()} — annualAccountId=${id} section=${section} docId=${docId} by user=${user._id}`,
    );

    this.notifyUlbOfManualReviewDecision(anchor, section, docSlot, decision).catch((err: unknown) => {
      this.logger.error(`Failed to queue manual-review-decision notification for annualAccountId=${id}:`, err);
    });

    return this.annualAccountsService.getProcessingStatus(id, section, user);
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

  // ─── Manual-review request history for one document ──────────────────────────

  async getManualReviewHistory(id: string, section: AnnualAccountSectionKey, docId: string, user: AuthUser) {
    const anchor = await this.annualAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!anchor) throw new NotFoundException('Annual account not found');
    await this.annualAccountsService.validateViewAccess(anchor, user);

    const requests = await this.manualReviewRequestModel
      .find({ annualAccountId: new Types.ObjectId(id), section, docId })
      .sort({ requestedAt: -1 })
      .lean()
      .exec();

    return requests.map((r) => {
      const breachedAgainst = r.decidedAt ?? new Date();
      return {
        uploadId: r.uploadId,
        ocrJobId: r.ocrJobId ?? null,
        status: r.status,
        requestedAt: r.requestedAt,
        requestedBy: { role: r.requestedBy.role },
        dueAt: r.dueAt,
        isBreached: r.dueAt.getTime() < breachedAgainst.getTime(),
        decidedAt: r.decidedAt,
        decidedBy: r.decidedBy ? { role: r.decidedBy.role } : null,
        decisionNote: r.decisionNote,
      };
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
                filePath: '$documents.currentUpload.file.path',
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
                filePath: '$unauditedSibling.documents.currentUpload.file.path',
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
          // Every row here is still PENDING (never decided — see the $match above), so breach is
          // always measured against now, unlike the decided-inclusive history endpoint.
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

    const [result] = await this.annualAccountModel.aggregate(pipeline).exec();
    const rows = (result?.data ?? []).map(({ filePath, ...row }: any) => ({
      ...row,
      fileUrl: filePath ? this.fileTokenService.signFileUrl(filePath, 'inline') : null,
    }));
    const total = result?.totalCount?.[0]?.count ?? 0;

    return { total, page, pageSize, rows };
  }

  // ─── ADMIN's global manual-review audit trail (all statuses) ─────────────────

  /**
   * Shared lookup/projection stages for both the paginated history list and the single-request
   * detail view — joined straight off `xvifc_ac_manual_review_requests` (not reconstructed from
   * live document state, unlike getManualReviewQueue) so decided requests are covered too. The
   * upload-history join is keyed on `uploadId` (unique per upload), which sidesteps the
   * audited/unaudited-sibling `$facet` dance getManualReviewQueue needs — a manual-review
   * request's uploadId always resolves to exactly one upload-history row regardless of section.
   */
  private manualReviewHistoryLookupStages(): PipelineStage.FacetPipelineStage[] {
    return [
      { $lookup: { from: 'ulbs', localField: 'ulb', foreignField: '_id', as: 'ulbDoc' } },
      { $addFields: { ulbDoc: { $arrayElemAt: ['$ulbDoc', 0] } } },
      { $lookup: { from: 'states', localField: 'ulbDoc.state', foreignField: '_id', as: 'stateDoc' } },
      { $addFields: { stateDoc: { $arrayElemAt: ['$stateDoc', 0] } } },
      { $lookup: { from: 'years', localField: 'designYear', foreignField: '_id', as: 'yearDoc' } },
      { $addFields: { yearDoc: { $arrayElemAt: ['$yearDoc', 0] } } },
      {
        $lookup: {
          from: 'xvifc_annualaccount_upload_history',
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

  private manualReviewHistoryProjectStage(): PipelineStage.Project {
    return {
      $project: {
        _id: 0,
        requestId: '$_id',
        annualAccountId: 1,
        ulbId: '$ulb',
        ulbName: 1,
        ulbCode: 1,
        stateName: 1,
        section: 1,
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
  private buildManualReviewHistoryFilterStages(dto: ManualReviewHistoryQueryDto): PipelineStage[] {
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
      ...this.manualReviewHistoryLookupStages(),
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

  async listManualReviewRequestHistory(dto: ManualReviewHistoryQueryDto, user: AuthUser) {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review history');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const pipeline: PipelineStage[] = [
      ...this.buildManualReviewHistoryFilterStages(dto),
      { $sort: { requestedAt: -1 } },
      {
        $facet: {
          data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, this.manualReviewHistoryProjectStage()],
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

  async dumpManualReviewHistoryToExcel(dto: ManualReviewHistoryQueryDto, user: AuthUser): Promise<ExcelJS.Buffer> {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only ADMIN users may view the manual-review history');
    }

    const pipeline: PipelineStage[] = [
      ...this.buildManualReviewHistoryFilterStages(dto),
      { $sort: { requestedAt: -1 } },
      this.manualReviewHistoryProjectStage(),
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

    const clientUrl = this.configService.get<string>('CLIENT_URL', 'https://cityfinance.in');
    // Mirrors AnnualAccountOcrApiService.setOcrJobApiUrl's derivation — the OCR engine's own v3
    // API, not this app's CLIENT_URL (used below for the in-app log-viewer link instead). Trailing
    // slash is normalized rather than assumed, since API_BASE_URL_V3 is free-form config.
    const ocrApiV3Base = (() => {
      const configured = this.configService.get<string>('API_BASE_URL_V3');
      const base =
        configured ||
        (() => {
          const baseUrl = this.configService.get<string>('BASE_URL', '');
          const origin = baseUrl ? new URL(baseUrl).origin : '';
          return `${origin}/api/v3/`;
        })();
      return base.replace(/\/+$/, '') + '/';
    })();

    const rows = requests.map((r: any) => ({
      ulbName: r.ulbName ?? '',
      ulbCode: r.ulbCode ?? '',
      stateName: r.stateName ?? '',
      section: r.section === 'auditedData' ? 'Audited' : 'Provisional',
      year: r.year ?? '',
      docId: r.docId ?? '',
      fileName: r.fileName ?? '',
      fileUrl: r.ocrJobId ? `${ocrApiV3Base}ocr-validation/jobs/${r.ocrJobId}/download` : '',
      ocrLogUrl: r.ocrJobId ? getPortalUrl(this.configService, `ocr/validation?jobId=${r.ocrJobId}`) : '',
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
        { label: 'Section', key: 'section', width: 12 },
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
      ...this.manualReviewHistoryLookupStages(),
      this.manualReviewHistoryProjectStage(),
    ];

    const [row] = await this.manualReviewRequestModel.aggregate(pipeline).exec();
    if (!row) throw new NotFoundException('Manual-review request not found');

    const { filePath, ...rest } = row as any;
    return { ...rest, fileUrl: filePath ? this.fileTokenService.signFileUrl(filePath, 'inline') : null };
  }
}
