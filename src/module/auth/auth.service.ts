/* eslint-disable prettier/prettier */
import { randomUUID } from 'crypto';
import { ConflictException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import axios from 'axios';
import type { StringValue } from 'ms';
import { Model, Types } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { UserDocument } from 'src/schemas/user/user.schema';
import { LoginHistory, LoginType } from 'src/schemas/user/login-history.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UsersRepository } from 'src/module/users/users.repository';
import { RegisterDto } from './dto/register.dto';
import { AuthResponse, AuthTokens } from './types/auth-tokens.type';
import { Role } from './enum/role.enum';
import { buildUserResponsePayload } from './auth-user-response.helper';

// Maps generateTokens()'s `purpose` param (raw DTO `type` values, e.g. login.dto.ts's '16thFC')
// to a valid LoginHistory `loginType`. Callers that pass something else (e.g. the literal 'WEB'
// used by OTP-login and profile-completion logins, which are grant-cycle-agnostic by design)
// fall through undefined, leaving the schema's own `default: '15thFC'` in place.
const LOGIN_TYPE_MAP: Record<string, LoginType> = {
  '15thFC': '15thFC',
  '16thFC': '16thFC',
  XVIFC: 'XVIFC', // distinct from '16thFC' — stored as whatever the login payload's `type` sent
  AAINA: 'AAINA',
  'state-dashboard': 'state-dashboard',
  fiscalRankings: 'fiscalRankings',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectModel(LoginHistory.name) private readonly loginHistoryModel: Model<LoginHistory>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
  ) {}

  async getUserById(id: string) {
    const u = await this.usersRepository.findById(id);
    return u ? { email: u.email, role: u.role, isActive: u.isActive, ulb: u.ulb, state: u.state } : null;
  }

  async logout(userId: string, res: Response, sessionId?: string, exp?: number): Promise<{ success: boolean }> {
    if (sessionId && exp) {
      const ttl = exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redisService.set(`bl:${sessionId}`, '1', ttl);
      }
    }
    await this.usersRepository.updateRefreshToken(userId, null);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  async refreshTokens(userId: string, refreshToken: string, res: Response): Promise<AuthResponse> {
    // console.log('Refreshing tokens for user:', userId, 'with refresh, token:', refreshToken);
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

    // Mirrors login()'s own state/ulb lookups so the refreshed user payload never drifts out of
    // sync with what login returns (see buildUserResponsePayload's doc comment) — unlike login,
    // this never throws on a stale/inactive reference; a silent background token refresh should
    // degrade gracefully (missing derived fields), never log the user out over a data nuance.
    const state = user.state ? await this.stateModel.findById(user.state).exec() : null;
    const ulb = user.role === Role.ULB ? await this.ulbModel.findOne({ _id: user.ulb }).exec() : null;

    return { token: tokens.accessToken, user: buildUserResponsePayload(user, state, ulb) };
  }
  // TODO: to be removed
  // async register(dto: RegisterDto): Promise<Record<string, unknown>> {
  //   const exists = await this.usersRepository.exists(dto.email);
  //   if (exists) throw new ConflictException('Email already registered');

  //   const hash = await bcrypt.hash(dto.password, 12);
  //   const user = await this.usersRepository.create({ name: dto.name, email: dto.email, password: hash });
  //   return this.sanitizeUser(user);
  // }

  async validateRefreshToken(userId: string, token: string): Promise<UserDocument | null> {
    const user = await this.usersRepository.findByIdWithRefreshToken(userId);
    if (!user?.refreshTokenHash) return null;
    const valid = await bcrypt.compare(token, user.refreshTokenHash);
    return valid ? user : null;
  }

  async setNewPassword(
    userId: string,
    newPassword: string,
    saveToken: string,
    profile?: { name?: string; mobile?: string; designation?: string },
  ): Promise<{ ok: boolean }> {
    const tokenKey = `profile_save_token:${userId}`;
    const stored = await this.redisService.get(tokenKey);
    if (!stored || stored !== saveToken) {
      throw new UnauthorizedException('Invalid or expired verification token. Please verify your email again.');
    }
    await this.redisService.del(tokenKey);

    const hash = await bcrypt.hash(newPassword, 12);
    await this.usersRepository.updatePassword(userId, hash);

    const user = await this.usersRepository.findByIdSelect<{
      state?: unknown;
      isNodalOfficer?: boolean;
      role?: string;
      xviFcSubrole?: string | null;
    }>(userId, 'state isNodalOfficer role xviFcSubrole');

    const profileUpdate: Record<string, unknown> = {
      isNewUser: false,
      isXVIFCProfileVerified: true,
      isXviFcEmailVerified: true,
      isXviFcdeleted: false,
      ...(profile?.name && { name: profile.name }),
      ...(profile?.mobile && { mobile: profile.mobile }),
      ...(profile?.designation && { designation: profile.designation }),
    };

    // Only derive subrole if one has not been manually assigned already
    if (user?.role === 'STATE' && user.state && !user.xviFcSubrole) {
      profileUpdate['xviFcSubrole'] = user.isNodalOfficer ? 'admin' : 'reviewer';
    }

    await this.usersRepository.updateProfile(userId, profileUpdate);

    // Assign subroles for other unverified STATE users in the same state
    if (user?.role === 'STATE' && user.state) {
      await this.usersRepository.assignStateSubroles(user.state as never);
    }

    return { ok: true };
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

  async generateTokens(userId: string, purpose = 'WEB'): Promise<AuthTokens> {
    const jwtExpires = (this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue;
    const refreshExpires = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as StringValue;

    // Create a login history record for this session — gives us lh_id
    const loginType = LOGIN_TYPE_MAP[purpose];
    const lhDoc = await this.loginHistoryModel.create({
      user: new Types.ObjectId(userId),
      ...(loginType ? { loginType } : {}),
    });
    const lhId = (lhDoc._id as Types.ObjectId).toString();

    const payload = {
      _id: userId,
      lh_id: lhId,
      sessionId: randomUUID(),
      purpose,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: jwtExpires,
      }),
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

    if (typeof value === 'object' && value !== null && '_id' in value) {
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
}
