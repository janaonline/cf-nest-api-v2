import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { StateNotificationsService } from './state-notifications.service';

const q = <T>(result: T) => ({ exec: () => Promise.resolve(result) });

describe('StateNotificationsService', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const stateUser = { _id: 'u1', role: 'STATE', scope: 'STATE', state: stateId } as unknown as AuthUser;

  let stateConditions: { resolve: jest.Mock };
  let annualAccountModel: { countDocuments: jest.Mock };
  let bankAccountModel: { countDocuments: jest.Mock };
  let durModel: { countDocuments: jest.Mock };
  let service: StateNotificationsService;

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
    service = new StateNotificationsService(
      stateConditions as never,
      annualAccountModel as never,
      bankAccountModel as never,
      durModel as never,
    );
  });

  it("returns the five forms' raw status codes and the summed ULB forms awaiting State review", async () => {
    const result = await service.getNotifications(stateId, yearId, stateUser);

    expect(result.data).toEqual({
      forms: [
        { key: 'SFC_STATUS', statusCode: FORM_STATUS.RETURNED_BY_PMU },
        { key: 'GTC', statusCode: FORM_STATUS.NO_STATUS },
      ],
      ulbSubmissionsAwaitingReview: 7,
    });
    expect(annualAccountModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE }),
    );
  });

  it("refuses another state's data and queries nothing", async () => {
    await expect(service.getNotifications(new Types.ObjectId().toString(), yearId, stateUser)).rejects.toThrow(
      ForbiddenException,
    );
    expect(stateConditions.resolve).not.toHaveBeenCalled();
  });
});
