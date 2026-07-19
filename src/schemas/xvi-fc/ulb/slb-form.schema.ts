import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

export const SLB_FORM_TYPE = 'SLB';
export const SLB_FORM_ID = 32;

export type SlbFormDocument = HydratedDocument<SlbForm>;

@Schema({
  collection: 'xvifc_slb_forms',
  timestamps: true,
  versionKey: false,
})
export class SlbForm {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, default: SLB_FORM_TYPE, immutable: true })
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

  // Injected by Mongoose timestamps: true — declared here for TypeScript visibility only.
  createdAt?: Date;
  updatedAt?: Date;
}

export const SlbFormSchema = SchemaFactory.createForClass(SlbForm);

SlbFormSchema.index({ ulb: 1, year: 1, formType: 1 }, { unique: true });
