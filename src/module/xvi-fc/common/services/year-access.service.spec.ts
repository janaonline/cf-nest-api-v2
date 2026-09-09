import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { YearAccessService } from './year-access.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';

describe('YearAccessService', () => {
  let service: YearAccessService;
  let ulbModel: { updateOne: jest.Mock };
  let formJsonConfigService: { findByFormId: jest.Mock };

  const ulbId = new Types.ObjectId();
  const year2627 = { _id: new Types.ObjectId(), year: '2026-27' };
  const year2728 = { _id: new Types.ObjectId(), year: '2027-28' };
  const year2829 = { _id: new Types.ObjectId(), year: '2028-29' };

  beforeEach(async () => {
    ulbModel = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    formJsonConfigService = { findByFormId: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YearAccessService,
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: FormJsonConfigService, useValue: formJsonConfigService },
      ],
    }).compile();

    service = module.get<YearAccessService>(YearAccessService);
  });

  describe('getEntry', () => {
    it('returns an already-materialized entry directly, no write', async () => {
      const ulb = { _id: ulbId, startYear: 2026, yearAccess: { '2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } } };

      const entry = await service.getEntry(ulb, year2627);

      expect(entry).toEqual({ yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] });
      expect(ulbModel.updateOne).not.toHaveBeenCalled();
    });

    it('materializes yearEnabled=true and empty disabledFormIds when startYear is null (no restriction)', async () => {
      const ulb = { _id: ulbId, startYear: null, yearAccess: {} };

      const entry = await service.getEntry(ulb, year2627);

      expect(entry).toEqual({ yearEnabled: true, yearId: year2627._id, disabledFormIds: [] });
      expect(ulbModel.updateOne).toHaveBeenCalledWith(
        { _id: ulbId, 'yearAccess.2026-27': { $exists: false } },
        { $set: { 'yearAccess.2026-27': entry } },
      );
    });

    it('materializes yearEnabled=false for a year before startYear', async () => {
      const ulb = { _id: ulbId, startYear: 2027, yearAccess: {} };

      const entry = await service.getEntry(ulb, year2627);

      expect(entry.yearEnabled).toBe(false);
      expect(entry.disabledFormIds).toEqual([]);
    });

    it('materializes yearEnabled=true for the exact startYear', async () => {
      const ulb = { _id: ulbId, startYear: 2026, yearAccess: {} };

      const entry = await service.getEntry(ulb, year2626Label(2026));

      expect(entry.yearEnabled).toBe(true);
    });

    it('inherits disabledFormIds from the seed year while inside exemptionGraceYears', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, exemptionGraceYears: 2 });
      const ulb = {
        _id: ulbId,
        startYear: 2026,
        yearAccess: { '2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } },
      };

      // year index 2 (2027-28) - still within a 2-year grace period
      const entry = await service.getEntry(ulb, year2728);

      expect(entry.disabledFormIds).toEqual([32]);
    });

    it('drops a formId once its exemptionGraceYears window has passed', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, exemptionGraceYears: 2 });
      const ulb = {
        _id: ulbId,
        startYear: 2026,
        yearAccess: { '2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } },
      };

      // year index 3 (2028-29) - past a 2-year grace period
      const entry = await service.getEntry(ulb, year2829);

      expect(entry.disabledFormIds).toEqual([]);
    });

    it('defaults exemptionGraceYears to 1 when no formJsonConfig exists for that formId', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue(null);
      const ulb = {
        _id: ulbId,
        startYear: 2026,
        yearAccess: { '2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } },
      };

      const entry = await service.getEntry(ulb, year2728); // index 2, grace defaults to 1

      expect(entry.disabledFormIds).toEqual([]);
    });
  });

  describe('peekEntry', () => {
    it('computes the same result as getEntry but never writes', async () => {
      const ulb = { _id: ulbId, startYear: 2027, yearAccess: {} };

      const entry = await service.peekEntry(ulb, year2627);

      expect(entry.yearEnabled).toBe(false);
      expect(ulbModel.updateOne).not.toHaveBeenCalled();
    });

    it('returns an already-materialized entry directly, same as getEntry', async () => {
      const ulb = { _id: ulbId, startYear: 2026, yearAccess: { '2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } } };

      const entry = await service.peekEntry(ulb, year2627);

      expect(entry).toEqual({ yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] });
    });
  });

  describe('isYearEnabled / isFormExempt', () => {
    it('isFormExempt is false when the year itself is disabled, even if the formId is listed', async () => {
      const ulb = { _id: ulbId, startYear: 2027, yearAccess: {} }; // 2026-27 predates startYear

      const exempt = await service.isFormExempt(ulb, year2627, 32);

      expect(exempt).toBe(false);
    });

    it('isFormExempt is true when the year is enabled and formId is in disabledFormIds', async () => {
      const ulb = { _id: ulbId, startYear: 2026, yearAccess: { '2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } } };

      expect(await service.isFormExempt(ulb, year2627, 32)).toBe(true);
      expect(await service.isFormExempt(ulb, year2627, 33)).toBe(false);
    });
  });

  describe('setSeedExemptions', () => {
    it('writes the seed entry with yearEnabled true and the given disabledFormIds', async () => {
      const ulb = { _id: ulbId, startYear: 2026, yearAccess: {} };

      await service.setSeedExemptions(ulb, year2627, [32]);

      expect(ulbModel.updateOne).toHaveBeenCalledWith(
        { _id: ulbId },
        { $set: { 'yearAccess.2026-27': { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] } } },
      );
    });

    it('no-ops when the ULB has no startYear set', async () => {
      const ulb = { _id: ulbId, startYear: null, yearAccess: {} };

      await service.setSeedExemptions(ulb, year2627, [32]);

      expect(ulbModel.updateOne).not.toHaveBeenCalled();
    });
  });
});

/** Helper so the "exact startYear" test reads clearly without a magic literal. */
function year2626Label(startCalendarYear: number) {
  return { _id: new Types.ObjectId(), year: `${startCalendarYear}-${String((startCalendarYear + 1) % 100).padStart(2, '0')}` };
}
