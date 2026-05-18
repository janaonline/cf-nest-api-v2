import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { DATA_COLLECTION_SCOPES } from 'src/module/data-collection/constants/data-collection-scopes.constant';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { DEFAULT_SALT_ROUNDS } from '../constants/api-client.constants';
import { CreateApiClientDto } from '../dto/create-api-client.dto';
import { ListApiClientsQueryDto } from '../dto/list-api-clients-query.dto';
import type { RotateSecretDto } from '../dto/rotate-secret.dto';
import { ActorType, ApiClient, ApiClientDocument, ClientStatus } from '../entities/api-client.schema';
import { ApiClientAuditLogService } from './api-client-audit-log.service';

/** Escapes special regex metacharacters for safe use in MongoDB $regex queries. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lean projection type used internally for safe reads (no secretHash). */
type LeanApiClient = {
  _id: Types.ObjectId;
  clientId: string;
  name?: string;
  actorType: ActorType;
  stateId: Types.ObjectId;
  ulbId?: Types.ObjectId;
  scopes: string[];
  allowedIps: string[];
  status: ClientStatus;
  lastUsedAt?: Date;
  lastRotatedAt?: Date;
  revokedAt?: Date;
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Minimal snapshot for capturing state before an update (audit logging). */
type StatusSnapshot = {
  _id: Types.ObjectId;
  status: ClientStatus;
};

/** Public-facing shape — never includes secretHash or admin-tracking fields. */
export type SafeApiClientResponse = {
  clientId: string;
  name?: string;
  actorType: ActorType;
  stateId: string;
  ulbId?: string;
  scopes: string[];
  allowedIps: string[];
  status: ClientStatus;
  lastUsedAt?: Date;
  lastRotatedAt?: Date;
  revokedAt?: Date;
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Paginated list response returned by listApiClients. */
export type PaginatedApiClients = {
  data: SafeApiClientResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

@Injectable()
export class ApiClientService {
  private readonly logger = new Logger(ApiClientService.name);

  constructor(
    @InjectModel(ApiClient.name)
    private readonly apiClientModel: Model<ApiClientDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<State>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<Ulb>,
    private readonly config: ConfigService,
    private readonly auditLogService: ApiClientAuditLogService,
  ) {}

  // ─── Internal auth helpers ───

  /**
   * Finds a client by clientId and includes the secretHash field.
   * Only use this for credential verification.
   */
  async findByClientIdWithSecret(clientId: string): Promise<ApiClientDocument | null> {
    return this.apiClientModel.findOne({ clientId: clientId.trim() }).select('+secretHash').lean<ApiClientDocument>();
  }

  /**
   * Finds a client by ObjectId, returning only fields needed for token context.
   * Never includes secretHash.
   */
  async findById(id: string): Promise<ApiClientDocument | null> {
    return this.apiClientModel
      .findById(id)
      .select('_id clientId actorType stateId ulbId scopes status')
      .lean<ApiClientDocument>();
  }

  /** Compares a plain secret against a stored bcrypt hash. */
  async verifySecret(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /**
   * Fires-and-forgets a lastUsedAt update.
   * Uses $max so the field only advances, never regresses.
   */
  touchLastUsed(id: Types.ObjectId): void {
    void this.apiClientModel
      .updateOne({ _id: id }, { $max: { lastUsedAt: new Date() } })
      .exec()
      .catch((error: unknown) => {
        this.logger.warn(`Failed to update lastUsedAt for client ${id.toString()}`, error);
      });
  }

  // ─── Crypto helpers ───

  /** Generates a cryptographically random 64-char hex secret. */
  generateClientSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Generates a prefixed, URL-safe client ID in cf_state_* or cf_ulb_* format. */
  private generateClientId(actorType: ActorType): string {
    const prefix = actorType === 'STATE' ? 'cf_state' : 'cf_ulb';
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }

  // ─── Validation ───

  /**
   * Validates scopes against the allowed data-collection scope set.
   * Uses Set for O(n) lookup. Throws BadRequestException on any violation.
   * @param scopes Scopes to validate.
   */
  validateScopes(scopes: string[]): void {
    if (!scopes.length) {
      throw new BadRequestException('Scopes array cannot be empty');
    }
    const allowed = new Set<string>(Object.values(DATA_COLLECTION_SCOPES));
    const invalid = scopes.filter((s) => !allowed.has(s));
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid scopes: ${invalid.join(', ')}`);
    }
  }

  /**
   * Validates that state and (for ULB actors) ULB exist, are active, and the ULB belongs to the state.
   * Uses efficient exists() queries — no full document fetch.
   * @param actorType Client type determining which checks apply.
   * @param stateId State ObjectId string to validate.
   * @param ulbId ULB ObjectId string (required for ULB actors).
   * @throws BadRequestException on any reference violation.
   */
  async validateStateAndUlbReferences(actorType: ActorType, stateId: string, ulbId?: string): Promise<void> {
    const stateExists = await this.stateModel.exists({ _id: new Types.ObjectId(stateId), isActive: true });
    if (!stateExists) {
      throw new BadRequestException('State does not exist or is inactive.');
    }

    if (actorType === 'ULB') {
      if (!ulbId) {
        throw new BadRequestException('ULB client requires ulbId.');
      }
      const ulbExists = await this.ulbModel.exists({
        _id: new Types.ObjectId(ulbId),
        state: new Types.ObjectId(stateId),
        isActive: true,
      });
      if (!ulbExists) {
        throw new BadRequestException('ULB does not exist, is inactive, or does not belong to the selected state.');
      }
    }
  }

  // ─── Safe response mapper ───

  /** Maps a lean document to a public-safe response, stripping secretHash and admin-tracking fields. */
  private toSafeResponse(client: LeanApiClient): SafeApiClientResponse {
    return {
      clientId: client.clientId,
      name: client.name,
      actorType: client.actorType,
      stateId: client.stateId.toString(),
      ulbId: client.ulbId?.toString(),
      scopes: client.scopes,
      allowedIps: client.allowedIps,
      status: client.status,
      lastUsedAt: client.lastUsedAt,
      lastRotatedAt: client.lastRotatedAt,
      revokedAt: client.revokedAt,
      revokedReason: client.revokedReason,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  // ─── Admin CRUD ───

  /**
   * Creates a new API client. Returns the plain secret exactly once — never stored.
   * Validates scopes and then validates state/ULB references before writing credentials.
   * @param dto Client configuration from admin.
   * @param adminId Authenticated admin user ID for audit tracking.
   * @param meta Request metadata (ip, userAgent) for audit logging.
   * @returns Created client details with one-time plain clientSecret.
   */
  async createApiClient(
    dto: CreateApiClientDto,
    adminId?: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<SafeApiClientResponse & { clientSecret: string }> {
    if (dto.actorType === 'ULB' && !dto.ulbId) {
      throw new BadRequestException('ulbId is required when actorType is ULB');
    }
    if (dto.actorType === 'STATE' && dto.ulbId) {
      throw new BadRequestException('ulbId must be absent when actorType is STATE');
    }

    this.validateScopes(dto.scopes);
    await this.validateStateAndUlbReferences(dto.actorType, dto.stateId, dto.ulbId);

    const clientId = this.generateClientId(dto.actorType);
    const plainSecret = this.generateClientSecret();
    const saltRounds = this.config.get<number>('API_CLIENT_SECRET_SALT_ROUNDS', DEFAULT_SALT_ROUNDS);
    const secretHash = await bcrypt.hash(plainSecret, saltRounds);
    const adminObjId = adminId ? new Types.ObjectId(adminId) : undefined;

    const doc = await this.apiClientModel.create({
      clientId,
      name: dto.name,
      actorType: dto.actorType,
      stateId: new Types.ObjectId(dto.stateId),
      ulbId: dto.ulbId ? new Types.ObjectId(dto.ulbId) : undefined,
      scopes: dto.scopes,
      allowedIps: dto.allowedIps ?? [],
      secretHash,
      lastRotatedAt: new Date(),
      ...(adminObjId && { createdBy: adminObjId, updatedBy: adminObjId }),
    });

    await this.auditLogService.logClientCreated({
      apiClientId: doc._id,
      clientId: doc.clientId,
      actorType: doc.actorType,
      stateId: doc.stateId as unknown as Types.ObjectId,
      ulbId: doc.ulbId ? (doc.ulbId as unknown as Types.ObjectId) : undefined,
      performedBy: adminObjId,
      ...meta,
    });

    return {
      ...this.toSafeResponse(doc as unknown as LeanApiClient),
      clientSecret: plainSecret,
    };
  }

  /**
   * Lists API clients with pagination and optional filters.
   * Never returns secretHash or plain clientSecret.
   * @param query Pagination and filter parameters.
   * @returns Paginated safe client data with meta.
   */
  async listApiClients(query?: ListApiClientsQueryDto): Promise<PaginatedApiClients> {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ApiClient> = {};
    if (query?.status) filter['status'] = query.status;
    if (query?.actorType) filter['actorType'] = query.actorType;
    if (query?.search) {
      const escaped = escapeRegex(query.search);
      filter['$or'] = [{ clientId: { $regex: escaped, $options: 'i' } }, { name: { $regex: escaped, $options: 'i' } }];
    }

    const [data, total] = await Promise.all([
      this.apiClientModel
        .find(filter)
        .select('-secretHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<LeanApiClient[]>(),
      this.apiClientModel.countDocuments(filter),
    ]);

    return {
      data: data.map((c) => this.toSafeResponse(c)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Gets one API client by clientId without secrets.
   * @param clientId Client identifier.
   * @returns Safe client details.
   */
  async getApiClient(clientId: string): Promise<SafeApiClientResponse> {
    const client = await this.apiClientModel.findOne({ clientId }).select('-secretHash').lean<LeanApiClient>();
    if (!client) throw new NotFoundException(`API client '${clientId}' not found`);
    return this.toSafeResponse(client);
  }

  /**
   * Rotates an API client's secret. Returns the new plain secret exactly once.
   * Rotation is allowed regardless of current status (admin-initiated).
   * @param clientId Client identifier.
   * @param dto Optional rotation data including reason.
   * @param adminId Authenticated admin user ID for audit tracking.
   * @param meta Request metadata (ip, userAgent) for audit logging.
   * @returns New plain clientSecret, clientId, and current status.
   */
  async rotateSecret(
    clientId: string,
    dto?: RotateSecretDto,
    adminId?: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ clientId: string; clientSecret: string; status: ClientStatus }> {
    const existing = await this.apiClientModel.findOne({ clientId }).select('_id status').lean<StatusSnapshot | null>();
    if (!existing) throw new NotFoundException(`API client '${clientId}' not found`);

    const plainSecret = this.generateClientSecret();
    const saltRounds = this.config.get<number>('API_CLIENT_SECRET_SALT_ROUNDS', DEFAULT_SALT_ROUNDS);
    const secretHash = await bcrypt.hash(plainSecret, saltRounds);
    const adminObjId = adminId ? new Types.ObjectId(adminId) : undefined;

    await this.apiClientModel
      .updateOne(
        { clientId },
        { $set: { secretHash, lastRotatedAt: new Date(), ...(adminObjId && { updatedBy: adminObjId }) } },
      )
      .exec();

    await this.auditLogService.logSecretRotated({
      apiClientId: existing._id,
      clientId,
      performedBy: adminObjId,
      reason: dto?.reason,
      ...meta,
    });

    return { clientId, clientSecret: plainSecret, status: existing.status };
  }

  /**
   * Updates API client status. REVOKED clients cannot obtain tokens.
   * Sets revokedAt/revokedBy/revokedReason on REVOKED transitions.
   * Does not clear revoke history when transitioning away from REVOKED.
   * @param clientId Client identifier.
   * @param status New status value.
   * @param adminId Authenticated admin user ID for audit tracking.
   * @param meta Request metadata (ip, userAgent) for audit logging.
   * @param reason Optional reason (stored when status is REVOKED).
   * @returns Updated safe client details.
   */
  async updateStatus(
    clientId: string,
    status: ClientStatus,
    adminId?: string,
    meta?: { ip?: string; userAgent?: string },
    reason?: string,
  ): Promise<SafeApiClientResponse> {
    const existing = await this.apiClientModel.findOne({ clientId }).select('_id status').lean<StatusSnapshot | null>();
    if (!existing) throw new NotFoundException(`API client '${clientId}' not found`);

    const adminObjId = adminId ? new Types.ObjectId(adminId) : undefined;
    const update: Record<string, unknown> = { status, ...(adminObjId && { updatedBy: adminObjId }) };

    if (status === 'REVOKED') {
      update['revokedAt'] = new Date();
      if (adminObjId) update['revokedBy'] = adminObjId;
      if (reason) update['revokedReason'] = reason;
    }

    const updated = await this.apiClientModel
      .findOneAndUpdate({ clientId }, { $set: update }, { new: true })
      .select('-secretHash')
      .lean<LeanApiClient | null>();

    if (!updated) throw new NotFoundException(`API client '${clientId}' not found`);

    await this.auditLogService.logStatusUpdated({
      apiClientId: existing._id,
      clientId,
      oldStatus: existing.status,
      newStatus: status,
      performedBy: adminObjId,
      reason,
      ...meta,
    });

    return this.toSafeResponse(updated);
  }
}
