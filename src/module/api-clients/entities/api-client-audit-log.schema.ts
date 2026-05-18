import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditAction =
  | 'API_CLIENT_CREATED'
  | 'API_CLIENT_SECRET_ROTATED'
  | 'API_CLIENT_STATUS_UPDATED'
  | 'API_CLIENT_TOKEN_CREATED'
  | 'API_CLIENT_TOKEN_FAILED';

export type FailureReason =
  | 'INVALID_CREDENTIALS'
  | 'INACTIVE_CLIENT'
  | 'REVOKED_CLIENT'
  | 'IP_NOT_ALLOWED'
  | 'UNKNOWN_ERROR';

@Schema({ timestamps: false })
export class ApiClientAuditLog {
  @Prop({ type: Types.ObjectId, ref: 'ApiClient' })
  apiClientId?: Types.ObjectId;

  @Prop()
  clientId?: string;

  @Prop({
    required: true,
    enum: [
      'API_CLIENT_CREATED',
      'API_CLIENT_SECRET_ROTATED',
      'API_CLIENT_STATUS_UPDATED',
      'API_CLIENT_TOKEN_CREATED',
      'API_CLIENT_TOKEN_FAILED',
    ],
  })
  action!: AuditAction;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  performedBy?: Types.ObjectId;

  @Prop({ enum: ['STATE', 'ULB'] })
  actorType?: string;

  @Prop({ type: Types.ObjectId, ref: 'State' })
  stateId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulbId?: Types.ObjectId;

  @Prop()
  oldStatus?: string;

  @Prop()
  newStatus?: string;

  @Prop()
  reason?: string;

  @Prop()
  ip?: string;

  @Prop()
  userAgent?: string;

  @Prop({ required: true })
  success!: boolean;

  @Prop()
  failureReason?: string;

  @Prop({ required: true })
  createdAt!: Date;
}

export type ApiClientAuditLogDocument = HydratedDocument<ApiClientAuditLog>;
export const ApiClientAuditLogSchema = SchemaFactory.createForClass(ApiClientAuditLog);

ApiClientAuditLogSchema.index({ clientId: 1, createdAt: -1 });
ApiClientAuditLogSchema.index({ apiClientId: 1, createdAt: -1 });
ApiClientAuditLogSchema.index({ action: 1, createdAt: -1 });
ApiClientAuditLogSchema.index({ success: 1, createdAt: -1 });
