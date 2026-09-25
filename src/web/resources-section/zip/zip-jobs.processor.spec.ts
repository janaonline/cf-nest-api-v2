import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { ZipJobsProcessor } from './zip-jobs.processor';
import { ZipBuildService } from './zip-build.service';
import { S3Service } from 'src/core/s3/s3.service';
import { ZipJobRequest, ZipJobResult } from './zip.types';

describe('ZipJobsProcessor', () => {
  let processor: ZipJobsProcessor;
  let zipBuildService: { buildZipToS3: jest.Mock; sendDownloadLink: jest.Mock };
  let s3Service: { presignGet: jest.Mock };

  const makeJob = (data: Partial<ZipJobRequest>, updateProgress = jest.fn().mockResolvedValue(undefined)) =>
    ({
      id: 'job-1',
      name: 'zipResources',
      data,
      updateProgress,
    }) as unknown as Job<ZipJobRequest, ZipJobResult>;

  const buildResult: ZipJobResult = {
    bucket: 'test-bucket',
    zipKey: 'zips/output.zip',
    totalFiles: 2,
    skippedFiles: 0,
  };

  beforeEach(async () => {
    zipBuildService = {
      buildZipToS3: jest.fn().mockResolvedValue(buildResult),
      sendDownloadLink: jest.fn().mockResolvedValue(undefined),
    };
    s3Service = {
      presignGet: jest.fn().mockResolvedValue('https://example.com/presigned-url'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZipJobsProcessor,
        { provide: ZipBuildService, useValue: zipBuildService },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    processor = module.get<ZipJobsProcessor>(ZipJobsProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    const ulbData = [
      {
        _id: 'ulb-1',
        state: 'state-1',
        ulbId: 'ulb-1',
        ulbName: 'Test ULB',
        stateName: 'Test State',
        auditType: 'audited',
        year: '2021-22',
        files: [{ name: 'balance-sheet', url: '/folder/balance-sheet.pdf' }],
      },
    ];

    it('should build the zip, presign the URL, send the email, and report progress to completion', async () => {
      const updateProgress = jest.fn().mockResolvedValue(undefined);
      const job = makeJob(
        {
          ulbData,
          email: 'user@example.com',
          userName: 'Test User',
          downloadType: 'Raw Data PDF',
        },
        updateProgress,
      );

      const result = await processor.process(job);

      expect(zipBuildService.buildZipToS3).toHaveBeenCalledWith(
        expect.objectContaining({ ulbData, downloadType: 'Raw Data PDF' }),
      );
      expect(s3Service.presignGet).toHaveBeenCalledWith(buildResult.zipKey);
      expect(zipBuildService.sendDownloadLink).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          name: 'Test User',
          link: 'https://example.com/presigned-url',
          key: buildResult.zipKey,
          counts: { total: buildResult.totalFiles, skipped: buildResult.skippedFiles },
        }),
      );
      expect(updateProgress).toHaveBeenNthCalledWith(1, 5);
      expect(updateProgress).toHaveBeenNthCalledWith(2, 95);
      expect(updateProgress).toHaveBeenNthCalledWith(3, 100);
      expect(result).toEqual({ ...buildResult, url: 'https://example.com/presigned-url' });
    });

    it('should use the provided outputKey instead of generating one when present', async () => {
      const job = makeJob({
        ulbData,
        outputKey: 'zips/custom-key.zip',
        downloadType: 'Raw Data PDF',
      });

      await processor.process(job);

      expect(zipBuildService.buildZipToS3).toHaveBeenCalledWith(
        expect.objectContaining({ outputKey: 'zips/custom-key.zip' }),
      );
    });

    it('should skip sending the notification email when no email is provided', async () => {
      const job = makeJob({
        ulbData,
        downloadType: 'Raw Data PDF',
      });

      await processor.process(job);

      expect(zipBuildService.sendDownloadLink).not.toHaveBeenCalled();
    });

    it('should propagate an error when zip building fails', async () => {
      zipBuildService.buildZipToS3.mockRejectedValue(new Error('build failed'));
      const job = makeJob({
        ulbData,
        email: 'user@example.com',
        downloadType: 'Raw Data PDF',
      });

      await expect(processor.process(job)).rejects.toThrow('build failed');
      expect(s3Service.presignGet).not.toHaveBeenCalled();
      expect(zipBuildService.sendDownloadLink).not.toHaveBeenCalled();
    });

    it('should propagate an error when presigning the download URL fails', async () => {
      s3Service.presignGet.mockRejectedValue(new Error('presign failed'));
      const job = makeJob({
        ulbData,
        email: 'user@example.com',
        downloadType: 'Raw Data PDF',
      });

      await expect(processor.process(job)).rejects.toThrow('presign failed');
      expect(zipBuildService.sendDownloadLink).not.toHaveBeenCalled();
    });

    it('should throw when ulbData is an empty array (no ULB to derive the zip file name from)', async () => {
      // NOTE: this documents existing behaviour rather than desired behaviour — the processor
      // unconditionally reads ulbData[0].stateName/year to build the default file name, so an
      // empty resource set throws a TypeError instead of failing gracefully. Not fixed here
      // per instructions to avoid modifying source files.
      const job = makeJob({
        ulbData: [],
        downloadType: 'Raw Data PDF',
      });

      await expect(processor.process(job)).rejects.toThrow(TypeError);
      expect(zipBuildService.buildZipToS3).not.toHaveBeenCalled();
    });
  });
});
