import { Test, TestingModule } from '@nestjs/testing';
import { DigitizationQueueService } from './digitization-queue.service';
import { getQueueToken } from '@nestjs/bullmq';
import { HttpService } from '@nestjs/axios';
import { getModelToken } from '@nestjs/mongoose';
import { DigitizationLog } from 'src/schemas/digitization-log.schema';
import { DigitizationResponseDto } from '../../dto/digitization-response.dto';

describe('DigitizationQueueService', () => {
  let service: DigitizationQueueService;
  let mockDigitizationLogModel: any;

  beforeEach(async () => {
    const mockQueue = {
      add: jest.fn(),
      addBulk: jest.fn(),
      getJob: jest.fn(),
    };

    const mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
    };

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

  describe('saveDigitizationResponse', () => {
    it('should save digitization response with all fields', async () => {
      const mockResponseData: DigitizationResponseDto = {
        request_id: 'test-request-123',
        S3_Excel_Storage_Link: 'https://s3.amazonaws.com/bucket/file.xlsx',
        Message: 'Digitization completed successfully',
        PDFUpload_Status: 'success',
        PDFUpload_StatusCode: 200,
        TotalProcessingTimeMs: 5000,
        FinalStatusCode: 200,
      };

      const sourceUrl = 'https://example.com/source.pdf';

      await service.saveDigitizationResponse(mockResponseData, sourceUrl);

      expect(mockDigitizationLogModel.updateOne).toHaveBeenCalledWith(
        { RequestId: 'test-request-123' },
        {
          $set: expect.objectContaining({
            RequestId: 'test-request-123',
            SourcePDFUrl: sourceUrl,
            DigitizedExcelUrl: 'https://s3.amazonaws.com/bucket/file.xlsx',
            Message: 'Digitization completed successfully',
            PDFUpload_Status: 'success',
            PDFUpload_StatusCode: 200,
            TotalProcessingTimeMs: 5000,
            FinalStatusCode: 200,
          }),
        },
        { upsert: true }
      );
    });

    it('should handle missing optional fields gracefully', async () => {
      const mockResponseData: DigitizationResponseDto = {
        request_id: 'test-request-456',
        S3_Excel_Storage_Link: 'https://s3.amazonaws.com/bucket/file2.xlsx',
      };

      const sourceUrl = 'https://example.com/source2.pdf';

      await service.saveDigitizationResponse(mockResponseData, sourceUrl);

      expect(mockDigitizationLogModel.updateOne).toHaveBeenCalledWith(
        { RequestId: 'test-request-456' },
        {
          $set: expect.objectContaining({
            RequestId: 'test-request-456',
            SourcePDFUrl: sourceUrl,
            DigitizedExcelUrl: 'https://s3.amazonaws.com/bucket/file2.xlsx',
          }),
        },
        { upsert: true }
      );
    });

    it('should not throw error if database save fails', async () => {
      mockDigitizationLogModel.updateOne.mockRejectedValue(new Error('Database error'));

      const mockResponseData: DigitizationResponseDto = {
        request_id: 'test-request-789',
        S3_Excel_Storage_Link: 'https://s3.amazonaws.com/bucket/file3.xlsx',
      };

      await expect(
        service.saveDigitizationResponse(mockResponseData, 'https://example.com/source3.pdf')
      ).resolves.not.toThrow();
    });

    it('should save all metrics fields when provided', async () => {
      const mockResponseData: DigitizationResponseDto = {
        request_id: 'test-request-full',
        S3_Excel_Storage_Link: 'https://s3.amazonaws.com/bucket/full.xlsx',
        PDFUpload_Status: 'success',
        PDFUpload_StatusCode: 200,
        PDFUpload_FileName: 'test.pdf',
        PDFUpload_FileType: 'application/pdf',
        PDFUpload_FileSize_In_Bytes: 1024000,
        PDFQualityCheck_Status: 'success',
        PDFQualityCheck_StatusCode: 200,
        PDFQualityCheck_ProcessingTimeMs: 500,
        PDFQualityCheck_BlurScore: 0.95,
        OCR_Status: 'success',
        OCR_StatusCode: 200,
        OCR_ProcessingTimeMs: 2000,
        ExcelGeneration_Status: 'success',
        ExcelGeneration_StatusCode: 200,
        ExcelGeneration_ProcessingTimeMs: 1500,
        TotalProcessingTimeMs: 5000,
        ProcessingMode: 'direct',
        RetryCount: 0,
        FinalStatusCode: 200,
      };

      await service.saveDigitizationResponse(mockResponseData, 'https://example.com/full.pdf');

      expect(mockDigitizationLogModel.updateOne).toHaveBeenCalledWith(
        { RequestId: 'test-request-full' },
        {
          $set: expect.objectContaining({
            RequestId: 'test-request-full',
            PDFUpload_FileName: 'test.pdf',
            PDFUpload_FileSize_In_Bytes: 1024000,
            PDFQualityCheck_BlurScore: 0.95,
            OCR_ProcessingTimeMs: 2000,
            ExcelGeneration_ProcessingTimeMs: 1500,
            TotalProcessingTimeMs: 5000,
            ProcessingMode: 'direct',
          }),
        },
        { upsert: true }
      );
    });
  });
});
