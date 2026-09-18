import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { S3Service } from '../../../../../core/s3/s3.service';
import type { AuthUser } from '../../../../auth/auth-user.interface';
import { XvFcPtaxReview, XvFcPtaxReviewDocument } from '../../../../../schemas/xv-fc-ptax-review.schema';
import { Year, YearDocument } from '../../../../../schemas/year.schema';
import {
  PTAX_METRIC_CODES,
  PTAX_METRIC_ORDER_PAIRS,
  PTAX_METRIC_VALIDATION,
  PTAX_METRICS,
  PTAX_REVIEWABLE_YEARS,
  toMetricKey,
  validatePtaxMetricOrder,
  validatePtaxMetricValue,
} from '../../common/ptax.constants';
import { DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE } from '../../common/xv-fc-review.constants';
import { escapeRegex } from '../../common/regex.util';
import { PtaxAdminListQueryDto } from './dto/ptax-admin-list-query.dto';
import { PtaxMetricDecisionDto } from './dto/ptax-metric-decision.dto';
import { ReopenPtaxReviewDto } from './dto/reopen-ptax-review.dto';

// Status a submission sits in before it's been finalized — decideMetric/acceptAll bump
// straight past this to VERIFYING the moment any decision is made.
const PRE_VERIFICATION_STATUSES = ['SUBMITTED'] as const;

@Injectable()
export class PtaxReviewAdminService {
  private readonly logger = new Logger(PtaxReviewAdminService.name);

  constructor(
    @InjectModel(XvFcPtaxReview.name) private readonly reviewModel: Model<XvFcPtaxReviewDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    private readonly s3Service: S3Service,
  ) {}

  /** This ULB's status across every reviewable financial year — powers the admin UI's year tabs. */
  async getYearsSummary(ulbId: string) {
    const reviewableYears = PTAX_REVIEWABLE_YEARS as unknown as string[];
    const [yearDocs, reviewDocs] = await Promise.all([
      this.yearModel.find({ year: { $in: reviewableYears } }).select('year').lean().exec(),
      this.reviewModel
        .find({ ulb_id: new Types.ObjectId(ulbId), financialYear: { $in: reviewableYears } })
        .select('financialYear status')
        .lean()
        .exec(),
    ]);
    const yearIdByYear = new Map(yearDocs.map((y: any) => [y.year, y._id.toString()]));
    const statusByYear = new Map(reviewDocs.map((d: any) => [d.financialYear, d.status ?? 'NOT_STARTED']));

    return PTAX_REVIEWABLE_YEARS.map((financialYear) => ({
      financialYear,
      yearId: yearIdByYear.get(financialYear) ?? null,
      status: statusByYear.get(financialYear) ?? 'NOT_STARTED',
    }));
  }

  async list(query: PtaxAdminListQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    // DRAFT submissions are still being edited by the ULB and were never sent
    // for review — only actually-submitted (or resolved) rows belong here.
    const filter: FilterQuery<XvFcPtaxReviewDocument> = { status: { $in: ['SUBMITTED', 'REJECTED', 'APPROVED'] } };
    if (query.stateId) filter['stateCode'] = query.stateId;
    if (query.financialYear) filter['financialYear'] = query.financialYear;
    if (query.reviewStatus) filter['status'] = query.reviewStatus;
    if (query.censusCode) filter['censusCode'] = new RegExp(escapeRegex(query.censusCode));
    if (query.search) {
      const regex = new RegExp(escapeRegex(query.search), 'i');
      filter['$or'] = [{ ulbName: regex }, { ulbCode: regex }];
    }

    const sortPathByField: Record<string, string> = {
      ulb: 'ulbName',
      financialYear: 'financialYear',
      state: 'state',
      submittedAt: 'submittedAt',
    };
    const sortField = sortPathByField[query.sortBy ?? 'submittedAt'] ?? 'submittedAt';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortOrder === 'asc' ? 1 : -1 };

    const [rows, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .select(
          'ulb_id ulbName ulbCode censusCode state stateCode financialYear status submittedAt submissionCount metricReviews',
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);

    return {
      rows: rows.map((doc: any) => ({
        ulbId: doc.ulb_id?.toString(),
        ulbName: doc.ulbName,
        ulbCode: doc.ulbCode,
        censusCode: doc.censusCode ?? null,
        state: doc.state,
        stateCode: doc.stateCode,
        financialYear: doc.financialYear,
        reviewStatus: doc.status,
        submittedAt: doc.submittedAt ?? null,
        submissionCount: doc.submissionCount ?? 0,
        flaggedCount: this.countFlagged(doc.metricReviews),
        pendingCount: this.countPending(doc.metricReviews),
      })),
      total,
      page,
      limit,
    };
  }

