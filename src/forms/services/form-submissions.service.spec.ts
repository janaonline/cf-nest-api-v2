import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FormSubmissionsService } from './form-submissions.service';
import { FormSubmission } from '../schemas/form-submission.schema';
import { FormWorkflowPermissions } from '../../common/services/form-workflow.permissions';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../../module/auth/enum/role.enum';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('FormSubmissionsService', () => {
  let service: FormSubmissionsService;
  let model: { findById: jest.Mock; find: jest.Mock };
  let permissions: { assertCanViewFormSubmission: jest.Mock };

  const ulbId = new Types.ObjectId();
  const ulbUser: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ULB, ulb: ulbId.toString() };

  beforeEach(async () => {
    model = { findById: jest.fn(), find: jest.fn() };
    permissions = { assertCanViewFormSubmission: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormSubmissionsService,
        { provide: getModelToken(FormSubmission.name), useValue: model },
        { provide: FormWorkflowPermissions, useValue: permissions },
      ],
    }).compile();

    service = module.get<FormSubmissionsService>(FormSubmissionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFormSubmissionById', () => {
    it('returns the submission after an access check when found', async () => {
      const record = { _id: new Types.ObjectId(), ulbId };
      model.findById.mockReturnValue(q(record));

      const result = await service.getFormSubmissionById('sub1', ulbUser);

      expect(result).toEqual(record);
      expect(permissions.assertCanViewFormSubmission).toHaveBeenCalledWith(ulbUser, record);
    });

    it('throws NotFoundException when the submission does not exist', async () => {
      model.findById.mockReturnValue(q(null));

      await expect(service.getFormSubmissionById('missing', ulbUser)).rejects.toThrow(NotFoundException);
      expect(permissions.assertCanViewFormSubmission).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException raised by the permissions check', async () => {
      const record = { _id: new Types.ObjectId(), ulbId: new Types.ObjectId() };
      model.findById.mockReturnValue(q(record));
      permissions.assertCanViewFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.getFormSubmissionById('sub1', ulbUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getFormSubmissionsByULB', () => {
    it('queries by ulbId and financialYear, sorted newest-first', async () => {
      const records = [{ _id: new Types.ObjectId() }];
      const chain = q(records);
      model.find.mockReturnValue(chain);

      const result = await service.getFormSubmissionsByULB(ulbId.toString(), '2024-25');

      expect(result).toEqual(records);
      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect((filter.ulbId as Types.ObjectId).toString()).toBe(ulbId.toString());
      expect(filter.financialYear).toBe('2024-25');
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });

  describe('getFormSubmissionsByState', () => {
    it('queries by stateId and financialYear, sorted newest-first', async () => {
      const stateId = new Types.ObjectId();
      const records = [{ _id: new Types.ObjectId() }];
      const chain = q(records);
      model.find.mockReturnValue(chain);

      const result = await service.getFormSubmissionsByState(stateId.toString(), '2024-25');

      expect(result).toEqual(records);
      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect((filter.stateId as Types.ObjectId).toString()).toBe(stateId.toString());
      expect(filter.financialYear).toBe('2024-25');
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });
});
