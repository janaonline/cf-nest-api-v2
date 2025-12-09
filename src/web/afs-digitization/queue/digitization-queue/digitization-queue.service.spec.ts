import { Test, TestingModule } from '@nestjs/testing';
import { DigitizationQueueService } from './digitization-queue.service';
import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { DigitizationLog } from 'src/schemas/digitization-log.schema';

describe('DigitizationQueueService', () => {
  let service: DigitizationQueueService;
  let mockDigitizationLogModel: any;

  const mockQueue = {
    add: jest.fn(),
    addBulk: jest.fn(),
    getJob: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  beforeEach(async () => {
    mockDigitizationLogModel = {
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigitizationQueueService,
        {
          provide: getQueueToken('afsDigitization'),
          useValue: mockQueue,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: getModelToken(DigitizationLog.name, 'digitization_db'),
          useValue: mockDigitizationLogModel,
        },
      ],
    }).compile();

    service = module.get<DigitizationQueueService>(DigitizationQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('saveDigitizationLog', () => {
    it('should save digitization log successfully', async () => {
      const mockRespData = {
        request_id: 'test-request-id-123',
        S3_Excel_Storage_Link: 'https://s3.amazonaws.com/test-bucket/test-file.xlsx',
        Message: 'Test digitization completed',
        TotalProcessingTimeMs: 5000,
        FinalStatusCode: 200,
      };

      const mockJob = {
        fileUrl: 'https://test.com/test.pdf',
      };

      await service.saveDigitizationLog(mockRespData, mockJob as any);

      expect(mockDigitizationLogModel.updateOne).toHaveBeenCalledWith(
        { RequestId: 'test-request-id-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            RequestId: 'test-request-id-123',
            DigitizedExcelUrl: 'https://s3.amazonaws.com/test-bucket/test-file.xlsx',
            SourcePDFUrl: 'https://test.com/test.pdf',
            Message: 'Test digitization completed',
            TotalProcessingTimeMs: 5000,
            FinalStatusCode: 200,
          }),
        }),
        { upsert: true },
      );
    });

    it('should handle errors gracefully', async () => {
      mockDigitizationLogModel.updateOne.mockRejectedValueOnce(new Error('Database error'));

      const mockRespData = {
        request_id: 'test-request-id-456',
      };

      const mockJob = {
        fileUrl: 'https://test.com/test.pdf',
      };

      // Should not throw error
      await expect(service.saveDigitizationLog(mockRespData, mockJob as any)).resolves.not.toThrow();
    });
  });
});
