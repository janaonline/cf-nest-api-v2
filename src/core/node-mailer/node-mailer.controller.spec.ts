import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NodeMailerController } from './node-mailer.controller';
import { NodeMailerService } from './node-mailer.service';
import { EMAIL_QUEUE } from '../queue/email-queue/email-queue.constant';

describe('NodeMailerController', () => {
  let controller: NodeMailerController;
  let service: jest.Mocked<NodeMailerService>;
  let mockQueue: { getJob: jest.Mock };

  beforeEach(async () => {
    const mockNodeMailerService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(true),
      sendEmailWithTemplate: jest.fn().mockResolvedValue(true),
    };

    mockQueue = { getJob: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodeMailerController],
      providers: [
        { provide: NodeMailerService, useValue: mockNodeMailerService },
        { provide: getQueueToken(EMAIL_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    controller = module.get<NodeMailerController>(NodeMailerController);
    service = module.get(NodeMailerService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('sendTestMail', () => {
    it('should call sendWelcomeEmail and return message', async () => {
      const result = await controller.sendTestMail();
      expect(service.sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ message: 'HTML Template Mail sent!' });
    });

    it('should propagate errors from sendWelcomeEmail', async () => {
      service.sendWelcomeEmail.mockRejectedValue(new Error('SMTP error'));
      await expect(controller.sendTestMail()).rejects.toThrow('SMTP error');
    });
  });

  describe('status', () => {
    it('should return not_found when job does not exist', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      const result = await controller.status('job-123');
      expect(result).toEqual({ status: 'not_found' });
    });

    it('should return completed status with 100 progress', async () => {
      const mockJob = { getState: jest.fn().mockResolvedValue('completed'), progress: 50, failedReason: undefined };
      mockQueue.getJob.mockResolvedValue(mockJob);
      const result = await controller.status('job-123');
      expect(result).toEqual({ status: 'completed', progress: 100 });
    });

    it('should return failed status with reason', async () => {
      const mockJob = {
        getState: jest.fn().mockResolvedValue('failed'),
        progress: 0,
        failedReason: 'SMTP connection refused',
      };
      mockQueue.getJob.mockResolvedValue(mockJob);
      const result = await controller.status('job-123');
      expect(result).toEqual({ status: 'failed', progress: 0, reason: 'SMTP connection refused' });
    });

    it('should return active status with progress', async () => {
      const mockJob = { getState: jest.fn().mockResolvedValue('active'), progress: 30, failedReason: undefined };
      mockQueue.getJob.mockResolvedValue(mockJob);
      const result = await controller.status('job-123');
      expect(result).toEqual({ status: 'active', progress: 30 });
    });

    it('should return 0 progress when job.progress is falsy', async () => {
      const mockJob = { getState: jest.fn().mockResolvedValue('waiting'), progress: 0, failedReason: undefined };
      mockQueue.getJob.mockResolvedValue(mockJob);
      const result = await controller.status('job-123');
      expect((result as any).progress).toBe(0);
    });
  });
});
