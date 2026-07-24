import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FormSubmissionSyncService, FindOrCreateFormSubmissionInput } from './form-submission-sync.service';
import { FormSubmission } from '../schemas/form-submission.schema';
import { FORM_STATUS } from '../../common/constants/form-status.constants';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['session', 'sort', 'skip', 'limit', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('FormSubmissionSyncService', () => {
  let service: FormSubmissionSyncService;
  let model: { findOne: jest.Mock; create: jest.Mock; find: jest.Mock; countDocuments: jest.Mock };

  const ulbId = new Types.ObjectId().toString();
  const stateId = new Types.ObjectId().toString();
  const designYear = new Types.ObjectId().toString();
  const formDataId = new Types.ObjectId().toString();

  const baseInput: FindOrCreateFormSubmissionInput = {
    formType: 'ANNUAL_ACCOUNTS',
    formName: 'Annual Accounts',
    formDataCollection: 'annualaccounts',
    formDataId,
    designYear,
    ownerType: 'ULB',
    ulbId,
  };

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FormSubmissionSyncService, { provide: getModelToken(FormSubmission.name), useValue: model }],
    }).compile();

    service = module.get<FormSubmissionSyncService>(FormSubmissionSyncService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOrCreateFormSubmissionForDataRecord', () => {
    it('throws BadRequestException for an invalid formDataId', async () => {
      await expect(
        service.findOrCreateFormSubmissionForDataRecord({ ...baseInput, formDataId: 'not-an-id' }),
      ).rejects.toThrow(BadRequestException);
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an invalid designYear', async () => {
      await expect(
        service.findOrCreateFormSubmissionForDataRecord({ ...baseInput, designYear: 'not-an-id' }),
      ).rejects.toThrow(BadRequestException);
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('returns the existing record without creating a new one', async () => {
      const existing = { _id: new Types.ObjectId(), formType: baseInput.formType };
      model.findOne.mockReturnValue(q(existing));

      const result = await service.findOrCreateFormSubmissionForDataRecord(baseInput);

      expect(result).toEqual(existing);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('creates a new NOT_STARTED record scoped to the ULB when none exists', async () => {
      model.findOne.mockReturnValue(q(null));
      const created = { _id: new Types.ObjectId() };
      model.create.mockResolvedValue([created]);

      const result = await service.findOrCreateFormSubmissionForDataRecord(baseInput);

      expect(result).toEqual(created);
      const [[doc]] = model.create.mock.calls[0] as [[Record<string, unknown>]];
      expect(doc.currentFormStatus).toBe(FORM_STATUS.NOT_STARTED);
      expect(doc.currentOwnerOrgType).toBe('ULB');
      expect((doc.ulbId as Types.ObjectId).toString()).toBe(ulbId);
      expect((doc.currentOwnerOrgId as Types.ObjectId).toString()).toBe(ulbId);
      expect(doc.stateId).toBeUndefined();
    });

    it('scopes the owner to stateId when ownerType is STATE', async () => {
      model.findOne.mockReturnValue(q(null));
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.findOrCreateFormSubmissionForDataRecord({
        ...baseInput,
        ownerType: 'STATE',
        ulbId: undefined,
        stateId,
      });

      const [[doc]] = model.create.mock.calls[0] as [[Record<string, unknown>]];
      expect(doc.currentOwnerOrgType).toBe('STATE');
      expect((doc.currentOwnerOrgId as Types.ObjectId).toString()).toBe(stateId);
      expect(doc.ulbId).toBeUndefined();
    });

    it('leaves ulbId/stateId/formJsonId undefined when the provided ids are not valid ObjectIds', async () => {
      model.findOne.mockReturnValue(q(null));
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.findOrCreateFormSubmissionForDataRecord({
        ...baseInput,
        ulbId: 'not-an-id',
        formJsonId: 'also-not-an-id',
      });

      const [[doc]] = model.create.mock.calls[0] as [[Record<string, unknown>]];
      expect(doc.ulbId).toBeUndefined();
      expect(doc.formJsonId).toBeUndefined();
    });

    it('passes the session through to findOne and create when provided', async () => {
      const session: any = { id: 'sess1' };
      model.findOne.mockReturnValue(q(null));
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.findOrCreateFormSubmissionForDataRecord({ ...baseInput, session });

      expect(model.findOne.mock.results[0].value.session).toHaveBeenCalledWith(session);
      const [, createOptions] = model.create.mock.calls[0] as [unknown, { session?: unknown }];
      expect(createOptions.session).toBe(session);
    });
  });

  describe('getFormSubmissionsByOwner', () => {
    it('throws BadRequestException for an invalid ownerId', async () => {
      await expect(service.getFormSubmissionsByOwner('ULB', 'not-an-id', designYear)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for an invalid designYear', async () => {
      await expect(service.getFormSubmissionsByOwner('ULB', ulbId, 'not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('filters by ulbId for ULB owner type', async () => {
      model.find.mockReturnValue(q([]));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getFormSubmissionsByOwner('ULB', ulbId, designYear);

      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect((filter.ulbId as Types.ObjectId).toString()).toBe(ulbId);
      expect(filter.stateId).toBeUndefined();
    });

    it('filters by stateId for STATE owner type', async () => {
      model.find.mockReturnValue(q([]));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getFormSubmissionsByOwner('STATE', stateId, designYear);

      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect((filter.stateId as Types.ObjectId).toString()).toBe(stateId);
      expect(filter.ulbId).toBeUndefined();
    });

    it('filters by neither ulbId nor stateId for MOHUA owner type', async () => {
      model.find.mockReturnValue(q([]));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      const mohuaOrgId = new Types.ObjectId().toString();

      await service.getFormSubmissionsByOwner('MOHUA', mohuaOrgId, designYear);

      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter.ulbId).toBeUndefined();
      expect(filter.stateId).toBeUndefined();
    });

    it('applies skip/limit for pagination and returns data + total', async () => {
      const data = [{ _id: new Types.ObjectId() }];
      const findChain = q(data);
      model.find.mockReturnValue(findChain);
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(42) });

      const result = await service.getFormSubmissionsByOwner('ULB', ulbId, designYear, 3, 10);

      expect(findChain.skip).toHaveBeenCalledWith(20); // (page 3 - 1) * limit 10
      expect(findChain.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual({ data, total: 42 });
    });

    it('defaults to page 1, limit 10 when not provided', async () => {
      const findChain = q([]);
      model.find.mockReturnValue(findChain);
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getFormSubmissionsByOwner('ULB', ulbId, designYear);

      expect(findChain.skip).toHaveBeenCalledWith(0);
      expect(findChain.limit).toHaveBeenCalledWith(10);
    });
  });
});
