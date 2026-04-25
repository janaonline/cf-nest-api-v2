import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginService } from './login.service';
import { OtpService } from './otp.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    logout: jest.fn(),
    refreshTokens: jest.fn(),
    register: jest.fn(),
    validateCaptcha: jest.fn(),
  };

  const mockLoginService = {
    login: jest.fn(),
  };

  const mockOtpService = {
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    forgotPasswordReset: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: LoginService, useValue: mockLoginService },
        { provide: OtpService, useValue: mockOtpService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates login to LoginService', async () => {
    mockLoginService.login.mockResolvedValue({ token: 'tok' });
    const res = { cookie: jest.fn() } as any;
    await controller.login({ identifier: 'a@b.com', password: 'pass' }, res);
    expect(mockLoginService.login).toHaveBeenCalled();
  });

  it('delegates sendOtp to OtpService', async () => {
    mockOtpService.sendOtp.mockResolvedValue({ success: true, message: 'OTP sent successfully' });
    await controller.sendOtp({ identifier: 'a@b.com' });
    expect(mockOtpService.sendOtp).toHaveBeenCalledWith({ identifier: 'a@b.com' });
  });

  it('delegates verifyOtp to OtpService', async () => {
    mockOtpService.verifyOtp.mockResolvedValue({ token: 'tok' });
    const res = { cookie: jest.fn() } as any;
    await controller.verifyOtp({ identifier: 'a@b.com', otp: '123456' }, res);
    expect(mockOtpService.verifyOtp).toHaveBeenCalledWith({ identifier: 'a@b.com', otp: '123456' }, res);
  });

  it('delegates logout to AuthService', async () => {
    mockAuthService.logout.mockResolvedValue({ success: true });
    const res = { cookie: jest.fn() } as any;
    await controller.logout({ _id: 'user-id-123' }, res);
    expect(mockAuthService.logout).toHaveBeenCalledWith('user-id-123', res);
  });

  it('delegates forgotPasswordReset to OtpService', async () => {
    mockOtpService.forgotPasswordReset.mockResolvedValue({ message: 'Password updated successfully' });
    const dto = {
      identifier: 'a@b.com',
      otp: '123456',
      newPassword: 'NewPass@1',
      confirmPassword: 'NewPass@1',
    };

    const result = await controller.forgotPasswordReset(dto as any);

    expect(mockOtpService.forgotPasswordReset).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: 'Password updated successfully' });
  });
});
