/* eslint-disable prettier/prettier */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { RedisService } from 'src/core/services/redis/redis.service';
import { UsersRepository } from 'src/users/users.repository';
import { JwtPayload } from '../types/jwt-payload.type';
import { parseUserRole } from '../roles-xvi-fc.helper';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly redisService: RedisService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }

    // Accept token from Authorization: Bearer header or x-access-token header
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => (req?.headers?.['x-access-token'] as string | undefined) ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    };
    super(options);
  }

  async validate(payload: JwtPayload) {
    // Reject tokens explicitly invalidated on logout (Redis blacklist keyed by sessionId)
    if (payload.sessionId) {
      const blacklisted = await this.redisService.get(`bl:${payload.sessionId}`);
      if (blacklisted) throw new UnauthorizedException('Your session has expired. Please log in again to continue.');
    }
    const user = await this.usersRepository.findById(payload._id);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    // scope/accessLevel derived fresh from DB role — never from the JWT payload
    const parsedRole = parseUserRole(user.role as unknown as Parameters<typeof parseUserRole>[0]);
    return {
      _id: payload._id,
      role: user.role,
      scope: parsedRole?.scope ?? null,
      accessLevel: parsedRole?.accessLevel ?? null,
      ulb: user.ulb,
      state: user.state,
      isActive: user.isActive,
      sessionId: payload.sessionId,
      exp: payload.exp,
      permissionOverrides: user.permissionOverrides ?? { allow: [], deny: [] },
    };
  }
}
