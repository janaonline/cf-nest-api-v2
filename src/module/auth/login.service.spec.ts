jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('mock-hash'),
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Adc } from 'src/schemas/adc.schema';
import { Year } from 'src/schemas/year.schema';
import { UsersRepository } from 'src/module/users/users.repository';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';
import { AuthService } from './auth.service';
import { LoginService } from './login.service';

const mockLoginUser = {
  _id: { toString: () => 'user-id-123' },
  email: 'test@example.com',
  role: 'USER',
  password: 'hashed-password',
  status: undefined,
  isEmailVerified: true,
  isLocked: false,
  lockUntil: null,
  loginAttempts: 0,
  name: 'Test User',
  isActive: true,
  ulb: null,
  state: null,
  designation: 'Test',
  isVerified2223: false,
};

const mockUsersRepository = {
  findByIdentifierWithSensitiveFields: jest.fn(),
  updateRefreshToken: jest.fn(),
  updateLastLogin: jest.fn(),
  resetLoginAttempts: jest.fn(),
  incrementLoginAttempts: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn().mockResolvedValue('mock-token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_SECRET: 'secret',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '7d',
      REFRESH_COOKIE_NAME: 'refresh_token',
      REFRESH_COOKIE_MAX_AGE_MS: '604800000',
      NODE_ENV: 'test',
    };
    return map[key];
  }),
};

const mockStateModel = {
  findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
};

const mockUlbModel = {
  findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
};

const mockYearModel = {
  find: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  }),
};

const mockAuthService = {
  generateTokens: jest.fn().mockResolvedValue({ accessToken: 'mock-token', refreshToken: 'mock-refresh' }),
  saveRefreshToken: jest.fn().mockResolvedValue(undefined),
  setRefreshCookie: jest.fn(),
};

const mockUlbEligibilityService = {
  isUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(true),
};

const mockRes = { cookie: jest.fn() } as unknown as Response;

