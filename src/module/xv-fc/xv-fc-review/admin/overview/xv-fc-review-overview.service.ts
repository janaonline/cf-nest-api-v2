import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { LedgerLog, LedgerLogDocument } from '../../../../../schemas/ledger-log.schema';
import { Ulb, UlbDocument } from '../../../../../schemas/ulb.schema';
import { XvFcPtaxReview, XvFcPtaxReviewDocument } from '../../../../../schemas/xv-fc-ptax-review.schema';
import { PTAX_REVIEWABLE_YEARS } from '../../common/ptax.constants';
import { XV_FC_REVIEWABLE_YEARS } from '../../common/xv-fc-review.constants';
import { escapeRegex } from '../../common/regex.util';
import { OverviewAnalyticsQueryDto } from './dto/overview-analytics-query.dto';
import { OverviewExportQueryDto } from './dto/overview-export-query.dto';
import { OverviewListQueryDto } from './dto/overview-list-query.dto';

/**
 * Combines AFS + Ptax into one row per ULB — the two admin list endpoints
 * (XvFcReviewAdminService, PtaxReviewAdminService) are per-form only and can't
 * produce this on their own. Anchored on `ulbs` (not `ledgerlogs`/`xvfc_ptax_reviews`)
 * so every active ULB appears even with zero review activity yet — matching the
 * `{ isActive: true }` convention already used for "total active ULBs" elsewhere
 * (see module/xvi-fc/state/dashboard/state-dashboard-phase-1-audit.md).
 *
 * The join/derivation pipeline below was validated directly against the local dev
 * database (5k+ ULBs, 16k+ ledgerlogs) before being written here — see
 * `overview-pipeline-test.js` in this change's notes for the mongosh script used.
 */
