import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { DigitizationProcessor } from './digitization.processor';
import { DigitizationQueueService } from './digitization-queue/digitization-queue.service';
import { DigitizationUploadedBy, DigitizationJobDto } from '../dto/digitization-job.dto';

describe('DigitizationProcessor', () => {
  let processor: DigitizationProcessor;
  let mockDigitizationQueueService: { handleDigitizationJob: jest.Mock };

  const makeJob = (overrides: Partial<DigitizationJobDto> = {}): Job<DigitizationJobDto> =>
    ({
      id: 'job-123',
      data: {
        pdfUrl: 'https://example.com/annual.pdf',
        ulb: '5eb5844f76a3b61f40ba069e',
        year: '606aadac4dff55e6c075c507',
        auditType: 'audited',
        docType: 'bal_sheet',
        uploadedBy: DigitizationUploadedBy.ULB,
        ...overrides,
      },
    }) as unknown as Job<DigitizationJobDto>;

  beforeEach(async () => {
    mockDigitizationQueueService = { handleDigitizationJob: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigitizationProcessor,
        { provide: DigitizationQueueService, useValue: mockDigitizationQueueService },
      ],
    }).compile();

    processor = module.get<DigitizationProcessor>(DigitizationProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should delegate the job to the digitization queue service', async () => {
      const job = makeJob();
      await processor.process(job);

      expect(mockDigitizationQueueService.handleDigitizationJob).toHaveBeenCalledTimes(1);
      expect(mockDigitizationQueueService.handleDigitizationJob).toHaveBeenCalledWith(job.data);
    });

    it('should propagate errors thrown by the digitization queue service', async () => {
      const job = makeJob();
      mockDigitizationQueueService.handleDigitizationJob.mockRejectedValue(new Error('digitization failed'));

      await expect(processor.process(job)).rejects.toThrow('digitization failed');
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
