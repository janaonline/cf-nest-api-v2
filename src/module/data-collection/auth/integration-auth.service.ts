import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { Types } from 'mongoose';
import { TokenRequestDto } from 'src/module/api-clients/dto/token-request.dto';
import { ApiClientAuditLogService } from 'src/module/api-clients/services/api-client-audit-log.service';
import { ApiClientService } from 'src/module/api-clients/services/api-client.service';

const GENERIC_AUTH_ERROR = 'Invalid client credentials';

type TokenResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

@Injectable()
export class IntegrationAuthService {
  constructor(
    private readonly apiClientService: ApiClientService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogService: ApiClientAuditLogService,
  ) {}

  /**
   * Validates client credentials and issues a short-lived access token.
   * Always runs bcrypt even when client is not found to prevent timing attacks.
   * Logs success/failure to the audit log without blocking the response.
   * @param payload Client credentials from request body.
   * @param ip Request IP address (from @Ip() decorator).
   * @param userAgent User-Agent header value.
   * @returns Short-lived bearer token response.
   */
  async createToken(payload: TokenRequestDto, ip: string, userAgent?: string): Promise<TokenResponse> {
    const client = await this.apiClientService.findByClientIdWithSecret(payload.clientId);

    const storedHash = client?.secretHash ?? '$2b$12$invalid.hash.to.prevent.timing.attacks';
    const isValidSecret = await this.apiClientService.verifySecret(payload.clientSecret, storedHash);

    if (!client || !isValidSecret) {
      this.auditLogService.logTokenFailed({
        clientId: payload.clientId,
        ip,
        userAgent,
        failureReason: 'INVALID_CREDENTIALS',
      });
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    if (client.status !== 'ACTIVE') {
      this.auditLogService.logTokenFailed({
        clientId: payload.clientId,
        ip,
        userAgent,
        failureReason: client.status === 'REVOKED' ? 'REVOKED_CLIENT' : 'INACTIVE_CLIENT',
      });
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    if (!this.isIpAllowed(ip, client.allowedIps)) {
      this.auditLogService.logTokenFailed({
        clientId: payload.clientId,
        ip,
        userAgent,
        failureReason: 'IP_NOT_ALLOWED',
      });
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    this.apiClientService.touchLastUsed(client._id);

    this.auditLogService.logTokenCreated({
      apiClientId: client._id as unknown as Types.ObjectId,
      clientId: client.clientId,
      actorType: client.actorType as 'STATE' | 'ULB',
      stateId: client.stateId as unknown as Types.ObjectId,
      ulbId: client.ulbId ? (client.ulbId as unknown as Types.ObjectId) : undefined,
      ip,
      userAgent,
    });

    const expiresIn = this.config.get<number>('DATA_COLLECTION_JWT_EXPIRES_IN_SECONDS', 900);
    const secret = this.config.get<string>('DATA_COLLECTION_JWT_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? '';

    const jwtPayload = {
      sub: client._id.toString(),
      clientId: client.clientId,
      actorType: client.actorType,
      stateId: client.stateId.toString(),
      ulbId: client.ulbId?.toString(),
      scopes: client.scopes,
      jti: crypto.randomUUID(),
    };

    const accessToken = await this.jwtService.signAsync(jwtPayload, { secret, expiresIn });

    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  /**
   * Returns true if the request IP is on the allowlist, or the allowlist is empty.
   * Normalises IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 → 127.0.0.1).
   * TODO: add CIDR range support if needed.
   * @param requestIp IP address from the incoming request.
   * @param allowedIps Configured allowlist for this client.
   */
  isIpAllowed(requestIp: string, allowedIps: string[]): boolean {
    if (!allowedIps || allowedIps.length === 0) return true;
    const normalized = this.normalizeIp(requestIp);
    return allowedIps.some((ip) => this.normalizeIp(ip) === normalized);
  }

  /** Strips ::ffff: prefix so IPv4-mapped IPv6 addresses compare equal to plain IPv4. */
  private normalizeIp(ip: string): string {
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
  }
}
