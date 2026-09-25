import { Types } from 'mongoose';
import { ActorType, ClientStatus } from '../entities/api-client.schema';

/** Lean projection type used internally for safe reads (no secretHash). */
export type LeanApiClient = {
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

/** Minimal snapshot used by rotateSecret (id + status only). */
export type StatusSnapshot = {
  _id: Types.ObjectId;
  status: ClientStatus;
};

/** Extended snapshot used by updateStatus — includes actor context for duplicate checks. */
export type StatusWithContext = {
  _id: Types.ObjectId;
  actorType: ActorType;
  status: ClientStatus;
  stateId: Types.ObjectId;
  ulbId?: Types.ObjectId;
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
