import type { Types } from 'mongoose';
import type { FailureReason } from '../entities/api-client-audit-log.schema';

export type LogClientCreatedData = {
  apiClientId: Types.ObjectId;
  clientId: string;
  actorType: 'STATE' | 'ULB';
  stateId: Types.ObjectId;
  ulbId?: Types.ObjectId;
  performedBy?: Types.ObjectId;
  ip?: string;
  userAgent?: string;
};

export type LogSecretRotatedData = {
  apiClientId: Types.ObjectId;
  clientId: string;
  performedBy?: Types.ObjectId;
  reason?: string;
  ip?: string;
  userAgent?: string;
};

export type LogStatusUpdatedData = {
  apiClientId: Types.ObjectId;
  clientId: string;
  oldStatus: string;
  newStatus: string;
  performedBy?: Types.ObjectId;
  reason?: string;
  ip?: string;
  userAgent?: string;
};

export type LogTokenCreatedData = {
  apiClientId?: Types.ObjectId;
  clientId: string;
  actorType: 'STATE' | 'ULB';
  stateId: Types.ObjectId;
  ulbId?: Types.ObjectId;
  ip?: string;
  userAgent?: string;
};

export type LogTokenFailedData = {
  clientId?: string;
  ip?: string;
  userAgent?: string;
  failureReason: FailureReason;
};
