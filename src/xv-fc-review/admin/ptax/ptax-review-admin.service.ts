import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { S3Service } from '../../../core/s3/s3.service';
import type { AuthUser } from '../../../module/auth/auth-user.interface';
import { XvFcPtaxReview, XvFcPtaxReviewDocument } from '../../../schemas/xv-fc-ptax-review.schema';
import {
  PTAX_METRIC_CODES,
  PTAX_METRIC_ORDER_PAIRS,
  PTAX_METRIC_VALIDATION,
  PTAX_METRICS,
  toMetricKey,
  validatePtaxMetricOrder,
  validatePtaxMetricValue,
} from '../../common/ptax.constants';
import { DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE } from '../../common/xv-fc-review.constants';
import { escapeRegex } from '../../common/regex.util';
import { PtaxAdminListQueryDto } from './dto/ptax-admin-list-query.dto';
import { PtaxMetricDecisionDto } from './dto/ptax-metric-decision.dto';

@Injectable()
export class PtaxReviewAdminService {
  private readonly logger = new Logger(PtaxReviewAdminService.name);

  constructor(
    @InjectModel(XvFcPtaxReview.name) private readonly reviewModel: Model<XvFcPtaxReviewDocument>,
    private readonly s3Service: S3Service,
  ) {}

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
        .select('ulb_id ulbName ulbCode state stateCode financialYear status submittedAt submissionCount metricReviews')
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
    const key = toMetricKey(code);

    const review = doc.metricReviews?.[key];
    if (!review?.flagged) {
      throw new BadRequestException('This metric was not flagged by the ULB');
    }
    if (review.adminDecision?.status !== 'PENDING') {
      throw new ConflictException('This metric is not currently pending a decision');
    }
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

    const previousValueNum = review.value != null && review.value !== '' ? Number(review.value) : null;
    const previousValue = previousValueNum != null && !Number.isNaN(previousValueNum) ? previousValueNum : null;

    const setOps: Record<string, unknown> = {
      [`metricReviews.${key}.adminDecision.status`]: dto.decision,
      [`metricReviews.${key}.adminDecision.reason`]: dto.reason,
      [`metricReviews.${key}.adminDecision.reviewedBy`]: reviewedBy,
      [`metricReviews.${key}.adminDecision.reviewedAt`]: now,
    };
    if (dto.decision === 'ACCEPTED') {
      setOps[`metricReviews.${key}.adminDecision.correctedValue`] = dto.correctedValue;
      // The corrected figure becomes the current value going forward — the
      // read-through cache (and every future read) reflects the resolved
      // number, not the original figure that was flagged as wrong.
      setOps[`metricReviews.${key}.value`] = String(dto.correctedValue);
    }

    const historyEntry = {
      action: dto.decision === 'ACCEPTED' ? 'ADMIN_ACCEPT' : 'ADMIN_REJECT',
      metricCode: code,
      previousValue,
      newValue: dto.decision === 'ACCEPTED' ? (dto.correctedValue ?? null) : null,
      performedBy: reviewedBy,
      performedByRole: user.role,
      reason: dto.reason,
      createdAt: now,
    };

    const result = await this.reviewModel
      .updateOne(
        { _id: doc._id, [`metricReviews.${key}.adminDecision.status`]: 'PENDING' },
        { $set: setOps, $push: { history: historyEntry } },
      )
      .exec();

    if (result.modifiedCount === 0) {
      throw new ConflictException('This metric has already been decided by another admin');
    }

    await this.recomputeAggregateStatus(doc._id, user);

    this.logger.log(
      `Ptax admin decision — ulb=${ulbId} year=${doc.financialYear} code=${code} decision=${dto.decision} by=${user._id}`,
    );

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

  // Recomputes the overall submission status from the current set of
  // per-metric decisions and, only if it actually changed, persists it and
  // appends one aggregate history entry. Any REJECTED decision wins (unlocks
  // ULB editing again); ALL flagged metrics ACCEPTED with none PENDING means
  // the submission is fully resolved.
  private async recomputeAggregateStatus(reviewId: Types.ObjectId, user: AuthUser) {
    const doc = await this.reviewModel.findById(reviewId).lean().exec();
    if (!doc) return;

    const reviews: Record<string, any> = doc.metricReviews ?? {};
    const flagged = Object.values(reviews).filter((r: any) => r?.flagged);
    const hasRejected = flagged.some((r: any) => r.adminDecision?.status === 'REJECTED');
    const hasPending = flagged.some((r: any) => !r.adminDecision || r.adminDecision.status === 'PENDING');

    const nextStatus = hasRejected ? 'REJECTED' : hasPending ? 'SUBMITTED' : 'APPROVED';
    if (nextStatus === doc.status) return;

    const now = new Date();
    await this.reviewModel
      .updateOne(
        { _id: reviewId },
        {
          $set: { status: nextStatus },
          $push: {
            history: {
              action: nextStatus === 'APPROVED' ? 'SUBMISSION_APPROVED' : 'SUBMISSION_REJECTED',
              metricCode: null,
              previousValue: null,
              newValue: null,
              performedBy: new Types.ObjectId(user._id),
              performedByRole: user.role,
              reason:
                nextStatus === 'APPROVED' ? 'All flagged metrics accepted' : 'At least one flagged metric was rejected',
              createdAt: now,
            },
          },
        },
      )
      .exec();
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
}
