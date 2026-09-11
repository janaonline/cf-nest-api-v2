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
import { SideMenuService } from './side-menu/side-menu.service';
import { ExemptionResolverService } from './common/services/exemption-resolver.service';
import { FormJsonConfigService } from '../../master/form-json-config/form-json-config.service';
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
  let mockYearModel: { find: jest.Mock; findById: jest.Mock };
  let mockUlbModel: { findById: jest.Mock };
  let mockStateModel: { findById: jest.Mock };
  let mockAnnualAccountModel: { find: jest.Mock };
  let mockDisclosureModel: { findOne: jest.Mock };
  let mockBankAccountModel: { findOne: jest.Mock };
  let mockSlbFormModel: { findOne: jest.Mock };
  let mockCacheService: { deleteByPattern: jest.Mock };
  let mockFormJsonService: { clearCache: jest.Mock };
  let mockUlbEligibilityService: { getIneligibleUlbTypeIds: jest.Mock };
  let mockSideMenuService: { getSideMenu: jest.Mock; clearCache: jest.Mock };
  let mockExemptionResolverService: { resolveBulk: jest.Mock };
  let mockFormJsonConfigService: { findByFormId: jest.Mock };

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
    mockYearModel = { find: jest.fn().mockReturnValue(q([])), findById: jest.fn().mockReturnValue(q(null)) };
    mockUlbModel = { findById: jest.fn().mockReturnValue(q(null)) };
    mockStateModel = { findById: jest.fn().mockReturnValue(q(null)) };
    mockAnnualAccountModel = { find: jest.fn().mockReturnValue(q([])) };
    mockDisclosureModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockBankAccountModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockSlbFormModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockCacheService = { deleteByPattern: jest.fn().mockResolvedValue(0) };
    mockFormJsonService = { clearCache: jest.fn().mockResolvedValue(0) };
    mockUlbEligibilityService = { getIneligibleUlbTypeIds: jest.fn().mockResolvedValue([]) };
    mockSideMenuService = { getSideMenu: jest.fn(), clearCache: jest.fn().mockResolvedValue(0) };
    mockExemptionResolverService = { resolveBulk: jest.fn().mockResolvedValue(new Map()) };
    // Default: PER_YEAR (or unconfigured) - existing getFormStatus tests' exact-year behavior unchanged.
    mockFormJsonConfigService = { findByFormId: jest.fn().mockResolvedValue(null) };

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
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcUnspentBalanceDisclosure.name), useValue: mockDisclosureModel },
        { provide: getModelToken(XviFcBankAccount.name), useValue: mockBankAccountModel },
        { provide: getModelToken(SlbForm.name), useValue: mockSlbFormModel },
        { provide: XviFcCacheService, useValue: mockCacheService },
        { provide: FormJsonService, useValue: mockFormJsonService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
        { provide: SideMenuService, useValue: mockSideMenuService },
        { provide: ExemptionResolverService, useValue: mockExemptionResolverService },
        { provide: FormJsonConfigService, useValue: mockFormJsonConfigService },
      ],
    }).compile();

    service = module.get<XviFcService>(XviFcService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getYears', () => {
    const yearA = { _id: new Types.ObjectId(), year: '2026-27' };
    const yearB = { _id: new Types.ObjectId(), year: '2027-28' };

    beforeEach(() => {
      // Default "now" is after the whole 16th FC cycle ends, so every test below exercises only
      // the yearAccess/scope logic under test, not the separate "future year" gate covered by its
      // own describe block further down (which sets its own system time explicitly).
      jest.useFakeTimers().setSystemTime(new Date('2031-01-01'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns every active year, all isEnabled, for STATE/ADMIN callers', async () => {
      mockYearModel.find.mockReturnValue(q([yearA, yearB]));
      const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };

      const result = await service.getYears(adminUser);

      expect(mockYearModel.find).toHaveBeenCalledWith({ isActive: true }, { _id: 1, year: 1 });
      expect(result).toEqual([
        { _id: yearA._id.toString(), year: '2026-27', isEnabled: true },
        { _id: yearB._id.toString(), year: '2027-28', isEnabled: true },
      ]);
    });

    it('excludes years outside the 16th FC award period (14th/15th FC years in the shared Year collection)', async () => {
      const legacyYear = { _id: new Types.ObjectId(), year: '2024-25' }; // 15th FC, predates the cycle
      const futureYear = { _id: new Types.ObjectId(), year: '2031-32' }; // after the cycle ends
      mockYearModel.find.mockReturnValue(q([legacyYear, yearA, yearB, futureYear]));
      const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };

      const result = await service.getYears(adminUser);

      expect(result).toEqual([
        { _id: yearA._id.toString(), year: '2026-27', isEnabled: true },
        { _id: yearB._id.toString(), year: '2027-28', isEnabled: true },
      ]);
    });

    it('returns every active year, all isEnabled, when called with no user (backward compatible)', async () => {
      mockYearModel.find.mockReturnValue(q([yearA]));

      const result = await service.getYears();

      expect(result).toEqual([{ _id: yearA._id.toString(), year: '2026-27', isEnabled: true }]);
    });

    it('reads isEnabled literally off Ulb.yearAccess[year].yearEnabled - a year missing from yearAccess entirely is isEnabled: false', async () => {
      mockYearModel.find.mockReturnValue(q([yearA, yearB]));
      const ulbId = new Types.ObjectId();
      // yearA ('2026-27') has no key at all in yearAccess; yearB ('2027-28') has an explicit entry.
      const ulb = {
        _id: ulbId,
        startYear: 2027,
        yearAccess: { '2027-28': { yearEnabled: true, yearId: yearB._id, disabledFormIds: [] } },
      };
      mockUlbModel.findById.mockReturnValue(q(ulb));
      const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: ulbId.toString() };

      const result = await service.getYears(ulbUser);

      expect(result).toEqual([
        { _id: yearA._id.toString(), year: '2026-27', isEnabled: false },
        { _id: yearB._id.toString(), year: '2027-28', isEnabled: true },
      ]);
    });

    it('is isEnabled: false for a year whose yearAccess entry explicitly has yearEnabled: false, not just a missing one', async () => {
      mockYearModel.find.mockReturnValue(q([yearA]));
      const ulbId = new Types.ObjectId();
      const ulb = {
        _id: ulbId,
        startYear: 2027,
        yearAccess: { '2026-27': { yearEnabled: false, yearId: yearA._id, disabledFormIds: [] } },
      };
      mockUlbModel.findById.mockReturnValue(q(ulb));
      const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: ulbId.toString() };

      const result = await service.getYears(ulbUser);

      expect(result).toEqual([{ _id: yearA._id.toString(), year: '2026-27', isEnabled: false }]);
    });

    it('an unrestricted ULB (startYear: null) with no materialized yearAccess entries is isEnabled: true for every started year, not locked out', async () => {
      mockYearModel.find.mockReturnValue(q([yearA, yearB]));
      const ulbId = new Types.ObjectId();
      // startYear: null is the documented "no restriction, sees every year" default for an
      // established ULB that predates Dynamic Year Access - yearAccess is empty because nothing
      // has ever touched it (getYears() no longer materializes, and this ULB hasn't visited an
      // exemption-aware form like SLB yet).
      mockUlbModel.findById.mockReturnValue(q({ _id: ulbId, startYear: null, yearAccess: {} }));
      const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: ulbId.toString() };

      const result = await service.getYears(ulbUser);

      expect(result).toEqual([
        { _id: yearA._id.toString(), year: '2026-27', isEnabled: true },
        { _id: yearB._id.toString(), year: '2027-28', isEnabled: true },
      ]);
    });

    it('does not persist anything for an unrestricted ULB either — ulbModel exposes no write method for this path to call', async () => {
      mockYearModel.find.mockReturnValue(q([yearA]));
      const ulbId = new Types.ObjectId();
      mockUlbModel.findById.mockReturnValue(q({ _id: ulbId, startYear: null, yearAccess: {} }));
      const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: ulbId.toString() };

      await expect(service.getYears(ulbUser)).resolves.toBeDefined();
    });

    it('never writes to the ULB document — this is a literal field read, and ulbModel exposes no write method for this path to call', async () => {
      mockYearModel.find.mockReturnValue(q([yearA, yearB]));
      const ulbId = new Types.ObjectId();
      // Deliberately no updateOne/findByIdAndUpdate on this mock — if getYears() ever tried to
      // persist as a side effect of this read, this test would throw instead of silently passing,
      // since mockUlbModel only ever defines findById.
      mockUlbModel.findById.mockReturnValue(q({ _id: ulbId, startYear: 2027, yearAccess: {} }));
      const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: ulbId.toString() };

      await expect(service.getYears(ulbUser)).resolves.toBeDefined();
    });

    it('returns every active year, all isEnabled, when the ULB record cannot be found', async () => {
      mockYearModel.find.mockReturnValue(q([yearA, yearB]));
      mockUlbModel.findById.mockReturnValue(q(null));
      const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: new Types.ObjectId().toString() };

      const result = await service.getYears(ulbUser);

      expect(result).toEqual([
        { _id: yearA._id.toString(), year: '2026-27', isEnabled: true },
        { _id: yearB._id.toString(), year: '2027-28', isEnabled: true },
      ]);
    });

    describe('disables a design year that has not started yet, regardless of yearAccess or scope', () => {
      it('e.g. "now" is 2026 -> only 2026-27 is enabled; 2027-28..2030-31 are disabled, for STATE/ADMIN callers', async () => {
        jest.setSystemTime(new Date('2026-09-09'));
        const yearC = { _id: new Types.ObjectId(), year: '2028-29' };
        const yearD = { _id: new Types.ObjectId(), year: '2029-30' };
        const yearE = { _id: new Types.ObjectId(), year: '2030-31' };
        mockYearModel.find.mockReturnValue(q([yearA, yearB, yearC, yearD, yearE]));
        const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };

        const result = await service.getYears(adminUser);

        expect(result).toEqual([
          { _id: yearA._id.toString(), year: '2026-27', isEnabled: true },
          { _id: yearB._id.toString(), year: '2027-28', isEnabled: false },
          { _id: yearC._id.toString(), year: '2028-29', isEnabled: false },
          { _id: yearD._id.toString(), year: '2029-30', isEnabled: false },
          { _id: yearE._id.toString(), year: '2030-31', isEnabled: false },
        ]);
      });

      it('overrides a ULB yearAccess entry explicitly set to yearEnabled: true for a future year', async () => {
        jest.setSystemTime(new Date('2026-09-09'));
        mockYearModel.find.mockReturnValue(q([yearA, yearB]));
        const ulbId = new Types.ObjectId();
        const ulb = {
          _id: ulbId,
          startYear: null,
          yearAccess: {
            '2026-27': { yearEnabled: true, yearId: yearA._id, disabledFormIds: [] },
            '2027-28': { yearEnabled: true, yearId: yearB._id, disabledFormIds: [] },
          },
        };
        mockUlbModel.findById.mockReturnValue(q(ulb));
        const ulbUser: AuthUser = { ...mockUser, scope: Scope.ULB, ulb: ulbId.toString() };

        const result = await service.getYears(ulbUser);

        expect(result).toEqual([
          { _id: yearA._id.toString(), year: '2026-27', isEnabled: true },
          { _id: yearB._id.toString(), year: '2027-28', isEnabled: false },
        ]);
      });
    });
  });

  describe('getStateWiseData', () => {
    const stateId = new Types.ObjectId().toHexString();
    const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };
    const ownStateUser: AuthUser = { ...mockUser, role: 'STATE', scope: Scope.STATE, state: stateId };
    const mockResult = {
      stateId,
      stateName: 'Test State',
      totalUlbs: 5,
      years: '2026-27',
      tableData: [{ year: 'FY2026-27', basic: 100, performance: 50 }],
      totalAllocation: 150,
    };

    it('should return state wise data when found (ADMIN)', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      const result = await service.getStateWiseData(stateId, adminUser);
      expect(result).toEqual(mockResult);
      expect(mockGrantAllocationModel.aggregate).toHaveBeenCalledTimes(1);
    });

    it('returns the data for a STATE user requesting their own state', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      const result = await service.getStateWiseData(stateId, ownStateUser);
      expect(result).toEqual(mockResult);
    });

    it('rejects a STATE user requesting a different state', async () => {
      const otherStateUser: AuthUser = { ...ownStateUser, state: new Types.ObjectId().toHexString() };
      await expect(service.getStateWiseData(stateId, otherStateUser)).rejects.toThrow(
        'You can only view your own state data',
      );
      expect(mockGrantAllocationModel.aggregate).not.toHaveBeenCalled();
    });

    it('rejects a ULB-scoped user regardless of which state is requested', async () => {
      const ulbUser: AuthUser = { ...mockUser, role: 'ULB', scope: Scope.ULB, ulb: new Types.ObjectId().toHexString() };
      await expect(service.getStateWiseData(stateId, ulbUser)).rejects.toThrow('You can only view your own state data');
      expect(mockGrantAllocationModel.aggregate).not.toHaveBeenCalled();
    });

    it('rejects a MoHUA-scoped user — only that state\'s own STATE user (or ADMIN) may view it', async () => {
      const mohuaUser: AuthUser = { ...mockUser, role: 'MoHUA', scope: Scope.MOHUA };
      await expect(service.getStateWiseData(stateId, mohuaUser)).rejects.toThrow('You can only view your own state data');
      expect(mockGrantAllocationModel.aggregate).not.toHaveBeenCalled();
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

      const result = await service.getStateWiseData(stateId, adminUser);

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
      await expect(service.getStateWiseData(stateId, adminUser)).rejects.toThrow(NotFoundException);
      await expect(service.getStateWiseData(stateId, adminUser)).rejects.toThrow(
        'No grant allocation data found for this state',
      );
    });

    it('should call aggregate with a pipeline array', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      await service.getStateWiseData(stateId, adminUser);
      const [pipeline] = mockGrantAllocationModel.aggregate.mock.calls[0];
      expect(Array.isArray(pipeline)).toBe(true);
    });
  });

  describe('getSideMenu', () => {
    // The actual query/tree-building/caching logic lives in SideMenuService now (see
    // side-menu.service.spec.ts) — this just confirms XviFcService delegates to it unchanged.
    const yearId = new Types.ObjectId().toString();

    it('delegates to sideMenuService.getSideMenu with the same role and yearId', async () => {
      const expected = { topModel: [], bottomModel: [] };
      mockSideMenuService.getSideMenu.mockResolvedValue(expected);

      const result = await service.getSideMenu('ULB', yearId);

      expect(mockSideMenuService.getSideMenu).toHaveBeenCalledWith('ULB', yearId);
      expect(result).toBe(expected);
    });

    it('propagates errors from sideMenuService.getSideMenu (e.g. NotFoundException)', async () => {
      mockSideMenuService.getSideMenu.mockRejectedValue(new NotFoundException('No menu configured for role X'));
      await expect(service.getSideMenu('UNKNOWN' as any, yearId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getYearLabelById', () => {
    const yearId = new Types.ObjectId().toHexString();

    it('returns the yearLabel for an existing year', async () => {
      mockYearModel.findById.mockReturnValue(q({ year: '2026-27' }));

      const result = await service.getYearLabelById(yearId);

      expect(result).toEqual({ yearLabel: '2026-27' });
    });

    it('selects only the year field', async () => {
      const chain = q({ year: '2026-27' });
      mockYearModel.findById.mockReturnValue(chain);

      await service.getYearLabelById(yearId);

      expect(chain.select).toHaveBeenCalledWith('year');
    });

    it('throws NotFoundException when the year does not exist', async () => {
      mockYearModel.findById.mockReturnValue(q(null));

      await expect(service.getYearLabelById(yearId)).rejects.toThrow(NotFoundException);
      await expect(service.getYearLabelById(yearId)).rejects.toThrow('Year not found');
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

    describe('xviFcBankAccount — ONCE_EVER-aware when the record belongs to an earlier design year', () => {
      it('falls back to a {ulb}-only lookup when the exact-year lookup finds nothing and submissionScope is ONCE_EVER, reporting the real status instead of NOT_STARTED', async () => {
        mockFormJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
        mockBankAccountModel.findOne.mockImplementation((filter: { designYear?: unknown }) =>
          filter.designYear ? q(null) : q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }),
        );

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.xviFcBankAccount).toEqual({
          form_status: 'UNDER_REVIEW_BY_STATE',
          form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE,
        });
        expect(mockBankAccountModel.findOne).toHaveBeenCalledWith({ ulb: new Types.ObjectId(ulbId) });
      });

      it('does not issue the fallback {ulb}-only lookup when the exact-year record already exists', async () => {
        mockFormJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
        mockBankAccountModel.findOne.mockReturnValue(q({ currentFormStatus: FORM_STATUS.APPROVED_BY_STATE }));

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.xviFcBankAccount.form_status_id).toBe(FORM_STATUS.APPROVED_BY_STATE);
        expect(mockBankAccountModel.findOne).toHaveBeenCalledTimes(1);
      });

      it('does not issue the fallback lookup when submissionScope is PER_YEAR or unconfigured - stays NOT_STARTED', async () => {
        // mockFormJsonConfigService default resolves null (PER_YEAR/unconfigured) - see beforeEach.
        mockBankAccountModel.findOne.mockReturnValue(q(null));

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.xviFcBankAccount).toEqual({ form_status: 'NOT_STARTED', form_status_id: FORM_STATUS.NOT_STARTED });
        expect(mockBankAccountModel.findOne).toHaveBeenCalledTimes(1);
      });
    });

    describe('serviceLevelBenchmarks — exemption-aware when no SLB document exists yet', () => {
      it('reports EXEMPTED_ACKNOWLEDGED when no SLB doc exists but the ULB is exempt', async () => {
        const ulb = { _id: new Types.ObjectId(ulbId), startYear: 2027, yearAccess: {} };
        const year = { _id: new Types.ObjectId(designYearId), year: '2027-28' };
        mockUlbModel.findById.mockReturnValue(q(ulb));
        mockYearModel.findById.mockReturnValue(q(year));
        mockExemptionResolverService.resolveBulk.mockResolvedValue(
          new Map([[String(ulb._id), { exempted: true, source: 'AUTOMATIC' }]]),
        );

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.serviceLevelBenchmarks).toEqual({
          form_status: 'EXEMPTED_ACKNOWLEDGED',
          form_status_id: FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
        });
        expect(mockExemptionResolverService.resolveBulk).toHaveBeenCalledWith([ulb], year, expect.any(Number));
      });

      it('reports NOT_STARTED when no SLB doc exists and the ULB is not exempt', async () => {
        const ulb = { _id: new Types.ObjectId(ulbId), startYear: null, yearAccess: {} };
        const year = { _id: new Types.ObjectId(designYearId), year: '2027-28' };
        mockUlbModel.findById.mockReturnValue(q(ulb));
        mockYearModel.findById.mockReturnValue(q(year));
        mockExemptionResolverService.resolveBulk.mockResolvedValue(
          new Map([[String(ulb._id), { exempted: false, source: null }]]),
        );

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.serviceLevelBenchmarks).toEqual({
          form_status: 'NOT_STARTED',
          form_status_id: FORM_STATUS.NOT_STARTED,
        });
      });

      it('reports NOT_STARTED without calling the exemption resolver when the ULB record cannot be found', async () => {
        mockUlbModel.findById.mockReturnValue(q(null));

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.serviceLevelBenchmarks).toEqual({
          form_status: 'NOT_STARTED',
          form_status_id: FORM_STATUS.NOT_STARTED,
        });
        expect(mockExemptionResolverService.resolveBulk).not.toHaveBeenCalled();
      });

      it('uses the real SLB document status as-is when one already exists, even for an exempt ULB — golden rule', async () => {
        mockSlbFormModel.findOne.mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }));

        const result = await service.getFormStatus(ulbId, designYearId);

        expect(result.serviceLevelBenchmarks).toEqual({
          form_status: 'UNDER_REVIEW_BY_STATE',
          form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE,
        });
        expect(mockUlbModel.findById).not.toHaveBeenCalled();
        expect(mockExemptionResolverService.resolveBulk).not.toHaveBeenCalled();
      });
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

  describe('clearSideMenuCache', () => {
    const adminUser: AuthUser = { ...mockUser, scope: Scope.ADMIN };
    const yearId = new Types.ObjectId().toHexString();

    it('rejects non-admin users', async () => {
      await expect(service.clearSideMenuCache({ ...mockUser, scope: Scope.STATE })).rejects.toThrow();
    });

    it('clears everything when both role and yearId are omitted', async () => {
      await service.clearSideMenuCache(adminUser);
      expect(mockSideMenuService.clearCache).toHaveBeenCalledWith(undefined, undefined);
    });

    it('passes role and yearId through unchanged', async () => {
      await service.clearSideMenuCache(adminUser, 'ULB', yearId);
      expect(mockSideMenuService.clearCache).toHaveBeenCalledWith('ULB', yearId);
    });

    it('reports how many entries were actually cleared', async () => {
      mockSideMenuService.clearCache.mockResolvedValue(2);
      const result = await service.clearSideMenuCache(adminUser, 'ULB', yearId);
      expect(result.message).toContain('Cleared 2');
    });

    it('says nothing was cleared when nothing matched', async () => {
      mockSideMenuService.clearCache.mockResolvedValue(0);
      const result = await service.clearSideMenuCache(adminUser, 'ULB', yearId);
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
