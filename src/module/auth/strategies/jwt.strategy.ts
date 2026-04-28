import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { RedisService } from 'src/core/services/redis/redis.service';
import { UsersRepository } from 'src/users/users.repository';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly redisService: RedisService,
  ) {
    // Accept token from Authorization: Bearer header or x-access-token header
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => (req?.headers?.['x-access-token'] as string | undefined) ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') as string,
    };
    super(options);
  }

  async validate(payload: JwtPayload) {
    // Reject tokens that were explicitly invalidated on logout (stored in Redis until natural expiry)
    if (payload.jti) {
      const blacklisted = await this.redisService.get(`bl:${payload.jti}`);
      if (blacklisted) throw new UnauthorizedException('Token has been revoked');
    }
    const user = await this.usersRepository.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    // jti and exp are forwarded so the logout handler can blacklist the token
    return {
      _id: payload.sub,
      role: user.role,
      ulb: user.ulb,
      state: user.state,
      isActive: user.isActive,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
