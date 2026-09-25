import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { UlbEligibilityService } from './ulb-eligibility.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { UlbType } from 'src/schemas/ulb-type.schema';
import { RedisService } from 'src/core/services/redis/redis.service';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('UlbEligibilityService', () => {
  let service: UlbEligibilityService;
  let ulbTypeModel: { find: jest.Mock };
  let ulbModel: { findById: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  const cantonmentTypeId = new Types.ObjectId();
  const municipalityTypeId = new Types.ObjectId();
  const cacheKey = (grantCycle: string) => `ulb-eligibility:ineligible-ulb-type-ids:${grantCycle}`;

  beforeEach(async () => {
    ulbTypeModel = { find: jest.fn().mockReturnValue(q([{ _id: cantonmentTypeId }])) };
    ulbModel = { findById: jest.fn() };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UlbEligibilityService,
        { provide: getModelToken(UlbType.name), useValue: ulbTypeModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(UlbEligibilityService);
  });

  describe('getIneligibleUlbTypeIds', () => {
    it('queries Mongo and caches the result on a cache miss', async () => {
      const ids = await service.getIneligibleUlbTypeIds('XVIFC');

      expect(ulbTypeModel.find).toHaveBeenCalledWith({ ineligibleForGrantCycles: 'XVIFC' });
      expect(ids.map(String)).toEqual([cantonmentTypeId.toString()]);
      expect(redis.set).toHaveBeenCalledWith(cacheKey('XVIFC'), [cantonmentTypeId.toString()]);
    });

    it('serves from Redis on a cache hit, skipping Mongo entirely', async () => {
      redis.get.mockResolvedValue(JSON.stringify([cantonmentTypeId.toString()]));

      const ids = await service.getIneligibleUlbTypeIds('XVIFC');

      expect(ulbTypeModel.find).not.toHaveBeenCalled();
      expect(ids.map(String)).toEqual([cantonmentTypeId.toString()]);
    });

    it('never passes a ttl to redisService.set — the cache entry does not expire on its own', async () => {
      await service.getIneligibleUlbTypeIds('XVIFC');

      const call = redis.set.mock.calls[0] as unknown[];
      expect(call).toHaveLength(2); // no third (ttl) argument
    });
  });

  describe('invalidate', () => {
    it('deletes exactly the cache key for the given grant cycle', async () => {
      await service.invalidate('XVIFC');

      expect(redis.del).toHaveBeenCalledWith(cacheKey('XVIFC'));
    });

    it('forces the next getIneligibleUlbTypeIds call to re-query Mongo instead of serving a stale value', async () => {
      redis.get.mockResolvedValueOnce(JSON.stringify([cantonmentTypeId.toString()]));
      await service.getIneligibleUlbTypeIds('XVIFC');
      expect(ulbTypeModel.find).not.toHaveBeenCalled();

      await service.invalidate('XVIFC');
      redis.get.mockResolvedValueOnce(null); // simulates the key being gone after del()

      await service.getIneligibleUlbTypeIds('XVIFC');
      expect(ulbTypeModel.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('isUlbEligibleForGrantCycle', () => {
    it('returns false for an inactive ULB without even checking the ineligible-type set', async () => {
      const eligible = await service.isUlbEligibleForGrantCycle(
        { isActive: false, ulbType: municipalityTypeId } as Pick<Ulb, 'isActive' | 'ulbType'>,
        'XVIFC',
      );

      expect(eligible).toBe(false);
      expect(ulbTypeModel.find).not.toHaveBeenCalled();
    });

    it('returns false when the ULB type is in the ineligible set', async () => {
      const eligible = await service.isUlbEligibleForGrantCycle(
        { isActive: true, ulbType: cantonmentTypeId } as Pick<Ulb, 'isActive' | 'ulbType'>,
        'XVIFC',
      );

      expect(eligible).toBe(false);
    });

    it('returns true for an active ULB whose type is not in the ineligible set', async () => {
      const eligible = await service.isUlbEligibleForGrantCycle(
        { isActive: true, ulbType: municipalityTypeId } as Pick<Ulb, 'isActive' | 'ulbType'>,
        'XVIFC',
      );

      expect(eligible).toBe(true);
    });
  });

  describe('assertUlbEligibleForGrantCycle', () => {
    it('throws ForbiddenException when the ULB is ineligible', async () => {
      ulbModel.findById.mockReturnValue(q({ isActive: true, ulbType: cantonmentTypeId }));

      await expect(service.assertUlbEligibleForGrantCycle(new Types.ObjectId(), 'XVIFC')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the ULB does not exist', async () => {
      ulbModel.findById.mockReturnValue(q(null));

      await expect(service.assertUlbEligibleForGrantCycle(new Types.ObjectId(), 'XVIFC')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('resolves without throwing for an eligible ULB', async () => {
      ulbModel.findById.mockReturnValue(q({ isActive: true, ulbType: municipalityTypeId }));

      await expect(service.assertUlbEligibleForGrantCycle(new Types.ObjectId(), 'XVIFC')).resolves.toBeUndefined();
    });
  });

  describe('getEligibleUlbFilter', () => {
    it('includes an $nin clause when at least one type is ineligible', async () => {
      const stateId = new Types.ObjectId();
      const filter = (await service.getEligibleUlbFilter(stateId, 'XVIFC')) as Record<string, unknown>;

      expect((filter['state'] as Types.ObjectId).toString()).toBe(stateId.toString());
      expect(filter['isActive']).toBe(true);
      const nin = (filter['ulbType'] as { $nin: Types.ObjectId[] })['$nin'];
      expect(nin.map(String)).toEqual([cantonmentTypeId.toString()]);
    });

    it('omits the ulbType clause entirely when no type is ineligible for the cycle', async () => {
      ulbTypeModel.find.mockReturnValue(q([]));
      const stateId = new Types.ObjectId();

      const filter = (await service.getEligibleUlbFilter(stateId, 'XVIFC')) as Record<string, unknown>;

      expect(filter['ulbType']).toBeUndefined();
      expect(filter['isActive']).toBe(true);
    });
  });
});
