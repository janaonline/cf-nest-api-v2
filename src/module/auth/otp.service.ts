import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import type { Response } from 'express';
import axios from 'axios';
import type { StringValue } from 'ms';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { UserDocument } from 'src/schemas/user/user.schema';
import { UsersRepository } from 'src/users/users.repository';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AuthResponse, AuthTokens } from './types/auth-tokens.type';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sesMailService: SESMailService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  async sendOtp(dto: SendOtpDto): Promise<{
    success: boolean;
    message: string;
    mobile?: string;
    email?: string;
    requestId?: string;
  }> {
    const { email } = dto;

    const user = await this.usersRepository.findByIdentifier(email);
    if (!user) return { success: true, message: 'OTP sent if account exists' };

    const rateLimitKey = `otp_rate:${email}`;
    const limited = await this.cacheManager.get(rateLimitKey);
    if (limited) throw new HttpException('Please wait before requesting another OTP', 429);

    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const otpDigits = parseInt(this.configService.get<string>('OTP_DIGITS') ?? '4', 10);
    const min = Math.pow(10, otpDigits - 1);
    const max = Math.pow(10, otpDigits) - 1;
    const devOtp = '123456789'.slice(0, otpDigits);
    const otp = isProd ? crypto.randomInt(min, max).toString() : devOtp;

    const otpHash = await bcrypt.hash(otp, 10);
    const ttlSeconds = parseInt(this.configService.get<string>('OTP_TTL_SECONDS') ?? '300', 10);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const userId = (user._id as { toString(): string }).toString();

    await this.usersRepository.updateOtp(userId, { hash: otpHash, expiresAt, attempts: 0 });
    await this.cacheManager.set(rateLimitKey, true, 60000);

    const mobile = user.role === 'STATE' ? user.mobile : user.accountantConatactNumber;
    const prodHost = this.configService.get<string>('PROD_HOST') ?? 'cityfinance.in';
    const msg = `Your OTP to login into CityFinance.in is ${otp}. Do not share this code. If not requested, please contact us at contact@${prodHost} - City Finance`;

    if (isProd) {
      if (mobile && this.isValidPhone(mobile)) await this.sendSms(mobile, otp);
      if (user.email) await this.sendOtpEmail(user.email, msg);
    } else {
      this.logger.debug(`OTP for ${email}: ${otp}`);
    }

    return {
      success: true,
      message: 'OTP sent successfully',
      mobile: this.maskMobile(mobile),
      email: this.maskEmail(user.email),
      requestId: userId,
    };
  }

  async verifyOtp(dto: VerifyOtpDto, res: Response): Promise<AuthResponse> {
    const user = dto.requestId
      ? await this.usersRepository.findByIdWithOtpFields(dto.requestId)
      : await this.usersRepository.findByIdentifierWithOtpFields(dto.identifier);
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

  private maskMobile(mobile = ''): string {
    const digits = String(mobile);
    if (!digits || digits.length <= 4) return digits.replace(/\d/g, '*');
    return `${digits.slice(0, 2)}${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
  }

  private maskEmail(email = ''): string {
    const value = String(email);
    const atIdx = value.indexOf('@');
    if (atIdx === -1) return value;
    const localPart = value.slice(0, atIdx);
    const domain = value.slice(atIdx + 1);
    const visible = localPart.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(0, localPart.length - visible.length))}@${domain}`;
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
      this.logger.log(`SMS OTP sent to ${mobile}`);
    } catch (err) {
      this.logger.error('Failed to send SMS OTP', err);
    }
  }

  private async sendOtpEmail(to: string, msg: string): Promise<void> {
    const from = this.configService.get<string>('EMAIL') ?? 'updates@cityfinance.in';
    try {
      await this.sesMailService.sendEmail({
        to,
        subject: 'Authentication Mail',
        html: `<p>${msg}</p>`,
        from,
        templateName: 'otp',
      });
      this.logger.log(`Email OTP sent to ${to}`);
    } catch (err) {
      this.logger.error('Failed to send email OTP', err);
    }
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
