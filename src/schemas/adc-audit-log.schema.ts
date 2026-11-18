import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum AdcAuditAction {
  ADC_CREATED = 'ADC_CREATED',
  ADC_RENAMED = 'ADC_RENAMED',
  ADC_DELETED = 'ADC_DELETED',
  ADC_ADMIN_CHANGED = 'ADC_ADMIN_CHANGED',
  ULB_ADC_CHANGED = 'ULB_ADC_CHANGED',
  MEMBER_INVITED = 'MEMBER_INVITED',
  MEMBER_RESTORED = 'MEMBER_RESTORED',
  MEMBER_LEVEL_CHANGED = 'MEMBER_LEVEL_CHANGED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
}

export type AdcAuditActorRole = 'PORTAL_ADMIN' | 'ADC_ADMIN';
export type AdcAdminChangeMode = 'PROMOTED' | 'INVITED' | 'TRANSFERRED';

/**
 * One entry per real change to an ADC, its Admin, its team or its ULBs. Never updated, and it outlives the
 * ADC, so `adcName` and `state` are copied in. No emails or mobiles are stored.
 */
@Schema({ collection: 'adc_audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AdcAuditLog {
  @Prop({ type: String, enum: Object.values(AdcAuditAction), required: true })
  action!: AdcAuditAction;

  /** For a ULB move: the gaining ADC, or the losing one when the ULB goes back to the State. */
  @Prop({ type: Types.ObjectId, ref: 'Adc', required: true })
  adc!: Types.ObjectId;

  @Prop({ type: String, required: true })
  adcName!: string;

  @Prop({ type: Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  performedBy!: Types.ObjectId;

  @Prop({ type: String, enum: ['PORTAL_ADMIN', 'ADC_ADMIN'], required: true })
  actorRole!: AdcAuditActorRole;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulb?: Types.ObjectId;

  /** Only the fields that changed: `{ [field]: { from, to } }`. */
  @Prop({ type: Object })
  changes?: Record<string, { from: unknown; to: unknown }>;

  @Prop({ type: String, enum: ['PROMOTED', 'INVITED', 'TRANSFERRED'] })
  mode?: AdcAdminChangeMode;
}

export type AdcAuditLogDocument = AdcAuditLog & Document;
export const AdcAuditLogSchema = SchemaFactory.createForClass(AdcAuditLog);

AdcAuditLogSchema.index({ adc: 1, createdAt: -1 });
AdcAuditLogSchema.index({ ulb: 1, createdAt: -1 }, { partialFilterExpression: { ulb: { $exists: true } } });
