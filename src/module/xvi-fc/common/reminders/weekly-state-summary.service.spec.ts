import { Types } from 'mongoose';
import { AnnualAccountFormStatus, FORM_STATUS_ID } from 'src/schemas/xvi-fc/annual-account.schema';
import { WeeklyStateSummaryService } from './weekly-state-summary.service';

/**
 * Covers only the two count helpers: ADC-owned ULBs are reviewed by their ADC, so they are left out of the
 * State's "Under state review" and "Review delayed" numbers, while every other count stays state-wide.
 */
describe('WeeklyStateSummaryService counts', () => {
  const stateId = new Types.ObjectId();
  const adcUlbId = new Types.ObjectId();

  function buildService(models: {
    ulbModel: Record<string, jest.Mock>;
    annualAccountModel?: Record<string, jest.Mock>;
  }) {
    return new WeeklyStateSummaryService(
      (models.annualAccountModel ?? {}) as any,
      undefined as any,
      models.ulbModel as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    );
  }

  it('excludes ADC-owned ULBs from "Under state review" only', async () => {
    const S = FORM_STATUS_ID;
    const rows = [
      { _id: { status: S[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE], isAdc: false }, count: 2 },
      { _id: { status: S[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE], isAdc: true }, count: 3 },
      { _id: { status: S[AnnualAccountFormStatus.APPROVED_BY_STATE], isAdc: true }, count: 1 },
      { _id: { status: S[AnnualAccountFormStatus.APPROVED_BY_STATE], isAdc: false }, count: 1 },
      { _id: { status: S[AnnualAccountFormStatus.NOT_STARTED], isAdc: true }, count: 4 },
      { _id: { status: S[AnnualAccountFormStatus.UNDER_REVIEW_BY_MOHUA], isAdc: false }, count: 5 },
    ];
    const ulbModel = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(rows) }) };

    const counts = await (buildService({ ulbModel }) as any).countByStatus(stateId);

    expect(counts).toEqual({
      total: 16,
      notStarted: 4,
      underStateReview: 2,
      readyForClaim: 2,
      forwardedToMohua: 5,
    });
  });

  it("counts delayed reviews only for the State's own ULBs, not its ADCs'", async () => {
    const ulbModel = { distinct: jest.fn().mockResolvedValue([adcUlbId]) };
    const annualAccountModel = { countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(7) }) };

    const delayed = await (buildService({ ulbModel, annualAccountModel }) as any).countReviewDelayed(stateId);

    expect(delayed).toBe(7);
    expect(ulbModel.distinct).toHaveBeenCalledWith('_id', { state: stateId, adc: { $ne: null } });
    expect(annualAccountModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ state: stateId, ulb: { $nin: [adcUlbId] } }),
    );
  });
});
