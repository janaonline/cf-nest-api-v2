import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { FormJsonService } from './form-json.service';
import { FormJson } from '../../schemas/form-json.schema';
import { RedisService } from 'src/core/services/redis/redis.service';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['lean', 'sort']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('FormJsonService', () => {
  let service: FormJsonService;
  let model: {
    findOne: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    create: jest.Mock;
  };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock; delByPattern: jest.Mock };
  let configService: { get: jest.Mock };

  const designYearId = new Types.ObjectId().toString();

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };
    redis = { get: jest.fn(), set: jest.fn(), del: jest.fn(), delByPattern: jest.fn().mockResolvedValue(1) };
    configService = { get: jest.fn().mockReturnValue('test') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormJsonService,
        { provide: getModelToken(FormJson.name), useValue: model },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<FormJsonService>(FormJsonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findActiveByDesignYearAndFormId', () => {
    it('returns the cached value without hitting the DB when present in Redis', async () => {
      const cached = { _id: 'abc', formId: 25, isActive: true };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.findActiveByDesignYearAndFormId(designYearId, 25);

      expect(result).toEqual(cached);
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('queries the DB, caches, and returns the result on a cache miss', async () => {
      redis.get.mockResolvedValue(null);
      const doc = { _id: 'abc', formId: 25, isActive: true, design_year: designYearId };
      model.findOne.mockReturnValue(q(doc));

      const result = await service.findActiveByDesignYearAndFormId(designYearId, 25);

      expect(result).toEqual(doc);
      expect(redis.set).toHaveBeenCalledWith(`formJson:test:${designYearId}:25`, JSON.stringify(doc));
    });

    it('throws NotFoundException when no active document exists for the year/formId', async () => {
      redis.get.mockResolvedValue(null);
      model.findOne.mockReturnValue(q(null));

      await expect(service.findActiveByDesignYearAndFormId(designYearId, 25)).rejects.toThrow(NotFoundException);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('queries with no filter when the query is empty', async () => {
      model.find.mockReturnValue(q([]));

      await service.findAll({});

      expect(model.find).toHaveBeenCalledWith({});
    });

    it('builds a filter from type, design_year, and isActive when provided', async () => {
      model.find.mockReturnValue(q([]));

      await service.findAll({ type: 'xvifcSfc', design_year: designYearId, isActive: true });

      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter.type).toBe('xvifcSfc');
      expect(filter.isActive).toBe(true);
      expect((filter.design_year as Types.ObjectId).toString()).toBe(designYearId);
    });
  });

  describe('findById', () => {
    it('returns the document when found', async () => {
      const doc = { _id: 'abc' };
      model.findById.mockReturnValue(q(doc));

      const result = await service.findById('abc');
      expect(result).toEqual(doc);
    });

    it('throws NotFoundException when absent', async () => {
      model.findById.mockReturnValue(q(null));
      await expect(service.findById('abc')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByType', () => {
    it('returns the active document matching the type', async () => {
      const doc = { _id: 'abc', type: 'xvifcSfc' };
      model.findOne.mockReturnValue(q(doc));

      const result = await service.findByType('xvifcSfc');
      expect(result).toEqual(doc);
      expect(model.findOne).toHaveBeenCalledWith({ type: 'xvifcSfc', isActive: true });
    });

    it('throws NotFoundException when absent', async () => {
      model.findOne.mockReturnValue(q(null));
      await expect(service.findByType('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a document and populates the cache when formId is set and isActive is true', async () => {
      const created = {
        toObject: () => ({ _id: 'new', design_year: designYearId, formId: 25, isActive: true }),
      };
      model.create.mockResolvedValue(created);

      const result = await service.create({ design_year: designYearId, formId: 25, type: 'x' } as any);

      expect(result).toEqual({ _id: 'new', design_year: designYearId, formId: 25, isActive: true });
      expect(redis.set).toHaveBeenCalledWith(
        `formJson:test:${designYearId}:25`,
        JSON.stringify({ _id: 'new', design_year: designYearId, formId: 25, isActive: true }),
      );
    });

    it('does not populate the cache when isActive is false', async () => {
      const created = {
        toObject: () => ({ _id: 'new', design_year: designYearId, formId: 25, isActive: false }),
      };
      model.create.mockResolvedValue(created);

      await service.create({ design_year: designYearId, formId: 25, isActive: false } as any);

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('does not populate the cache when formId is absent', async () => {
      const created = {
        toObject: () => ({ _id: 'new', design_year: designYearId, isActive: true }),
      };
      model.create.mockResolvedValue(created);

      await service.create({ design_year: designYearId } as any);

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('defaults isActive to true and data to [] when omitted', async () => {
      model.create.mockResolvedValue({ toObject: () => ({ _id: 'new' }) });

      await service.create({ design_year: designYearId } as any);

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: true, data: [] }));
    });

    it('passes claimEligibility through to the model on create', async () => {
      model.create.mockResolvedValue({ toObject: () => ({ _id: 'new' }) });
      const claimEligibility = { enabled: true, ruleVersion: 1 };

      await service.create({ design_year: designYearId, claimEligibility } as any);

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ claimEligibility }));
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the update target does not exist', async () => {
      model.findById.mockReturnValue(q(null));
      model.findByIdAndUpdate.mockReturnValue(q(null));

      await expect(service.update('missing', { type: 'x' } as any)).rejects.toThrow(NotFoundException);
    });

    it('applies only the provided fields as a sparse $set patch', async () => {
      model.findById.mockReturnValue(q({ _id: 'x', formId: 1, design_year: designYearId }));
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', formId: 1, design_year: designYearId, type: 'updated' }));

      await service.update('x', { type: 'updated' } as any);

      const [, updateArg] = model.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set).toEqual({ type: 'updated' });
    });

    it('deletes both old and new cache keys when the formId changes', async () => {
      model.findById.mockReturnValue(q({ _id: 'x', formId: 1, design_year: designYearId }));
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', formId: 2, design_year: designYearId }));

      await service.update('x', { formId: 2 } as any);

      expect(redis.del).toHaveBeenCalledWith(`formJson:test:${designYearId}:1`);
      expect(redis.del).toHaveBeenCalledWith(`formJson:test:${designYearId}:2`);
    });

    it('deletes the cache key only once when the formId is unchanged', async () => {
      model.findById.mockReturnValue(q({ _id: 'x', formId: 1, design_year: designYearId }));
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', formId: 1, design_year: designYearId, type: 'y' }));

      await service.update('x', { type: 'y' } as any);

      expect(redis.del).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith(`formJson:test:${designYearId}:1`);
    });

    it('does not attempt cache deletion when neither the existing nor updated doc has a formId', async () => {
      model.findById.mockReturnValue(q({ _id: 'x', design_year: designYearId }));
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', design_year: designYearId, type: 'y' }));

      await service.update('x', { type: 'y' } as any);

      expect(redis.del).not.toHaveBeenCalled();
    });

    it('includes claimEligibility in the sparse patch when provided', async () => {
      model.findById.mockReturnValue(q({ _id: 'x', design_year: designYearId }));
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', design_year: designYearId }));
      const claimEligibility = { enabled: false, ruleVersion: 2 };

      await service.update('x', { claimEligibility } as any);

      const [, updateArg] = model.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set).toEqual({ claimEligibility });
    });
  });

  describe('findEnabledClaimEligibilitySources', () => {
    it('queries for isActive + claimEligibility.enabled scoped to the design year', async () => {
      model.find.mockReturnValue(q([]));

      await service.findEnabledClaimEligibilitySources(designYearId);

      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>];
      expect((filter['design_year'] as Types.ObjectId).toString()).toBe(designYearId);
      expect(filter['isActive']).toBe(true);
      expect(filter['claimEligibility.enabled']).toBe(true);
    });

    it('returns every matching formJson document', async () => {
      const docs = [{ _id: 'a', formId: 24 }];
      model.find.mockReturnValue(q(docs));

      const result = await service.findEnabledClaimEligibilitySources(designYearId);

      expect(result).toEqual(docs);
    });
  });

  describe('clearCache', () => {
    it('deletes the cache entry for the given designYearId/formId', async () => {
      await service.clearCache(designYearId, 25);
      expect(redis.delByPattern).toHaveBeenCalledWith(`formJson:test:${designYearId}:25`);
    });

    it('matches every formId for a year when formId is omitted', async () => {
      await service.clearCache(designYearId);
      expect(redis.delByPattern).toHaveBeenCalledWith(`formJson:test:${designYearId}:*`);
    });

    it('matches every year for a formId when designYearId is omitted', async () => {
      await service.clearCache(undefined, 25);
      expect(redis.delByPattern).toHaveBeenCalledWith(`formJson:test:*:25`);
    });

    it('matches everything when both are omitted', async () => {
      await service.clearCache();
      expect(redis.delByPattern).toHaveBeenCalledWith(`formJson:test:*:*`);
    });

    it('returns the number of keys actually deleted', async () => {
      redis.delByPattern.mockResolvedValue(3);
      await expect(service.clearCache(designYearId, 25)).resolves.toBe(3);
    });
  });

  describe('remove', () => {
    it('soft-deletes the document via $set isActive:false and deletes its cache entry', async () => {
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', formId: 1, design_year: designYearId }));

      await service.remove('x');

      const [, updateArg] = model.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set).toEqual({ isActive: false });
      expect(redis.del).toHaveBeenCalledWith(`formJson:test:${designYearId}:1`);
    });

    it('throws NotFoundException when the document does not exist', async () => {
      model.findByIdAndUpdate.mockReturnValue(q(null));
      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });

    it('skips cache deletion when the document has no formId', async () => {
      model.findByIdAndUpdate.mockReturnValue(q({ _id: 'x', design_year: designYearId }));
      await service.remove('x');
      expect(redis.del).not.toHaveBeenCalled();
    });
  });
});
