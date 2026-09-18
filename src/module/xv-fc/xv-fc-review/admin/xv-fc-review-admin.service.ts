import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { S3Service } from '../../../../core/s3/s3.service';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { LedgerLog, LedgerLogDocument } from '../../../../schemas/ledger-log.schema';
import { LineItem, LineItemDocument } from '../../../../schemas/line-item.schema';
import { Year, YearDocument } from '../../../../schemas/year.schema';
import {
  DECLARATION_TARGET_CODE,
  SUPPORTING_DOCUMENT_TARGET_CODE,
  XV_FC_REVIEWABLE_YEARS,
  mapCodeToSubSection,
  mapHeadOfAccountToSection,
} from '../common/xv-fc-review.constants';
import { escapeRegex } from '../common/regex.util';
import { AdminReviewListQueryDto } from './dto/admin-review-list-query.dto';
import { LineItemDecisionDto } from './dto/line-item-decision.dto';
import { ReopenReviewDto } from './dto/reopen-review.dto';

// Statuses a submission sits in before it's been finalized — decideLineItem/acceptAll bump
// straight past these to VERIFYING the moment any decision is made.
const PRE_VERIFICATION_STATUSES = ['LOCKED', 'SUBMITTED'] as const;

@Injectable()
export class XvFcReviewAdminService {
  private readonly logger = new Logger(XvFcReviewAdminService.name);

  constructor(
    @InjectModel(LedgerLog.name) private readonly ledgerLogModel: Model<LedgerLogDocument>,
    @InjectModel(LineItem.name) private readonly lineItemModel: Model<LineItemDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    private readonly s3Service: S3Service,
  ) {}

  async list(query: AdminReviewListQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const filter: FilterQuery<LedgerLogDocument> = { xvFcReview: { $ne: null } };
    if (query.stateId) filter['state_code'] = query.stateId;
    if (query.financialYear) filter['year'] = query.financialYear;
    if (query.reviewStatus) filter['xvFcReview.status'] = query.reviewStatus;
    if (query.censusCode) filter['censusCode'] = new RegExp(escapeRegex(query.censusCode));
    if (query.search) {
      const regex = new RegExp(escapeRegex(query.search), 'i');
      filter['$or'] = [{ ulb: regex }, { ulb_code: regex }];
    }

    const sortPathByField: Record<string, string> = {
      ulb: 'ulb',
      financialYear: 'year',
      state: 'state',
      submittedAt: 'xvFcReview.submittedAt',
    };
    const sortField = sortPathByField[query.sortBy ?? 'submittedAt'] ?? 'xvFcReview.submittedAt';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortOrder === 'asc' ? 1 : -1 };

    const [rows, total] = await Promise.all([
      this.ledgerLogModel
        .find(filter)
        .select(
          'ulb_id ulb ulb_code censusCode state state_code year xvFcReview.status xvFcReview.submittedAt xvFcReview.lineItemReviews',
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.ledgerLogModel.countDocuments(filter).exec(),
    ]);

    return {
      rows: rows.map((doc: any) => ({
        ulbId: doc.ulb_id?.toString(),
        ulbName: doc.ulb,
        ulbCode: doc.ulb_code,
        censusCode: doc.censusCode ?? null,
        state: doc.state,
        stateCode: doc.state_code,
        financialYear: doc.year,
        reviewStatus: doc.xvFcReview?.status ?? 'NOT_STARTED',
        submittedAt: doc.xvFcReview?.submittedAt ?? null,
        flaggedCount: this.countFlagged(doc.xvFcReview?.lineItemReviews),
        pendingCount: this.countPending(doc.xvFcReview?.lineItemReviews),
      })),
      total,
      page,
      limit,
    };
  }

  /** This ULB's status across every reviewable financial year — powers the admin UI's year tabs. */
  async getYearsSummary(ulbId: string) {
    const reviewableYears = XV_FC_REVIEWABLE_YEARS as unknown as string[];
    const [yearDocs, reviewDocs] = await Promise.all([
      this.yearModel.find({ year: { $in: reviewableYears } }).select('year').lean().exec(),
      this.ledgerLogModel
        .find({ ulb_id: new Types.ObjectId(ulbId), year: { $in: reviewableYears } })
        .select('year xvFcReview.status')
        .lean()
        .exec(),
    ]);
    const yearIdByYear = new Map(yearDocs.map((y: any) => [y.year, y._id.toString()]));
    const statusByYear = new Map(reviewDocs.map((d: any) => [d.year, d.xvFcReview?.status ?? 'NOT_STARTED']));

    return XV_FC_REVIEWABLE_YEARS.map((financialYear) => ({
      financialYear,
      yearId: yearIdByYear.get(financialYear) ?? null,
      status: statusByYear.get(financialYear) ?? 'NOT_STARTED',
    }));
  }

