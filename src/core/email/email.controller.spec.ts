import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';
import { RateLimitService } from '../services/rate-limit/rate-limit.service';
import { RedisService } from '../services/redis/redis.service';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

describe('EmailController', () => {
  let controller: EmailController;
  let emailService: jest.Mocked<
    Pick<
      EmailService,
      'handleUnsubscribe' | 'generateToken' | 'sendOtp' | 'verifyOtp' | 'sendProfileOtp' | 'verifyProfileOtp'
    >
  >;
  let res: { status: jest.Mock; send: jest.Mock; render: jest.Mock };

  beforeEach(async () => {
    emailService = {
      handleUnsubscribe: jest.fn(),
      generateToken: jest.fn(),
      sendOtp: jest.fn(),
      verifyOtp: jest.fn(),
      sendProfileOtp: jest.fn(),
      verifyProfileOtp: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://cityfinance.in/') } },
        { provide: RateLimitService, useValue: { checkLimit: jest.fn() } },
        { provide: RedisService, useValue: {} },
        { provide: EmailQueueService, useValue: { addEmailJob: jest.fn() } },
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);

    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      render: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('unsubscribePage()', () => {
    it('should return 400 when token is missing', () => {
      controller.unsubscribePage('', res as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.send).toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
    });

    it('should render the unsubscribe page when token is present', () => {
      controller.unsubscribePage('tok-123', res as any);

      expect(res.render).toHaveBeenCalledWith('unsubscribe/unsubscribe', {
        token: 'tok-123',
        baseUrl: 'https://cityfinance.in/',
      });
    });
  });

  describe('unsubscribeView()', () => {
    it('should return 400 when token is missing', () => {
      controller.unsubscribeView('', res as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.send).toHaveBeenCalled();
    });

    it('should render the unsubscribe view when token is present', () => {
      controller.unsubscribeView('tok-123', res as any);

      expect(res.render).toHaveBeenCalledWith('unsubscribe/unsubscribe', {
        token: 'tok-123',
        baseUrl: 'https://cityfinance.in/',
      });
    });
  });

  describe('unsubscribeConfirm()', () => {
    it('should return 400 when token is missing', async () => {
      await controller.unsubscribeConfirm('', res as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(emailService.handleUnsubscribe).not.toHaveBeenCalled();
    });

    it('should return 400 when the service reports failure', async () => {
      emailService.handleUnsubscribe.mockResolvedValue({ success: false, error: 'Invalid or expired token.' });

      await controller.unsubscribeConfirm('bad-token', res as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Unsubscribe failed: Invalid or expired token.'));
    });

    it('should return 200 with confirmation on success', async () => {
      emailService.handleUnsubscribe.mockResolvedValue({ success: true, email: 'a@b.com' });

      await controller.unsubscribeConfirm('good-token', res as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('a@b.com has been unsubscribed successfully.'));
    });
  });

  describe('getToken()', () => {
    it('should return 400 when email is missing', () => {
      controller.getToken('', 'desc', res as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.send).toHaveBeenCalledWith({ success: false, message: 'Email is missing!' });
      expect(emailService.generateToken).not.toHaveBeenCalled();
    });

    it('should generate and return a token when email is present', () => {
      emailService.generateToken.mockReturnValue('signed-token');

      controller.getToken('a@b.com', 'unsub', res as any);

      expect(emailService.generateToken).toHaveBeenCalledWith({ email: 'a@b.com', desc: 'unsub' });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.send).toHaveBeenCalledWith({ success: true, message: 'signed-token' });
    });
  });

  describe('sendOtp()', () => {
    it('should delegate to EmailService.sendOtp', async () => {
      emailService.sendOtp.mockResolvedValue({ isOtpSent: true } as any);

      const result = await controller.sendOtp({ email: 'a@b.com' });

      expect(emailService.sendOtp).toHaveBeenCalledWith({ email: 'a@b.com' });
      expect(result).toEqual({ isOtpSent: true });
    });
  });

  describe('verifyOtp()', () => {
    it('should delegate to EmailService.verifyOtp', async () => {
      emailService.verifyOtp.mockResolvedValue({ isOtpVerified: true } as any);

      const result = await controller.verifyOtp({ email: 'a@b.com', otp: '123456' });

      expect(emailService.verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', otp: '123456' });
      expect(result).toEqual({ isOtpVerified: true });
    });
  });

  describe('sendProfileOtp()', () => {
    it('should delegate to EmailService.sendProfileOtp', async () => {
      emailService.sendProfileOtp.mockResolvedValue({ isOtpSent: true, message: 'OTP sent successfully' });

      const result = await controller.sendProfileOtp('a@b.com');

      expect(emailService.sendProfileOtp).toHaveBeenCalledWith('a@b.com');
      expect(result).toEqual({ isOtpSent: true, message: 'OTP sent successfully' });
    });
  });

  describe('verifyProfileOtp()', () => {
    it('should delegate to EmailService.verifyProfileOtp', async () => {
      emailService.verifyProfileOtp.mockResolvedValue({ isOtpVerified: true, message: 'OTP verified successfully' });

      const result = await controller.verifyProfileOtp('a@b.com', '1234');

      expect(emailService.verifyProfileOtp).toHaveBeenCalledWith('a@b.com', '1234');
      expect(result).toEqual({ isOtpVerified: true, message: 'OTP verified successfully' });
    });
  });
});
