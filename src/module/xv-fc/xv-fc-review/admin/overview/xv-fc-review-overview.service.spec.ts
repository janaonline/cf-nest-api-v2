import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { XvFcReviewOverviewService } from './xv-fc-review-overview.service';
import { LedgerLog } from '../../../../../schemas/ledger-log.schema';
import { Ulb } from '../../../../../schemas/ulb.schema';
import { XvFcPtaxReview } from '../../../../../schemas/xv-fc-ptax-review.schema';

function aggregateReturning<T>(value: T) {
  return jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) });
}

// JSON.stringify collapses a RegExp to `{}`, so the state-filter tests (which now compare
// against regex clauses, not plain strings) need the actual pipeline object, not its stringified
// form. There are two `$match` stages in the full pipeline ({isActive: true} first, from the
// join stages, then the filter conditions) — this pulls out the last one, i.e. the filter's.
function filterMatchStageOf(pipeline: Array<Record<string, any>>): Record<string, any> {
  return pipeline.filter((stage) => stage.$match).slice(-1)[0].$match;
}

function lookupStageOf(pipeline: Array<Record<string, any>>, from: string): Record<string, any> {
  return pipeline.find((stage) => stage.$lookup?.from === from)!.$lookup;
}

function overviewRow(overrides: Record<string, unknown> = {}) {
  return {
    ulbId: 'ulb1',
    ulbName: 'Test ULB',
    ulbCode: 'ULB001',
    censusCode: '800563',
    state: 'Test State',
    stateCode: 'TS',
    overallStatus: 'NOT_STARTED',
    afs: {
      status: 'NOT_STARTED',
      financialYear: null,
      flaggedCount: 0,
      pendingCount: 0,
      acceptedPct: 0,
      rejectedPct: 0,
    },
    ptax: {
      status: 'NOT_STARTED',
      financialYear: null,
      flaggedCount: 0,
      pendingCount: 0,
      acceptedPct: 0,
      rejectedPct: 0,
    },
    ...overrides,
  };
}

