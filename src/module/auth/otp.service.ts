import { Injectable, Logger, HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import type { StringValue } from 'ms';
import axios from 'axios';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { RedisService } from 'src/core/services/redis/redis.service';
import { UsersRepository } from 'src/users/users.repository';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AuthResponse, AuthTokens } from './types/auth-tokens.type';
import { generateOtp, getOtpConfig } from './otp/otp.config';
import {
  OtpState,
  normalizeIdentifier,
  otpCooldownKey,
  otpLockKey,
  otpStateKey,
} from './otp/otp-redis.types';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sesMailService: SESMailService,
    private readonly redisService: RedisService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  async sendOtp(dto: SendOtpDto): Promise<{
    success: boolean;
    message: string;
    mobile?: string;
    email?: string;
  }> {
    const purpose = dto.purpose ?? 'login';
    const id = normalizeIdentifier(dto.identifier);
    const cfg = getOtpConfig(this.configService);

    // Always return success shape even when user not found (no enumeration)
    const user = await this.usersRepository.findByIdentifier(id);
    if (!user) return { success: true, message: 'OTP sent if account exists' };

    await this.assertNotLocked(purpose, id);
    await this.assertCooldownClear(purpose, id);

    const existingState = await this.readOtpState(purpose, id);
    const resendCount = existingState?.resendCount ?? 0;

    if (resendCount >= cfg.maxResendAttempts) {
      throw new HttpException('Maximum OTP requests reached. Please try again later.', 429);
    }

    const otp = generateOtp(cfg.length, cfg.isProduction);
    const hashedOtp = await bcrypt.hash(otp, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + cfg.ttlSeconds * 1000);

    const state: OtpState = {
      hashedOtp,
      purpose,
      identifier: id,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      resendCount: resendCount + 1,
      verifyAttempts: 0,
    };

    await this.redisService.set(otpStateKey(purpose, id), state, cfg.ttlSeconds);
    // Cooldown key expires independently of the main state TTL
    await this.redisService.set(otpCooldownKey(purpose, id), '1', cfg.resendCooldownSeconds);

    await this.dispatchOtp(user, otp, cfg.isProduction);

    if (!cfg.isProduction) {
      this.logger.debug(`[DEV] OTP for ${id}: ${otp}`);
    }

    const mobile = user.role === 'STATE' ? user.mobile : user.accountantConatactNumber;
    return {
      success: true,
      message: 'OTP sent successfully',
      mobile: this.maskMobile(mobile),
      email: this.maskEmail(user.email),
    };
  }

  async verifyOtp(dto: VerifyOtpDto, res: Response): Promise<AuthResponse> {
    const purpose = 'login';
    const id = normalizeIdentifier(dto.identifier);
    const cfg = getOtpConfig(this.configService);

    await this.assertNotLocked(purpose, id);

    const state = await this.readOtpState(purpose, id);
    if (!state) throw new HttpException('Invalid or expired OTP', 422);

    if (new Date() > new Date(state.expiresAt)) {
      await this.redisService.del(otpStateKey(purpose, id));
      throw new HttpException('Invalid or expired OTP', 422);
    }

    if (state.verifyAttempts >= cfg.maxVerifyAttempts) {
      await this.triggerLock(purpose, id, cfg.lockSeconds);
      throw new HttpException('Too many attempts. Please request a new OTP.', 429);
    }

    // bcrypt.compare provides constant-time comparison
    const valid = await bcrypt.compare(dto.otp, state.hashedOtp);

    if (!valid) {
      state.verifyAttempts += 1;

      if (state.verifyAttempts >= cfg.maxVerifyAttempts) {
        await this.triggerLock(purpose, id, cfg.lockSeconds);
        await this.redisService.del(otpStateKey(purpose, id));
        throw new HttpException('Too many attempts. Please request a new OTP.', 429);
      }

      // Persist updated attempt count; recalculate remaining TTL to avoid extending it
      const remainingTtl = Math.max(
        1,
        Math.ceil((new Date(state.expiresAt).getTime() - Date.now()) / 1000),
      );
      await this.redisService.set(otpStateKey(purpose, id), state, remainingTtl);
      throw new HttpException('Invalid or expired OTP', 422);
    }

    // ── Success path ──────────────────────────────────────────────────────────
    // Remove OTP state immediately so it cannot be replayed
    await this.redisService.del(otpStateKey(purpose, id));

    const user = await this.usersRepository.findByIdentifier(id);
    if (!user) throw new UnauthorizedException('User not found');

    const userId = (user._id as { toString(): string }).toString();
    const tokens = await this.generateTokens(userId);
    await this.saveRefreshToken(userId, tokens.refreshToken);
    this.setRefreshCookie(res, tokens.refreshToken);

    return { token: tokens.accessToken, user: this.sanitizeUser(user) };
  }

  async forgotPasswordReset(dto: ResetPasswordDto): Promise<{ message: string }> {
    const purpose = 'forgot-password';
    const id = normalizeIdentifier(dto.identifier);
    const cfg = getOtpConfig(this.configService);

    await this.assertNotLocked(purpose, id);

    const state = await this.readOtpState(purpose, id);
    if (!state) throw new HttpException('Invalid or expired OTP', 422);

    if (new Date() > new Date(state.expiresAt)) {
      await this.redisService.del(otpStateKey(purpose, id));
      throw new HttpException('Invalid or expired OTP', 422);
    }

    if (state.verifyAttempts >= cfg.maxVerifyAttempts) {
      await this.triggerLock(purpose, id, cfg.lockSeconds);
      throw new HttpException('Too many attempts. Please request a new OTP.', 429);
    }

    const valid = await bcrypt.compare(dto.otp, state.hashedOtp);

    if (!valid) {
      state.verifyAttempts += 1;

      if (state.verifyAttempts >= cfg.maxVerifyAttempts) {
        await this.triggerLock(purpose, id, cfg.lockSeconds);
        await this.redisService.del(otpStateKey(purpose, id));
        throw new HttpException('Too many attempts. Please request a new OTP.', 429);
      }

      const remainingTtl = Math.max(
        1,
        Math.ceil((new Date(state.expiresAt).getTime() - Date.now()) / 1000),
      );
      await this.redisService.set(otpStateKey(purpose, id), state, remainingTtl);
      throw new HttpException('Invalid or expired OTP', 422);
    }

    await this.redisService.del(otpStateKey(purpose, id));

    const user = await this.usersRepository.findByIdentifier(id);
    if (!user) throw new UnauthorizedException('User not found');

    const userId = (user._id as { toString(): string }).toString();
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.usersRepository.updatePassword(userId, hashedPassword);

    return { message: 'Password updated successfully' };
  }

  // ─── Redis state helpers ────────────────────────────────────────────────────

  private async readOtpState(purpose: string, id: string): Promise<OtpState | null> {
    const raw = await this.redisService.get(otpStateKey(purpose, id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OtpState;
    } catch {
      return null;
    }
  }

  private async assertNotLocked(purpose: string, id: string): Promise<void> {
    const locked = await this.redisService.get(otpLockKey(purpose, id));
    if (locked) throw new HttpException('Too many attempts. Please try again later.', 429);
  }

  private async assertCooldownClear(purpose: string, id: string): Promise<void> {
    const cooling = await this.redisService.get(otpCooldownKey(purpose, id));
    if (cooling) throw new HttpException('Please wait before requesting another OTP.', 429);
  }

  private async triggerLock(purpose: string, id: string, lockSeconds: number): Promise<void> {
    await this.redisService.set(otpLockKey(purpose, id), '1', lockSeconds);
    this.logger.warn(`OTP lockout triggered for ${purpose}:${id}`);
  }

  // ─── OTP dispatch ──────────────────────────────────────────────────────────

  private async dispatchOtp(
    user: Awaited<ReturnType<UsersRepository['findByIdentifier']>>,
    otp: string,
    isProduction: boolean,
  ): Promise<void> {
    if (!user || !isProduction) return;
    const mobile = user.role === 'STATE' ? user.mobile : user.accountantConatactNumber;
    if (mobile && this.isValidPhone(mobile)) await this.sendSms(mobile, otp);
    if (user.email) await this.sendOtpEmail(user.email, otp);
  }

  private isValidPhone(mobile: string): boolean {
    return /^\d{10}$/.test(String(mobile).trim());
  }

  private async sendSms(mobile: string, otp: string): Promise<void> {
    const authKey = this.configService.get<string>('MSG91_AUTH_KEY');
    const templateId = this.configService.get<string>('TEMPLATE_ID');
    if (!authKey) {
      this.logger.warn('MSG91_AUTH_KEY not configured — skipping SMS');
      return;
    }
    try {
      await axios.get('https://api.msg91.com/api/v5/otp', {
        params: { template_id: templateId, mobile: `91${mobile}`, authkey: authKey, otp },
      });
    } catch (err) {
      this.logger.error('SMS OTP send failed', err);
    }
  }

  private async sendOtpEmail(to: string, otp: string): Promise<void> {
    const from = this.configService.get<string>('EMAIL') ?? 'updates@cityfinance.in';
    const prodHost = this.configService.get<string>('PROD_HOST') ?? 'cityfinance.in';
    const msg = `Your OTP to login into CityFinance.in is ${otp}. Do not share this code. If not requested, contact us at contact@${prodHost} - City Finance`;
    try {
      await this.sesMailService.sendEmail({
        to,
        subject: 'Authentication Mail',
        html: `<p>${msg}</p>`,
        from,
        templateName: 'otp',
      });
    } catch (err) {
      this.logger.error('Email OTP send failed', err);
    }
  }

  // ─── Token helpers ─────────────────────────────────────────────────────────

  private async generateTokens(userId: string): Promise<AuthTokens> {
    const jwtExpires = (this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue;
    const refreshExpires = (
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d'
    ) as StringValue;

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
    const maxAge = parseInt(
      this.configService.get<string>('REFRESH_COOKIE_MAX_AGE_MS') ?? '604800000',
      10,
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge,
      path: '/',
    });
  }

  // ─── Formatting helpers ─────────────────────────────────────────────────────

  private maskMobile(mobile = ''): string {
    const s = String(mobile);
    if (!s || s.length <= 4) return s.replace(/\d/g, '*');
    return `${s.slice(0, 2)}${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-2)}`;
  }

  private maskEmail(email = ''): string {
    const atIdx = email.indexOf('@');
    if (atIdx === -1) return email;
    const local = email.slice(0, atIdx);
    const domain = email.slice(atIdx + 1);
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(0, local.length - 2))}@${domain}`;
  }

  private sanitizeUser(user: NonNullable<Awaited<ReturnType<UsersRepository['findByIdentifier']>>>): Record<string, unknown> {
    const obj = (
      typeof (user as unknown as { toObject?: () => Record<string, unknown> }).toObject === 'function'
        ? (user as unknown as { toObject: () => Record<string, unknown> }).toObject()
        : { ...(user as unknown as Record<string, unknown>) }
    ) as Record<string, unknown>;
    const sensitiveFields = [
      'password', 'refreshTokenHash', 'otpHash', 'otpAttempts',
      'otpExpiresAt', 'loginAttempts', 'lockUntil', 'isLocked',
      'passwordHistory', 'passwordExpires',
    ];
    for (const f of sensitiveFields) delete obj[f];
    return obj;
  }
}
