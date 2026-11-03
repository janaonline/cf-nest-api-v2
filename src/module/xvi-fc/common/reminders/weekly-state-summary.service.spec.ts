import { Types } from 'mongoose';
import { WeeklyStateSummaryService } from './weekly-state-summary.service';

function aggregateResult<T>(rows: T[]) {
  return { exec: jest.fn().mockResolvedValue(rows) };
}

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

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
  });

  describe('countReviewDelayed', () => {
    const stateId = new Types.ObjectId();

    const callCountReviewDelayed = () =>
      (service as unknown as { countReviewDelayed(stateId: Types.ObjectId): Promise<number> }).countReviewDelayed(
        stateId,
      );

    it("scopes the count to the state's eligible ULBs", async () => {
      const eligibleUlbId = new Types.ObjectId();
      ulbModel.distinct.mockReturnValue(execResult([eligibleUlbId]));

      await callCountReviewDelayed();

      expect(ulbEligibilityService.getEligibleUlbFilter).toHaveBeenCalledWith(stateId, 'XVIFC');
      expect(ulbModel.distinct).toHaveBeenCalledWith('_id', { state: stateId, isActive: true });
      const filter = annualAccountModel.countDocuments.mock.calls[0][0];
      expect(filter.ulb).toEqual({ $in: [eligibleUlbId] });
    });

    it('excludes an ineligible-typed ULB (e.g. a Cantonment Board) from the count', async () => {
      // The ineligible ULB simply never appears in the eligible-ULB id set resolved above, so its
      // delayed-review record (if any) can't inflate this count.
      ulbModel.distinct.mockReturnValue(execResult([]));

      await callCountReviewDelayed();

      const filter = annualAccountModel.countDocuments.mock.calls[0][0];
      expect(filter.ulb).toEqual({ $in: [] });
    });
  });
});