describe('XvFcReviewOverviewService', () => {
  let service: XvFcReviewOverviewService;
  let ulbModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    ulbModel = { aggregate: aggregateReturning([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XvFcReviewOverviewService,
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        // No longer read directly by the service (the per-ULB year resolution lives inside the
        // aggregation pipeline itself now — see buildJoinAndDeriveStages) — still injected since
        // the constructor still declares them.
        { provide: getModelToken(LedgerLog.name), useValue: {} },
        { provide: getModelToken(XvFcPtaxReview.name), useValue: {} },
      ],
    }).compile();

    service = module.get(XvFcReviewOverviewService);
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    // The Overview screen has no year concept in its UI, and there's no single "current" year
    // shared across the whole roster either — each ULB, each form, independently resolves
    // whichever reviewable year is most worth an admin's attention (see statusPriorityExpr).
    // These assert the *shape* of that resolution inside the $lookup pipeline sent to Mongo —
    // actual evaluation against real data was validated separately via mongosh.
    it("AFS's per-ULB $lookup ranks VERIFYING > SUBMITTED/LOCKED > REJECTED > DRAFT > APPROVED > (nothing), breaking ties by the oldest year", async () => {
      await service.list({});
      const afsLookup = lookupStageOf(ulbModel.aggregate.mock.calls[0][0], 'ledgerlogs');
      const [, , priorityStage, sortStage, limitStage] = afsLookup.pipeline;
      const branches = priorityStage.$addFields.priority.$switch.branches;
      expect(branches.map((b: any) => b.then)).toEqual([1, 2, 3, 4, 5]);
      expect(branches[0].case).toEqual({ $eq: ['$xvFcReview.status', 'VERIFYING'] });
      expect(branches[1].case).toEqual({ $in: ['$xvFcReview.status', ['SUBMITTED', 'LOCKED']] });
      // Ascending on year — a backlog of equally-urgent submissions surfaces the earliest one
      // first, not whichever happens to be most recent.
      expect(sortStage).toEqual({ $sort: { priority: 1, year: 1 } });
      expect(limitStage).toEqual({ $limit: 1 });
    });

    it("Ptax's per-ULB $lookup uses the same ranking but without LOCKED, which isn't a Ptax status", async () => {
      await service.list({});
      const ptaxLookup = lookupStageOf(ulbModel.aggregate.mock.calls[0][0], 'xvfc_ptax_reviews');
      const [, , priorityStage, sortStage] = ptaxLookup.pipeline;
      const branches = priorityStage.$addFields.priority.$switch.branches;
      expect(branches[1].case).toEqual({ $in: ['$status', ['SUBMITTED']] });
      expect(sortStage).toEqual({ $sort: { priority: 1, financialYear: 1 } });
    });

    it('each AFS $lookup restricts to its 5 reviewable years, not one specific year', async () => {
      await service.list({});
      const afsLookup = lookupStageOf(ulbModel.aggregate.mock.calls[0][0], 'ledgerlogs');
      const matchStage = afsLookup.pipeline[0];
      expect(JSON.stringify(matchStage)).toContain(
        '"$in":["$year",["2019-20","2020-21","2021-22","2022-23","2023-24"]]',
      );
    });

    // Ptax's reviewable window is 6 years starting 2018-19 — one year earlier than AFS's 5-year
    // window (2019-20 start) — because real Ptax review activity genuinely goes back that far
    // (confirmed against the local dev DB), unlike AFS.
    it('each Ptax $lookup restricts to its own 6 reviewable years (2018-19 onward), not AFS’s 5', async () => {
      await service.list({});
      const ptaxLookup = lookupStageOf(ulbModel.aggregate.mock.calls[0][0], 'xvfc_ptax_reviews');
      const matchStage = ptaxLookup.pipeline[0];
      expect(JSON.stringify(matchStage)).toContain(
        '"$in":["$financialYear",["2018-19","2019-20","2020-21","2021-22","2022-23","2023-24"]]',
      );
    });

    // flaggedCount/acceptedPct/rejectedPct must reflect every reviewable year's flagged items
    // combined, not just whichever single year afsDoc/ptaxDoc picked for status — otherwise a
    // ULB with, say, 1 accepted item in one year and 2 pending in another would show a
    // misleadingly clean 100% just because the "most relevant" year happened to be the decided
    // one.
    it('sources afsFlaggedReviews/ptaxFlaggedReviews from a lookup spanning all 5 years, not the single most-relevant-year doc', async () => {
      await service.list({});
      const pipeline = ulbModel.aggregate.mock.calls[0][0];
      const afsAllFlaggedLookup = pipeline.find(
        (stage: any) => stage.$lookup?.from === 'ledgerlogs' && stage.$lookup.as === 'afsAllFlaggedReviews',
      ).$lookup;
      expect(JSON.stringify(afsAllFlaggedLookup.pipeline[0])).toContain(
        '"$in":["$year",["2019-20","2020-21","2021-22","2022-23","2023-24"]]',
      );
      // No $limit anywhere in this sub-pipeline — every matching year's flagged items count.
      expect(afsAllFlaggedLookup.pipeline.some((s: any) => '$limit' in s)).toBe(false);

      const overallDerivedStage = pipeline.find((stage: any) => stage.$addFields?.afsFlaggedReviews !== undefined);
      expect(overallDerivedStage.$addFields.afsFlaggedReviews).toBe('$afsAllFlaggedReviews');
      expect(overallDerivedStage.$addFields.ptaxFlaggedReviews).toBe('$ptaxAllFlaggedReviews');
    });

    // "Approved by Admin" must mean every one of the 5 reviewable years is APPROVED, for both
    // forms — not just that each form's single most-relevant year happens to be APPROVED while
    // other years were never even submitted (e.g. 3 of 5 years approved, 2 never submitted is
    // NOT "Approved by Admin" — it falls into PARTIAL instead).
    it('counts APPROVED years per form separately from the single most-relevant-year pick', async () => {
      await service.list({});
      const pipeline = ulbModel.aggregate.mock.calls[0][0];
      const afsCountLookup = pipeline.find(
        (stage: any) => stage.$lookup?.from === 'ledgerlogs' && stage.$lookup.as === 'afsApprovedCountDoc',
      ).$lookup;
      expect(JSON.stringify(afsCountLookup.pipeline[0])).toContain('"$eq":["$xvFcReview.status","APPROVED"]');
      expect(afsCountLookup.pipeline[1]).toEqual({ $count: 'count' });

      const ptaxCountLookup = pipeline.find(
        (stage: any) => stage.$lookup?.from === 'xvfc_ptax_reviews' && stage.$lookup.as === 'ptaxApprovedCountDoc',
      ).$lookup;
      expect(JSON.stringify(ptaxCountLookup.pipeline[0])).toContain('"$eq":["$status","APPROVED"]');
    });

    // AFS's reviewable window is 5 years (2019-20 → 2023-24); Ptax's is 6 (2018-19 → 2023-24) —
    // each form's "fully approved" bar must use its own count, not a shared one.
    it('the overallStatus switch only resolves APPROVED when both forms have all their own reviewable years approved (AFS: 5, Ptax: 6)', async () => {
      await service.list({});
      const pipeline = ulbModel.aggregate.mock.calls[0][0];
      const overallStage = pipeline.find((stage: any) => stage.$addFields?.overallStatus);
      const branches = overallStage.$addFields.overallStatus.$switch.branches;
      const approvedBranch = branches.find((b: any) => b.then === 'APPROVED');
      expect(approvedBranch.case).toEqual({
        $and: [{ $eq: ['$afsApprovedYearCount', 5] }, { $eq: ['$ptaxApprovedYearCount', 6] }],
      });
      const partialBranch = branches.find((b: any) => b.then === 'PARTIAL');
      expect(partialBranch.case).toEqual({
        $or: [{ $gt: ['$afsApprovedYearCount', 0] }, { $gt: ['$ptaxApprovedYearCount', 0] }],
      });
    });

    // stateName is the primary use case (a search-as-you-type state box), but a state code or
    // the state's ObjectId are also accepted, since a caller might have either on hand instead.
    it('matches stateObjectId (not the code/name $or clause) when stateName looks like a 24-hex-char ObjectId', async () => {
      ulbModel.aggregate = aggregateReturning([{ rows: [], totalCount: [] }]);
      await service.list({ stateName: '5dcf9d7516a06aed41c748f8' } as never);
      const match = filterMatchStageOf(ulbModel.aggregate.mock.calls[0][0]);
      expect(match.stateObjectId.toString()).toBe('5dcf9d7516a06aed41c748f8');
      expect(match.$or).toBeUndefined();
    });

    it('matches an exact, case-insensitive state code via the $or clause', async () => {
      ulbModel.aggregate = aggregateReturning([{ rows: [], totalCount: [] }]);
      await service.list({ stateName: 'RJ' } as never);
      const match = filterMatchStageOf(ulbModel.aggregate.mock.calls[0][0]);
      const [codeClause] = match.$or;
      expect(codeClause.stateCode.test('RJ')).toBe(true);
      expect(codeClause.stateCode.test('rj')).toBe(true); // case-insensitive
      expect(codeClause.stateCode.test('RJX')).toBe(false); // exact, not partial
      expect(match.stateObjectId).toBeUndefined();
    });

    it('matches a partial, case-insensitive state name via the same $or clause', async () => {
      ulbModel.aggregate = aggregateReturning([{ rows: [], totalCount: [] }]);
      await service.list({ stateName: 'raja' } as never);
      const match = filterMatchStageOf(ulbModel.aggregate.mock.calls[0][0]);
      const [, nameClause] = match.$or;
      expect(nameClause.state.test('Rajasthan')).toBe(true);
      expect(nameClause.state.test('RAJASTHAN')).toBe(true); // case-insensitive
      expect(nameClause.state.test('Kerala')).toBe(false);
    });

    it('returns rows/total from the $facet result, defaulting to empty/0 when the aggregate returns nothing', async () => {
      const result = await service.list({});
      expect(result).toMatchObject({ rows: [], total: 0, page: 1, limit: 50 });
    });

    it('unwraps rows and total count from a populated $facet result', async () => {
      ulbModel.aggregate = aggregateReturning([{ rows: [overviewRow()], totalCount: [{ count: 1 }] }]);
      const result = await service.list({});
      expect(result.rows).toEqual([overviewRow()]);
      expect(result.total).toBe(1);
    });

    it('caps limit at 200 even when a larger value is requested', async () => {
      ulbModel.aggregate = aggregateReturning([{ rows: [], totalCount: [] }]);
      const result = await service.list({ limit: 5000 } as never);
      expect(result.limit).toBe(200);
    });
  });

  // ─── analytics ───────────────────────────────────────────────────────────

  describe('analytics', () => {
    it('defaults every KPI to 0 when the aggregate returns nothing', async () => {
      const result = await service.analytics({});
      expect(result).toMatchObject({ totalUlbs: 0, awaitingVerification: 0, approved: 0, rejected: 0 });
    });

    it('surfaces the $group result values as-is', async () => {
      ulbModel.aggregate = aggregateReturning([
        { totalUlbs: 100, awaitingVerification: 10, approved: 80, rejected: 5 },
      ]);
      const result = await service.analytics({});
      expect(result).toMatchObject({ totalUlbs: 100, awaitingVerification: 10, approved: 80, rejected: 5 });
    });
  });

  // ─── exportCsv ───────────────────────────────────────────────────────────

  describe('exportCsv', () => {
    it('produces one CSV row per ULB per form, with a header row', async () => {
      ulbModel.aggregate = aggregateReturning([
        overviewRow({
          ulbName: 'Sadri Municipality',
          afs: { status: 'LOCKED', financialYear: '2021-22', acceptedPct: 0, rejectedPct: 0 },
        }),
      ]);
      const { csv, rowCount } = await service.exportCsv({});
      const lines = csv.split('\n');
      expect(lines[0]).toBe('"State","ULB Name","Census Code","Form","Status","% Accepted","% Rejected"');
      expect(lines).toHaveLength(3); // header + 1 AFS row + 1 Ptax row
      expect(lines[1]).toContain('Sadri Municipality');
      expect(lines[1]).toContain('AFS');
      expect(lines[2]).toContain('Property Tax');
      expect(rowCount).toBe(2);
    });

    it('escapes embedded quotes in a cell', async () => {
      ulbModel.aggregate = aggregateReturning([overviewRow({ ulbName: 'Sadri "New" Municipality' })]);
      const { csv } = await service.exportCsv({});
      expect(csv).toContain('"Sadri ""New"" Municipality"');
    });

    it('rejects when the export would exceed the row cap', async () => {
      const rows = Array.from({ length: 10001 }, (_, i) => overviewRow({ ulbId: `ulb${i}` }));
      ulbModel.aggregate = aggregateReturning(rows);
      await expect(service.exportCsv({})).rejects.toThrow(BadRequestException);
    });
  });
});
