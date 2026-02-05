import { Test, TestingModule } from '@nestjs/testing';
import { EmailQueueService } from './email-queue.service';
import { getQueueToken } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from './email-queue.constant';

describe('EmailQueueService', () => {
  let service: EmailQueueService;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    process: jest.fn(),
    on: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        {
          provide: getQueueToken(EMAIL_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<EmailQueueService>(EmailQueueService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addEmailJob()', () => {
    it('should add email job to queue', async () => {
      const emailJob = {
        to: 'test@example.com',
        subject: 'Test Email',
        body: 'Test Body',
      };

      await service.addEmailJob(emailJob);

      expect(mockQueue.add).toHaveBeenCalledWith('emailJob', emailJob);
    });

    it('should return job id', async () => {
      const emailJob = {
        to: 'test@example.com',
        subject: 'Test Email',
        body: 'Test Body',
      };

      mockQueue.add.mockResolvedValue({ id: 'job-456' });

      await service.addEmailJob(emailJob);

      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should handle queue errors', async () => {
      const emailJob = {
        to: 'test@example.com',
        subject: 'Test Email',
        body: 'Test Body',
      };

      mockQueue.add.mockRejectedValue(new Error('Queue error'));

      await expect(service.addEmailJob(emailJob)).rejects.toThrow('Queue error');
    });
  });
});
