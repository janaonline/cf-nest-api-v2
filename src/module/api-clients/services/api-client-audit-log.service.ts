import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiClientAuditLog } from '../entities/api-client-audit-log.schema';
import type {
  LogClientCreatedData,
  LogSecretRotatedData,
  LogStatusUpdatedData,
  LogTokenCreatedData,
  LogTokenFailedData,
} from '../types/api-client-audit-log.types';

@Injectable()
export class ApiClientAuditLogService {
  private readonly logger = new Logger(ApiClientAuditLogService.name);

  constructor(
    @InjectModel(ApiClientAuditLog.name)
    private readonly auditLogModel: Model<ApiClientAuditLog>,
  ) {}

  /**
   * Logs API client creation by an admin user.
   * @param data Audit data for the creation event.
   */
  async logClientCreated(data: LogClientCreatedData): Promise<void> {
    await this.auditLogModel.create({
      apiClientId: data.apiClientId,
      clientId: data.clientId,
      action: 'API_CLIENT_CREATED',
      performedBy: data.performedBy,
      actorType: data.actorType,
      stateId: data.stateId,
      ulbId: data.ulbId,
      ip: data.ip,
      userAgent: data.userAgent,
      success: true,
      createdAt: new Date(),
    });
  }

  /**
   * Logs secret rotation by an admin user.
   * @param data Audit data for the rotation event.
   */
  async logSecretRotated(data: LogSecretRotatedData): Promise<void> {
    await this.auditLogModel.create({
      apiClientId: data.apiClientId,
      clientId: data.clientId,
      action: 'API_CLIENT_SECRET_ROTATED',
      performedBy: data.performedBy,
      reason: data.reason,
      ip: data.ip,
      userAgent: data.userAgent,
      success: true,
      createdAt: new Date(),
    });
  }

  /**
   * Logs status update by an admin user.
   * @param data Audit data for the status change event.
   */
  async logStatusUpdated(data: LogStatusUpdatedData): Promise<void> {
    await this.auditLogModel.create({
      apiClientId: data.apiClientId,
      clientId: data.clientId,
      action: 'API_CLIENT_STATUS_UPDATED',
      performedBy: data.performedBy,
      oldStatus: data.oldStatus,
      newStatus: data.newStatus,
      reason: data.reason,
      ip: data.ip,
      userAgent: data.userAgent,
      success: true,
      createdAt: new Date(),
    });
  }

  /**
   * Logs a successful token creation. Fire-and-forget — does not block the token response.
   * @param data Audit data for the token creation event.
   */
  logTokenCreated(data: LogTokenCreatedData): void {
    void this.auditLogModel
      .create({
        apiClientId: data.apiClientId,
        clientId: data.clientId,
        action: 'API_CLIENT_TOKEN_CREATED',
        actorType: data.actorType,
        stateId: data.stateId,
        ulbId: data.ulbId,
        ip: data.ip,
        userAgent: data.userAgent,
        success: true,
        createdAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn('Failed to log token creation', error);
      });
  }

  /**
   * Logs a failed token creation attempt. Fire-and-forget — does not block the error response.
   * @param data Audit data for the failure event.
   */
  logTokenFailed(data: LogTokenFailedData): void {
    void this.auditLogModel
      .create({
        clientId: data.clientId,
        action: 'API_CLIENT_TOKEN_FAILED',
        ip: data.ip,
        userAgent: data.userAgent,
        success: false,
        failureReason: data.failureReason,
        createdAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn('Failed to log token failure', error);
      });
  }
}
