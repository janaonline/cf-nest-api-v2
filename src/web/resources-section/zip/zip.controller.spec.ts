import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ZipController } from './zip.controller';
import { ZipBuildService } from './zip-build.service';
import { responseJsonUlb } from './responseJsonUlb';

describe('ZipController', () => {
  let controller: ZipController;
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let mailer: { sendDownloadLink: jest.Mock };

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: jest.fn(),
    };
    mailer = {
      sendDownloadLink: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZipController],
      providers: [
        { provide: getQueueToken('zipResources'), useValue: queue },
        { provide: ZipBuildService, useValue: mailer },
      ],
    }).compile();

    controller = module.get<ZipController>(ZipController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should enqueue a zip job with the sample ULB payload and return job info', async () => {
      const result = await controller.create();

      expect(queue.add).toHaveBeenCalledWith(
        'zipResources',
        expect.objectContaining({
          email: 'jeevanantham.d@janaagraha.org',
          ulbData: responseJsonUlb.data,
        }),
        expect.objectContaining({
          removeOnComplete: { age: 86400, count: 2000 },
          removeOnFail: 1000,
        }),
      );
      expect(result).toEqual({
        jobId: 'job-123',
        statusUrl: '/zip-jobs/job-123',
        poll: true,
      });
    });

    it('should propagate errors thrown while enqueueing the job', async () => {
      queue.add.mockRejectedValue(new Error('queue unavailable'));

      await expect(controller.create()).rejects.toThrow('queue unavailable');
    });
  });

  describe('getHello', () => {
    it('should return the test string', () => {
      expect(controller.getHello()).toBe('test');
    });
  });

  describe('sendmail', () => {
    it('should send the sample download-link email', async () => {
      const result = await controller.sendmail();

      expect(mailer.sendDownloadLink).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jeevanantham.d@janaagraha.org',
          subject: 'test mail',
          link: 'http://example.com/download.zip',
          counts: { total: 10, skipped: 2 },
          ulbData: responseJsonUlb.data,
        }),
      );
      expect(result).toEqual({ message: 'HTML Template Mail sent!' });
    });

    it('should propagate errors thrown while sending the email', async () => {
      mailer.sendDownloadLink.mockRejectedValue(new Error('mail failed'));

      await expect(controller.sendmail()).rejects.toThrow('mail failed');
    });
  });

  describe('status', () => {
    it('should return not_found when the job does not exist', async () => {
      queue.getJob.mockResolvedValue(null);

      const result = await controller.status('missing-job');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('should return the result payload for a completed job', async () => {
      const returnvalue = { bucket: 'test-bucket', zipKey: 'zips/output.zip', totalFiles: 2, skippedFiles: 0, url: 'https://example.com/file.zip' };
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue,
        progress: 100,
      });

      const result = await controller.status('job-123');

      expect(result).toEqual({ status: 'completed', progress: 100, result: returnvalue });
    });

    it('should return the failure reason for a failed job', async () => {
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
        progress: 40,
        failedReason: 'archiver crashed',
      });

      const result = await controller.status('job-123');

      expect(result).toEqual({ status: 'failed', progress: 40, reason: 'archiver crashed' });
    });

    it('should return the current state and progress for an in-progress job', async () => {
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        progress: 55,
      });

      const result = await controller.status('job-123');

      expect(result).toEqual({ status: 'active', progress: 55 });
    });

    it('should default progress to 0 when the job has none set', async () => {
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('waiting'),
        progress: 0,
      });

      const result = await controller.status('job-123');

      expect(result).toEqual({ status: 'waiting', progress: 0 });
    });
  });
});
