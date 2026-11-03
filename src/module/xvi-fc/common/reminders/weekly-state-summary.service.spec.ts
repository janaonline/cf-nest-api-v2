import { Types } from 'mongoose';
import { AnnualAccountFormStatus, FORM_STATUS_ID } from 'src/schemas/xvi-fc/annual-account.schema';
import { WeeklyStateSummaryService } from './weekly-state-summary.service';

function aggregateResult<T>(rows: T[]) {
  return { exec: jest.fn().mockResolvedValue(rows) };
}

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

/**
 * Covers only the two count helpers: both are limited to XVIFC-eligible ULBs (no Cantonment Boards), and
 * ADC-owned ULBs are left out of "Under state review" and "Review delayed" because their ADC reviews them.
 */
describe('WeeklyStateSummaryService', () => {
  let service: WeeklyStateSummaryService;
  let ulbModel: { aggregate: jest.Mock; distinct: jest.Mock };
  let annualAccountModel: { countDocuments: jest.Mock };
  let ulbEligibilityService: { getIneligibleUlbTypeIds: jest.Mock; getEligibleUlbFilter: jest.Mock };

  beforeEach(() => {
    ulbModel = {
      aggregate: jest.fn().mockReturnValue(aggregateResult([])),
      distinct: jest.fn().mockReturnValue(execResult([])),
    };
    annualAccountModel = { countDocuments: jest.fn().mockReturnValue(execResult(0)) };
    ulbEligibilityService = {
      getIneligibleUlbTypeIds: jest.fn().mockResolvedValue([]),
      getEligibleUlbFilter: jest
        .fn()
        .mockImplementation((stateId: Types.ObjectId) => Promise.resolve({ state: stateId, isActive: true })),
    };

    service = new WeeklyStateSummaryService(
      annualAccountModel as never,
      {} as never,
      ulbModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      ulbEligibilityService as never,
    );
  });

  describe('countByStatus', () => {
    const stateId = new Types.ObjectId();

    const callCountByStatus = () =>
      (service as unknown as { countByStatus(stateId: Types.ObjectId): Promise<unknown> }).countByStatus(stateId);

    it('matches by state and isActive when no ULB type is ineligible', async () => {
      await callCountByStatus();

      const pipeline = ulbModel.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match).toEqual({ state: stateId, isActive: true });
    });

    it('excludes XVIFC-ineligible ULB types (e.g. Cantonment Boards) from the $match stage', async () => {
      const cantonmentTypeId = new Types.ObjectId();
      ulbEligibilityService.getIneligibleUlbTypeIds.mockResolvedValue([cantonmentTypeId]);

      await callCountByStatus();

      const pipeline = ulbModel.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match).toEqual({
        state: stateId,
        isActive: true,
        ulbType: { $nin: [cantonmentTypeId] },
      });
      expect(ulbEligibilityService.getIneligibleUlbTypeIds).toHaveBeenCalledWith('XVIFC');
    });

    it('excludes ADC-owned ULBs from "Under state review" only', async () => {
      const S = FORM_STATUS_ID;
      ulbModel.aggregate.mockReturnValue(
        aggregateResult([
          { _id: { status: S[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE], isAdc: false }, count: 2 },
          { _id: { status: S[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE], isAdc: true }, count: 3 },
          { _id: { status: S[AnnualAccountFormStatus.APPROVED_BY_STATE], isAdc: true }, count: 1 },
          { _id: { status: S[AnnualAccountFormStatus.APPROVED_BY_STATE], isAdc: false }, count: 1 },
          { _id: { status: S[AnnualAccountFormStatus.NOT_STARTED], isAdc: true }, count: 4 },
          { _id: { status: S[AnnualAccountFormStatus.UNDER_REVIEW_BY_MOHUA], isAdc: false }, count: 5 },
        ]),
      );

      const counts = await callCountByStatus();

      expect(counts).toEqual({
        total: 16,
        notStarted: 4,
        underStateReview: 2,
        readyForClaim: 2,
        forwardedToMohua: 5,
      });
    });
  });

  describe('countReviewDelayed', () => {
    const stateId = new Types.ObjectId();

    const callCountReviewDelayed = () =>
      (service as unknown as { countReviewDelayed(stateId: Types.ObjectId): Promise<number> }).countReviewDelayed(
        stateId,
      );

    it("scopes the count to the state's eligible ULBs that no ADC owns", async () => {
      const stateOwnedUlbId = new Types.ObjectId();
      ulbModel.distinct.mockReturnValue(execResult([stateOwnedUlbId]));
      annualAccountModel.countDocuments.mockReturnValue(execResult(7));

      const delayed = await callCountReviewDelayed();

      expect(delayed).toBe(7);
      expect(ulbEligibilityService.getEligibleUlbFilter).toHaveBeenCalledWith(stateId, 'XVIFC');
      expect(ulbModel.distinct).toHaveBeenCalledWith('_id', { state: stateId, isActive: true, adc: null });
      const filter = annualAccountModel.countDocuments.mock.calls[0][0];
      expect(filter).toEqual(expect.objectContaining({ state: stateId, ulb: { $in: [stateOwnedUlbId] } }));
    });

    it('excludes an ineligible-typed ULB (e.g. a Cantonment Board) or an ADC-owned ULB from the count', async () => {
      // Neither ever appears in the resolved id set, so their delayed-review records can't inflate this count.
      ulbModel.distinct.mockReturnValue(execResult([]));

      await callCountReviewDelayed();

      const filter = annualAccountModel.countDocuments.mock.calls[0][0];
      expect(filter.ulb).toEqual({ $in: [] });
    });
  });
});
