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
  let formJson: { findActiveByDesignYearAndFormId: jest.Mock };
  let service: UlbStateConditionsService;

  const form = (currentFormStatus: number) => q({ _id: formId, currentFormStatus, activeDatasetVersion: 3 });

  beforeEach(() => {
    sfcModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    ebForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    ebRow = { findOne: jest.fn().mockReturnValue(q(null)) };
    dfForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    dfRow = { findOne: jest.fn().mockReturnValue(q(null)) };
    unspentForm = { findOne: jest.fn().mockReturnValue(q(null)) };
    unspentRow = { findOne: jest.fn().mockReturnValue(q(null)) };
    formJson = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue({
        data: [{ key: 'isActiveSfc', options: [{ id: 'yes', label: 'Yes' }] }],
      }),
    };
    service = new UlbStateConditionsService(
      sfcModel as never,
      ebForm as never,
      ebRow as never,
      dfForm as never,
      dfRow as never,
      unspentForm as never,
      unspentRow as never,
      formJson as never,
    );
  });

  it('shows data from status 5 (Under Review by MoHUA) only', () => {
    expect(ULB_VISIBLE_STATE_FORM_STATUSES).toEqual([FORM_STATUS.UNDER_REVIEW_BY_MOHUA]);
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
    'withholds every value while the form is at status %i',
    async (status) => {
      sfcModel.findOne.mockReturnValue(q({ currentFormStatus: status, data: { isActiveSfc: 'yes' } }));
      ebForm.findOne.mockReturnValue(form(status));
      dfForm.findOne.mockReturnValue(form(status));
      unspentForm.findOne.mockReturnValue(form(status));

      const result = await service.resolve(stateId, ulbId, yearId);

      expect(Object.values(result).every((c) => !c.visible && c.value === null && c.amount === null)).toBe(true);
      expect(ebRow.findOne).not.toHaveBeenCalled();
      expect(dfRow.findOne).not.toHaveBeenCalled();
      expect(unspentRow.findOne).not.toHaveBeenCalled();
    },
  );

  it("returns each State-filed value at status 5, reading only this ULB's row", async () => {
    sfcModel.findOne.mockReturnValue(q({ currentFormStatus: 5, data: { isActiveSfc: 'yes' } }));
    ebForm.findOne.mockReturnValue(form(5));
    ebRow.findOne.mockReturnValue(q({ electedBodyStatus: 'Elected body in place' }));
    dfForm.findOne.mockReturnValue(form(5));
    dfRow.findOne.mockReturnValue(q({ totalGrantAllocation: 1234567 }));
    unspentForm.findOne.mockReturnValue(form(5));
    unspentRow.findOne.mockReturnValue(q({ unspentAmount: 250000 }));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.sfcStatus).toMatchObject({ visible: true, value: 'Yes' });
    expect(result.electedBody).toMatchObject({ visible: true, value: 'Elected body in place' });
    expect(result.devolution).toMatchObject({ visible: true, amount: 1234567 });
    expect(result.fcUnspent).toMatchObject({ visible: true, amount: 250000 });
    for (const row of [ebRow, dfRow, unspentRow]) {
      expect(row.findOne).toHaveBeenCalledWith(expect.objectContaining({ form: formId, ulbId }));
    }
    expect(ebRow.findOne).toHaveBeenCalledWith(expect.objectContaining({ datasetVersion: 3 }));
  });

  it("is visible but empty when the State's form has no row for this ULB", async () => {
    ebForm.findOne.mockReturnValue(form(5));
    dfForm.findOne.mockReturnValue(form(5));
    unspentForm.findOne.mockReturnValue(form(5));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.electedBody).toMatchObject({ visible: true, value: null });
    expect(result.devolution).toMatchObject({ visible: true, amount: null });
    expect(result.fcUnspent).toMatchObject({ visible: true, amount: null });
  });

  it('falls back to the stored SFC answer when its label config is unavailable', async () => {
    sfcModel.findOne.mockReturnValue(q({ currentFormStatus: 5, data: { isActiveSfc: 'yes' } }));
    formJson.findActiveByDesignYearAndFormId.mockRejectedValue(new Error('no config'));

    const result = await service.resolve(stateId, ulbId, yearId);

    expect(result.sfcStatus).toMatchObject({ visible: true, value: 'yes' });
  });
});
