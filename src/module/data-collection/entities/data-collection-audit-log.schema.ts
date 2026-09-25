import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  DATA_COLLECTION_AUDIT_ACTION_VALUES,
  DATA_COLLECTION_FAILURE_REASON_VALUES,
  type DataCollectionAuditAction,
  type DataCollectionFailureReason,
} from '../constant';

@Schema({ timestamps: true })
export class DataCollectionAuditLog {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'DataCollection' })
  dataCollectionId?: Types.ObjectId;

  @Prop({ type: String, required: true, enum: DATA_COLLECTION_AUDIT_ACTION_VALUES })
  action!: DataCollectionAuditAction;

  @Prop({ type: Boolean, required: true })
  success!: boolean;

  @Prop({ type: String, enum: DATA_COLLECTION_FAILURE_REASON_VALUES })
  failureReason?: DataCollectionFailureReason;

  @Prop({ type: Types.ObjectId, ref: 'ApiClient' })
  apiClientId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  adminUserId?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  reason?: string;

  @Prop({ type: Types.ObjectId, ref: 'State', required: true })
  stateId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  yearId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  templateVersion!: string;

  @Prop({ type: String, enum: ['VALID', 'WARNING'] })
  validationStatus?: 'VALID' | 'WARNING';

  @Prop({ type: Number })
  lineItemCount?: number;

  @Prop({ type: [String], default: [] })
  changedLineItemCodes?: string[];

  @Prop({ type: Number })
  errorCount?: number;

  @Prop({ type: Object })
  validationSummary?: Record<string, unknown>;

  @Prop({ type: String })
  ip?: string;

  @Prop({ type: String })
  userAgent?: string;
}

export type DataCollectionAuditLogDocument = HydratedDocument<DataCollectionAuditLog>;
export const DataCollectionAuditLogSchema = SchemaFactory.createForClass(DataCollectionAuditLog);

DataCollectionAuditLogSchema.index({ dataCollectionId: 1, createdAt: -1 });
DataCollectionAuditLogSchema.index({ apiClientId: 1, createdAt: -1 });
DataCollectionAuditLogSchema.index({ stateId: 1, yearId: 1, createdAt: -1 });
DataCollectionAuditLogSchema.index({ ulbId: 1, yearId: 1, createdAt: -1 });
DataCollectionAuditLogSchema.index({ action: 1, createdAt: -1 });
DataCollectionAuditLogSchema.index({ success: 1, createdAt: -1 });
DataCollectionAuditLogSchema.index({ adminUserId: 1, createdAt: -1 });
