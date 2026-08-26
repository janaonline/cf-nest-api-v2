import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { UlbTypesService } from './ulb-types.service';
import { UlbType } from 'src/schemas/ulb-type.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';

/** Chainable Mongoose Query-like mock resolving to `value`. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

interface MockUlbTypeDoc {
  name: string;
  isActive: boolean;
  ineligibleForGrantCycles?: string[];
  save: jest.Mock;
}

/** A mutable, save()-able document-like mock — mirrors the fields `update()`/`remove()` read/write. */
function doc(initial: { name: string; isActive: boolean; ineligibleForGrantCycles?: string[] }): MockUlbTypeDoc {
  const d = { ...initial } as MockUlbTypeDoc;
  d.save = jest.fn().mockImplementation(() => Promise.resolve(d));
  return d;
}

describe('UlbTypesService', () => {
  let service: UlbTypesService;
  let ulbTypeModel: Record<string, jest.Mock>;
  let ulbEligibilityService: { invalidate: jest.Mock };

  beforeEach(async () => {
    ulbTypeModel = {
      findOne: jest.fn().mockReturnValue(q(null)),
      findById: jest.fn(),
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    };
    ulbEligibilityService = { invalidate: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UlbTypesService,
        { provide: getModelToken(UlbType.name), useValue: ulbTypeModel },
        { provide: UlbEligibilityService, useValue: ulbEligibilityService },
      ],
    }).compile();

    service = module.get(UlbTypesService);
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a ULB type and invalidates every cycle it declares ineligible', async () => {
      const created = doc({ name: 'Cantonment Board', isActive: true, ineligibleForGrantCycles: ['XVIFC'] });
      ulbTypeModel.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Cantonment Board', ineligibleForGrantCycles: ['XVIFC'] });

      expect(ulbTypeModel.findOne).toHaveBeenCalledWith({ name: 'Cantonment Board', isActive: true });
      expect(result).toBe(created);
      expect(ulbEligibilityService.invalidate).toHaveBeenCalledWith('XVIFC');
      expect(ulbEligibilityService.invalidate).toHaveBeenCalledTimes(1);
    });

    it('does not call invalidate when the new type has no ineligibleForGrantCycles', async () => {
      ulbTypeModel.create.mockResolvedValue(doc({ name: 'Municipality', isActive: true }));

      await service.create({ name: 'Municipality' });

      expect(ulbEligibilityService.invalidate).not.toHaveBeenCalled();
    });

    it('throws ConflictException when an active type with the same name already exists (pre-check)', async () => {
      ulbTypeModel.findOne.mockReturnValue(q({ name: 'Cantonment Board', isActive: true }));

      await expect(service.create({ name: 'Cantonment Board' })).rejects.toThrow(ConflictException);
      expect(ulbTypeModel.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException on a duplicate-key race (pre-check passed, insert still collided)', async () => {
      const dupErr = new MongoServerError({ message: 'dup key' });
      dupErr.code = 11000;
      ulbTypeModel.create.mockRejectedValue(dupErr);

      await expect(service.create({ name: 'Cantonment Board' })).rejects.toThrow(ConflictException);
    });
  });

  // ─── findAll / findOne ───────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated results', async () => {
      const docs = [doc({ name: 'A', isActive: true }), doc({ name: 'B', isActive: true })];
      ulbTypeModel.find.mockReturnValue(q(docs));
      ulbTypeModel.countDocuments.mockResolvedValue(2);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({ data: docs, total: 2, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      ulbTypeModel.findById.mockReturnValue(q(null));

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('invalidates the newly-added cycle', async () => {
      const existing = doc({ name: 'Cantonment Board', isActive: true, ineligibleForGrantCycles: [] });
      ulbTypeModel.findById.mockReturnValue(q(existing));

      await service.update('id1', { ineligibleForGrantCycles: ['XVIFC'] });

      expect(ulbEligibilityService.invalidate).toHaveBeenCalledWith('XVIFC');
    });

    it('invalidates a cycle that was removed from the array, not just ones that remain', async () => {
      const existing = doc({ name: 'Cantonment Board', isActive: true, ineligibleForGrantCycles: ['XVIFC'] });
      ulbTypeModel.findById.mockReturnValue(q(existing));

      await service.update('id1', { ineligibleForGrantCycles: [] });

      expect(ulbEligibilityService.invalidate).toHaveBeenCalledWith('XVIFC');
    });

    it('throws NotFoundException when the type does not exist', async () => {
      ulbTypeModel.findById.mockReturnValue(q(null));

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when renaming into an existing active type', async () => {
      const existing = doc({ name: 'Cantonment Board', isActive: true });
      ulbTypeModel.findById.mockReturnValue(q(existing));
      ulbTypeModel.findOne.mockReturnValue(q({ name: 'Municipality', isActive: true }));

      await expect(service.update('id1', { name: 'Municipality' })).rejects.toThrow(ConflictException);
    });

    it('does not re-check uniqueness when name/isActive are not part of the update', async () => {
      const existing = doc({ name: 'Cantonment Board', isActive: true, ineligibleForGrantCycles: [] });
      ulbTypeModel.findById.mockReturnValue(q(existing));

      await service.update('id1', { ineligibleForGrantCycles: ['XVIFC'] });

      expect(ulbTypeModel.findOne).not.toHaveBeenCalled();
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft-deletes via isActive=false and invalidates its declared cycles', async () => {
      const existing = doc({ name: 'Cantonment Board', isActive: true, ineligibleForGrantCycles: ['XVIFC'] });
      ulbTypeModel.findById.mockReturnValue(q(existing));

      const result = await service.remove('id1');

      expect(existing.isActive).toBe(false);
      expect(existing.save).toHaveBeenCalled();
      expect(ulbEligibilityService.invalidate).toHaveBeenCalledWith('XVIFC');
      expect(result.message).toContain('Cantonment Board');
    });

    it('throws NotFoundException when the type does not exist', async () => {
      ulbTypeModel.findById.mockReturnValue(q(null));

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
