import { Test, TestingModule } from '@nestjs/testing';
import { AfsDigitizationController } from './afs-digitization.controller';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { DigitizationQueueService } from './queue/digitization-queue/digitization-queue.service';
import { Response } from 'express';

describe('AfsDigitizationController', () => {
  let controller: AfsDigitizationController;
  let afsService: jest.Mocked<AfsDigitizationService>;
  let afsDumpService: jest.Mocked<AfsDumpService>;
  let digitizationQueueService: jest.Mocked<DigitizationQueueService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AfsDigitizationController],
      providers: [
        {
          provide: AfsDigitizationService,
          useValue: {
            getAfsFilters: jest.fn(),
            getUlbs: jest.fn(),
            afsList: jest.fn(),
            getRequestLog: jest.fn(),
            getMetrics: jest.fn(),
            getFile: jest.fn(),
          },
        },
        {
          provide: AfsDumpService,
          useValue: {
            exportAfsExcelFiles: jest.fn(),
          },
        },
        {
          provide: DigitizationQueueService,
          useValue: {
            upsertAfsExcelFile: jest.fn(),
            handleDigitizationJob: jest.fn(),
            enqueueBatch: jest.fn(),
            jobStatus: jest.fn(),
            markJobRemoved: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AfsDigitizationController>(AfsDigitizationController);
    afsService = module.get(AfsDigitizationService);
    afsDumpService = module.get(AfsDumpService);
    digitizationQueueService = module.get(DigitizationQueueService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAfsFilters', () => {
    it('should return AFS filters', async () => {
      const mockFilters = { docTypes: ['bal_sheet', 'inc_exp'], states: ['state1'] };
      afsService.getAfsFilters.mockResolvedValue(mockFilters);

      const result = await controller.getAfsFilters();

      expect(result).toEqual(mockFilters);
      expect(afsService.getAfsFilters).toHaveBeenCalled();
    });

    it('should handle error when fetching filters', async () => {
      const error = new Error('Database error');
      afsService.getAfsFilters.mockRejectedValue(error);

      await expect(controller.getAfsFilters()).rejects.toThrow('Database error');
    });
  });

  describe('getUlbs', () => {
    it('should return ULBs for a population category', async () => {
      const mockUlbs = [{ id: 'ulb1', name: 'ULB 1' }];
      const query = { populationCategory: '100K-500K' };
      afsService.getUlbs.mockResolvedValue(mockUlbs);

      const result = await controller.getUlbs(query);

      expect(result).toEqual(mockUlbs);
      expect(afsService.getUlbs).toHaveBeenCalledWith(query);
    });

    it('should handle error when fetching ULBs', async () => {
      const query = { populationCategory: 'invalid' };
      const error = new Error('Invalid population category');
      afsService.getUlbs.mockRejectedValue(error);

      await expect(controller.getUlbs(query)).rejects.toThrow('Invalid population category');
    });
  });

  describe('afsList', () => {
    it('should return AFS list with pagination', async () => {
      const mockBody = {
        yearId: '65a7dd50b0c7e600128b1234',
        docType: 'bal_sheet',
        page: 1,
        pageSize: 10,
      };
      const mockResult = {
        data: [{ id: 'afs1', name: 'AFS 1' }],
        total: 100,
        page: 1,
      };
      afsService.afsList.mockResolvedValue(mockResult);

      const result = await controller.afsList(mockBody as any);

      expect(result).toEqual(mockResult);
      expect(afsService.afsList).toHaveBeenCalledWith(mockBody);
    });

    it('should handle error when fetching AFS list', async () => {
      const mockBody = { yearId: 'invalid' };
      const error = new Error('Invalid year ID');
      afsService.afsList.mockRejectedValue(error);

      await expect(controller.afsList(mockBody as any)).rejects.toThrow('Invalid year ID');
    });
  });

  describe('getRequestLog', () => {
    it('should return request log for given request ID', async () => {
      const requestId = '65a7dd50b0c7e600128b1234';
      const mockLog = { status: 'completed', timestamp: new Date() };
      afsService.getRequestLog.mockResolvedValue(mockLog);

      const result = await controller.getRequestLog(requestId);

      expect(result).toEqual({ data: mockLog });
      expect(afsService.getRequestLog).toHaveBeenCalledWith(requestId);
    });

    it('should return empty data when log not found', async () => {
      const requestId = 'non-existent-id';
      afsService.getRequestLog.mockResolvedValue(null);

      const result = await controller.getRequestLog(requestId);

      expect(result).toEqual({ data: null });
    });
  });

  describe('downloadAfsExcelFiles', () => {
    it('should download AFS Excel files', async () => {
      const query = {
        yearId: '65a7dd50b0c7e600128b1234',
        docType: 'bal_sheet',
      };
      const mockBuffer = Buffer.from('mock excel data');
      afsDumpService.exportAfsExcelFiles.mockResolvedValue(mockBuffer);

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.downloadAfsExcelFiles(query as any, mockResponse);

      expect(afsDumpService.exportAfsExcelFiles).toHaveBeenCalledWith(query);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment; filename='),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockBuffer);
    });

    it('should handle error during file export', async () => {
      const query = { yearId: 'invalid', docType: 'bal_sheet' };
      const error = new Error('Export failed');
      afsDumpService.exportAfsExcelFiles.mockRejectedValue(error);

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await expect(controller.downloadAfsExcelFiles(query as any, mockResponse)).rejects.toThrow('Export failed');
    });
  });

  describe('uploadAFSFile', () => {
    it('should upload AFS file successfully', async () => {
      const mockBody = {
        annualAccountsId: '65a7dd50b0c7e600128b1234',
        ulbId: '65a7dd50b0c7e600128b5678',
      };
      const mockResult = { id: 'file-id', status: 'uploaded' };
      digitizationQueueService.upsertAfsExcelFile.mockResolvedValue(mockResult);

      const result = await controller.uploadAFSFile(mockBody as any);

      expect(result).toEqual({ status: 'success', data: mockResult });
      expect(digitizationQueueService.upsertAfsExcelFile).toHaveBeenCalledWith(mockBody);
    });

    it('should handle error during file upload', async () => {
      const mockBody = { annualAccountsId: 'invalid' };
      const error = new Error('Upload failed');
      digitizationQueueService.upsertAfsExcelFile.mockRejectedValue(error);

      await expect(controller.uploadAFSFile(mockBody as any)).rejects.toThrow('Upload failed');
    });
  });

  describe('digitize', () => {
    it('should queue digitization job', async () => {
      const mockBody = {
        annualAccountsId: '65a7dd50b0c7e600128b1234',
        ulbId: '65a7dd50b0c7e600128b5678',
      };
      const mockResult = { jobId: 'job-123', status: 'queued' };
      digitizationQueueService.handleDigitizationJob.mockResolvedValue(mockResult);

      const result = await controller.digitize(mockBody as any);

      expect(result.status).toBe('queued');
      expect(digitizationQueueService.handleDigitizationJob).toHaveBeenCalledWith(mockBody);
    });

    it('should handle error during job queueing', async () => {
      const mockBody = { annualAccountsId: 'invalid' };
      const error = new Error('Queueing failed');
      digitizationQueueService.handleDigitizationJob.mockRejectedValue(error);

      await expect(controller.digitize(mockBody as any)).rejects.toThrow('Queueing failed');
    });
  });

  describe('enqueueBatch', () => {
    it('should enqueue batch of digitization jobs', async () => {
      const mockBody = {
        jobs: [
          {
            annualAccountsId: '65a7dd50b0c7e600128b1234',
            ulbId: '65a7dd50b0c7e600128b5678',
          },
        ],
      };
      const mockResult = [{ jobId: 'job-123', status: 'queued' }];
      digitizationQueueService.enqueueBatch.mockResolvedValue(mockResult);

      const result = await controller.enqueueBatch(mockBody as any);

      expect(result.status).toBe('queued');
      expect(digitizationQueueService.enqueueBatch).toHaveBeenCalledWith(mockBody.jobs);
    });

    it('should handle error during batch enqueueing', async () => {
      const mockBody = { jobs: [] };
      const error = new Error('Batch queueing failed');
      digitizationQueueService.enqueueBatch.mockRejectedValue(error);

      await expect(controller.enqueueBatch(mockBody as any)).rejects.toThrow('Batch queueing failed');
    });
  });

  describe('getMetrics', () => {
    it('should return digitization metrics', async () => {
      const mockMetrics = {
        totalJobsQueued: 100,
        completedJobs: 80,
        failedJobs: 5,
      };
      afsService.getMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getMetrics();

      expect(result).toEqual(mockMetrics);
      expect(afsService.getMetrics).toHaveBeenCalled();
    });

    it('should handle error when fetching metrics', async () => {
      const error = new Error('Metrics fetch failed');
      afsService.getMetrics.mockRejectedValue(error);

      await expect(controller.getMetrics()).rejects.toThrow('Metrics fetch failed');
    });
  });

  describe('status', () => {
    it('should return job status', async () => {
      const jobId = 'job-123';
      const mockStatus = { jobId, status: 'completed', progress: 100 };
      digitizationQueueService.jobStatus.mockResolvedValue(mockStatus);

      const result = await controller.status(jobId);

      expect(result).toEqual(mockStatus);
      expect(digitizationQueueService.jobStatus).toHaveBeenCalledWith(jobId);
    });

    it('should handle error when fetching job status', async () => {
      const jobId = 'non-existent-id';
      const error = new Error('Job not found');
      digitizationQueueService.jobStatus.mockRejectedValue(error);

      await expect(controller.status(jobId)).rejects.toThrow('Job not found');
    });
  });

  describe('removeJob', () => {
    it('should mark job as removed', async () => {
      const mockBody = {
        annualAccountsId: '65a7dd50b0c7e600128b1234',
        ulbId: '65a7dd50b0c7e600128b5678',
      };
      const mockResult = { success: true, message: 'Job marked as removed' };
      digitizationQueueService.markJobRemoved.mockResolvedValue(mockResult);

      const result = await controller.removeJob(mockBody as any);

      expect(result).toEqual(mockResult);
      expect(digitizationQueueService.markJobRemoved).toHaveBeenCalledWith(mockBody);
    });

    it('should handle error when removing job', async () => {
      const mockBody = { annualAccountsId: 'invalid' };
      const error = new Error('Job removal failed');
      digitizationQueueService.markJobRemoved.mockRejectedValue(error);

      await expect(controller.removeJob(mockBody as any)).rejects.toThrow('Job removal failed');
    });
  });

  describe('getFile', () => {
    it('should return file details', async () => {
      const fileId = 'file-123';
      const mockFile = { id: fileId, name: 'document.pdf', status: 'processed' };
      afsService.getFile.mockResolvedValue(mockFile);

      const result = await controller.getFile(fileId);

      expect(result).toEqual(mockFile);
      expect(afsService.getFile).toHaveBeenCalledWith(fileId);
    });

    it('should handle error when fetching file', async () => {
      const fileId = 'non-existent-id';
      const error = new Error('File not found');
      afsService.getFile.mockRejectedValue(error);

      await expect(controller.getFile(fileId)).rejects.toThrow('File not found');
    });
  });
});
