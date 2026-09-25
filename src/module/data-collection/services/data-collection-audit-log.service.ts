import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataCollectionAuditLog } from '../entities/data-collection-audit-log.schema';
import type {
  LogDataCollectionDuplicateSubmitData,
  LogDataCollectionModifiedData,
  LogDataCollectionModifyNotFoundData,
  LogDataCollectionReversedData,
  LogDataCollectionSubmittedData,
  LogDataCollectionValidationFailedData,
} from '../types/data-collection-audit-log.types';
import { DATA_COLLECTION_AUDIT_ACTION, DATA_COLLECTION_FAILURE_REASON } from '../constant';

@Injectable()
export class DataCollectionAuditLogService {
  private readonly logger = new Logger(DataCollectionAuditLogService.name);

  constructor(
    @InjectModel(DataCollectionAuditLog.name)
    private readonly auditLogModel: Model<DataCollectionAuditLog>,
  ) {}

  /**
   * Records a successful data collection submission.
   * Stores identifiers and line item count summary.
   */
  async logSubmitted(data: LogDataCollectionSubmittedData): Promise<void> {
    await this.write({
      dataCollectionId: data.dataCollectionId,
      action: DATA_COLLECTION_AUDIT_ACTION.SUBMITTED,
      success: true,
      apiClientId: data.apiClientId,
      stateId: data.stateId,
      ulbId: data.ulbId,
      yearId: data.yearId,
      templateVersion: data.templateVersion,
      validationStatus: data.validationStatus,
      lineItemCount: data.lineItemCount,
      ip: data.ip,
      userAgent: data.userAgent,
    });
  }

  /**
   * Records a successful data collection modification.
   * Stores changed line item code summary.
   */
  async logModified(data: LogDataCollectionModifiedData): Promise<void> {
    await this.write({
      dataCollectionId: data.dataCollectionId,
      action: DATA_COLLECTION_AUDIT_ACTION.MODIFIED,
      success: true,
      apiClientId: data.apiClientId,
      stateId: data.stateId,
      ulbId: data.ulbId,
      yearId: data.yearId,
      templateVersion: data.templateVersion,
      validationStatus: data.validationStatus,
      changedLineItemCodes: data.changedLineItemCodes,
      lineItemCount: data.lineItemCount,
      ip: data.ip,
      userAgent: data.userAgent,
    });
  }

  /**
   * Records a failed data collection validation.
   * Stores validation error summary without full raw payload.
   */
  async logValidationFailed(data: LogDataCollectionValidationFailedData): Promise<void> {
    await this.write({
      action: DATA_COLLECTION_AUDIT_ACTION.VALIDATION_FAILED,
      success: false,
      failureReason: DATA_COLLECTION_FAILURE_REASON.VALIDATION_FAILED,
      apiClientId: data.apiClientId,
      stateId: data.stateId,
      ulbId: data.ulbId,
      yearId: data.yearId,
      templateVersion: data.templateVersion,
      lineItemCount: data.lineItemCount,
      errorCount: data.errorCount,
      validationSummary: data.validationSummary,
      ip: data.ip,
      userAgent: data.userAgent,
    });
  }

  /**
   * Records a duplicate submit attempt.
   */
  async logDuplicateSubmit(data: LogDataCollectionDuplicateSubmitData): Promise<void> {
    await this.write({
      dataCollectionId: data.dataCollectionId,
      action: DATA_COLLECTION_AUDIT_ACTION.SUBMIT_DUPLICATE,
      success: false,
      failureReason: DATA_COLLECTION_FAILURE_REASON.DUPLICATE_SUBMISSION,
      apiClientId: data.apiClientId,
      stateId: data.stateId,
      ulbId: data.ulbId,
      yearId: data.yearId,
      templateVersion: data.templateVersion,
      lineItemCount: data.lineItemCount,
      ip: data.ip,
      userAgent: data.userAgent,
    });
  }

  /**
   * Records a modify attempt for a missing data collection record.
   */
  async logModifyNotFound(data: LogDataCollectionModifyNotFoundData): Promise<void> {
    await this.write({
      action: DATA_COLLECTION_AUDIT_ACTION.NOT_FOUND_FOR_MODIFY,
      success: false,
      failureReason: DATA_COLLECTION_FAILURE_REASON.DATA_COLLECTION_NOT_FOUND,
      apiClientId: data.apiClientId,
      stateId: data.stateId,
      ulbId: data.ulbId,
      yearId: data.yearId,
      templateVersion: data.templateVersion,
      lineItemCount: data.lineItemCount,
      ip: data.ip,
      userAgent: data.userAgent,
    });
  }

  /**
   * Records an admin reversal of a data collection submission.
   */
  async logReversed(data: LogDataCollectionReversedData): Promise<void> {
    await this.write({
      dataCollectionId: data.dataCollectionId,
      action: DATA_COLLECTION_AUDIT_ACTION.REVERSED,
      success: true,
      adminUserId: data.adminUserId,
      stateId: data.stateId,
      ulbId: data.ulbId,
      yearId: data.yearId,
      templateVersion: data.templateVersion,
      reason: data.reason,
      ip: data.ip,
      userAgent: data.userAgent,
    });
  }

  /** Persists the audit entry; logs but does not propagate write failures. */
  private async write(data: Record<string, unknown>): Promise<void> {
    try {
      await this.auditLogModel.create(data);
    } catch (error: unknown) {
      this.logger.error('Failed to write data collection audit log', error);
    }
  }
}