  async getDetail(ulbId: string, yearId: string) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);

    const codes = Object.keys(doc.lineItems ?? {});
    const catalog = await this.lineItemModel
      .find({ code: { $in: codes } })
      .lean()
      .exec();
    const catalogByCode = new Map(catalog.map((c) => [c.code, c]));

    const reviewMap: Record<string, any> = doc.xvFcReview?.lineItemReviews ?? {};

    const lineItems = codes
      .map((code) => {
        const meta = catalogByCode.get(code);
        const review = reviewMap[code];
        return {
          code,
          name: meta?.name ?? null,
          headOfAccount: meta?.headOfAccount ?? null,
          section: mapHeadOfAccountToSection(meta?.headOfAccount),
          subSection: mapCodeToSubSection(code),
          originalValue: doc.lineItems?.[code] ?? null,
          flagged: review?.flagged ?? false,
          proposedValue: review?.proposedValue ?? null,
          comment: review?.comment ?? '',
          adminDecision: review?.adminDecision ?? null,
        };
      })
      .sort((a, b) => {
        const aIsOthers = a.subSection === 'OTHERS' ? 1 : 0;
        const bIsOthers = b.subSection === 'OTHERS' ? 1 : 0;
        if (aIsOthers !== bIsOthers) return aIsOthers - bIsOthers;
        return a.code.localeCompare(b.code, undefined, { numeric: true });
      });

    return {
      ulbId,
      ulbName: doc.ulb ?? null,
      ulbCode: doc.ulb_code ?? null,
      state: doc.state ?? null,
      yearId,
      financialYear,
      status: doc.xvFcReview?.status ?? 'NOT_STARTED',
      finalAction: doc.xvFcReview?.finalAction ?? null,
      declaration: doc.xvFcReview?.declaration ?? null,
      supportingDocument: doc.xvFcReview?.supportingDocument ?? null,
      lineItems,
      // Filterable client-side by lineItemCode — same shape/purpose as Ptax's `history`.
      auditTrail: doc.xvFcReview?.auditTrail ?? [],
    };
  }

  async decideLineItem(ulbId: string, yearId: string, code: string, dto: LineItemDecisionDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);
    this.assertNotFinalized(doc.xvFcReview?.status);

    const review = doc.xvFcReview?.lineItemReviews?.[code];
    if (!review?.flagged) {
      throw new BadRequestException('This line item was not flagged by the ULB');
    }
    // Deliberately NOT requiring adminDecision.status === 'PENDING' here — the admin can freely
    // flip a line item between Accept/Reject (or re-decide it) any number of times up until
    // Final Submit locks the form, matching what the UI itself always allowed (the decision
    // buttons only ever disable once the whole form is finalized, never per-row after one click).

    const previousValue = doc.lineItems?.[code] ?? null;
    const now = new Date();
    const reviewedBy = new Types.ObjectId(user._id);
    const reason = dto.reason ?? '';

    const setOps: Record<string, unknown> = {
      [`xvFcReview.lineItemReviews.${code}.adminDecision.status`]: dto.decision,
      [`xvFcReview.lineItemReviews.${code}.adminDecision.reason`]: reason,
      [`xvFcReview.lineItemReviews.${code}.adminDecision.reviewedBy`]: reviewedBy,
      [`xvFcReview.lineItemReviews.${code}.adminDecision.reviewedAt`]: now,
    };

    // correctedValue is optional on ACCEPTED — a flagged item with no original/proposed value at
    // all (e.g. a comment-only flag on an empty field) has nothing to overwrite. Skipping these
    // two writes when it's absent leaves both fields as they already were, rather than clobbering
    // them with `undefined`.
    if (dto.decision === 'ACCEPTED' && dto.correctedValue !== undefined) {
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.correctedValue`] = dto.correctedValue;
      // ACCEPTED propagates into the source-of-truth value on the same document —
      // one atomic write keeps lineItems and the audit trail from ever drifting apart.
      setOps[`lineItems.${code}`] = dto.correctedValue;
    }

    // First decision on this submission moves it out of the "awaiting admin action" state
    // and into "being worked on" — Final Submit (a separate, deliberate action) is what
    // actually resolves it to APPROVED/REJECTED.
    if ((PRE_VERIFICATION_STATUSES as readonly string[]).includes(doc.xvFcReview?.status)) {
      setOps['xvFcReview.status'] = 'VERIFYING';
    }

    const auditEntry = {
      action: dto.decision === 'ACCEPTED' ? 'ADMIN_ACCEPT' : 'ADMIN_REJECT',
      lineItemCode: code,
      previousValue,
      newValue: dto.decision === 'ACCEPTED' ? (dto.correctedValue ?? null) : null,
      performedBy: reviewedBy,
      performedByRole: user.role,
      reason,
      createdAt: now,
    };

    const result = await this.ledgerLogModel
      .updateOne({ _id: doc._id }, { $set: setOps, $push: { 'xvFcReview.auditTrail': auditEntry } })
      .exec();

    if (result.modifiedCount === 0) {
      throw new ConflictException('Failed to save this decision — please retry.');
    }

    this.logger.log(
      `XV-FC admin decision — ulb=${ulbId} year=${financialYear} code=${code} decision=${dto.decision} by=${user._id}`,
    );

    return this.getDetail(ulbId, yearId);
  }

  /** Bulk-accepts every still-PENDING flagged line item, using each one's own `proposedValue`. */
  async acceptAll(ulbId: string, yearId: string, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);
    this.assertNotFinalized(doc.xvFcReview?.status);

    const reviewMap: Record<string, any> = doc.xvFcReview?.lineItemReviews ?? {};
    const pendingCodes = Object.entries(reviewMap)
      .filter(([, review]) => review?.flagged && review?.adminDecision?.status === 'PENDING')
      .map(([code]) => code);

    if (pendingCodes.length === 0) return this.getDetail(ulbId, yearId);

    const now = new Date();
    const reviewedBy = new Types.ObjectId(user._id);
    const setOps: Record<string, unknown> = {};
    const auditEntries: unknown[] = [];

    for (const code of pendingCodes) {
      const correctedValue = reviewMap[code].proposedValue;
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.status`] = 'ACCEPTED';
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.reason`] = '';
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.correctedValue`] = correctedValue;
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.reviewedBy`] = reviewedBy;
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.reviewedAt`] = now;
      setOps[`lineItems.${code}`] = correctedValue;
      auditEntries.push({
        action: 'ADMIN_ACCEPT',
        lineItemCode: code,
        previousValue: doc.lineItems?.[code] ?? null,
        newValue: correctedValue,
        performedBy: reviewedBy,
        performedByRole: user.role,
        reason: 'Accepted via Accept All',
        createdAt: now,
      });
    }
    if ((PRE_VERIFICATION_STATUSES as readonly string[]).includes(doc.xvFcReview?.status)) {
      setOps['xvFcReview.status'] = 'VERIFYING';
    }

    await this.ledgerLogModel
      .updateOne({ _id: doc._id }, { $set: setOps, $push: { 'xvFcReview.auditTrail': { $each: auditEntries } } })
      .exec();

    this.logger.log(
      `XV-FC admin accept-all — ulb=${ulbId} year=${financialYear} count=${pendingCodes.length} by=${user._id}`,
    );

    return this.getDetail(ulbId, yearId);
  }

  /**
   * Deliberate, separate finalization step — every flagged item must already have a decision
   * (with a reason on any Reject) before this succeeds. Resolves to REJECTED if any flagged
   * item was rejected, APPROVED otherwise; matches the same rule Ptax used to auto-apply after
   * every single decision, now applied once, on purpose, via this endpoint.
   */
  async finalize(ulbId: string, yearId: string, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);
    this.assertNotFinalized(doc.xvFcReview?.status);

    const reviewMap: Record<string, any> = doc.xvFcReview?.lineItemReviews ?? {};
    const flagged = Object.values(reviewMap).filter((r: any) => r?.flagged);
    const stillPending = flagged.filter((r: any) => !r.adminDecision || r.adminDecision.status === 'PENDING');
    if (stillPending.length > 0) {
      throw new BadRequestException(`${stillPending.length} flagged line item(s) still need an Accept/Reject decision`);
    }
    const missingReason = flagged.filter(
      (r: any) => r.adminDecision.status === 'REJECTED' && !r.adminDecision.reason?.trim(),
    );
    if (missingReason.length > 0) {
      throw new BadRequestException('Every rejected line item needs a reason before Final Submit');
    }

    const hasRejected = flagged.some((r: any) => r.adminDecision.status === 'REJECTED');
    const nextStatus = hasRejected ? 'REJECTED' : 'APPROVED';
    const now = new Date();
    const performedBy = new Types.ObjectId(user._id);

    await this.ledgerLogModel
      .updateOne(
        { _id: doc._id },
        {
          $set: { 'xvFcReview.status': nextStatus },
          $push: {
            'xvFcReview.auditTrail': {
              action: nextStatus === 'APPROVED' ? 'SUBMISSION_APPROVED' : 'SUBMISSION_REJECTED',
              lineItemCode: null,
              previousValue: null,
              newValue: null,
              performedBy,
              performedByRole: user.role,
              reason:
                nextStatus === 'APPROVED'
                  ? 'All flagged line items accepted'
                  : 'At least one flagged line item was rejected',
              createdAt: now,
            },
          },
        },
      )
      .exec();

    this.logger.log(`XV-FC admin finalize — ulb=${ulbId} year=${financialYear} result=${nextStatus} by=${user._id}`);

    return this.getDetail(ulbId, yearId);
  }

  /**
   * Moves a finalized submission back to DRAFT so the ULB can edit and resubmit. Existing
   * line-item decisions are left untouched — only the form-level status changes.
   */
  async reopen(ulbId: string, yearId: string, dto: ReopenReviewDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);

    const status = doc.xvFcReview?.status;
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new ConflictException('Only a finalized (Approved/Rejected) submission can be reopened');
    }

    const now = new Date();
    const performedBy = new Types.ObjectId(user._id);

    await this.ledgerLogModel
      .updateOne(
        { _id: doc._id },
        {
          $set: { 'xvFcReview.status': 'DRAFT' },
          $push: {
            'xvFcReview.auditTrail': {
              action: 'REOPENED',
              lineItemCode: null,
              previousValue: null,
              newValue: null,
              performedBy,
              performedByRole: user.role,
              reason: dto.reason ?? '',
              createdAt: now,
            },
          },
        },
      )
      .exec();

    this.logger.log(`XV-FC admin reopen — ulb=${ulbId} year=${financialYear} by=${user._id}`);

    return this.getDetail(ulbId, yearId);
  }

  async getSignedUrl(ulbId: string, yearId: string, targetCode: string) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);

    if (targetCode !== DECLARATION_TARGET_CODE && targetCode !== SUPPORTING_DOCUMENT_TARGET_CODE) {
      throw new BadRequestException(
        `targetCode must be one of: ${DECLARATION_TARGET_CODE}, ${SUPPORTING_DOCUMENT_TARGET_CODE}`,
      );
    }

    const s3Key: string | undefined =
      targetCode === DECLARATION_TARGET_CODE
        ? doc.xvFcReview?.declaration?.file?.url
        : doc.xvFcReview?.supportingDocument?.url;

    if (!s3Key) throw new NotFoundException('Document not found');

    const url = await this.s3Service.presignGet(s3Key);
    return { url };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async resolveYearString(yearId: string): Promise<string> {
    const yearDoc = await this.yearModel.findById(new Types.ObjectId(yearId)).select('year').lean().exec();
    if (!yearDoc) throw new NotFoundException('Year not found');
    if (!(XV_FC_REVIEWABLE_YEARS as readonly string[]).includes(yearDoc.year)) {
      throw new BadRequestException(`Year ${yearDoc.year} is not in the reviewable range for this module`);
    }
    return yearDoc.year;
  }

  private async findLedgerLogOrThrow(ulbId: string, financialYear: string): Promise<any> {
    const doc = await this.ledgerLogModel
      .findOne({ ulb_id: new Types.ObjectId(ulbId), year: financialYear })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('No standardized data found for this ULB and financial year');
    return doc;
  }

  private countFlagged(lineItemReviews: Record<string, any> | undefined): number {
    if (!lineItemReviews) return 0;
    return Object.values(lineItemReviews).filter((r: any) => r?.flagged).length;
  }

  private countPending(lineItemReviews: Record<string, any> | undefined): number {
    if (!lineItemReviews) return 0;
    return Object.values(lineItemReviews).filter((r: any) => r?.flagged && r?.adminDecision?.status === 'PENDING')
      .length;
  }

  private assertNotFinalized(status: string | undefined): void {
    if (status === 'APPROVED' || status === 'REJECTED') {
      throw new ConflictException('This submission has already been finalized — Reopen it first.');
    }
  }
}