@Injectable()
export class XvFcReviewOverviewService {
  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(LedgerLog.name) private readonly ledgerLogModel: Model<LedgerLogDocument>,
    @InjectModel(XvFcPtaxReview.name) private readonly ptaxReviewModel: Model<XvFcPtaxReviewDocument>,
  ) {}

  async list(query: OverviewListQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const sortPathByField: Record<string, string> = {
      ulb: 'ulbName',
      state: 'state',
      censusCode: 'censusCode',
    };
    const sortField = sortPathByField[query.sortBy ?? 'ulb'] ?? 'ulbName';
    const sortOrder: 1 | -1 = query.sortOrder === 'desc' ? -1 : 1;

    const pipeline: PipelineStage[] = [
      ...this.buildJoinAndDeriveStages(),
      ...this.buildFilterStage(query),
      {
        $facet: {
          rows: [{ $sort: { [sortField]: sortOrder } }, { $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.ulbModel.aggregate(pipeline).exec();
    const rows = result?.rows ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    return { rows, total, page, limit };
  }

  async analytics(query: OverviewAnalyticsQueryDto) {
    const statusField = query.form === 'afs' ? '$afsStatus' : query.form === 'ptax' ? '$ptaxStatus' : '$overallStatus';
    // "Approved" needs the same all-years-done bar as the overallStatus switch — afsStatus/
    // ptaxStatus alone only reflect the single most-relevant year, which would otherwise count a
    // ULB with 3 of 5 AFS years approved (2 never submitted) as fully "Approved" here too. AFS
    // and Ptax have different reviewable-year windows (AFS: 5 years from 2019-20; Ptax: 6 years
    // from 2018-19), so each needs its own "all years" bar.
    const approvedExpr =
      query.form === 'afs'
        ? { $eq: ['$afsApprovedYearCount', XV_FC_REVIEWABLE_YEARS.length] }
        : query.form === 'ptax'
          ? { $eq: ['$ptaxApprovedYearCount', PTAX_REVIEWABLE_YEARS.length] }
          : { $eq: ['$overallStatus', 'APPROVED'] };

    const pipeline: PipelineStage[] = [
      ...this.buildJoinAndDeriveStages(),
      {
        $group: {
          _id: null,
          totalUlbs: { $sum: 1 },
          awaitingVerification: {
            $sum: { $cond: [{ $in: [statusField, ['LOCKED', 'SUBMITTED', 'VERIFYING']] }, 1, 0] },
          },
          approved: { $sum: { $cond: [approvedExpr, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: [statusField, 'REJECTED'] }, 1, 0] } },
        },
      },
    ];

    const [result] = await this.ulbModel.aggregate(pipeline).exec();
    return {
      totalUlbs: result?.totalUlbs ?? 0,
      awaitingVerification: result?.awaitingVerification ?? 0,
      approved: result?.approved ?? 0,
      rejected: result?.rejected ?? 0,
    };
  }

  /** One CSV row per ULB per form (matches the approved prototype's downloadSummary() shape). */
  async exportCsv(query: OverviewExportQueryDto): Promise<{ csv: string; rowCount: number }> {
    const MAX_ROWS = 20000;

    const pipeline: PipelineStage[] = [
      ...this.buildJoinAndDeriveStages(),
      ...this.buildFilterStage(query),
      { $limit: MAX_ROWS / 2 + 1 }, // ×2 rows (AFS + Ptax) per ULB below
    ];

    const ulbRows = await this.ulbModel.aggregate(pipeline).exec();
    if (ulbRows.length > MAX_ROWS / 2) {
      throw new BadRequestException(
        `Export would exceed ${MAX_ROWS} rows — narrow the filters (state, census code, or status).`,
      );
    }

    // No FY column — the Overview screen (and this export) has no year concept in its own UI;
    // each ULB's AFS/Ptax status here is already rolled up across every reviewable year (see
    // buildJoinAndDeriveStages), so there's no single year left to label a row with anyway.
    const header = ['State', 'ULB Name', 'Census Code', 'Form', 'Status', '% Accepted', '% Rejected'];
    const csvRows = ulbRows.flatMap((row) => [
      [row.state, row.ulbName, row.censusCode, 'AFS', row.afs.status, row.afs.acceptedPct, row.afs.rejectedPct],
      [
        row.state,
        row.ulbName,
        row.censusCode,
        'Property Tax',
        row.ptax.status,
        row.ptax.acceptedPct,
        row.ptax.rejectedPct,
      ],
    ]);

    const csv = [header, ...csvRows]
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return { csv, rowCount: csvRows.length };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildFilterStage(
    query: Pick<OverviewListQueryDto, 'stateName' | 'censusCode' | 'search' | 'overallStatus'>,
  ): PipelineStage[] {
    const match: Record<string, unknown> = {};
    // Named stateName since a search-as-you-type state box is the primary use case, but still
    // accepts a state code (e.g. "KL") or the state's ObjectId too — whichever a caller has on
    // hand. A 24-hex-char string matches stateObjectId; otherwise, match either an exact
    // (case-insensitive) code or a partial (case-insensitive) name.
    if (query.stateName) {
      if (/^[0-9a-fA-F]{24}$/.test(query.stateName)) {
        match['stateObjectId'] = new Types.ObjectId(query.stateName);
      } else {
        const escaped = escapeRegex(query.stateName);
        match['$or'] = [{ stateCode: new RegExp(`^${escaped}$`, 'i') }, { state: new RegExp(escaped, 'i') }];
      }
    }
    if (query.censusCode) match['censusCode'] = new RegExp(escapeRegex(query.censusCode));
    if (query.search) match['ulbName'] = new RegExp(escapeRegex(query.search), 'i');
    if (query.overallStatus) match['overallStatus'] = query.overallStatus;
    return Object.keys(match).length ? [{ $match: match }] : [];
  }

  /**
   * Picks, per document, whichever reviewable year is "most worth an admin's attention" for that
   * one ULB: a year that's actively awaiting/under verification beats one that's already been
   * decided, which beats one the ULB hasn't even submitted yet. Ties within a tier go to the
   * *oldest* year — an admin clearing a backlog of equally-urgent years naturally starts from the
   * earliest one, not whichever is most recent. This mirrors a real admin's own priority (go look
   * at what's pending first, oldest first), and — critically — it's resolved independently *per
   * ULB*, not once for the whole roster: two
   * ULBs can each have their real activity sitting on two different years, and a single
   * globally-"current" year picked for everyone would silently read as NOT_STARTED for whichever
   * ULBs' activity isn't on that particular year.
   *
   * `includeLocked` is AFS-only — LOCKED (the ULB-submitted-but-admin-hasn't-touched-it-yet
   * state) doesn't exist as a Ptax status; SUBMITTED already covers that case there.
   */
  private statusPriorityExpr(statusFieldPath: string, includeLocked: boolean) {
    const awaitingStatuses = includeLocked ? ['SUBMITTED', 'LOCKED'] : ['SUBMITTED'];
    return {
      $switch: {
        branches: [
          { case: { $eq: [statusFieldPath, 'VERIFYING'] }, then: 1 },
          { case: { $in: [statusFieldPath, awaitingStatuses] }, then: 2 },
          { case: { $eq: [statusFieldPath, 'REJECTED'] }, then: 3 },
          { case: { $eq: [statusFieldPath, 'DRAFT'] }, then: 4 },
          { case: { $eq: [statusFieldPath, 'APPROVED'] }, then: 5 },
        ],
        default: 6, // no status at all / NOT_STARTED
      },
    };
  }

  /**
   * Joins the ULB roster to each form's data across every reviewable year. Two different things
   * are deliberately resolved differently here, both per ULB per form:
   *  - status/financialYear come from the single most-relevant year (see statusPriorityExpr) —
   *    "what needs my attention right now".
   *  - flaggedCount/pendingCount/acceptedPct/rejectedPct are summed across *all 5* reviewable
   *    years — "how much of this ULB's total review work is actually done", so a ULB with 1
   *    accepted item in one year and 2 pending in another correctly reads as 1 of 3 decided, not
   *    just whichever single year happened to be picked for status.
   * A combined `overallStatus` is then derived — ported from the approved prototype's
   * `overallStatus()`: any REJECTED wins, both forms fully APPROVED (all 5 years each) wins next,
   * either VERIFYING next, either awaiting-admin-action (LOCKED/SUBMITTED) next, any real approved
   * progress short of fully done next (PARTIAL), either DRAFT next (IN_PROGRESS), else NOT_STARTED.
   */
  private buildJoinAndDeriveStages(): PipelineStage[] {
    return [
      { $match: { isActive: true } },
      { $lookup: { from: 'states', localField: 'state', foreignField: '_id', as: 'stateDoc' } },
      { $unwind: { path: '$stateDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'ledgerlogs',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$ulb_id', '$$ulbId'] }, { $in: ['$year', XV_FC_REVIEWABLE_YEARS] }],
                },
              },
            },
            { $project: { year: 1, 'xvFcReview.status': 1, 'xvFcReview.lineItemReviews': 1 } },
            { $addFields: { priority: this.statusPriorityExpr('$xvFcReview.status', true) } },
            // Ties within a priority tier go to the *oldest* year — an admin clearing a backlog
            // of equally-urgent submissions naturally starts from the earliest one, not whichever
            // is most recent.
            { $sort: { priority: 1, year: 1 } },
            { $limit: 1 },
          ],
          as: 'afsDoc',
        },
      },
      { $unwind: { path: '$afsDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'xvfc_ptax_reviews',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$ulb_id', '$$ulbId'] }, { $in: ['$financialYear', PTAX_REVIEWABLE_YEARS] }],
                },
              },
            },
            { $project: { financialYear: 1, status: 1, metricReviews: 1 } },
            { $addFields: { priority: this.statusPriorityExpr('$status', false) } },
            { $sort: { priority: 1, financialYear: 1 } },
            { $limit: 1 },
          ],
          as: 'ptaxDoc',
        },
      },
      { $unwind: { path: '$ptaxDoc', preserveNullAndEmptyArrays: true } },
      // How many of the 5 reviewable years are actually APPROVED — separate from afsDoc/ptaxDoc
      // above (which only ever surface the single *most relevant* year). "Approved by Admin"
      // needs to mean every year is done, not just that the most relevant one happens to be
      // APPROVED while others were never even submitted — see the overallStatus switch below.
      {
        $lookup: {
          from: 'ledgerlogs',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$ulb_id', '$$ulbId'] },
                    { $eq: ['$xvFcReview.status', 'APPROVED'] },
                    { $in: ['$year', XV_FC_REVIEWABLE_YEARS] },
                  ],
                },
              },
            },
            { $count: 'count' },
          ],
          as: 'afsApprovedCountDoc',
        },
      },
      {
        $lookup: {
          from: 'xvfc_ptax_reviews',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$ulb_id', '$$ulbId'] },
                    { $eq: ['$status', 'APPROVED'] },
                    { $in: ['$financialYear', PTAX_REVIEWABLE_YEARS] },
                  ],
                },
              },
            },
            { $count: 'count' },
          ],
          as: 'ptaxApprovedCountDoc',
        },
      },
      // Every flagged item across *all* 5 reviewable years, not just the single most-relevant
      // one — flaggedCount/acceptedPct/rejectedPct need to reflect the ULB's real cross-year
      // review progress (e.g. 1 accepted item in one year plus 2 pending in another shows as 1
      // of 3 decided, not just whichever single year afsDoc happened to pick).
      {
        $lookup: {
          from: 'ledgerlogs',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$ulb_id', '$$ulbId'] }, { $in: ['$year', XV_FC_REVIEWABLE_YEARS] }],
                },
              },
            },
            {
              $project: {
                flaggedReviews: {
                  $filter: {
                    input: { $objectToArray: { $ifNull: ['$xvFcReview.lineItemReviews', {}] } },
                    as: 'r',
                    cond: { $eq: ['$$r.v.flagged', true] },
                  },
                },
              },
            },
            { $unwind: '$flaggedReviews' },
            { $replaceRoot: { newRoot: '$flaggedReviews' } },
          ],
          as: 'afsAllFlaggedReviews',
        },
      },
      {
        $lookup: {
          from: 'xvfc_ptax_reviews',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$ulb_id', '$$ulbId'] }, { $in: ['$financialYear', PTAX_REVIEWABLE_YEARS] }],
                },
              },
            },
            {
              $project: {
                flaggedReviews: {
                  $filter: {
                    input: { $objectToArray: { $ifNull: ['$metricReviews', {}] } },
                    as: 'r',
                    cond: { $eq: ['$$r.v.flagged', true] },
                  },
                },
              },
            },
            { $unwind: '$flaggedReviews' },
            { $replaceRoot: { newRoot: '$flaggedReviews' } },
          ],
          as: 'ptaxAllFlaggedReviews',
        },
      },
      {
        $addFields: {
          afsStatus: { $ifNull: ['$afsDoc.xvFcReview.status', 'NOT_STARTED'] },
          afsFinancialYear: { $ifNull: ['$afsDoc.year', null] },
          afsApprovedYearCount: { $ifNull: [{ $arrayElemAt: ['$afsApprovedCountDoc.count', 0] }, 0] },
          ptaxStatus: { $ifNull: ['$ptaxDoc.status', 'NOT_STARTED'] },
          ptaxFinancialYear: { $ifNull: ['$ptaxDoc.financialYear', null] },
          ptaxApprovedYearCount: { $ifNull: [{ $arrayElemAt: ['$ptaxApprovedCountDoc.count', 0] }, 0] },
          afsFlaggedReviews: '$afsAllFlaggedReviews',
          ptaxFlaggedReviews: '$ptaxAllFlaggedReviews',
        },
      },
      {
        $addFields: {
          afsFlaggedCount: { $size: '$afsFlaggedReviews' },
          afsAcceptedCount: this.countByDecision('$afsFlaggedReviews', 'ACCEPTED'),
          afsRejectedCount: this.countByDecision('$afsFlaggedReviews', 'REJECTED'),
          afsPendingCount: this.countByDecision('$afsFlaggedReviews', 'PENDING'),
          ptaxFlaggedCount: { $size: '$ptaxFlaggedReviews' },
          ptaxAcceptedCount: this.countByDecision('$ptaxFlaggedReviews', 'ACCEPTED'),
          ptaxRejectedCount: this.countByDecision('$ptaxFlaggedReviews', 'REJECTED'),
          ptaxPendingCount: this.countByDecision('$ptaxFlaggedReviews', 'PENDING'),
        },
      },
      {
        $addFields: {
          overallStatus: {
            $switch: {
              branches: [
                {
                  case: { $or: [{ $eq: ['$afsStatus', 'REJECTED'] }, { $eq: ['$ptaxStatus', 'REJECTED'] }] },
                  then: 'REJECTED',
                },
                // "Approved by Admin" requires every one of the 5 reviewable years to actually be
                // APPROVED, for both forms — not just that each form's single most-relevant year
                // happens to be APPROVED while other years were never even submitted. A ULB that
                // approved 3 of 5 years (2 never submitted) is NOT "done"; it falls through to
                // the PARTIAL branch below instead.
                {
                  case: {
                    $and: [
                      { $eq: ['$afsApprovedYearCount', XV_FC_REVIEWABLE_YEARS.length] },
                      { $eq: ['$ptaxApprovedYearCount', PTAX_REVIEWABLE_YEARS.length] },
                    ],
                  },
                  then: 'APPROVED',
                },
                {
                  case: { $or: [{ $eq: ['$afsStatus', 'VERIFYING'] }, { $eq: ['$ptaxStatus', 'VERIFYING'] }] },
                  then: 'VERIFYING',
                },
                {
                  case: {
                    $or: [{ $in: ['$afsStatus', ['LOCKED', 'SUBMITTED']] }, { $eq: ['$ptaxStatus', 'SUBMITTED'] }],
                  },
                  then: 'SUBMITTED',
                },
                // Any real approved progress on either form that isn't (yet) the fully-done state
                // above — covers both "one form fully approved, the other untouched" and "both
                // forms have some approved years but not all 5".
                {
                  case: { $or: [{ $gt: ['$afsApprovedYearCount', 0] }, { $gt: ['$ptaxApprovedYearCount', 0] }] },
                  then: 'PARTIAL',
                },
                {
                  case: { $or: [{ $eq: ['$afsStatus', 'DRAFT'] }, { $eq: ['$ptaxStatus', 'DRAFT'] }] },
                  then: 'IN_PROGRESS',
                },
              ],
              default: 'NOT_STARTED',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          ulbId: '$_id',
          ulbName: '$name',
          ulbCode: '$code',
          censusCode: 1,
          state: '$stateDoc.name',
          stateCode: '$stateDoc.code',
          stateObjectId: '$stateDoc._id',
          overallStatus: 1,
          afsStatus: 1,
          ptaxStatus: 1,
          afs: {
            status: '$afsStatus',
            // The year this row's AFS status actually came from — the FE needs it to navigate
            // to the Detail screen on the right year instead of guessing; null (no submission on
            // any reviewable year yet) falls back to the latest reviewable year client-side.
            financialYear: '$afsFinancialYear',
            flaggedCount: '$afsFlaggedCount',
            pendingCount: '$afsPendingCount',
            acceptedPct: this.percentOf('$afsAcceptedCount', '$afsFlaggedCount'),
            rejectedPct: this.percentOf('$afsRejectedCount', '$afsFlaggedCount'),
          },
          ptax: {
            status: '$ptaxStatus',
            financialYear: '$ptaxFinancialYear',
            flaggedCount: '$ptaxFlaggedCount',
            pendingCount: '$ptaxPendingCount',
            acceptedPct: this.percentOf('$ptaxAcceptedCount', '$ptaxFlaggedCount'),
            rejectedPct: this.percentOf('$ptaxRejectedCount', '$ptaxFlaggedCount'),
          },
        },
      },
    ];
  }

  /** Counts entries in a flagged-reviews array whose adminDecision.status matches (PENDING covers "no decision yet" too). */
  private countByDecision(flaggedReviewsPath: string, status: 'ACCEPTED' | 'REJECTED' | 'PENDING') {
    return {
      $size: {
        $filter: {
          input: flaggedReviewsPath,
          as: 'r',
          cond: { $eq: [{ $ifNull: ['$$r.v.adminDecision.status', 'PENDING'] }, status] },
        },
      },
    };
  }

  private percentOf(countExpr: unknown, totalExpr: unknown) {
    return {
      $cond: [{ $gt: [totalExpr, 0] }, { $round: [{ $multiply: [{ $divide: [countExpr, totalExpr] }, 100] }, 0] }, 0],
    };
  }
}
