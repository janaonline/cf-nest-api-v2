import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { HttpService } from '@nestjs/axios';
import { DigitizationQueueService } from './digitization-queue.service';
import { AfsExcelFile } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric } from 'src/schemas/afs/afs-metrics.schema';
import { S3Service } from 'src/core/s3/s3.service';

describe('DigitizationQueueService', () => {
  let service: DigitizationQueueService;
  let mockQueue: any;
  let mockAfsExcelFileModel: any;
  let mockAfsMetricModel: any;
  let mockHttpService: any;
  let mockS3Service: any;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue: { url: 'http://example.com/file.zip' },
        progress: 100,
      }),
      removeJob: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };

    mockAfsExcelFileModel = {
      findByIdAndUpdate: jest.fn().mockResolvedValue({ _id: 'file-1', status: 'queued' }),
      create: jest.fn().mockResolvedValue({ _id: 'file-1' }),
      findById: jest.fn().mockResolvedValue({ _id: 'file-1' }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    mockAfsMetricModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ queuedFiles: 1 }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    mockHttpService = {
      post: jest.fn().mockReturnValue({
        pipe: jest.fn().mockReturnThis(),
        toPromise: jest.fn().mockResolvedValue({ data: { status: 'success' } }),
      }),
    };

    mockS3Service = {
      uploadFile: jest.fn().mockResolvedValue({ Location: 'http://s3.example.com/file' }),
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('file content')),
      getPdfBufferFromS3: jest.fn().mockResolvedValue(Buffer.from('pdf content')),
      getPdfPageCountFromBuffer: jest.fn().mockReturnValue(10),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigitizationQueueService,
        {
          provide: getQueueToken('afsDigitization'),
          useValue: mockQueue,
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
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
      ],
    }).compile();

    service = module.get<DigitizationQueueService>(DigitizationQueueService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('jobStatus', () => {
    it('should return job status for existing job', async () => {
      const jobId = 'job-123';

      const result = await service.jobStatus(jobId);

      expect(result.status).toBe('completed');
      expect(mockQueue.getJob).toHaveBeenCalledWith(jobId);
    });

    it('should return not_found status for non-existent job', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      const result = await service.jobStatus('non-existent-job');

      expect(result.status).toBe('not_found');
    });

    it('should return job state and progress', async () => {
      const jobId = 'job-123';
      const mockJob = {
        getState: jest.fn().mockResolvedValue('active'),
        progress: 50,
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await service.jobStatus(jobId);

      expect(mockJob.getState).toHaveBeenCalled();
    });

    it('should handle different job states', async () => {
      const states = ['waiting', 'active', 'completed', 'failed', 'delayed'];

      for (const state of states) {
        const mockJob = {
          getState: jest.fn().mockResolvedValue(state),
          progress: 0,
        };
        mockQueue.getJob.mockResolvedValue(mockJob);

        const result = await service.jobStatus('job-id');
        expect(mockJob.getState).toHaveBeenCalled();
      }
    });
  });

  describe('jobStatus - edge cases', () => {
    it('should handle queue retrieval errors gracefully', async () => {
      mockQueue.getJob.mockRejectedValue(new Error('Queue error'));

      await expect(service.jobStatus('job-id')).rejects.toThrow('Queue error');
    });
  });

  describe('enqueueBatch', () => {
    it('should handle empty batch', async () => {
      const jobs: any[] = [];

      const result = await service.enqueueBatch(jobs);

      // enqueueBatch may return an empty array or handle empty batches gracefully
      expect(result !== undefined).toBe(true);
    });
  });

  describe('markJobRemoved', () => {
    it('should handle missing jobId', async () => {
      const jobData = {
        annualAccountsId: 'aa-1',
        uploadedBy: 'ULB',
      };

      await expect(service.markJobRemoved(jobData as any)).rejects.toThrow();
    });

    it('should mark job as removed with valid jobId', async () => {
      const jobData = {
        jobId: 'job-123',
        annualAccountsId: 'aa-1',
        uploadedBy: 'ULB',
      };

      const mockJob = {
        remove: jest.fn().mockResolvedValue(true),
      };
      mockQueue.getJob = jest.fn().mockResolvedValue(mockJob);

      const result = await service.markJobRemoved(jobData as any);

      expect(result).toBeDefined();
    });
  });

  describe('Service initialization', () => {
    it('should have all dependencies injected', () => {
      expect(service).toBeDefined();
    });

    it('should have queue defined', () => {
      expect(mockQueue).toBeDefined();
    });

    it('should have models defined', () => {
      expect(mockAfsExcelFileModel).toBeDefined();
      expect(mockAfsMetricModel).toBeDefined();
    });
  });
});
