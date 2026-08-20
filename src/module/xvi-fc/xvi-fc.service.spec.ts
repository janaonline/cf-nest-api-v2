import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { XviFcService } from './xvi-fc.service';
import { GrantAllocation } from '../../schemas/xvi-fc/grant-allocation.schema';
import { Year } from '../../schemas/year.schema';
import { Ulb } from '../../schemas/ulb.schema';
import { State } from '../../schemas/state.schema';
import { SideMenu } from '../../schemas/side-menu.schema';
import {
  XviFcAnnualAccount,
  AnnualAccountFormStatus,
  FORM_STATUS_ID,
} from '../../schemas/xvi-fc/annual-account.schema';
import { XviFcUnspentBalanceDisclosure } from '../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import { XviFcBankAccount } from '../../schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { SlbForm } from '../../schemas/xvi-fc/ulb/slb-form.schema';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from './cache/xvi-fc-cache.service';
import { FormJsonService } from '../../master/form-json/form-json.service';
import { UlbEligibilityService } from '../ulb-eligibility/ulb-eligibility.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';

const mockUser: AuthUser = {
  _id: new Types.ObjectId().toHexString(),
  role: 'ADMIN',
  scope: null,
  accessLevel: null,
};

describe('XviFcService', () => {
  let service: XviFcService;
  let mockGrantAllocationModel: { aggregate: jest.Mock };
  let mockYearModel: { find: jest.Mock };
  let mockUlbModel: { findById: jest.Mock };
  let mockStateModel: { findById: jest.Mock };
  let mockSideMenuModel: { find: jest.Mock };
  let mockAnnualAccountModel: { find: jest.Mock };
  let mockDisclosureModel: { findOne: jest.Mock };
  let mockBankAccountModel: { findOne: jest.Mock };
  let mockSlbFormModel: { findOne: jest.Mock };
  let mockCacheService: { deleteByPattern: jest.Mock };
  let mockFormJsonService: { clearCache: jest.Mock };
  let mockUlbEligibilityService: { getIneligibleUlbTypeIds: jest.Mock };

  function q<T>(value: T) {
    return {
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(value),
    };
  }

  beforeEach(async () => {
    mockGrantAllocationModel = {
      aggregate: jest.fn(),
    };
    mockYearModel = { find: jest.fn().mockReturnValue(q([])) };
    mockUlbModel = { findById: jest.fn().mockReturnValue(q(null)) };
    mockStateModel = { findById: jest.fn().mockReturnValue(q(null)) };
    mockSideMenuModel = { find: jest.fn().mockReturnValue(q([])) };
    mockAnnualAccountModel = { find: jest.fn().mockReturnValue(q([])) };
    mockDisclosureModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockBankAccountModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockSlbFormModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockCacheService = { deleteByPattern: jest.fn().mockResolvedValue(0) };
    mockFormJsonService = { clearCache: jest.fn().mockResolvedValue(0) };
    mockUlbEligibilityService = { getIneligibleUlbTypeIds: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XviFcService,
        {
          provide: getModelToken(GrantAllocation.name),
          useValue: mockGrantAllocationModel,
        },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(State.name), useValue: mockStateModel },
        { provide: getModelToken(SideMenu.name), useValue: mockSideMenuModel },
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcUnspentBalanceDisclosure.name), useValue: mockDisclosureModel },
        { provide: getModelToken(XviFcBankAccount.name), useValue: mockBankAccountModel },
        { provide: getModelToken(SlbForm.name), useValue: mockSlbFormModel },
        { provide: XviFcCacheService, useValue: mockCacheService },
        { provide: FormJsonService, useValue: mockFormJsonService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
      ],
    }).compile();

    service = module.get<XviFcService>(XviFcService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStateWiseData', () => {
    const stateId = new Types.ObjectId().toHexString();
    const mockResult = {
      stateId,
      stateName: 'Test State',
      totalUlbs: 5,
      years: '2026-27',
      tableData: [{ year: 'FY2026-27', basic: 100, performance: 50 }],
      totalAllocation: 150,
    };

    it('should return state wise data when found', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      const result = await service.getStateWiseData(stateId, mockUser);
      expect(result).toEqual(mockResult);
      expect(mockGrantAllocationModel.aggregate).toHaveBeenCalledTimes(1);
    });

    it('defensively rounds basic/performance and re-derives totalAllocation from the rounded rows', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([
        {
          ...mockResult,
          tableData: [
            { year: 'FY2026-27', basic: 100.4, performance: 50.6 },
            { year: 'FY2027-28', basic: 200.2, performance: 0 },
          ],
          totalAllocation: 351.2, // what the raw (unrounded) sum would be
        },
      ]);

      const result = await service.getStateWiseData(stateId, mockUser);

      expect(result.tableData).toEqual([
        { year: 'FY2026-27', basic: 100, performance: 51 },
        { year: 'FY2027-28', basic: 200, performance: 0 },
      ]);
      // Sum of the rounded rows (100+51+200+0=351), not the raw 351.2 — keeps the displayed total
      // consistent with the displayed per-year figures rather than drifting from them.
      expect(result.totalAllocation).toBe(351);
    });

    it('should throw NotFoundException when no data found', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([]);
      await expect(service.getStateWiseData(stateId, mockUser)).rejects.toThrow(NotFoundException);
      await expect(service.getStateWiseData(stateId, mockUser)).rejects.toThrow(
        'No grant allocation data found for this state',
      );
    });

    it('should call aggregate with a pipeline array', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      await service.getStateWiseData(stateId, mockUser);
      const [pipeline] = mockGrantAllocationModel.aggregate.mock.calls[0];
      expect(Array.isArray(pipeline)).toBe(true);
    });
  });

  describe('getSideMenu', () => {
    const yearId = new Types.ObjectId().toString();

    it('should return ULB side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      expect(result).toHaveProperty('topModel');
      expect(result).toHaveProperty('bottomModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return STATE side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('STATE', yearId);
      expect(result).toHaveProperty('topModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return MOHUA side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('MOHUA', yearId);
      expect(result).toHaveProperty('topModel');
    });

    it('should return DOE side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('DOE', yearId);
      expect(result).toHaveProperty('topModel');
    });

    it('should throw NotFoundException for unknown role', async () => {
      await expect(service.getSideMenu('UNKNOWN' as any, yearId)).rejects.toThrow(NotFoundException);
    });

    it('copies url/target onto a top-level external-link item', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([
          {
            _id: new Types.ObjectId(),
            name: 'Submit Feedback',
            section: 'top',
            type: 'item',
            sequence: 1,
            url: 'https://tally.so/r/44d28O',
            target: '_blank',
          },
        ]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      expect(result.topModel[0]).toEqual(
        expect.objectContaining({ label: 'Submit Feedback', url: 'https://tally.so/r/44d28O', target: '_blank' }),
      );
    });

    it('copies url/target onto a child item nested under a group', async () => {
      const groupId = new Types.ObjectId();
      mockSideMenuModel.find.mockReturnValue(
        q([
          { _id: groupId, name: 'Support', section: 'top', type: 'group', sequence: 1, parentId: null },
          {
            _id: new Types.ObjectId(),
            name: 'Submit Feedback',
            section: 'top',
            type: 'item',
            sequence: 2,
            parentId: groupId,
            url: 'https://tally.so/r/44d28O',
            target: '_blank',
          },
        ]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      const group = result.topModel.find((i) => i.label === 'Support');
      expect(group?.items?.[0]).toEqual(
        expect.objectContaining({ label: 'Submit Feedback', url: 'https://tally.so/r/44d28O', target: '_blank' }),
      );
    });

    it('omits url/target for an item that does not set them', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      expect(result.topModel[0].url).toBeUndefined();
      expect(result.topModel[0].target).toBeUndefined();
    });
  });

  describe('getFormStatus', () => {
    const ulbId = new Types.ObjectId().toString();
    const designYearId = new Types.ObjectId().toString();

    it('returns xviFcBankAccount as NOT_STARTED using form-status field names when no bank-account record exists', async () => {
      const result = await service.getFormStatus(ulbId, designYearId);

      expect(result.xviFcBankAccount).toEqual({
        form_status: 'NOT_STARTED',
        form_status_id: FORM_STATUS.NOT_STARTED,
      });
    });

    it('returns xviFcBankAccount with stored status using form-status field names when record exists', async () => {
      mockBankAccountModel.findOne.mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }));

      const result = await service.getFormStatus(ulbId, designYearId);

      expect(result.xviFcBankAccount).toEqual({
        form_status: 'UNDER_REVIEW_BY_STATE',
        form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      });
    });

    it('preserves existing form-status response fields', async () => {
      const annualAccountId = new Types.ObjectId();
      mockAnnualAccountModel.find.mockReturnValue(
        q([
          {
            _id: annualAccountId,
            sectionType: 'audited',
            form_status: AnnualAccountFormStatus.IN_PROGRESS,
            form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
          },
          {
            _id: new Types.ObjectId(),
            sectionType: 'unaudited',
            form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
            form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
          },
        ]),
      );
      mockDisclosureModel.findOne.mockReturnValue(q({ formStatus: 'SUBMITTED' }));

      const result = await service.getFormStatus(ulbId, designYearId);

      expect(result).toMatchObject({
        annualAccountId: annualAccountId.toString(),
        auditedData: {
          form_status: AnnualAccountFormStatus.IN_PROGRESS,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
        },
        unauditedData: {
          form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
          form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
        },
        unspentBalanceDisclosure: {
          form_status: 'SUBMITTED',
          form_status_id: null,
        },
      });
      expect(result.xviFcBankAccount.form_status).not.toBe('SUBMITTED');
    });

    it('queries bank-account status by ulb and designYear and selects only currentFormStatus', async () => {
      const chain = q(null);
      mockBankAccountModel.findOne.mockReturnValue(chain);

      await service.getFormStatus(ulbId, designYearId);

      expect(mockBankAccountModel.findOne).toHaveBeenCalledWith({
        ulb: new Types.ObjectId(ulbId),
        designYear: new Types.ObjectId(designYearId),
      });
      expect(chain.select).toHaveBeenCalledWith('currentFormStatus');
    });
  });

  describe('clearPageCache', () => {
    const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };

    it('rejects non-admin users', async () => {
      await expect(service.clearPageCache({ ...mockUser, scope: Scope.STATE })).rejects.toThrow();
    });

    it('clears everything when no pattern is given', async () => {
      await service.clearPageCache(adminUser);
      expect(mockCacheService.deleteByPattern).toHaveBeenCalledWith(`${XVIFC_CACHE_KEY_PREFIX}:*`);
    });

    it('matches the real cache key even when the pattern omits the app route prefix', async () => {
      // Real keys look like `xvifc:cache:/api/v2/xvi-fc/sidebar/STATE?yearId=...` — a caller
      // has no way to know about the /api/v2 prefix, so the pattern must still match it.
      await service.clearPageCache(adminUser, '/xvi-fc/sidebar');

      const [calledPattern] = mockCacheService.deleteByPattern.mock.calls[0] as [string];
      const realKey = `${XVIFC_CACHE_KEY_PREFIX}:/api/v2/xvi-fc/sidebar/STATE?yearId=abc`;
      expect(new RegExp(`^${calledPattern.replace(/\*/g, '.*')}$`).test(realKey)).toBe(true);
    });

    it('ignores extra slashes and wildcards the caller adds themselves', async () => {
      await service.clearPageCache(adminUser, '/xvi-fc/sidebar/*');

      const [calledPattern] = mockCacheService.deleteByPattern.mock.calls[0] as [string];
      const realKey = `${XVIFC_CACHE_KEY_PREFIX}:/api/v2/xvi-fc/sidebar/STATE?yearId=abc`;
      expect(new RegExp(`^${calledPattern.replace(/\*/g, '.*')}$`).test(realKey)).toBe(true);
    });

    it('reports how many entries were actually cleared', async () => {
      mockCacheService.deleteByPattern.mockResolvedValue(3);
      const result = await service.clearPageCache(adminUser, 'sidebar');
      expect(result.message).toContain('Cleared 3');
    });

    it('says nothing was cleared when the pattern matches no cached entries', async () => {
      mockCacheService.deleteByPattern.mockResolvedValue(0);
      const result = await service.clearPageCache(adminUser, 'nonexistent');
      expect(result.message).toContain('nothing was cleared');
    });
  });

  describe('clearFormJsonCache', () => {
    const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };
    const designYearId = new Types.ObjectId().toHexString();

    it('rejects non-admin users', async () => {
      await expect(service.clearFormJsonCache({ ...mockUser, scope: Scope.STATE })).rejects.toThrow();
    });

    it('clears everything when both designYearId and formId are omitted', async () => {
      await service.clearFormJsonCache(adminUser);
      expect(mockFormJsonService.clearCache).toHaveBeenCalledWith(undefined, undefined);
    });

    it('passes designYearId and formId through unchanged', async () => {
      await service.clearFormJsonCache(adminUser, designYearId, 25);
      expect(mockFormJsonService.clearCache).toHaveBeenCalledWith(designYearId, 25);
    });

    it('reports how many entries were actually cleared', async () => {
      mockFormJsonService.clearCache.mockResolvedValue(2);
      const result = await service.clearFormJsonCache(adminUser, designYearId, 25);
      expect(result.message).toContain('Cleared 2');
    });

    it('says nothing was cleared when nothing matched', async () => {
      mockFormJsonService.clearCache.mockResolvedValue(0);
      const result = await service.clearFormJsonCache(adminUser, designYearId, 25);
      expect(result.message).toContain('nothing was cleared');
    });
  });

  describe('getSupportHours', () => {
    it('should return nextSupportHour and upcomingSupportHours', () => {
      const result = service.getSupportHours();
      expect(result).toHaveProperty('nextSupportHour');
      expect(result).toHaveProperty('upcomingSupportHours');
    });

    it('should return nextSupportHour with required fields', () => {
      const { nextSupportHour } = service.getSupportHours();
      expect(nextSupportHour).toHaveProperty('date');
      expect(nextSupportHour).toHaveProperty('description');
      expect(nextSupportHour).toHaveProperty('time');
      expect(nextSupportHour).toHaveProperty('hostedBy');
    });

    it('should return 2 upcoming support hours', () => {
      const { upcomingSupportHours } = service.getSupportHours();
      expect(upcomingSupportHours).toHaveLength(2);
    });

    it('should return upcoming hours with date and status', () => {
      const { upcomingSupportHours } = service.getSupportHours();
      upcomingSupportHours.forEach((h) => {
        expect(h).toHaveProperty('date');
        expect(h).toHaveProperty('status');
        expect(['UPCOMING', 'SCHEDULED']).toContain(h.status);
      });
    });

    it('should always return a Thursday as the next support hour', () => {
      const { nextSupportHour } = service.getSupportHours();
      expect(nextSupportHour.date).toMatch(/Thursday/);
    });
  });
});