  async getDetail(ulbId: string, yearId: string) {
    const doc = await this.findReviewOrThrow(ulbId, yearId);

    const metricReviewMap: Record<string, any> = doc.metricReviews ?? {};
    const metrics = PTAX_METRICS.map(({ code, label }) => {
      const review = metricReviewMap[toMetricKey(code)];
      return {
        code,
        label,
        value: review?.value ?? null,
        flagged: review?.flagged ?? false,
        proposedValue: review?.proposedValue ?? null,
        comment: review?.comment ?? '',
        adminDecision: review?.adminDecision ?? null,
        validation: PTAX_METRIC_VALIDATION[code] ?? null,
      };
    });

    return {
      ulbId,
      ulbName: doc.ulbName ?? null,
      ulbCode: doc.ulbCode ?? null,
      state: doc.state ?? null,
      yearId,
      financialYear: doc.financialYear,
      status: doc.status,
      finalAction: doc.finalAction ?? null,
      declaration: doc.declaration ?? null,
      supportingDocument: doc.supportingDocument ?? null,
      submissionCount: doc.submissionCount ?? 0,
      metrics,
      metricOrderRules: PTAX_METRIC_ORDER_PAIRS,
      history: doc.history ?? [],
    };
  }

  async decideMetric(ulbId: string, yearId: string, code: string, dto: PtaxMetricDecisionDto, user: AuthUser) {
    const doc = await this.findReviewOrThrow(ulbId, yearId);
    this.assertNotFinalized(doc.status);
    const key = toMetricKey(code);

    const review = doc.metricReviews?.[key];
    if (!review?.flagged) {
      throw new BadRequestException('This metric was not flagged by the ULB');
    }
    // Deliberately NOT requiring adminDecision.status === 'PENDING' here — see the matching
    // comment in XvFcReviewAdminService.decideLineItem for why re-deciding is allowed.
    if (dto.decision === 'ACCEPTED' && dto.correctedValue !== undefined) {
      const error = validatePtaxMetricValue(code, dto.correctedValue);
      if (error) throw new BadRequestException(`correctedValue: ${error}`);

      // Cross-field ordering against the other metrics' current best-known
      // value (their cached `value`, which already reflects any earlier
      // admin correction) — this metric's value is about to become
      // correctedValue, so check the merged post-decision state.
      const allReviews: Record<string, any> = doc.metricReviews ?? {};
      const mergedValuesByCode: Record<string, number | null | undefined> = {};
      for (const c of PTAX_METRIC_CODES) {
        const v = allReviews[toMetricKey(c)]?.value;
        mergedValuesByCode[c] = v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
      }
      mergedValuesByCode[code] = dto.correctedValue;

      const orderError = validatePtaxMetricOrder(mergedValuesByCode);
      if (orderError) throw new BadRequestException(orderError);
    }

    const now = new Date();
    const reviewedBy = new Types.ObjectId(user._id);
    const reason = dto.reason ?? '';

    const previousValueNum = review.value != null && review.value !== '' ? Number(review.value) : null;
    const previousValue = previousValueNum != null && !Number.isNaN(previousValueNum) ? previousValueNum : null;

    const setOps: Record<string, unknown> = {
      [`metricReviews.${key}.adminDecision.status`]: dto.decision,
      [`metricReviews.${key}.adminDecision.reason`]: reason,
      [`metricReviews.${key}.adminDecision.reviewedBy`]: reviewedBy,
      [`metricReviews.${key}.adminDecision.reviewedAt`]: now,
    };
    // correctedValue is optional on ACCEPTED — a flagged metric with no value at all (e.g. a
    // comment-only flag) has nothing to record. Skipping this write leaves the field as it
    // already was, rather than clobbering it with the literal string "undefined".
    if (dto.decision === 'ACCEPTED' && dto.correctedValue !== undefined) {
      setOps[`metricReviews.${key}.adminDecision.correctedValue`] = dto.correctedValue;
      // The corrected figure becomes the current value going forward — the
      // read-through cache (and every future read) reflects the resolved
      // number, not the original figure that was flagged as wrong.
      setOps[`metricReviews.${key}.value`] = String(dto.correctedValue);
    }
    // First decision on this submission moves it out of "awaiting admin action" and into
    // "being worked on" — Final Submit (a separate, deliberate action) is what actually
    // resolves it to APPROVED/REJECTED.
    if ((PRE_VERIFICATION_STATUSES as readonly string[]).includes(doc.status)) {
      setOps['status'] = 'VERIFYING';
    }

    const historyEntry = {
      action: dto.decision === 'ACCEPTED' ? 'ADMIN_ACCEPT' : 'ADMIN_REJECT',
      metricCode: code,
      previousValue,
      newValue: dto.decision === 'ACCEPTED' ? (dto.correctedValue ?? null) : null,
      performedBy: reviewedBy,
      performedByRole: user.role,
      reason,
      createdAt: now,
    };

    const result = await this.reviewModel
      .updateOne({ _id: doc._id }, { $set: setOps, $push: { history: historyEntry } })
      .exec();

    if (result.modifiedCount === 0) {
      throw new ConflictException('Failed to save this decision — please retry.');
    }

    this.logger.log(
      `Ptax admin decision — ulb=${ulbId} year=${doc.financialYear} code=${code} decision=${dto.decision} by=${user._id}`,
    );

    return this.getDetail(ulbId, yearId);
  }

