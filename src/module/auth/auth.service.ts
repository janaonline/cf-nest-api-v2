/* eslint-disable prettier/prettier */
import { randomUUID } from 'crypto';
import { ConflictException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import axios from 'axios';
import type { StringValue } from 'ms';
import { RedisService } from 'src/core/services/redis/redis.service';
import { UserDocument } from 'src/schemas/user/user.schema';
import { UsersRepository } from 'src/users/users.repository';
import { RegisterDto } from './dto/register.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthResponse, AuthTokens } from './types/auth-tokens.type';
import { parseUserRole } from './roles-xvi-fc.helper';
import { Types } from 'mongoose';
import { UserRole } from './otp/otp-contracts';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) { }

  async getUserById(id: string) {
    const u = await this.usersRepository.findById(id);
    return u ? { email: u.email, role: u.role, isActive: u.isActive, ulb: u.ulb, state: u.state } : null;
  }

  async logout(userId: string, res: Response, jti?: string, exp?: number): Promise<{ success: boolean }> {
    if (jti && exp) {
      const ttl = exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redisService.set(`bl:${jti}`, '1', ttl);
      }
    }
    await this.usersRepository.updateRefreshToken(userId, null);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  async refreshTokens(userId: string, refreshToken: string, res: Response): Promise<AuthResponse> {
    console.log('Refreshing tokens for user:', userId, 'with refresh, token:', refreshToken);
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

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Record<string, unknown>> {
    const { mobileNumber, commissionerContactNumber, accountantContactNumber, ...rest } = dto;
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }
    if (mobileNumber !== undefined) update['mobile'] = mobileNumber;
    if (commissionerContactNumber !== undefined) update['commissionerConatactNumber'] = commissionerContactNumber;
    if (accountantContactNumber !== undefined) update['accountantConatactNumber'] = accountantContactNumber;

    const updated = await this.usersRepository.updateProfile(userId, update);
    if (!updated) throw new HttpException('User not found', 404);

    return { message: 'Profile updated successfully', updatedFields: update };
  }

  async setPassword(dto: SetPasswordDto): Promise<{ message: string }> {
    const user = await this.usersRepository.findByIdentifier(dto.identifier);
    if (!user) throw new NotFoundException('User not found. Please check your details.');

    const hash = await bcrypt.hash(dto.newPassword, 12);
    const userId = (user._id as { toString(): string }).toString();
    await this.usersRepository.updatePassword(userId, hash);
    await this.usersRepository.updateProfile(userId, { isActive: true, status: 'APPROVED', isXVIFCProfileVerified: true });

    return { message: 'Password updated successfully' };
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

  async generateTokens(userId: string): Promise<AuthTokens> {
    const jwtExpires = (this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue;
    const refreshExpires = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as StringValue;
     const user = await this.usersRepository.findById(userId);

  if (!user) {
    throw new UnauthorizedException('User not found');
  }

  // user.role may come from a different UserRole declaration (otp-contracts)
  // cast to any to avoid incompatible type errors between separate enum declarations
  const parsedRole = parseUserRole(user.role as unknown as any);

  const payload = {
    sub: userId,
    role: user.role,
    ...(parsedRole && {
      scope: parsedRole.scope,
      accessLevel: parsedRole.accessLevel,
    }),
    ulb: this.toObjectIdString(user.ulb),
    state: this.toObjectIdString(user.state),
    jti: randomUUID(),
  };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
          payload,
        { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: jwtExpires },
      ),
      this.jwtService.signAsync(
       { sub: userId },
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: refreshExpires },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  async saveRefreshToken(userId: string, token: string): Promise<void> {
    const hash = await bcrypt.hash(token, 10);
    await this.usersRepository.updateRefreshToken(userId, hash);
  }

  setRefreshCookie(res: Response, token: string): void {
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
  private toObjectIdString(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    '_id' in value
  ) {
    const id = (value as { _id?: unknown })._id;

    if (id instanceof Types.ObjectId) {
      return id.toString();
    }

    if (typeof id === 'string') {
      return id;
    }
  }

  return null;
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
