import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { XviFcController } from './xvi-fc.controller';
import { XviFcService } from './xvi-fc.service';

describe('XviFcController', () => {
  let controller: XviFcController;
  let service: jest.Mocked<XviFcService>;

  const mockStateWiseData = { stateId: 'state1', grants: [] };
  const mockSideMenu = { topModel: [], bottomModel: [] };
  const mockSupportHours = {
    nextSupportHour: {
      date: 'Thursday, 1 May 2025',
      description: 'Open Q&A',
      time: '3:00 PM - 4:00 PM IST',
      hostedBy: 'CityFinance Team',
    },
    upcomingSupportHours: [
      { date: '8 May 2025', details: 'Open support hour', status: 'UPCOMING' as const },
    ],
  };

  beforeEach(async () => {
    const mockXviFcService = {
      getStateWiseData: jest.fn(),
      getSideMenu: jest.fn(),
      getSupportHours: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [XviFcController],
      providers: [{ provide: XviFcService, useValue: mockXviFcService }],
    }).compile();

    controller = module.get<XviFcController>(XviFcController);
    service = module.get(XviFcService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStateWiseData', () => {
    const stateId = new Types.ObjectId().toHexString();

    it('should call service with stateId and return result', async () => {
      service.getStateWiseData.mockResolvedValue(mockStateWiseData as any);
      const result = await controller.getStateWiseData(stateId);
      expect(service.getStateWiseData).toHaveBeenCalledWith(stateId);
      expect(result).toEqual(mockStateWiseData);
    });

    it('should propagate NotFoundException from service', async () => {
      service.getStateWiseData.mockRejectedValue(new NotFoundException('No grant allocation data found'));
      await expect(controller.getStateWiseData(stateId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSideMenu', () => {
    it('should call service with role and yearId and return result', async () => {
      service.getSideMenu.mockResolvedValue(mockSideMenu as any);
      const result = await controller.getSideMenu('ULB', 'year1');
      expect(service.getSideMenu).toHaveBeenCalledWith('ULB', 'year1');
      expect(result).toEqual(mockSideMenu);
    });

    it('should propagate NotFoundException for unknown role', async () => {
      service.getSideMenu.mockRejectedValue(new NotFoundException('No menu found'));
      await expect(controller.getSideMenu('UNKNOWN' as any, 'year1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSupportHours', () => {
    it('should call service and return support hours', () => {
      service.getSupportHours.mockReturnValue(mockSupportHours as any);
      const result = controller.getSupportHours();
      expect(service.getSupportHours).toHaveBeenCalled();
      expect(result).toEqual(mockSupportHours);
    });
  });
});