  /** Bulk-accepts every still-PENDING flagged metric, using each one's own `proposedValue`. */
  async acceptAll(ulbId: string, yearId: string, user: AuthUser) {
    const doc = await this.findReviewOrThrow(ulbId, yearId);
    this.assertNotFinalized(doc.status);

    const reviewMap: Record<string, any> = doc.metricReviews ?? {};
    const pendingKeys = Object.entries(reviewMap)
      .filter(([, review]) => review?.flagged && review?.adminDecision?.status === 'PENDING')
      .map(([key]) => key);

    if (pendingKeys.length === 0) return this.getDetail(ulbId, yearId);

    const now = new Date();
    const reviewedBy = new Types.ObjectId(user._id);
    const setOps: Record<string, unknown> = {};
    const historyEntries: unknown[] = [];

    for (const key of pendingKeys) {
      const review = reviewMap[key];
      const correctedValue = review.proposedValue;
      const previousValueNum = review.value != null && review.value !== '' ? Number(review.value) : null;
      const previousValue = previousValueNum != null && !Number.isNaN(previousValueNum) ? previousValueNum : null;

      setOps[`metricReviews.${key}.adminDecision.status`] = 'ACCEPTED';
      setOps[`metricReviews.${key}.adminDecision.reason`] = '';
      setOps[`metricReviews.${key}.adminDecision.correctedValue`] = correctedValue;
      setOps[`metricReviews.${key}.adminDecision.reviewedBy`] = reviewedBy;
      setOps[`metricReviews.${key}.adminDecision.reviewedAt`] = now;
      setOps[`metricReviews.${key}.value`] = correctedValue != null ? String(correctedValue) : review.value;

      historyEntries.push({
        action: 'ADMIN_ACCEPT',
        metricCode: review.code ?? key,
        previousValue,
        newValue: correctedValue,
        performedBy: reviewedBy,
        performedByRole: user.role,
        reason: 'Accepted via Accept All',
        createdAt: now,
      });
    }
    if ((PRE_VERIFICATION_STATUSES as readonly string[]).includes(doc.status)) {
      setOps['status'] = 'VERIFYING';
    }

    await this.reviewModel
      .updateOne({ _id: doc._id }, { $set: setOps, $push: { history: { $each: historyEntries } } })
      .exec();

    this.logger.log(
      `Ptax admin accept-all — ulb=${ulbId} year=${doc.financialYear} count=${pendingKeys.length} by=${user._id}`,
    );

    return this.getDetail(ulbId, yearId);
  }

