import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { FormJsonConfigService } from './form-json-config.service';
import { FormJsonConfig } from '../../schemas/form-json-config.schema';
import { NamespacedCacheService } from 'src/core/services/redis/namespaced-cache.service';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['lean', 'find']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('FormJsonConfigService', () => {
  let service: FormJsonConfigService;
  let model: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    exists: jest.Mock;
  };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock; buildKey: jest.Mock };

  beforeEach(async () => {
    model = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn() };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      buildKey: jest.fn((...parts: unknown[]) => parts.join(':')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormJsonConfigService,
        { provide: getModelToken(FormJsonConfig.name), useValue: model },
        { provide: NamespacedCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<FormJsonConfigService>(FormJsonConfigService);
  });

  describe('findByFormId', () => {
    it('returns the cached value without querying Mongo on a cache hit', async () => {
      cache.get.mockResolvedValueOnce({ formId: 32, submissionScope: 'PER_YEAR' });

      const result = await service.findByFormId(32);

      expect(result).toEqual({ formId: 32, submissionScope: 'PER_YEAR' });
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('queries Mongo and populates the cache on a miss', async () => {
      model.findOne.mockReturnValue(q({ formId: 32, submissionScope: 'PER_YEAR' }));

      const result = await service.findByFormId(32);

      expect(model.findOne).toHaveBeenCalledWith({ formId: 32, isActive: true });
      expect(cache.set).toHaveBeenCalled();
      expect(result).toEqual({ formId: 32, submissionScope: 'PER_YEAR' });
    });

    it('returns null (not an error) when no config exists for a formId', async () => {
      model.findOne.mockReturnValue(q(null));

      await expect(service.findByFormId(999)).resolves.toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('findAllExemptable', () => {
    it('filters to isApplicableForExemption + isActive only', async () => {
      model.find.mockReturnValue(q([]));

      await service.findAllExemptable();

      expect(model.find).toHaveBeenCalledWith({ isApplicableForExemption: true, isActive: true });
    });

    it('enriches each row with a computed display label, falling back to "Form #<id>" for an unregistered formId', async () => {
      model.find.mockReturnValue(q([{ formId: 32, isApplicableForExemption: true }, { formId: 999, isApplicableForExemption: true }]));

      const result = await service.findAllExemptable();

      expect(result).toEqual([
        { formId: 32, isApplicableForExemption: true, label: 'SLB' },
        { formId: 999, isApplicableForExemption: true, label: 'Form #999' },
      ]);
    });
  });

  describe('create', () => {
    it('defaults submissionScope to PER_YEAR and exemptionGraceYears to 1', async () => {
      model.create.mockResolvedValue({
        toObject: () => ({ formId: 32, isActive: true, submissionScope: 'PER_YEAR', exemptionGraceYears: 1 }),
      });

      const result = await service.create({ formId: 32 });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionScope: 'PER_YEAR',
          exemptionGraceYears: 1,
          isApplicableForExemption: false,
        }),
      );
      expect(result.formId).toBe(32);
      expect(cache.set).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the document does not exist', async () => {
      model.findByIdAndUpdate.mockReturnValue(q(null));

      await expect(service.update('missing-id', {})).rejects.toThrow(NotFoundException);
    });

    it('invalidates the cache entry for the updated formId', async () => {
      model.findByIdAndUpdate.mockReturnValue(q({ formId: 33, submissionScope: 'ONCE_EVER' }));

      await service.update('id', { submissionScope: 'ONCE_EVER' });

      expect(cache.del).toHaveBeenCalled();
    });
  });
});
