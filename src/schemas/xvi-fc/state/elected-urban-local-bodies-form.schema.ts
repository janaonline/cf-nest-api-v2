import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

export const EULB_FORM_TYPE = 'ELECTED_URBAN_LOCAL_BODIES';

export enum EulbFormAction {
  CREATE_DRAFT = 'CREATE_DRAFT',
  UPDATE_DRAFT = 'UPDATE_DRAFT',
  FINAL_SUBMIT = 'FINAL_SUBMIT',
}

export type EulbValidationStatus = 'NOT_VALIDATED' | 'VALID' | 'INVALID';

export type EulbFormDocument = HydratedDocument<ElectedUrbanLocalBodiesForm>;

@Schema({ _id: false })
class EulbFileRef {
  @Prop({ type: String, default: '' })
  fileName!: string;

  @Prop({ type: String, default: '' })
  fileUrl!: string;

  @Prop({ type: Number, default: null })
  fileSize!: number | null;

  @Prop({ type: String })
  mimeType?: string;

  @Prop({ type: String })
  s3Key?: string;
}

const EulbFileRefSchema = SchemaFactory.createForClass(EulbFileRef);

@Schema({
  collection: 'xvi_fc_elected_urban_local_bodies_forms',
  timestamps: true,
  versionKey: false,
})
export class ElectedUrbanLocalBodiesForm {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, default: EULB_FORM_TYPE, immutable: true })
  formType!: string;

  @Prop({ type: Number })
  ulbCount?: number;

  @Prop({ type: EulbFileRefSchema })
  electedBodyExcelFile?: EulbFileRef;

  @Prop({ type: EulbFileRefSchema })
  errorExcelFile?: EulbFileRef;

  @Prop({ type: Boolean })
  checkboxConfirmation?: boolean;

  @Prop({ type: Number, default: 0 })
  dbUlbCount!: number;

  @Prop({ type: Number, default: 0 })
  maxAllowedExcelRows!: number;

  @Prop({ type: Number, default: 0 })
  excelRowCount!: number;

  @Prop({ type: Number, default: 0 })
  matchedDbUlbCount!: number;

  @Prop({ type: Number, default: 0 })
  missingDbUlbCount!: number;

  @Prop({ type: Number, default: 0 })
  extraExcelRowCount!: number;

  @Prop({ type: Number, default: 0 })
  errorRowCount!: number;

  @Prop({ type: String, enum: ['NOT_VALIDATED', 'VALID', 'INVALID'], default: 'NOT_VALIDATED' })
  validationStatus!: EulbValidationStatus;

  @Prop({ type: Number, default: 0 })
  activeDatasetVersion!: number;

  @Prop({ type: Date })
  lastExcelUploadedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  lastExcelUploadedBy?: Types.ObjectId;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  @Prop({ type: Number, default: FORM_STATUS.NOT_STARTED })
  currentFormStatus!: number;

  @Prop({ type: Boolean, default: true })
  isDraft!: boolean;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted?: boolean;

  // Injected by Mongoose timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const ElectedUrbanLocalBodiesFormSchema = SchemaFactory.createForClass(ElectedUrbanLocalBodiesForm);

ElectedUrbanLocalBodiesFormSchema.index({ state: 1, year: 1, formType: 1 }, { unique: true });
ElectedUrbanLocalBodiesFormSchema.index({ state: 1, year: 1, isActive: 1 });
