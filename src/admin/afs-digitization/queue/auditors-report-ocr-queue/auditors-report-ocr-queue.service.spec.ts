import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { of } from 'rxjs';
import { AFS_AUDITORS_REPORT_QUEUE } from 'src/core/constants/queues';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsAuditorsReport } from 'src/schemas/afs/afs-auditors-report.schema';
import { AfsExcelFile } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric } from 'src/schemas/afs/afs-metrics.schema';
import { DigitizationUploadedBy } from '../../dto/digitization-job.dto';
import { AuditorsReportOcrQueueService } from './auditors-report-ocr-queue.service';

const makeJob = (overrides = {}): any => ({
  pdfUrl: 'afs/auditor_report/ulb1_2021_ANNUAL_auditor_report.pdf',
  requestId: 'req-20250501-abc123',
  ulb: '6402dd7803b5a6b6c2cb6d43',
  year: '6402dd7803b5a6b6c2cb6d44',
  auditType: 'ANNUAL',
  docType: 'auditor_report',
  uploadedBy: DigitizationUploadedBy.AFS,
  annualAccountsId: '6402dd7803b5a6b6c2cb6d45',
  noOfPages: 2,
  jobId: 'job-001',
  ...overrides,
});

describe('AuditorsReportOcrQueueService', () => {
  let service: AuditorsReportOcrQueueService;
  let mockQueue: { add: jest.Mock; getJob: jest.Mock };
  let mockAfsAuditorsReportModel: { findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
  let mockAfsMetricModel: { updateOne: jest.Mock };
  let mockS3Service: {
    getPdfBufferFromS3: jest.Mock;
    getPdfPageCountFromBuffer: jest.Mock;
    copyFileBetweenBuckets: jest.Mock;
  };
  let mockConfigService: { get: jest.Mock };
  let mockHttp: { post: jest.Mock };

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-001' }), getJob: jest.fn() };
    mockAfsAuditorsReportModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    mockAfsMetricModel = { updateOne: jest.fn().mockResolvedValue({}) };
    mockS3Service = {
      getPdfBufferFromS3: jest.fn().mockResolvedValue(Buffer.from('pdf-content')),
      getPdfPageCountFromBuffer: jest.fn().mockReturnValue(2),
      copyFileBetweenBuckets: jest.fn().mockResolvedValue(undefined),
    };
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const map: Record<string, string> = {
          AWS_DIGITIZATION_BUCKET_NAME: 'cf-digitization-dev',
          DIGITIZATION_API_URL: 'https://digitize.api/',
        };
        return map[key];
      }),
    };
    mockHttp = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditorsReportOcrQueueService,
        { provide: getQueueToken(AFS_AUDITORS_REPORT_QUEUE), useValue: mockQueue },
        { provide: getModelToken(AfsExcelFile.name), useValue: {} },
        { provide: getModelToken(AfsAuditorsReport.name), useValue: mockAfsAuditorsReportModel },
        { provide: getModelToken(AfsMetric.name), useValue: mockAfsMetricModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttp },
      ],
    }).compile();

    service = module.get<AuditorsReportOcrQueueService>(AuditorsReportOcrQueueService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── normalizeError ────────────────────────────────────────────────────────

  describe('normalizeError', () => {
    it('should return message and stack for Error instances', () => {
      const err = new Error('something failed');
      const result = service.normalizeError(err);
      expect(result.message).toBe('something failed');
    });

    it('should stringify plain objects', () => {
      const result = service.normalizeError({ code: 500, msg: 'oops' });
      expect(result).toMatchObject({ code: 500, msg: 'oops' });
    });

    it('should convert non-objects to string message', () => {
      const result = service.normalizeError('plain string error') as any;
      expect(result.message).toBe('plain string error');
    });
  });

  // ─── removeJob ────────────────────────────────────────────────────────────

  describe('removeJob', () => {
    it('should return message when job not found', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      const result = await service.removeJob('missing-job');
      expect(result.message).toContain('not found');
    });

    it('should remove job and return success message', async () => {
      const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
      mockQueue.getJob.mockResolvedValue(mockJob);
      const result = await service.removeJob('job-001');
      expect(mockJob.remove).toHaveBeenCalled();
      expect(result.message).toContain('removed from queue');
    });
  });

  // ─── updateAfsMetrics ─────────────────────────────────────────────────────

  describe('updateAfsMetrics', () => {
    it('should call updateOne on afsMetricModel', async () => {
      await service.updateAfsMetrics({ digitizedFiles: 1 });
      expect(mockAfsMetricModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('should auto-calculate queuedFiles when not provided', async () => {
      await service.updateAfsMetrics({ digitizedFiles: 2 });
      const [, updateArg] = mockAfsMetricModel.updateOne.mock.calls[0];
      expect(updateArg.$inc.queuedFiles).toBe(-2);
    });
  });

  // ─── updateAfsAR ──────────────────────────────────────────────────────────

  describe('updateAfsAR', () => {
    it('should call updateOne with correct filter', async () => {
      const job = makeJob();
      await service.updateAfsAR(job, { 'afsFile.digitizationStatus': 'digitized' } as any);
      expect(mockAfsAuditorsReportModel.updateOne).toHaveBeenCalledTimes(1);
    });
  });

  // ─── enqueueBatch ─────────────────────────────────────────────────────────

  describe('enqueueBatch', () => {
    it('should return queuedJobs count', async () => {
      // upsertAfsAR calls s3Service and queue.add internally
      mockS3Service.getPdfBufferFromS3.mockResolvedValue(Buffer.from('pdf'));
      mockAfsAuditorsReportModel.findOneAndUpdate.mockResolvedValue({});

      const jobs = [makeJob(), makeJob()];
      const result = await service.enqueueBatch(jobs);
      expect(result.queuedJobs).toBe(2);
    });
  });

  // ─── copyDigitizedUrl ─────────────────────────────────────────────────────

  describe('copyDigitizedUrl', () => {
    it('should copy file and return destination key', async () => {
      mockS3Service.copyFileBetweenBuckets.mockResolvedValue(undefined);
      const job = makeJob({ docType: 'auditor_report', ulb: 'ulb1', auditType: 'ANNUAL' });
      const result = await service.copyDigitizedUrl(job, 'ocr-output/result.txt');
      expect(result).toContain('afs/auditor_report/');
      expect(mockS3Service.copyFileBetweenBuckets).toHaveBeenCalledTimes(1);
    });
  });

  // ─── markJobFailed ────────────────────────────────────────────────────────

  describe('markJobFailed', () => {
    it('should update AfsAuditorsReport with failed status', async () => {
      const job = makeJob();
      const response = { message: 'API error', total_processing_time_ms: 500 } as any;
      await service.markJobFailed(job, response);
      expect(mockAfsAuditorsReportModel.updateOne).toHaveBeenCalled();
      expect(mockAfsMetricModel.updateOne).toHaveBeenCalled();
    });
  });

  // ─── handleAuditorsReportOcrJob ───────────────────────────────────────────

  describe('handleAuditorsReportOcrJob', () => {
    it('should throw when OCR text key missing in response', async () => {
      const job = makeJob();
      jest.spyOn(service, 'callDigitizationApi').mockResolvedValue({
        data: { ocr_extraction: {} },
        overall_confidence_score: 0.9,
        total_processing_time_ms: 100,
        request_id: 'req-001',
        message: 'ok',
      } as any);

      await expect(service.handleAuditorsReportOcrJob(job)).rejects.toThrow(BadRequestException);
    });

    it('should complete successfully with valid OCR response', async () => {
      const job = makeJob();
      jest.spyOn(service, 'callDigitizationApi').mockResolvedValue({
        data: { ocr_extraction: { ocr_text_key: 'ocr-output/result.txt' } },
        overall_confidence_score: 0.95,
        total_processing_time_ms: 200,
        request_id: 'req-001',
        message: 'ok',
      } as any);
      jest.spyOn(service, 'copyDigitizedUrl').mockResolvedValue('afs/auditor_report/copied.txt');
      jest.spyOn(service, 'markJobCompleted').mockResolvedValue(undefined as any);

      await expect(service.handleAuditorsReportOcrJob(job)).resolves.not.toThrow();
    });
  });

  // ─── getFormDataForDigitization ───────────────────────────────────────────

  describe('getFormDataForDigitization', () => {
    it('should return FormData with file and request_id', async () => {
      mockS3Service.getPdfBufferFromS3.mockResolvedValue(Buffer.from('%PDF-1.4 test content'));
      mockS3Service.getPdfPageCountFromBuffer.mockReturnValue(3);

      const job = makeJob();
      const formData = await service.getFormDataForDigitization(job);
      expect(formData).toBeDefined();
      expect(job.noOfPages).toBe(3);
    });

    it('should throw when S3 fetch fails', async () => {
      mockS3Service.getPdfBufferFromS3.mockRejectedValue(new Error('S3 error'));
      await expect(service.getFormDataForDigitization(makeJob())).rejects.toThrow('S3 error');
    });
  });
});
