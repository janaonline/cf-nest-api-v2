import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ActorType = 'STATE' | 'ULB';
export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'REVOKED';

@Schema({ timestamps: true })
export class ApiClient {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ required: true, unique: true, trim: true })
  clientId!: string;

  /** Stored as bcrypt hash; excluded from queries by default. */
  @Prop({ required: true, select: false })
  secretHash!: string;

  @Prop({ required: true, enum: ['STATE', 'ULB'] })
  actorType!: ActorType;

  @Prop({ type: Types.ObjectId, ref: 'State', required: true })
  stateId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulbId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  scopes!: string[];

  @Prop({ type: [String], default: [] })
  allowedIps!: string[];

  @Prop({ required: true, enum: ['ACTIVE', 'INACTIVE', 'REVOKED'], default: 'ACTIVE' })
  status!: ClientStatus;

  @Prop({ type: String, trim: true, maxlength: 255 })
  name?: string;

  @Prop({ type: Date })
  lastUsedAt?: Date;

  @Prop({ type: Date })
  lastRotatedAt?: Date;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: String, maxlength: 500 })
  revokedReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  revokedBy?: Types.ObjectId;
}

export type ApiClientDocument = HydratedDocument<ApiClient>;
export const ApiClientSchema = SchemaFactory.createForClass(ApiClient);

ApiClientSchema.index({ actorType: 1, stateId: 1 });
ApiClientSchema.index({ status: 1 });

/** Ensures ULB actors have ulbId; STATE actors do not. */
ApiClientSchema.pre<ApiClientDocument>('validate', function () {
  if (this.actorType === 'ULB' && !this.ulbId) {
    this.invalidate('ulbId', 'ulbId is required when actorType is ULB');
  }
  if (this.actorType === 'STATE' && this.ulbId) {
    this.invalidate('ulbId', 'ulbId must be absent when actorType is STATE');
  }
});
