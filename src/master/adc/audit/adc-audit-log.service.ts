import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AdcAdminChangeMode,
  AdcAuditAction,
  AdcAuditActorRole,
  AdcAuditLog,
  AdcAuditLogDocument,
} from 'src/schemas/adc-audit-log.schema';

type Id = Types.ObjectId | string;

export interface AdcAuditEntry {
  action: AdcAuditAction;
  adc: Id;
  adcName: string;
  state: Id;
  performedBy: Id;
  actorRole: AdcAuditActorRole;
  user?: Id | null;
  ulb?: Id | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  mode?: AdcAdminChangeMode;
}

const toOid = (id: Id) => (id instanceof Types.ObjectId ? id : new Types.ObjectId(id));

@Injectable()
export class AdcAuditLogService {
  private readonly logger = new Logger(AdcAuditLogService.name);

  constructor(@InjectModel(AdcAuditLog.name) private readonly auditModel: Model<AdcAuditLogDocument>) {}

  /** Call only after the change has succeeded. A failed write is logged, never thrown: the change already happened. */
  async record(entry: AdcAuditEntry): Promise<void> {
    try {
      await this.auditModel.create({
        action: entry.action,
        adc: toOid(entry.adc),
        adcName: entry.adcName,
        state: toOid(entry.state),
        performedBy: toOid(entry.performedBy),
        actorRole: entry.actorRole,
        ...(entry.user ? { user: toOid(entry.user) } : {}),
        ...(entry.ulb ? { ulb: toOid(entry.ulb) } : {}),
        ...(entry.changes ? { changes: entry.changes } : {}),
        ...(entry.mode ? { mode: entry.mode } : {}),
      });
    } catch (err) {
      this.logger.error(`Failed to record ${entry.action} for ADC ${String(entry.adc)}`, err as Error);
    }
  }
}
