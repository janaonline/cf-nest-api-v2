import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import type { Response } from 'express';
import axios from 'axios';
import { UserDocument } from 'src/schemas/user/user.schema';
import { Role } from './enum/role.enum';
import { UsersRepository } from 'src/users/users.repository';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AuthResponse, AuthTokens } from './types/auth-tokens.type';
import type { StringValue } from 'ms';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  async getUserById(id: string) {
    const u = await this.usersRepository.findById(id);
    return u
      ? { email: u.email, role: u.role, isActive: u.isActive, ulb: u.ulb, state: u.state }
      : null;
  }

  async login(dto: LoginDto, res: Response): Promise<AuthResponse> {
    const isEmail = dto.email.includes('@');
    const invalidMsg = isEmail ? 'Invalid email or password' : 'Invalid ULB Code/Census Code or password';

    const user = await this.usersRepository.findByIdentifierWithSensitiveFields(dto.email);
    if (!user) throw new UnauthorizedException(invalidMsg);

    if (user.status === 'PENDING') throw new ForbiddenException('Waiting for admin action on request.');
    if (user.status === 'REJECTED') throw new ForbiddenException(`Your request has been rejected. Reason: ${user.rejectReason}`);
    if (!user.isEmailVerified) {
      const url = `${this.configService.get<string>('HOSTNAME')}/account-reactivate`;
      throw new ForbiddenException(`Email not verified yet. Please <a href='${url}'>click here</a> to send the activation link on your registered email`);
    }
    if (user.role === Role.ULB && isEmail) throw new ForbiddenException('Please use ULB Code/Census Code for login');

    const userId = (user._id as { toString(): string }).toString();

    if (user.isLocked) {
      if (!user.lockUntil || Date.now() < user.lockUntil) {
        throw new ForbiddenException('Your account is temporarily locked for 1 hour');
      }
      await this.usersRepository.resetLoginAttempts(userId);
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      await this.usersRepository.incrementLoginAttempts(userId);
      throw new UnauthorizedException(invalidMsg);
    }

    if (user.loginAttempts > 0) {
      await this.usersRepository.resetLoginAttempts(userId);
    }

    const tokens = await this.generateTokens(userId);
    await this.saveRefreshToken(userId, tokens.refreshToken);
    await this.usersRepository.updateLastLogin(userId);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { token: tokens.accessToken, user: this.sanitizeUser(user) };
  }

  async logout(userId: string, res: Response): Promise<{ success: boolean }> {
    await this.usersRepository.updateRefreshToken(userId, null);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  async refreshTokens(userId: string, refreshToken: string, res: Response): Promise<AuthResponse> {
    const user = await this.usersRepository.findByIdWithRefreshToken(userId);
    if (!user?.refreshTokenHash) throw new HttpException('Session expired', 440);

    const valid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!valid) {
      await this.usersRepository.updateRefreshToken(userId, null);
      throw new HttpException('Session expired', 440);
    }

    const tokens = await this.generateTokens(userId);
    await this.saveRefreshToken(userId, tokens.refreshToken);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { token: tokens.accessToken, user: this.sanitizeUser(user) };
  }

  async register(dto: RegisterDto): Promise<Record<string, unknown>> {
    const exists = await this.usersRepository.exists(dto.email);
    if (exists) throw new ConflictException('Email already registered');

    const hash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersRepository.create({ name: dto.name, email: dto.email, password: hash });
    return this.sanitizeUser(user);
  }

  async validateRefreshToken(userId: string, token: string): Promise<UserDocument | null> {
    const user = await this.usersRepository.findByIdWithRefreshToken(userId);
    if (!user?.refreshTokenHash) return null;
    const valid = await bcrypt.compare(token, user.refreshTokenHash);
    return valid ? user : null;
  }

  async validateCaptcha(token: string): Promise<{ success: boolean; message: string }> {
    const secret = this.configService.get<string>('RECAPTCHA_SECRET_KEY');
    try {
      const { data } = await axios.post<{ success: boolean; 'error-codes'?: string[] }>(
        'https://www.google.com/recaptcha/api/siteverify',
        null,
        { params: { secret, response: token } },
      );
      return { success: data.success, message: data.success ? 'Captcha verified' : 'Captcha verification failed' };
    } catch {
      return { success: false, message: 'Captcha service unavailable' };
    }
  }

  async sendOtp(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) return { success: true, message: 'OTP sent if account exists' };

    const rateLimitKey = `otp_rate:${email}`;
    const limited = await this.cacheManager.get(rateLimitKey);
    if (limited) throw new HttpException('Please wait before requesting another OTP', 429);

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const ttlSeconds = parseInt(this.configService.get<string>('OTP_TTL_SECONDS') ?? '300', 10);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.usersRepository.updateOtp((user._id as { toString(): string }).toString(), {
      hash: otpHash,
      expiresAt,
      attempts: 0,
    });
    await this.cacheManager.set(rateLimitKey, true, 60000);

    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      this.logger.debug(`OTP for ${email}: ${otp}`);
    }
    return { success: true, message: 'OTP sent if account exists' };
  }

  async verifyOtp(dto: VerifyOtpDto, res: Response): Promise<AuthResponse> {
    const user = await this.usersRepository.findByEmailWithSensitiveFields(dto.email);
    if (!user?.otpHash) throw new HttpException('OTP expired or not requested', 422);

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      await this.usersRepository.clearOtp((user._id as { toString(): string }).toString());
      throw new HttpException('OTP has expired', 422);
    }
    if (user.otpAttempts >= 3) throw new HttpException('Too many attempts, request a new OTP', 429);

    const valid = await bcrypt.compare(dto.otp, user.otpHash);
    if (!valid) {
      await this.usersRepository.incrementOtpAttempts((user._id as { toString(): string }).toString());
      throw new HttpException('Invalid OTP', 422);
    }

    const userId = (user._id as { toString(): string }).toString();
    await this.usersRepository.clearOtp(userId);
    const tokens = await this.generateTokens(userId);
    await this.saveRefreshToken(userId, tokens.refreshToken);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { token: tokens.accessToken, user: this.sanitizeUser(user) };
  }

  private async generateTokens(userId: string): Promise<AuthTokens> {
    const jwtExpires = (this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue;
    const refreshExpires = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as StringValue;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId },
        { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: jwtExpires },
      ),
      this.jwtService.signAsync(
        { sub: userId },
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: refreshExpires },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string): Promise<void> {
    const hash = await bcrypt.hash(token, 10);
    await this.usersRepository.updateRefreshToken(userId, hash);
  }

  private setRefreshCookie(res: Response, token: string): void {
    const cookieName = this.configService.get<string>('REFRESH_COOKIE_NAME') ?? 'refresh_token';
    const maxAge = parseInt(this.configService.get<string>('REFRESH_COOKIE_MAX_AGE_MS') ?? '604800000', 10);
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge,
      path: '/',
    });
  }

  private clearRefreshCookie(res: Response): void {
    const cookieName = this.configService.get<string>('REFRESH_COOKIE_NAME') ?? 'refresh_token';
    res.cookie(cookieName, '', { httpOnly: true, maxAge: 0, path: '/' });
  }

  private sanitizeUser(user: UserDocument): Record<string, unknown> {
    const obj = (user.toObject ? user.toObject() : { ...user }) as unknown as Record<string, unknown>;
    delete obj['password'];
    delete obj['refreshTokenHash'];
    delete obj['otpHash'];
    delete obj['otpAttempts'];
    delete obj['otpExpiresAt'];
    delete obj['loginAttempts'];
    delete obj['lockUntil'];
    delete obj['isLocked'];
    delete obj['passwordHistory'];
    delete obj['passwordExpires'];
    return obj;
  }
}
