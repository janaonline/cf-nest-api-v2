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
import { XviFcSideMenu } from '../../schemas/xvi-fc/xvi-fc-side-menu.schema';
import { XviFcAnnualAccount, AnnualAccountFormStatus, FORM_STATUS_ID } from '../../schemas/xvi-fc/annual-account.schema';
import { XviFcUnspentBalanceDisclosure } from '../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import { XviFcBankAccount } from '../../schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { XviFcCacheService } from './cache/xvi-fc-cache.service';
import { FormJsonService } from '../../form-json/form-json.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

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
  let mockAnnualAccountModel: { findOne: jest.Mock };
  let mockDisclosureModel: { findOne: jest.Mock };
  let mockBankAccountModel: { findOne: jest.Mock };

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
    mockAnnualAccountModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockDisclosureModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    mockBankAccountModel = { findOne: jest.fn().mockReturnValue(q(null)) };

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
        { provide: getModelToken(XviFcSideMenu.name), useValue: mockSideMenuModel },
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcUnspentBalanceDisclosure.name), useValue: mockDisclosureModel },
        { provide: getModelToken(XviFcBankAccount.name), useValue: mockBankAccountModel },
        { provide: XviFcCacheService, useValue: { deleteByPattern: jest.fn() } },
        { provide: FormJsonService, useValue: { clearCache: jest.fn() } },
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
    const mockResult = { stateId, grants: [] };

    it('should return state wise data when found', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      const result = await service.getStateWiseData(stateId, mockUser);
      expect(result).toEqual(mockResult);
      expect(mockGrantAllocationModel.aggregate).toHaveBeenCalledTimes(1);
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
      mockSideMenuModel.find.mockReturnValue(q([{ _id: new Types.ObjectId(), label: 'Overview', section: 'top', type: 'item', sequence: 1 }]));
      const result = await service.getSideMenu('ULB', yearId);
      expect(result).toHaveProperty('topModel');
      expect(result).toHaveProperty('bottomModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return STATE side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(q([{ _id: new Types.ObjectId(), label: 'Overview', section: 'top', type: 'item', sequence: 1 }]));
      const result = await service.getSideMenu('STATE', yearId);
      expect(result).toHaveProperty('topModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return MOHUA side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(q([{ _id: new Types.ObjectId(), label: 'Overview', section: 'top', type: 'item', sequence: 1 }]));
      const result = await service.getSideMenu('MOHUA', yearId);
      expect(result).toHaveProperty('topModel');
    });

    it('should return DOE side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(q([{ _id: new Types.ObjectId(), label: 'Overview', section: 'top', type: 'item', sequence: 1 }]));
      const result = await service.getSideMenu('DOE', yearId);
      expect(result).toHaveProperty('topModel');
    });

    it('should throw NotFoundException for unknown role', async () => {
      await expect(service.getSideMenu('UNKNOWN' as any, yearId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFormStatus', () => {
    const ulbId = new Types.ObjectId().toString();
    const designYearId = new Types.ObjectId().toString();

    it('returns xviFcBankAccount as NOT_STARTED when no bank-account record exists', async () => {
      const result = await service.getFormStatus(ulbId, designYearId);

      expect(result.xviFcBankAccount).toEqual({
        currentFormStatus: FORM_STATUS.NOT_STARTED,
        currentFormStatusLabel: 'Not Started',
        form_status_id: null,
      });
    });

    it('returns xviFcBankAccount with stored currentFormStatus when record exists', async () => {
      mockBankAccountModel.findOne.mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }));

      const result = await service.getFormStatus(ulbId, designYearId);

      expect(result.xviFcBankAccount).toEqual({
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
        currentFormStatusLabel: 'Under Review by State',
        form_status_id: null,
      });
    });

    it('preserves existing form-status response fields', async () => {
      const annualAccountId = new Types.ObjectId();
      mockAnnualAccountModel.findOne.mockReturnValue(
        q({
          _id: annualAccountId,
          auditedData: {
            form_status: AnnualAccountFormStatus.IN_PROGRESS,
            form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
          },
          unauditedData: {
            form_status: AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
            form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
          },
        }),
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
      expect(result.xviFcBankAccount.currentFormStatus).not.toBe('SUBMITTED');
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
