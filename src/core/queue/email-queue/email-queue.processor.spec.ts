import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq/dist/esm/classes';
import { NodeMailerService } from 'src/core/node-mailer/node-mailer.service';
import { EmailJob } from '../../aws-ses/email-job.type';
import { EmailQueueProcessor } from './email-queue.processor';

describe('EmailQueueProcessor', () => {
  let processor: EmailQueueProcessor;

  const mockNodeMailerService = {
    sendHtml: jest.fn().mockResolvedValue(true),
    sendEmailWithTemplate: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
        {
          provide: NodeMailerService,
          useValue: mockNodeMailerService,
        },
      ],
    }).compile();

    processor = module.get<EmailQueueProcessor>(EmailQueueProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process()', () => {
    it('should send html email when html is provided', async () => {
      const job = {
        id: 'job-1',
        data: {
          to: 'test@example.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
        } as EmailJob,
      } as Job<EmailJob>;

      await processor.process(job);

      expect(mockNodeMailerService.sendHtml).toHaveBeenCalledWith(
        'test@example.com',
        'Test Subject',
        '<p>Hello</p>',
      );
      expect(mockNodeMailerService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('should send templated email with a single string recipient', async () => {
      const job = {
        id: 'job-2',
        data: {
          to: 'test@example.com',
          subject: 'OTP Email',
          templateName: 'otp',
          mailData: { otp: '123456' },
        } as EmailJob,
      } as Job<EmailJob>;

      await processor.process(job);

      expect(mockNodeMailerService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'test@example.com',
        'OTP Email',
        'otp',
        { otp: '123456' },
      );
      expect(mockNodeMailerService.sendHtml).not.toHaveBeenCalled();
    });

    it('sends to every recipient when "to" is an array and templateName is used', async () => {
      const job = {
        id: 'job-3',
        data: {
          to: ['first@example.com', 'second@example.com'],
          subject: 'Bulk Email',
          templateName: 'welcome',
          mailData: { name: 'City Finance' },
        } as EmailJob,
      } as Job<EmailJob>;

      await processor.process(job);

      expect(mockNodeMailerService.sendEmailWithTemplate).toHaveBeenCalledWith(
        ['first@example.com', 'second@example.com'],
        'Bulk Email',
        'welcome',
        { name: 'City Finance' },
      );
    });

    it('should prefer html over templateName when both are present', async () => {
      const job = {
        id: 'job-4',
        data: {
          to: 'test@example.com',
          subject: 'Both Provided',
          html: '<p>Wins</p>',
          templateName: 'otp',
        } as EmailJob,
      } as Job<EmailJob>;

      await processor.process(job);

      expect(mockNodeMailerService.sendHtml).toHaveBeenCalledWith('test@example.com', 'Both Provided', '<p>Wins</p>');
      expect(mockNodeMailerService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('should throw when neither html nor templateName is provided', async () => {
      const job = {
        id: 'job-5',
        data: {
          to: 'test@example.com',
          subject: 'Nothing',
        } as EmailJob,
      } as Job<EmailJob>;

      await expect(processor.process(job)).rejects.toThrow('Job job-5: neither html nor templateName provided');
      expect(mockNodeMailerService.sendHtml).not.toHaveBeenCalled();
      expect(mockNodeMailerService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('should propagate errors from the mail service', async () => {
      mockNodeMailerService.sendHtml.mockRejectedValueOnce(new Error('SMTP down'));
      const job = {
        id: 'job-6',
        data: {
          to: 'test@example.com',
          subject: 'Fails',
          html: '<p>x</p>',
        } as EmailJob,
      } as Job<EmailJob>;

      await expect(processor.process(job)).rejects.toThrow('SMTP down');
    });
  });
});
