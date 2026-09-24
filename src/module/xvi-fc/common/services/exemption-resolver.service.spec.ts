import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ExemptionResolverService } from './exemption-resolver.service';
import { YearAccessService } from './year-access.service';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';
import { XviFcEligibilityExemption } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/** find/findOne().lean().exec() chain mock, same shape used throughout this module's specs. */
function q<T>(value: T) {
  return { lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('ExemptionResolverService', () => {
  let service: ExemptionResolverService;
  let yearAccessService: { peekEntry: jest.Mock };
  let formJsonConfigService: { findByFormId: jest.Mock };
  let eligibilityExemptionModel: { findOne: jest.Mock; find: jest.Mock };

  const year2627 = { _id: new Types.ObjectId(), year: '2026-27' };
  const ulbA = { _id: new Types.ObjectId(), startYear: 2026, yearAccess: {} };
  const ulbB = { _id: new Types.ObjectId(), startYear: 2026, yearAccess: {} };

  beforeEach(async () => {
    yearAccessService = { peekEntry: jest.fn() };
    formJsonConfigService = { findByFormId: jest.fn() };
    eligibilityExemptionModel = { findOne: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExemptionResolverService,
        { provide: YearAccessService, useValue: yearAccessService },
        { provide: FormJsonConfigService, useValue: formJsonConfigService },
        { provide: getModelToken(XviFcEligibilityExemption.name), useValue: eligibilityExemptionModel },
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

  describe('resolveDiscretionary', () => {
    it('returns null when no discretionary request document matches this {ulb, year, formId}', async () => {
      eligibilityExemptionModel.findOne.mockReturnValue(q(null));

      const result = await service.resolveDiscretionary(ulbA._id, year2627._id, 30);

      expect(result).toBeNull();
      expect(eligibilityExemptionModel.findOne).toHaveBeenCalledWith(
        { ulb: ulbA._id, year: year2627._id, 'data.formId': 30 },
        { ulb: 1, data: 1 },
      );
    });

    it('returns null when the document exists but has no entry for this formId', async () => {
      eligibilityExemptionModel.findOne.mockReturnValue(
        q({
          _id: new Types.ObjectId(),
          ulb: ulbA._id,
          data: [
            { formId: 31, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, decidedAt: null, mohuaRemarks: null },
          ],
        }),
      );

      const result = await service.resolveDiscretionary(ulbA._id, year2627._id, 30);

      expect(result).toBeNull();
    });

    it('returns the matching entry, mapping decidedAt/mohuaRemarks straight through', async () => {
      const requestId = new Types.ObjectId();
      const decidedAt = new Date('2026-01-15T00:00:00.000Z');
      eligibilityExemptionModel.findOne.mockReturnValue(
        q({
          _id: requestId,
          ulb: ulbA._id,
          data: [
            {
              formId: 30,
              currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
              decidedAt,
              mohuaRemarks: 'Missing signature',
            },
          ],
        }),
      );

      const result = await service.resolveDiscretionary(ulbA._id, year2627._id, 30);

      expect(result).toEqual({
        requestId,
        currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
        decidedAt,
        mohuaRemarks: 'Missing signature',
      });
    });
  });

  describe('resolveDiscretionaryBulk', () => {
    it('returns an empty map without any lookup when given no ULB ids', async () => {
      const result = await service.resolveDiscretionaryBulk([], year2627._id, 30);

      expect(result.size).toBe(0);
      expect(eligibilityExemptionModel.find).not.toHaveBeenCalled();
    });

    it('maps only the ULBs that have a matching entry, skipping the rest', async () => {
      eligibilityExemptionModel.find.mockReturnValue(
        q([
          {
            _id: new Types.ObjectId(),
            ulb: ulbA._id,
            data: [
              { formId: 30, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, decidedAt: null, mohuaRemarks: null },
            ],
          },
        ]),
      );

      const result = await service.resolveDiscretionaryBulk([ulbA._id, ulbB._id], year2627._id, 30);

      expect(result.size).toBe(1);
      expect(result.get(String(ulbA._id))?.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      expect(result.has(String(ulbB._id))).toBe(false);
    });
  });
});
