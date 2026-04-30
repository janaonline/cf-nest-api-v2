import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { XviFcService } from './xvi-fc.service';
import { GrantAllocation } from './schemas/grant-allocation.schema';

describe('XviFcService', () => {
  let service: XviFcService;
  let mockGrantAllocationModel: { aggregate: jest.Mock };

  beforeEach(async () => {
    mockGrantAllocationModel = {
      aggregate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XviFcService,
        {
          provide: getModelToken(GrantAllocation.name),
          useValue: mockGrantAllocationModel,
        },
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
      const result = await service.getStateWiseData(stateId);
      expect(result).toEqual(mockResult);
      expect(mockGrantAllocationModel.aggregate).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when no data found', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([]);
      await expect(service.getStateWiseData(stateId)).rejects.toThrow(NotFoundException);
      await expect(service.getStateWiseData(stateId)).rejects.toThrow(
        'No grant allocation data found for this state',
      );
    });

    it('should call aggregate with a pipeline array', async () => {
      mockGrantAllocationModel.aggregate.mockResolvedValue([mockResult]);
      await service.getStateWiseData(stateId);
      const [pipeline] = mockGrantAllocationModel.aggregate.mock.calls[0];
      expect(Array.isArray(pipeline)).toBe(true);
    });
  });

  describe('getSideMenu', () => {
    it('should return ULB side menu', async () => {
      const result = await service.getSideMenu('ULB', 'year1');
      expect(result).toHaveProperty('topModel');
      expect(result).toHaveProperty('bottomModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return STATE side menu', async () => {
      const result = await service.getSideMenu('STATE', 'year1');
      expect(result).toHaveProperty('topModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return MOHUA side menu', async () => {
      const result = await service.getSideMenu('MOHUA', 'year1');
      expect(result).toHaveProperty('topModel');
    });

    it('should return DOE side menu', async () => {
      const result = await service.getSideMenu('DOE', 'year1');
      expect(result).toHaveProperty('topModel');
    });

    it('should throw NotFoundException for unknown role', async () => {
      await expect(service.getSideMenu('UNKNOWN' as any, 'year1')).rejects.toThrow(NotFoundException);
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