  /**
   * Deliberate, separate finalization step — every flagged metric must already have a decision
   * (with a reason on any Reject) before this succeeds. Resolves to REJECTED if any flagged
   * metric was rejected, APPROVED otherwise — replaces the old `recomputeAggregateStatus`,
   * which used to apply this same rule automatically after every single decision.
   */
  async finalize(ulbId: string, yearId: string, user: AuthUser) {
    const doc = await this.findReviewOrThrow(ulbId, yearId);
    this.assertNotFinalized(doc.status);

    const reviewMap: Record<string, any> = doc.metricReviews ?? {};
    const flagged = Object.values(reviewMap).filter((r: any) => r?.flagged);
    const stillPending = flagged.filter((r: any) => !r.adminDecision || r.adminDecision.status === 'PENDING');
    if (stillPending.length > 0) {
      throw new BadRequestException(`${stillPending.length} flagged metric(s) still need an Accept/Reject decision`);
    }
    const missingReason = flagged.filter(
      (r: any) => r.adminDecision.status === 'REJECTED' && !r.adminDecision.reason?.trim(),
    );
    if (missingReason.length > 0) {
      throw new BadRequestException('Every rejected metric needs a reason before Final Submit');
    }

    const hasRejected = flagged.some((r: any) => r.adminDecision.status === 'REJECTED');
    const nextStatus = hasRejected ? 'REJECTED' : 'APPROVED';
    const now = new Date();
    const performedBy = new Types.ObjectId(user._id);

    await this.reviewModel
      .updateOne(
        { _id: doc._id },
        {
          $set: { status: nextStatus },
          $push: {
            history: {
              action: nextStatus === 'APPROVED' ? 'SUBMISSION_APPROVED' : 'SUBMISSION_REJECTED',
              metricCode: null,
              previousValue: null,
              newValue: null,
              performedBy,
              performedByRole: user.role,
              reason:
                nextStatus === 'APPROVED' ? 'All flagged metrics accepted' : 'At least one flagged metric was rejected',
              createdAt: now,
            },
          },
        },
      )
      .exec();

    this.logger.log(`Ptax admin finalize — ulb=${ulbId} year=${doc.financialYear} result=${nextStatus} by=${user._id}`);

    return this.getDetail(ulbId, yearId);
  }

  /**
   * Moves a finalized submission back to DRAFT so the ULB can edit and resubmit. Existing
   * metric decisions are left untouched — only the submission-level status changes.
   */
  async reopen(ulbId: string, yearId: string, dto: ReopenPtaxReviewDto, user: AuthUser) {
    const doc = await this.findReviewOrThrow(ulbId, yearId);

    if (doc.status !== 'APPROVED' && doc.status !== 'REJECTED') {
      throw new ConflictException('Only a finalized (Approved/Rejected) submission can be reopened');
    }

    const now = new Date();
    const performedBy = new Types.ObjectId(user._id);

    await this.reviewModel
      .updateOne(
        { _id: doc._id },
        {
          $set: { status: 'DRAFT' },
          $push: {
            history: {
              action: 'REOPENED',
              metricCode: null,
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

    this.logger.log(`Ptax admin reopen — ulb=${ulbId} year=${doc.financialYear} by=${user._id}`);

    return this.getDetail(ulbId, yearId);
  }

  async getSignedUrl(ulbId: string, yearId: string, targetCode: string) {
    const doc = await this.findReviewOrThrow(ulbId, yearId);

    if (targetCode !== DECLARATION_TARGET_CODE && targetCode !== SUPPORTING_DOCUMENT_TARGET_CODE) {
      throw new BadRequestException(
        `targetCode must be one of: ${DECLARATION_TARGET_CODE}, ${SUPPORTING_DOCUMENT_TARGET_CODE}`,
      );
    }

    const s3Key: string | undefined =
      targetCode === DECLARATION_TARGET_CODE ? doc.declaration?.file?.url : doc.supportingDocument?.url;

    if (!s3Key) throw new NotFoundException('Document not found');

    const url = await this.s3Service.presignGet(s3Key);
    return { url };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async findReviewOrThrow(ulbId: string, yearId: string): Promise<any> {
    const doc = await this.reviewModel
      .findOne({ ulb_id: new Types.ObjectId(ulbId), year_id: new Types.ObjectId(yearId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('No Ptax review found for this ULB and financial year');
    return doc;
  }

  private countFlagged(metricReviews: Record<string, any> | undefined): number {
    if (!metricReviews) return 0;
    return Object.values(metricReviews).filter((r: any) => r?.flagged).length;
  }

  private countPending(metricReviews: Record<string, any> | undefined): number {
    if (!metricReviews) return 0;
    return Object.values(metricReviews).filter(
      (r: any) => r?.flagged && (!r.adminDecision || r.adminDecision.status === 'PENDING'),
    ).length;
  }

  private assertNotFinalized(status: string | undefined): void {
    if (status === 'APPROVED' || status === 'REJECTED') {
      throw new ConflictException('This submission has already been finalized — Reopen it first.');
    }
  }
}
