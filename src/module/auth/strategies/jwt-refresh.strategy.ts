import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { JwtRefreshPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  private readonly cookieName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const cookieName = configService.get<string>('REFRESH_COOKIE_NAME') ?? 'refresh_token';
    const options: StrategyOptionsWithRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies as Record<string, string> | undefined)?.[cookieName] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET') as string,
      passReqToCallback: true,
    };
    super(options);
    this.cookieName = cookieName;
  }

  async validate(req: Request, payload: JwtRefreshPayload) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[this.cookieName];
    if (!refreshToken) throw new HttpException('No refresh token', 440);

    const user = await this.authService.validateRefreshToken(payload.sub, refreshToken);
    if (!user) throw new HttpException('Session expired', 440);

    return { ...user.toObject(), refreshToken };
  }
}