describe('LoginService', () => {
  let service: LoginService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: AuthService, useValue: mockAuthService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getModelToken(State.name), useValue: mockStateModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Adc.name), useValue: { find: jest.fn(), findById: jest.fn(), exists: jest.fn() } },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
      ],
    }).compile();

    service = module.get<LoginService>(LoginService);
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('mock-token');
    mockUsersRepository.updateRefreshToken.mockResolvedValue(undefined);
    mockAuthService.generateTokens.mockResolvedValue({ accessToken: 'mock-token', refreshToken: 'mock-refresh' });
    mockAuthService.saveRefreshToken.mockResolvedValue(undefined);
    mockAuthService.setRefreshCookie.mockImplementation(() => undefined);
    mockUsersRepository.updateLastLogin.mockResolvedValue(undefined);
    mockUsersRepository.resetLoginAttempts.mockResolvedValue(undefined);
    mockUsersRepository.incrementLoginAttempts.mockResolvedValue(undefined);
    mockStateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockUlbModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockUlbEligibilityService.isUlbEligibleForGrantCycle.mockResolvedValue(true);
    mockYearModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login()', () => {
    it('returns token and user on valid credentials', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockLoginUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes);
      expect(result.token).toBe('mock-token');
    });

    it('throws 401 when user not found (same message as wrong password)', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(null);
      await expect(service.login({ identifier: 'no@example.com', password: 'pass' }, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 when password mismatch (same message)', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockLoginUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.login({ identifier: 'test@example.com', password: 'wrong' }, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 403 when email is not verified', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        isEmailVerified: false,
      });
      await expect(service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 403 when account is locked', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        isLocked: true,
        lockUntil: Date.now() + 3600000,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 403 when account status is PENDING', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        status: 'PENDING',
      });
      await expect(service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 403 when account status is REJECTED', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        status: 'REJECTED',
        rejectReason: 'Duplicate account',
      });
      await expect(service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes)).rejects.toThrow(
        ForbiddenException,
      );
    });

    describe('Cantonment Board / XVI-FC eligibility gate', () => {
      const mockUlbUser = {
        ...mockLoginUser,
        role: 'ULB',
        ulb: { toString: () => 'ulb-id-123' },
      };
      const mockUlbDoc = { _id: 'ulb-id-123', code: 'ULB001', isUA: 'No', isMillionPlus: 'No' };

      beforeEach(() => {
        mockUlbModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockUlbDoc) });
      });

      it('throws 403 with the Cantonment Board message when the ULB is ineligible for XVIFC', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockUlbUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        mockUlbEligibilityService.isUlbEligibleForGrantCycle.mockResolvedValue(false);

        await expect(
          service.login({ identifier: 'ULB001', password: 'pass', type: '16thFC' }, mockRes),
        ).rejects.toThrow(new ForbiddenException(CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE));
      });

      it('does not leak eligibility before credentials are validated — wrong password still yields the generic message', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockUlbUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);
        mockUlbEligibilityService.isUlbEligibleForGrantCycle.mockResolvedValue(false);

        await expect(
          service.login({ identifier: 'ULB001', password: 'wrong', type: '16thFC' }, mockRes),
        ).rejects.toThrow(UnauthorizedException);
        expect(mockUlbEligibilityService.isUlbEligibleForGrantCycle).not.toHaveBeenCalled();
      });

      it('does not block an ineligible ULB logging in outside the XVI-FC context (e.g. 15thFC)', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockUlbUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        mockUlbEligibilityService.isUlbEligibleForGrantCycle.mockResolvedValue(false);

        const result = await service.login({ identifier: 'ULB001', password: 'pass', type: '15thFC' }, mockRes);
        expect(result.token).toBe('mock-token');
      });

      it('allows login when the ULB is eligible for XVIFC', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockUlbUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        mockUlbEligibilityService.isUlbEligibleForGrantCycle.mockResolvedValue(true);

        const result = await service.login({ identifier: 'ULB001', password: 'pass', type: '16thFC' }, mockRes);
        expect(result.token).toBe('mock-token');
      });
    });

    describe('role-check (TS-1262 unified sign-in picker)', () => {
      it('allows login when the picked role matches the account', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
          ...mockLoginUser,
          role: 'STATE',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const result = await service.login(
          { identifier: 'test@example.com', password: 'pass', role: 'STATE' },
          mockRes,
        );
        expect(result.token).toBe('mock-token');
      });

      it('rejects with the generic message, but only after the password has already been verified, when the picked role does not match', async () => {
        // The role check must run AFTER bcrypt.compare, not before — otherwise a wrong-role guess
        // short-circuits at a different cost/code-path than a wrong-password guess, letting an
        // attacker who knows an identifier learn its role bucket (and, for a PENDING/REJECTED/
        // locked account, its status) without ever supplying a valid password. See the comment
        // above the role-check in login.service.ts for the full reasoning.
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
          ...mockLoginUser,
          role: 'STATE',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        await expect(
          service.login({ identifier: 'test@example.com', password: 'pass', role: 'ULB' }, mockRes),
        ).rejects.toThrow(UnauthorizedException);
        expect(bcrypt.compare).toHaveBeenCalled();
      });

      it('does not let a role mismatch bypass the account-status checks (no status/role oracle)', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
          ...mockLoginUser,
          role: 'STATE',
          status: 'PENDING',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        // A mismatched role on a PENDING account must still surface the PENDING message, not the
        // generic one — proving the status check runs before the role check can ever short-circuit.
        await expect(
          service.login({ identifier: 'test@example.com', password: 'pass', role: 'ULB' }, mockRes),
        ).rejects.toThrow(new ForbiddenException('Waiting for admin action on request.'));
      });

      it('rejects a wrong password with the generic message even when the picked role is also wrong (no timing shortcut)', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
          ...mockLoginUser,
          role: 'STATE',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(
          service.login({ identifier: 'test@example.com', password: 'wrong', role: 'ULB' }, mockRes),
        ).rejects.toThrow(UnauthorizedException);
        expect(bcrypt.compare).toHaveBeenCalled();
      });

      it('skips the check entirely for a role with no picker tile (e.g. ADMIN)', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
          ...mockLoginUser,
          role: 'ADMIN',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const result = await service.login({ identifier: 'test@example.com', password: 'pass', role: 'ULB' }, mockRes);
        expect(result.token).toBe('mock-token');
      });

      it('enforces nothing when no role is sent at all (backward compatible)', async () => {
        mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
          ...mockLoginUser,
          role: 'STATE',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const result = await service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes);
        expect(result.token).toBe('mock-token');
      });

      it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
        'rejects an inherited Object property name (%s) as a role with 401, not a 500',
        async (role) => {
          mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
            ...mockLoginUser,
            role: 'STATE',
          });
          (bcrypt.compare as jest.Mock).mockResolvedValue(true);

          await expect(
            service.login({ identifier: 'test@example.com', password: 'pass', role }, mockRes),
          ).rejects.toThrow(UnauthorizedException);
        },
      );
    });
  });

  describe('resolveStateName()', () => {
    it('returns null when there is no state id', async () => {
      await expect(service.resolveStateName(null)).resolves.toBeNull();
    });

    it('resolves the state document name', async () => {
      mockStateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ name: 'Kerala' }) });
      await expect(service.resolveStateName('state-id-1')).resolves.toBe('Kerala');
    });

    it('returns null when the state id does not resolve to a document', async () => {
      mockStateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.resolveStateName('missing-id')).resolves.toBeNull();
    });
  });
});
