import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { S3Service } from '../../core/s3/s3.service';
import type { AuthUser } from '../../module/auth/auth-user.interface';
import { LedgerLog, LedgerLogDocument } from '../../schemas/ledger-log.schema';
import { LineItem, LineItemDocument } from '../../schemas/line-item.schema';
import { Year, YearDocument } from '../../schemas/year.schema';
import {
  DECLARATION_TARGET_CODE,
  SUPPORTING_DOCUMENT_TARGET_CODE,
  XV_FC_REVIEWABLE_YEARS,
  mapHeadOfAccountToSection,
} from '../common/xv-fc-review.constants';
import { escapeRegex } from '../common/regex.util';
import { AdminReviewListQueryDto } from './dto/admin-review-list-query.dto';
import { LineItemDecisionDto } from './dto/line-item-decision.dto';

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
          'ulb_id ulb ulb_code state state_code year xvFcReview.status xvFcReview.submittedAt xvFcReview.lineItemReviews',
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
          originalValue: doc.lineItems?.[code] ?? null,
          flagged: review?.flagged ?? false,
          proposedValue: review?.proposedValue ?? null,
          comment: review?.comment ?? '',
          adminDecision: review?.adminDecision ?? null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

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
    };
  }

  async decideLineItem(ulbId: string, yearId: string, code: string, dto: LineItemDecisionDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear);

    const review = doc.xvFcReview?.lineItemReviews?.[code];
    if (!review?.flagged) {
      throw new BadRequestException('This line item was not flagged by the ULB');
    }
    if (review.adminDecision?.status !== 'PENDING') {
      throw new ConflictException('This line item is not currently pending a decision');
    }

    const previousValue = doc.lineItems?.[code] ?? null;
    const now = new Date();
    const reviewedBy = new Types.ObjectId(user._id);

    const setOps: Record<string, unknown> = {
      [`xvFcReview.lineItemReviews.${code}.adminDecision.status`]: dto.decision,
      [`xvFcReview.lineItemReviews.${code}.adminDecision.reason`]: dto.reason,
      [`xvFcReview.lineItemReviews.${code}.adminDecision.reviewedBy`]: reviewedBy,
      [`xvFcReview.lineItemReviews.${code}.adminDecision.reviewedAt`]: now,
    };

    if (dto.decision === 'ACCEPTED') {
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision.correctedValue`] = dto.correctedValue;
      // ACCEPTED propagates into the source-of-truth value on the same document —
      // one atomic write keeps lineItems and the audit trail from ever drifting apart.
      setOps[`lineItems.${code}`] = dto.correctedValue;
    }

    const auditEntry = {
      action: dto.decision === 'ACCEPTED' ? 'ADMIN_ACCEPT' : 'ADMIN_REJECT',
      lineItemCode: code,
      previousValue,
      newValue: dto.decision === 'ACCEPTED' ? (dto.correctedValue ?? null) : null,
      performedBy: reviewedBy,
      performedByRole: user.role,
      reason: dto.reason,
      createdAt: now,
    };

    const result = await this.ledgerLogModel
      .updateOne(
        { _id: doc._id, [`xvFcReview.lineItemReviews.${code}.adminDecision.status`]: 'PENDING' },
        { $set: setOps, $push: { 'xvFcReview.auditTrail': auditEntry } },
      )
      .exec();

    if (result.modifiedCount === 0) {
      throw new ConflictException('This line item has already been decided by another admin');
    }

    this.logger.log(
      `XV-FC admin decision — ulb=${ulbId} year=${financialYear} code=${code} decision=${dto.decision} by=${user._id}`,
    );

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
}
