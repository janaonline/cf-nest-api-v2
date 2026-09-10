import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ExemptionResolverService } from './exemption-resolver.service';
import { YearAccessService } from './year-access.service';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';

describe('ExemptionResolverService', () => {
  let service: ExemptionResolverService;
  let yearAccessService: { peekEntry: jest.Mock };
  let formJsonConfigService: { findByFormId: jest.Mock };

  const year2627 = { _id: new Types.ObjectId(), year: '2026-27' };
  const ulbA = { _id: new Types.ObjectId(), startYear: 2026, yearAccess: {} };
  const ulbB = { _id: new Types.ObjectId(), startYear: 2026, yearAccess: {} };

  beforeEach(async () => {
    yearAccessService = { peekEntry: jest.fn() };
    formJsonConfigService = { findByFormId: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExemptionResolverService,
        { provide: YearAccessService, useValue: yearAccessService },
        { provide: FormJsonConfigService, useValue: formJsonConfigService },
      ],
    }).compile();

    service = module.get<ExemptionResolverService>(ExemptionResolverService);
  });

  describe('resolveBulk', () => {
    it('returns an empty map without any lookup when given no ULBs', async () => {
      const result = await service.resolveBulk([], year2627, 32);

      expect(result.size).toBe(0);
      expect(formJsonConfigService.findByFormId).not.toHaveBeenCalled();
    });

    it('resolves everyone as not-exempt without touching peekEntry when the form is not exemptable', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, isApplicableForExemption: false });

      const result = await service.resolveBulk([ulbA, ulbB], year2627, 32);

      expect(result.get(String(ulbA._id))).toEqual({ exempted: false, source: null });
      expect(result.get(String(ulbB._id))).toEqual({ exempted: false, source: null });
      expect(yearAccessService.peekEntry).not.toHaveBeenCalled();
    });

    it('resolves everyone as not-exempt when no formJsonConfig row exists for the formId', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue(null);

      const result = await service.resolveBulk([ulbA], year2627, 32);

      expect(result.get(String(ulbA._id))).toEqual({ exempted: false, source: null });
      expect(yearAccessService.peekEntry).not.toHaveBeenCalled();
    });

    it('resolves exempted: true, source: AUTOMATIC for a ULB whose peekEntry marks the year enabled and the formId disabled', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, isApplicableForExemption: true });
      yearAccessService.peekEntry.mockResolvedValue({ yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] });

      const result = await service.resolveBulk([ulbA], year2627, 32);

      expect(result.get(String(ulbA._id))).toEqual({ exempted: true, source: 'AUTOMATIC' });
    });

    it('resolves not-exempt when the year is disabled even if the formId is listed', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, isApplicableForExemption: true });
      yearAccessService.peekEntry.mockResolvedValue({
        yearEnabled: false,
        yearId: year2627._id,
        disabledFormIds: [32],
      });

      const result = await service.resolveBulk([ulbA], year2627, 32);

      expect(result.get(String(ulbA._id))).toEqual({ exempted: false, source: null });
    });

    it('resolves not-exempt when the formId is not in that ULB entry disabledFormIds', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, isApplicableForExemption: true });
      yearAccessService.peekEntry.mockResolvedValue({ yearEnabled: true, yearId: year2627._id, disabledFormIds: [] });

      const result = await service.resolveBulk([ulbA], year2627, 32);

      expect(result.get(String(ulbA._id))).toEqual({ exempted: false, source: null });
    });

    it('resolves each ULB independently in the same call', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 32, isApplicableForExemption: true });
      yearAccessService.peekEntry.mockImplementation(async (ulb: { _id: Types.ObjectId }) =>
        ulb._id === ulbA._id
          ? { yearEnabled: true, yearId: year2627._id, disabledFormIds: [32] }
          : { yearEnabled: true, yearId: year2627._id, disabledFormIds: [] },
      );

      const result = await service.resolveBulk([ulbA, ulbB], year2627, 32);

      expect(result.get(String(ulbA._id))).toEqual({ exempted: true, source: 'AUTOMATIC' });
      expect(result.get(String(ulbB._id))).toEqual({ exempted: false, source: null });
    });
  });
});
