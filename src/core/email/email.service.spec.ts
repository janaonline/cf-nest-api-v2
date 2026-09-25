import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailList } from 'src/schemas/email-list';
import { EmailDomainValidationService } from '../email-domain-validation/email-domain-validation.service';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';
import { RateLimitService } from '../services/rate-limit/rate-limit.service';
import { RedisService } from '../services/redis/redis.service';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let rateLimit: { checkLimit: jest.Mock };
  let mailQueue: { addEmailJob: jest.Mock };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let emailListModel: {
    findOne: jest.Mock;
    insertOne: jest.Mock;
    updateOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let configGet: jest.Mock;
  let emailDomainValidation: { domainHasMxRecord: jest.Mock };

  const buildModule = async (nodeEnv = 'test') => {
    configGet = jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'NODE_ENV') return nodeEnv;
      return undefined;
    });

    emailListModel = {
      findOne: jest.fn(),
      insertOne: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    rateLimit = { checkLimit: jest.fn().mockResolvedValue(undefined) };
    redis = { get: jest.fn(), set: jest.fn().mockResolvedValue(true), del: jest.fn().mockResolvedValue(true) };
    mailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    jwtService = { sign: jest.fn().mockReturnValue('signed-token'), verify: jest.fn() };
    emailDomainValidation = { domainHasMxRecord: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: getModelToken(EmailList.name), useValue: emailListModel },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: JwtService, useValue: jwtService },
        { provide: RateLimitService, useValue: rateLimit },
        { provide: RedisService, useValue: redis },
        { provide: EmailQueueService, useValue: mailQueue },
        { provide: EmailDomainValidationService, useValue: emailDomainValidation },
      ],
    }).compile();

    return module.get<EmailService>(EmailService);
  };

  beforeEach(async () => {
    service = await buildModule();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw when JWT_SECRET is not configured', async () => {
    const badConfig = { get: jest.fn().mockReturnValue(undefined) };

    await expect(
      Test.createTestingModule({
        providers: [
          EmailService,
          { provide: getModelToken(EmailList.name), useValue: {} },
          { provide: ConfigService, useValue: badConfig },
          { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
          { provide: RateLimitService, useValue: { checkLimit: jest.fn() } },
          { provide: RedisService, useValue: {} },
          { provide: EmailQueueService, useValue: {} },
          { provide: EmailDomainValidationService, useValue: { domainHasMxRecord: jest.fn() } },
        ],
      }).compile(),
    ).rejects.toThrow('JWT_SECRET is not defined in environment variables');
  });

  describe('generateToken()', () => {
    it('should sign the payload with a 7d expiry', () => {
      const token = service.generateToken({ email: 'a@b.com', desc: 'test' });
      expect(jwtService.sign).toHaveBeenCalledWith({ email: 'a@b.com', desc: 'test' }, { expiresIn: '7d' });
      expect(token).toBe('signed-token');
    });
  });

  describe('handleUnsubscribe()', () => {
    it('should return failure when the token is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      const result = await service.handleUnsubscribe('bad-token');

      expect(result).toEqual({ success: false, error: 'Invalid or expired token.' });
    });

    it('should upsert the email and return success on a valid token', async () => {
      jwtService.verify.mockReturnValue({ email: 'a@b.com', desc: 'x' });
      emailListModel.findOneAndUpdate.mockResolvedValue({ email: 'a@b.com', isUnsubscribed: true });

      const result = await service.handleUnsubscribe('good-token');

      expect(emailListModel.findOneAndUpdate).toHaveBeenCalled();
      expect(result).toEqual({ success: true, email: 'a@b.com' });
    });

    it('should report duplicate key errors distinctly', async () => {
      jwtService.verify.mockReturnValue({ email: 'a@b.com', desc: 'x' });
      const dupError: any = new Error('duplicate');
      dupError.code = 11000;
      emailListModel.findOneAndUpdate.mockRejectedValue(dupError);

      const result = await service.handleUnsubscribe('good-token');

      expect(result).toEqual({ success: false, error: 'Email already unsubscribed (duplicate key).' });
    });

    it('should report a generic database error otherwise', async () => {
      jwtService.verify.mockReturnValue({ email: 'a@b.com', desc: 'x' });
      emailListModel.findOneAndUpdate.mockRejectedValue(new Error('connection lost'));

      const result = await service.handleUnsubscribe('good-token');

      expect(result).toEqual({ success: false, error: 'Database error.' });
    });
  });

  describe('sendOtp()', () => {
    it('should insert a new email and send OTP when the email does not exist', async () => {
      emailListModel.findOne.mockResolvedValue(null);
      emailListModel.insertOne.mockResolvedValue({ email: 'new@example.com' });

      const result = await service.sendOtp({ email: 'new@example.com' });

      expect(rateLimit.checkLimit).toHaveBeenCalledWith('otp:new@example.com:send');
      expect(emailListModel.insertOne).toHaveBeenCalledWith({ email: 'new@example.com' });
      expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('otp:new@example.com'), expect.any(String), 300);
      expect(mailQueue.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'new@example.com', templateName: 'otp' }),
      );
      expect(result).toEqual(expect.objectContaining({ isOtpSent: true }));
    });

    it('should short-circuit with isEmailVerified when the user is already verified', async () => {
      emailListModel.findOne.mockResolvedValue({ isVerified: true, isUnsubscribed: false });

      const result = await service.sendOtp({ email: 'verified@example.com' });

      expect(mailQueue.addEmailJob).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ isEmailVerified: true, message: 'Email ID verifed successfully!' }),
      );
    });

    it('should send OTP again for an existing but unverified user', async () => {
      emailListModel.findOne.mockResolvedValue({ isVerified: false });

      const result = await service.sendOtp({ email: 'unverified@example.com' });

      expect(mailQueue.addEmailJob).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ isOtpSent: true }));
    });

    it('should propagate rate-limit errors', async () => {
      rateLimit.checkLimit.mockRejectedValue(new BadRequestException('Too many requests'));

      await expect(service.sendOtp({ email: 'limited@example.com' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp()', () => {
    it('should throw when the email does not exist', async () => {
      emailListModel.findOne.mockResolvedValue(null);

      await expect(service.verifyOtp({ email: 'missing@example.com', otp: '123456' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when the OTP has expired', async () => {
      emailListModel.findOne.mockResolvedValue({ email: 'a@b.com' });
      redis.get.mockResolvedValue(null);

      await expect(service.verifyOtp({ email: 'a@b.com', otp: '123456' })).rejects.toThrow('OTP expired');
    });

    it('should throw when the OTP does not match', async () => {
      emailListModel.findOne.mockResolvedValue({ email: 'a@b.com' });
      redis.get.mockResolvedValue('654321');

      await expect(service.verifyOtp({ email: 'a@b.com', otp: '123456' })).rejects.toThrow('Invalid OTP');
    });

    it('should mark the user verified on a matching OTP', async () => {
      emailListModel.findOne
        .mockResolvedValueOnce({ email: 'a@b.com' })
        .mockResolvedValueOnce({ email: 'a@b.com', isVerified: true, isUnsubscribed: false });
      redis.get.mockResolvedValue('123456');

      const result = await service.verifyOtp({ email: 'a@b.com', otp: '123456' });

      expect(redis.del).toHaveBeenCalledWith('otp:a@b.com');
      expect(emailListModel.updateOne).toHaveBeenCalledWith(
        { email: 'a@b.com' },
        { $set: { isVerified: true, verifiedAt: expect.any(Date) } },
      );
      expect(result).toEqual(expect.objectContaining({ isOtpVerified: true, isEmailVerified: true }));
    });

    it('should throw when the post-update lookup fails to find the user', async () => {
      emailListModel.findOne.mockResolvedValueOnce({ email: 'a@b.com' }).mockResolvedValueOnce(null);
      redis.get.mockResolvedValue('123456');

      await expect(service.verifyOtp({ email: 'a@b.com', otp: '123456' })).rejects.toThrow(
        'Failed to verify email id!',
      );
    });
  });

  describe('checkEmailDomain()', () => {
    it('returns deliverable: true for a domain with an MX/A record', async () => {
      emailDomainValidation.domainHasMxRecord.mockResolvedValue(true);

      const result = await service.checkEmailDomain('a@gmail.com');

      expect(emailDomainValidation.domainHasMxRecord).toHaveBeenCalledWith('a@gmail.com');
      expect(result).toEqual({ deliverable: true });
    });

    it('returns deliverable: false for a made-up domain', async () => {
      emailDomainValidation.domainHasMxRecord.mockResolvedValue(false);

      const result = await service.checkEmailDomain('a@examplesdcds.co');

      expect(result).toEqual({ deliverable: false });
    });
  });

  describe('sendProfileOtp()', () => {
    it('should use a fixed OTP and skip the mail queue outside production', async () => {
      const result = await service.sendProfileOtp('dev@example.com');

      expect(redis.set).toHaveBeenCalledWith('profile_otp:dev@example.com', '111111', 600);
      expect(mailQueue.addEmailJob).not.toHaveBeenCalled();
      expect(result).toEqual({ isOtpSent: true, message: 'OTP sent successfully' });
    });

    it('should generate a random OTP and use the mail queue in production', async () => {
      service = await buildModule('production');

      const result = await service.sendProfileOtp('prod@example.com');

      expect(mailQueue.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'prod@example.com', templateName: 'otp' }),
      );
      expect(result).toEqual({ isOtpSent: true, message: 'OTP sent successfully' });
    });
  });

  describe('verifyProfileOtp()', () => {
    it('should fail when no OTP is stored', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.verifyProfileOtp('a@b.com', '1234');

      expect(result).toEqual({ isOtpVerified: false, message: 'OTP expired or not found' });
    });

    it('should fail when the OTP does not match', async () => {
      redis.get.mockResolvedValue('9999');

      const result = await service.verifyProfileOtp('a@b.com', '1234');

      expect(result).toEqual({ isOtpVerified: false, message: 'Invalid OTP' });
    });

    it('should succeed and clear the OTP on a match', async () => {
      redis.get.mockResolvedValue('1234');

      const result = await service.verifyProfileOtp('a@b.com', '1234');

      expect(redis.del).toHaveBeenCalledWith('profile_otp:a@b.com');
      expect(result).toEqual({ isOtpVerified: true, message: 'OTP verified successfully' });
    });
  });
});
