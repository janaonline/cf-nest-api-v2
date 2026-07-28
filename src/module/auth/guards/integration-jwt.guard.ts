import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ApiClientService } from 'src/module/api-clients/services/api-client.service';
import type { ApiClientContext } from '../types/api-client-context.type';

type JwtApiClientPayload = {
  sub: string;
  clientId: string;
  actorType: 'STATE' | 'ULB';
  stateId: string;
  ulbId?: string;
  scopes: string[];
};

type RequestWithApiClient = Request & { apiClient?: ApiClientContext };

@Injectable()
export class IntegrationJwtGuard implements CanActivate {
  private readonly logger = new Logger(IntegrationJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly apiClientService: ApiClientService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiClient>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    let payload: JwtApiClientPayload;
    try {
      const secret =
        this.config.get<string>('DATA_COLLECTION_JWT_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? '';
      payload = await this.jwtService.verifyAsync<JwtApiClientPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const client = await this.apiClientService.findById(payload.sub);
    if (!client || client.status !== 'ACTIVE') {
      this.logger.warn(`API client inactive or missing: ${payload.sub}`);
      throw new UnauthorizedException('Invalid token');
    }

    request.apiClient = {
      apiClientId: client._id.toString(),
      clientId: client.clientId,
      actorType: client.actorType,
      stateId: client.stateId.toString(),
      ulbId: client.ulbId?.toString(),
      scopes: client.scopes,
    };

    return true;
  }

  private extractBearerToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (typeof auth === 'string') {
      const [scheme, token] = auth.split(' ');
      if (scheme === 'Bearer' && token) return token;
    }
    return undefined;
  }
}
