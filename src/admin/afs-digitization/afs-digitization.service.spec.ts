import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AfsDigitizationService } from './afs-digitization.service';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { AnnualAccountData } from 'src/schemas/annual-account-data.schema';
import { AfsExcelFile } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric } from 'src/schemas/afs/afs-metrics.schema';
import { DigitizationLog } from 'src/schemas/digitization-log.schema';
import { Types } from 'mongoose';

describe('AfsDigitizationService', () => {
  let service: AfsDigitizationService;
  let mockStateModel: any;
  let mockUlbModel: any;
  let mockYearModel: any;
  let mockAnnualAccountModel: any;
  let mockAfsExcelFileModel: any;
  let mockAfsMetricModel: any;
  let mockDigitizationModel: any;
  let mockQueue: any;

  beforeEach(async () => {
    mockStateModel = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([{ _id: 'state1', name: 'State 1' }]),
    };

    mockUlbModel = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ _id: 'ulb1', name: 'ULB 1', population: 50000 }]),
    };

    mockYearModel = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([{ _id: 'year1', year: 2021 }]),
    };

    mockAnnualAccountModel = {
      aggregate: jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValueOnce([{ _id: 'aa1', year: 2021 }])
          .mockResolvedValueOnce([{ count: 100 }]),
      }),
    };

    mockAfsExcelFileModel = {
      findById: jest.fn().mockResolvedValue({ _id: 'file1', name: 'file.xlsx' }),
    };

    mockAfsMetricModel = {
      findOne: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        digitizedFiles: 100,
        digitizedPages: 500,
        failedFiles: 5,
        failedPages: 10,
        queuedFiles: 2,
      }),
    };

    mockDigitizationModel = {
      findOne: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ RequestId: 'req1', status: 'completed' }),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AfsDigitizationService,
        {
          provide: getModelToken(State.name),
          useValue: mockStateModel,
        },
        {
          provide: getModelToken(Ulb.name),
          useValue: mockUlbModel,
        },
        {
          provide: getModelToken(Year.name),
          useValue: mockYearModel,
        },
        {
          provide: getModelToken(AnnualAccountData.name),
          useValue: mockAnnualAccountModel,
        },
        {
          provide: getModelToken(AfsExcelFile.name),
          useValue: mockAfsExcelFileModel,
        },
        {
          provide: getModelToken(AfsMetric.name),
          useValue: mockAfsMetricModel,
        },
        {
          provide: getModelToken(DigitizationLog.name, 'digitization_db'),
          useValue: mockDigitizationModel,
        },
        {
          provide: getQueueToken('afsDigitization'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<AfsDigitizationService>(AfsDigitizationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAfsFilters', () => {
    it('should return AFS filters with states, ULBs, years, and document types', async () => {
      const result = await service.getAfsFilters();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('states');
      expect(result.data).toHaveProperty('ulbs');
      expect(result.data).toHaveProperty('years');
      expect(result.data).toHaveProperty('populationCategories');
      expect(result.data).toHaveProperty('documentTypes');
      expect(result.data).toHaveProperty('auditTypes');
      expect(result.data).toHaveProperty('digitizationStatuses');
    });

    it('should fetch active and published states', async () => {
      await service.getAfsFilters();

      expect(mockStateModel.find).toHaveBeenCalledWith({ isActive: true, isPublish: true }, { _id: 1, name: 1 });
    });

    it('should fetch active and published ULBs', async () => {
      await service.getAfsFilters();

      expect(mockUlbModel.find).toHaveBeenCalledWith(
        { isActive: true, isPublish: true },
        { _id: 1, name: 1, population: 1, state: 1, code: 1 },
      );
    });

    it('should fetch active years', async () => {
      await service.getAfsFilters();

      expect(mockYearModel.find).toHaveBeenCalledWith({ isActive: true }, { _id: 1, year: 1 });
    });

    it('should handle errors when fetching filters', async () => {
      const error = new Error('Database error');
      mockStateModel.find.mockImplementation(() => {
        throw error;
      });

      await expect(service.getAfsFilters()).rejects.toThrow('Database error');
    });
  });

  describe('getMetrics', () => {
    it('should return metrics with cards', async () => {
      const result = await service.getMetrics();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('cards');
      expect(Array.isArray(result.data.cards)).toBe(true);
      expect(result.data.cards.length).toBeGreaterThan(0);
    });

    it('should calculate success percentage correctly', async () => {
      const result = await service.getMetrics();

      const successCard = result.data.cards.find((card: any) => card.title === 'Successful');
      expect(successCard).toBeDefined();
      expect(successCard.value).toBe('95%'); // 100 / (100 + 5) * 100
    });

    it('should return 0% success when no files processed', async () => {
      mockAfsMetricModel.lean.mockResolvedValue({
        digitizedFiles: 0,
        failedFiles: 0,
      });

      const result = await service.getMetrics();

      const successCard = result.data.cards.find((card: any) => card.title === 'Successful');
      expect(successCard.value).toBe('0%');
    });

    it('should handle missing metric data', async () => {
      mockAfsMetricModel.lean.mockResolvedValue(null);

      const result = await service.getMetrics();

      expect(result.data.cards).toBeDefined();
      const digitizedCard = result.data.cards.find((card: any) => card.title === 'Files Digitized');
      expect(digitizedCard.value).toBe(0);
    });
  });

  describe('getUlbs', () => {
    it('should return ULBs for a population category', async () => {
      const params = { populationCategory: '100K-500K' };

      const result = await service.getUlbs(params);

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should fetch active and published ULBs', async () => {
      const params = { populationCategory: 'all' };

      await service.getUlbs(params);

      expect(mockUlbModel.find).toHaveBeenCalled();
    });

    it('should apply sort by name', async () => {
      const params = { populationCategory: 'all' };

      await service.getUlbs(params);

      expect(mockUlbModel.sort).toHaveBeenCalledWith({ name: 1 });
    });

    it('should apply limit parameter', async () => {
      const params = { populationCategory: '100K-500K', limit: 100 };

      await service.getUlbs(params);

      expect(mockUlbModel.limit).toHaveBeenCalledWith(100);
    });

    it('should default limit to 2000', async () => {
      const params = { populationCategory: 'all' };

      await service.getUlbs(params);

      expect(mockUlbModel.limit).toHaveBeenCalledWith(2000);
    });
  });

  describe('getFile', () => {
    it('should return file by ID', async () => {
      const fileId = 'file-123';
      mockAfsExcelFileModel.findById.mockResolvedValue({ _id: fileId, name: 'file.xlsx' });

      const result = await service.getFile(fileId);

      expect(result).toHaveProperty('_id', fileId);
      expect(mockAfsExcelFileModel.findById).toHaveBeenCalledWith(fileId);
    });

    it('should handle file not found', async () => {
      mockAfsExcelFileModel.findById.mockResolvedValue(null);

      const result = await service.getFile('non-existent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      mockAfsExcelFileModel.findById.mockRejectedValue(error);

      await expect(service.getFile('file-id')).rejects.toThrow('Database connection failed');
    });
  });

  describe('afsList', () => {
    it('should return AFS list with data and total count', async () => {
      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      const result = await service.afsList(query as any);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('totalCount');
    });

    it('should call aggregate with query', async () => {
      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      await service.afsList(query as any);

      expect(mockAnnualAccountModel.aggregate).toHaveBeenCalled();
    });

    it('should handle aggregation results', async () => {
      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      const result = await service.afsList(query as any);

      expect(Array.isArray(result.data)).toBe(true);
      expect(typeof result.totalCount).toBe('number');
    });
  });

  describe('getRequestLog', () => {
    it('should return digitization log for request ID', async () => {
      const requestId = 'req-123';
      mockDigitizationModel.findOne.mockReturnThis();
      mockDigitizationModel.exec.mockResolvedValue({
        RequestId: requestId,
        status: 'completed',
      });

      const result = await service.getRequestLog(requestId);

      expect(result).toBeDefined();
      expect(result.RequestId).toBe(requestId);
      expect(mockDigitizationModel.findOne).toHaveBeenCalledWith({ RequestId: requestId });
    });

    it('should return null when log not found', async () => {
      mockDigitizationModel.findOne.mockReturnThis();
      mockDigitizationModel.exec.mockResolvedValue(null);

      const result = await service.getRequestLog('non-existent');

      expect(result).toBeNull();
    });

    it('should call findOne with correct parameters', async () => {
      const requestId = 'req-id-123';
      mockDigitizationModel.findOne.mockReturnThis();
      mockDigitizationModel.exec.mockResolvedValue({});

      await service.getRequestLog(requestId);

      expect(mockDigitizationModel.findOne).toHaveBeenCalledWith({ RequestId: requestId });
    });
  });
});
