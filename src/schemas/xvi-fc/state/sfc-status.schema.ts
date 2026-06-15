import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

export const SFC_STATUS_FORM_TYPE = 'SFC_STATUS';

export enum SfcStatusAction {
  CREATE_DRAFT = 'CREATE_DRAFT',
  UPDATE_DRAFT = 'UPDATE_DRAFT',
  FINAL_SUBMIT = 'FINAL_SUBMIT',
}

export type XviFcSfcStatusDocument = HydratedDocument<XviFcSfcStatus>;

@Schema({
  collection: 'xvifc_sfc_forms',
  timestamps: true,
  versionKey: false,
})
export class XviFcSfcStatus {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, default: SFC_STATUS_FORM_TYPE, immutable: true })
  formType!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  data!: Record<string, unknown>;

  @Prop({ type: Number, default: FORM_STATUS.NOT_STARTED })
  currentFormStatus!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted?: boolean;
}

export const XviFcSfcStatusSchema = SchemaFactory.createForClass(XviFcSfcStatus);

XviFcSfcStatusSchema.index({ state: 1, year: 1, formType: 1 }, { unique: true });
