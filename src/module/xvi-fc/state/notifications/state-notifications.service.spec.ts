import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { StateNotificationsService } from './state-notifications.service';

const q = <T>(result: T) => ({ exec: () => Promise.resolve(result) });

interface ScopeMatch {
  state: Types.ObjectId;
  year: Types.ObjectId;
}
interface ReturnedMatchStage {
  $match: ScopeMatch & { currentFormStatus: { $in: number[] } };
}
interface LookupStage {
  $lookup: {
    from: string;
    let: Record<string, string>;
    pipeline: [{ $match: ScopeMatch }, { $match: { $expr: { $and: unknown[] } } }, ...unknown[]];
  };
}

describe('StateNotificationsService', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const stateUser = { _id: 'u1', role: 'STATE', scope: 'STATE', state: stateId } as unknown as AuthUser;

  let stateConditions: { resolve: jest.Mock };
  let annualAccountModel: { countDocuments: jest.Mock };
  let bankAccountModel: { countDocuments: jest.Mock };
  let durModel: { countDocuments: jest.Mock };
  let claimLetterModel: { aggregate: jest.Mock; collection: { name: string } };
  let service: StateNotificationsService;

  const pipeline = (): unknown[] => (claimLetterModel.aggregate.mock.calls as unknown[][])[0][0] as unknown[];

  beforeEach(() => {
    stateConditions = {
      resolve: jest.fn().mockResolvedValue(
        new Map([
          [
            stateId,
            {
              forms: [
                { key: 'SFC_STATUS', label: 'SFC Status', statusCode: FORM_STATUS.RETURNED_BY_PMU },
                { key: 'GTC', label: 'Grant Transfer Certificate', statusCode: FORM_STATUS.NO_STATUS },
              ],
            },
          ],
        ]),
      ),
    };
    annualAccountModel = { countDocuments: jest.fn().mockReturnValue(q(2)) };
    bankAccountModel = { countDocuments: jest.fn().mockReturnValue(q(1)) };
    durModel = { countDocuments: jest.fn().mockReturnValue(q(4)) };
    claimLetterModel = {
      aggregate: jest.fn().mockReturnValue(q([{ open: 1 }])),
      collection: { name: 'xvifc_claim_letter_batches' },
    };
    service = new StateNotificationsService(
      stateConditions as never,
      annualAccountModel as never,
      bankAccountModel as never,
      durModel as never,
      claimLetterModel as never,
    );
  });

  it("returns the five forms' raw status codes, the summed ULB forms awaiting State review and the open claim-letter returns", async () => {
    const result = await service.getNotifications(stateId, yearId, stateUser);

    expect(result.data).toEqual({
      forms: [
        { key: 'SFC_STATUS', statusCode: FORM_STATUS.RETURNED_BY_PMU },
        { key: 'GTC', statusCode: FORM_STATUS.NO_STATUS },
      ],
      ulbSubmissionsAwaitingReview: 7,
      claimLettersReturned: 1,
    });
    expect(annualAccountModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE }),
    );
  });

  it('reports 0 claim-letter returns when none is open ($count yields no document)', async () => {
    claimLetterModel.aggregate.mockReturnValue(q([]));

    const result = await service.getNotifications(stateId, yearId, stateUser);

    expect(result.data.claimLettersReturned).toBe(0);
  });

  it("counts only this state and year's letters returned by the SO (16) or MoHUA (6)", async () => {
    await service.getNotifications(stateId, yearId, stateUser);

    const match = (pipeline()[0] as ReturnedMatchStage).$match;
    expect(match.state.toString()).toBe(stateId);
    expect(match.year.toString()).toBe(yearId);
    expect(match.currentFormStatus.$in).toEqual([FORM_STATUS.RETURNED_BY_SO, FORM_STATUS.RETURNED_BY_MOHUA]);
  });

  it('clears a return only once a letter in the same slot is submitted after it, not merely drafted', async () => {
    await service.getNotifications(stateId, yearId, stateUser);

    const lookup = (pipeline()[1] as LookupStage).$lookup;
    expect(lookup.from).toBe('xvifc_claim_letter_batches');
    expect(lookup.let).toEqual({ installment: '$installment', batchNumber: '$batchNumber', returnedAt: '$resolvedAt' });

    const [scope, slot] = lookup.pipeline;
    expect(scope.$match.state.toString()).toBe(stateId);
    expect(scope.$match.year.toString()).toBe(yearId);
    expect(slot.$match.$expr.$and).toEqual([
      { $eq: ['$installment', '$$installment'] },
      { $eq: ['$batchNumber', '$$batchNumber'] },
      { $gt: ['$submittedAt', '$$returnedAt'] },
    ]);
    // Only returns with no such later submission are counted.
    expect(pipeline()[2]).toEqual({ $match: { resubmitted: { $size: 0 } } });
    expect(pipeline()[3]).toEqual({ $count: 'open' });
  });

  it("refuses another state's data and queries nothing", async () => {
    await expect(service.getNotifications(new Types.ObjectId().toString(), yearId, stateUser)).rejects.toThrow(
      ForbiddenException,
    );
    expect(stateConditions.resolve).not.toHaveBeenCalled();
    expect(claimLetterModel.aggregate).not.toHaveBeenCalled();
  });
});
