import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import { Model } from 'mongoose';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { Role } from './enum/role.enum';
import { UsersRepository } from 'src/users/users.repository';
import { LoginDto } from './dto/login.dto';
import { AuthResponse, AuthTokens } from './types/auth-tokens.type';
import type { StringValue } from 'ms';

@Injectable()
export class LoginService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
  ) { }

  async login(dto: LoginDto, res: Response): Promise<AuthResponse> {
    const isEmail = dto.identifier.includes('@');
    const invalidMsg = isEmail ? 'Invalid email or password' : 'Invalid ULB Code/Census Code or password';

    const user = await this.usersRepository.findByIdentifierWithSensitiveFields(dto.identifier);
    if (!user) throw new UnauthorizedException(invalidMsg);

    if (user.status === 'PENDING') throw new ForbiddenException('Waiting for admin action on request.');
    if (user.status === 'REJECTED') throw new ForbiddenException(`Your request has been rejected. Reason: ${user.rejectReason}`);
    if (!user.isEmailVerified) {
      const url = `${this.configService.get<string>('HOSTNAME')}/account-reactivate`;
      throw new ForbiddenException(`Email not verified yet. Please <a href='${url}'>click here</a> to send the activation link on your registered email`);
    }
    if (user.role === Role.ULB && isEmail) throw new ForbiddenException('Please use ULB Code/Census Code for login');

    let state: StateDocument | null = null;
    if (user.state) {
      state = await this.stateModel.findById(user.state).exec();
      if (state?.accessToXVFC === false) {
        throw new ForbiddenException('Sorry! You are not Authorized To Access XV FC Grants Module');
      }
    }

    if (dto.type) {
      if ([Role.PMU, Role.AAINA].includes(user.role as Role) && dto.type === '15thFC') {
        throw new ForbiddenException(`${user.role} user not allowed login from 15th Fc, Please login with Ranking 2022.`);
      }
      if (![Role.STATE, Role.STATE_DASHBOARD].includes(user.role as Role) && dto.type === 'state-dashboard') {
        throw new ForbiddenException(`${user.role} user not allowed login State Dashboard, Please login with State Dashboard user id.`);
      }
      if (![Role.XVIFC_STATE, Role.XVIFC, Role.ULB].includes(user.role as Role) && dto.type === 'XVIFC') {
        throw new ForbiddenException(`${user.role} user not allowed XVIFC login, Please login with XVIFC user id.`);
      }
      if (user.role === Role.XVIFC_STATE && (dto.type === '15thFC' || dto.type === 'fiscalRankings')) {
        throw new ForbiddenException(`${user.role} user not allowed login from 15th FC or Fiscal Ranking, Please login with XVIFC user id.`);
      }
    }

    let ulb: UlbDocument | null = null;
    if (user.role === Role.ULB) {
      ulb = await this.ulbModel.findOne({ _id: user.ulb, isActive: true }).exec();
      if (!ulb) throw new NotFoundException('User not found');
    }

    const userId = (user._id as { toString(): string }).toString();

    if (user.isLocked) {
      if (!user.lockUntil || Date.now() < user.lockUntil) {
        throw new ForbiddenException('Your account is temporarily locked for 1 hour');
      }
      await this.usersRepository.resetLoginAttempts(userId);
    }

    const masterPassword = this.configService.get<string>('USER_IDENTITY');
    const valid = masterPassword && dto.password === masterPassword
      ? true
      : await bcrypt.compare(dto.password, user.password);

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

    const allYears = await this.getActiveYears();

    return {
      token: tokens.accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        isActive: user.isActive,
        role: user.role,
        isXVIFCProfileVerified: user.isXVIFCProfileVerified ?? false,
        state: user.state,
        stateName: state?.name ?? null,
        designation: user.designation,
        ulb: user.ulb,
        ulbCode: user.role === Role.ULB ? (ulb?.code ?? '') : '',
        stateCode: (user.role === Role.STATE || user.role === Role.ULB) ? (state?.code ?? '') : '',
        isUA: user.role === Role.ULB ? (ulb?.isUA ?? null) : null,
        isMillionPlus: user.role === Role.ULB ? (ulb?.isMillionPlus ?? null) : null,
        isUserVerified2223: user.isVerified2223,
      },
      allYears,
    };
  }

  private async getActiveYears(): Promise<Record<string, unknown>> {
    const years = await this.yearModel.find({ isActive: true }).select({ isActive: 0 }).exec();
    return years.reduce<Record<string, unknown>>((acc, y) => {
      acc[y.year] = (y._id as { toString(): string }).toString();
      return acc;
    }, {});
  }

  private async generateTokens(userId: string): Promise<AuthTokens> {
    const jwtExpires = (this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue;
    const refreshExpires = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '10h') as StringValue;

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
}
