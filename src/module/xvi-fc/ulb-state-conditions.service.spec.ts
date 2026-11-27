import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { ULB_VISIBLE_STATE_FORM_STATUSES, UlbStateConditionsService } from './ulb-state-conditions.service';

/** `Model.findOne(...).select().lean().exec()` chain. */
function q<T>(result: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(result);
  return chain;
}

const stateId = new Types.ObjectId();
const ulbId = new Types.ObjectId();
const yearId = new Types.ObjectId();
const formId = new Types.ObjectId();

describe('UlbStateConditionsService', () => {
  let sfcModel: { findOne: jest.Mock };
  let ebForm: { findOne: jest.Mock };
  let ebRow: { findOne: jest.Mock };
  let dfForm: { findOne: jest.Mock };
  let dfRow: { findOne: jest.Mock };
  let unspentForm: { findOne: jest.Mock };
  let unspentRow: { findOne: jest.Mock };
  let gtcForm: { findOne: jest.Mock };
  let formJson: { findActiveByDesignYearAndFormId: jest.Mock };
  let exemptions: { resolveDiscretionary: jest.Mock };
  let service: UlbStateConditionsService;

  const form = (currentFormStatus: number) => q({ _id: formId, currentFormStatus, activeDatasetVersion: 3 });
  /** The FC Unspent form at 5, on the Yes-branch (the State declared an unspent balance) or the nil declaration. */
  const unspentDeclared = (isFcUnspent: boolean) =>
    unspentForm.findOne.mockReturnValue(q({ _id: formId, currentFormStatus: 5, isFcUnspent }));

  /** Puts all five State forms at `status` (SFC with an answer). */
  const allAt = (status: number) => {
    sfcModel.findOne.mockReturnValue(q({ currentFormStatus: status, data: { isActiveSfc: 'yes' } }));
    ebForm.findOne.mockReturnValue(form(status));
    dfForm.findOne.mockReturnValue(form(status));
    unspentForm.findOne.mockReturnValue(form(status));
    gtcForm.findOne.mockReturnValue(form(status));
  };

  beforeEach(() => {
    sfcModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    ebForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    ebRow = { findOne: jest.fn().mockReturnValue(q(null)) };
    dfForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    dfRow = { findOne: jest.fn().mockReturnValue(q(null)) };
    unspentForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    unspentRow = { findOne: jest.fn().mockReturnValue(q(null)) };
    gtcForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    formJson = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue({
        data: [{ key: 'isActiveSfc', options: [{ id: 'yes', label: 'Yes' }] }],
      }),
    };
    exemptions = { resolveDiscretionary: jest.fn().mockResolvedValue(null) };
    service = new UlbStateConditionsService(
      sfcModel as never,
      ebForm as never,
      ebRow as never,
      dfForm as never,
      dfRow as never,
      unspentForm as never,
      unspentRow as never,
      gtcForm as never,
      formJson as never,
      exemptions as never,
    );
  });

  it('counts a State form as approved by PMU at 15 (with the SO), 5 (MoHUA review) and 7 (acknowledged) only', () => {
    expect(ULB_VISIBLE_STATE_FORM_STATUSES).toEqual([
      FORM_STATUS.UNDER_REVIEW_BY_SO,
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    ]);
  });

  it('is not visible, and reads no rows, when no State form exists yet', async () => {
    const result = await service.resolve(stateId, ulbId, yearId);

    for (const key of ['sfcStatus', 'electedBody', 'devolution', 'fcUnspent'] as const) {
      expect(result[key]).toMatchObject({ visible: false, value: null, amount: null });
    }
    expect(ebRow.findOne).not.toHaveBeenCalled();
    expect(dfRow.findOne).not.toHaveBeenCalled();
    expect(unspentRow.findOne).not.toHaveBeenCalled();
  });

  it.each([FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.RETURNED_BY_PMU])(
    'withholds every value while the forms are at status %i (not yet approved by PMU)',
    async (status) => {
      allAt(status);

      const result = await service.resolve(stateId, ulbId, yearId);

      expect(Object.values(result).every((c) => !c.visible && c.value === null && c.amount === null)).toBe(true);
      expect(ebRow.findOne).not.toHaveBeenCalled();
      expect(dfRow.findOne).not.toHaveBeenCalled();
      expect(unspentRow.findOne).not.toHaveBeenCalled();
    },
  );

  it.each([
    FORM_STATUS.UNDER_REVIEW_BY_SO,
    FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  ])('is visible once all five forms are at status %i', async (status) => {
    allAt(status);

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(Object.values(result).every((c) => c.visible)).toBe(true);
  });

  it('withholds everything while even one form (here GTC) is still with PMU', async () => {
    allAt(FORM_STATUS.UNDER_REVIEW_BY_SO);
    gtcForm.findOne.mockReturnValue(form(FORM_STATUS.UNDER_REVIEW_BY_PMU));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(Object.values(result).every((c) => !c.visible)).toBe(true);
    expect(ebRow.findOne).not.toHaveBeenCalled();
  });

  it("returns each State-filed value once all are approved, reading only this ULB's row", async () => {
    allAt(5);
    unspentDeclared(true);
    ebRow.findOne.mockReturnValue(q({ electedBodyStatus: 'Elected body in place' }));
    dfRow.findOne.mockReturnValue(q({ totalGrantAllocation: 1234567 }));
    unspentRow.findOne.mockReturnValue(q({ unspentAmount: 250000 }));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.sfcStatus).toMatchObject({ visible: true, value: 'Yes' });
    expect(result.electedBody).toMatchObject({ visible: true, value: 'Elected body in place' });
    expect(result.devolution).toMatchObject({ visible: true, amount: 1234567 });
    // Only whether this ULB has an unspent balance, never the amount.
    expect(result.fcUnspent).toMatchObject({ visible: true, value: 'Yes', amount: null });
    for (const row of [ebRow, dfRow, unspentRow]) {
      expect(row.findOne).toHaveBeenCalledWith(expect.objectContaining({ form: formId, ulbId }));
    }
    expect(ebRow.findOne).toHaveBeenCalledWith(expect.objectContaining({ datasetVersion: 3 }));
  });

  it('lets a whole-State SFC exemption stand in for SFC, shown as "Exempted"', async () => {
    allAt(FORM_STATUS.UNDER_REVIEW_BY_SO);
    sfcModel.findOne.mockReturnValue(q(null));
    exemptions.resolveDiscretionary.mockResolvedValue({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.sfcStatus).toMatchObject({ visible: true, value: 'Exempted' });
    expect(result.electedBody.visible).toBe(true);
  });

  it("is visible but empty when the State's form has no row for this ULB (FC Unspent reads No)", async () => {
    allAt(5);
    unspentDeclared(true);

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.electedBody).toMatchObject({ visible: true, value: null });
    expect(result.devolution).toMatchObject({ visible: true, amount: null });
    expect(result.fcUnspent).toMatchObject({ visible: true, value: 'No', amount: null });
  });

  it("reads FC Unspent as No for an amount of 0 on this ULB's row", async () => {
    allAt(5);
    unspentDeclared(true);
    unspentRow.findOne.mockReturnValue(q({ unspentAmount: 0 }));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.fcUnspent).toMatchObject({ visible: true, value: 'No', amount: null });
  });

  it("reads FC Unspent as No on the State's nil declaration, without looking up any row", async () => {
    allAt(5);
    unspentDeclared(false);

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.fcUnspent).toMatchObject({ visible: true, value: 'No', amount: null });
    expect(unspentRow.findOne).not.toHaveBeenCalled();
  });

  it('falls back to the stored SFC answer when its label config is unavailable', async () => {
    allAt(5);
    formJson.findActiveByDesignYearAndFormId.mockRejectedValue(new Error('no config'));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.sfcStatus).toMatchObject({ visible: true, value: 'yes' });
  });
});
