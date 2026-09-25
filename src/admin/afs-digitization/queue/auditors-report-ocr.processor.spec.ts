import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { Job } from 'bullmq';
import { AuditorsReportOcrProcessor } from './auditors-report-ocr.processor';
import { AuditorsReportOcrQueueService } from './auditors-report-ocr-queue/auditors-report-ocr-queue.service';
import { DigitizationUploadedBy, DigitizationJobDto } from '../dto/digitization-job.dto';

describe('AuditorsReportOcrProcessor', () => {
  let processor: AuditorsReportOcrProcessor;
  let mockOcrService: { handleAuditorsReportOcrJob: jest.Mock };
  let mockHttp: { post: jest.Mock };

  const makeJob = (overrides: Partial<DigitizationJobDto> = {}): Job<DigitizationJobDto> =>
    ({
      id: 'job-001',
      data: {
        pdfUrl: 'afs/auditor_report/ulb1_2021_ANNUAL_auditor_report.pdf',
        requestId: 'req-20250501-abc123',
        ulb: '6402dd7803b5a6b6c2cb6d43',
        year: '6402dd7803b5a6b6c2cb6d44',
        auditType: 'ANNUAL',
        docType: 'auditor_report',
        uploadedBy: DigitizationUploadedBy.AFS,
        ...overrides,
      },
    }) as unknown as Job<DigitizationJobDto>;

  beforeEach(async () => {
    mockOcrService = { handleAuditorsReportOcrJob: jest.fn().mockResolvedValue(undefined) };
    mockHttp = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditorsReportOcrProcessor,
        { provide: HttpService, useValue: mockHttp },
        { provide: AuditorsReportOcrQueueService, useValue: mockOcrService },
      ],
    }).compile();

    processor = module.get<AuditorsReportOcrProcessor>(AuditorsReportOcrProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should delegate the job to the OCR queue service', async () => {
      const job = makeJob();
      await processor.process(job);

      expect(mockOcrService.handleAuditorsReportOcrJob).toHaveBeenCalledTimes(1);
      expect(mockOcrService.handleAuditorsReportOcrJob).toHaveBeenCalledWith(job.data);
    });

    it('should propagate errors thrown by the OCR queue service', async () => {
      const job = makeJob();
      mockOcrService.handleAuditorsReportOcrJob.mockRejectedValue(new Error('OCR processing failed'));

      await expect(processor.process(job)).rejects.toThrow('OCR processing failed');
    });
  });

  describe('handleDigitizationJob_test', () => {
    it('should resolve with the last emitted value from the delayed observable', async () => {
      jest.useFakeTimers();
      const resultPromise = processor.handleDigitizationJob_test();
      jest.advanceTimersByTime(5000);
      const result = await resultPromise;

      expect(result).toBe('A');
      jest.useRealTimers();
    });
  });
});
