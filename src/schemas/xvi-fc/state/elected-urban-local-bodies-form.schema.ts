import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import { EulbRowError, EulbRowErrorSubdocSchema } from './elected-urban-local-bodies-row.schema';

export const EULB_FORM_TYPE = 'ELECTED_URBAN_LOCAL_BODIES';

export enum EulbFormAction {
  CREATE_DRAFT = 'CREATE_DRAFT',
  UPDATE_DRAFT = 'UPDATE_DRAFT',
  FINAL_SUBMIT = 'FINAL_SUBMIT',
}

export type EulbValidationStatus = 'NOT_VALIDATED' | 'VALID' | 'INVALID';

export type EulbFormDocument = HydratedDocument<ElectedUrbanLocalBodiesForm>;

@Schema({ _id: false })
class EulbPostSubmissionUpdateBatch {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) batchId!: Types.ObjectId;
  @Prop({ type: String, enum: ['APPLIED'], required: true }) status!: string;
  @Prop({ type: FileInfoSchema, required: true }) document!: FileInfo;
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'ElectedUrbanLocalBodiesRow' }] })
  rowIds!: Types.ObjectId[];
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) submittedBy!: Types.ObjectId;
  @Prop({ type: Date, required: true }) submittedAt!: Date;
  @Prop({ type: Date, required: true }) appliedAt!: Date;
}
const EulbPostSubmissionUpdateBatchSchema = SchemaFactory.createForClass(EulbPostSubmissionUpdateBatch);

/** A row excluded from persistence at the last validateExcel/revalidateFromStoredFile call
 *  (unmatched to the registry, or an intra-batch duplicate census code). Kept only so
 *  getErrorSheet can surface these rows — they never appear in ElectedUrbanLocalBodiesRow. */
export interface EulbExcludedRowEntry {
  rowNumber: number;
  censusCode?: string;
  ulbName: string;
  electedBodyStatus?: string;
  dateOfConstitution?: Date | string;
  dateOfExpiry?: Date | string;
  remarks?: string;
  errors: EulbRowError[];
}

@Schema({ _id: false })
class EulbExcludedRowSubdoc {
  @Prop({ type: Number, required: true }) rowNumber!: number;
  @Prop({ type: String }) censusCode?: string;
  @Prop({ type: String, default: '' }) ulbName!: string;
  @Prop({ type: String }) electedBodyStatus?: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) dateOfConstitution?: Date | string;
  @Prop({ type: MongooseSchema.Types.Mixed }) dateOfExpiry?: Date | string;
  @Prop({ type: String }) remarks?: string;
  @Prop({ type: [EulbRowErrorSubdocSchema], default: [] }) errors!: EulbRowError[];
}
const EulbExcludedRowSubdocSchema = SchemaFactory.createForClass(EulbExcludedRowSubdoc);

@Schema({
  collection: 'xvifc_elected_ulb_forms',
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

  @Prop({ type: FileInfoSchema })
  electedBodyExcelFile?: FileInfo;

  @Prop({ type: FileInfoSchema })
  errorExcelFile?: FileInfo;

  @Prop({ type: [EulbExcludedRowSubdocSchema], default: [] })
  excludedRows!: EulbExcludedRowEntry[];

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

  @Prop({ type: [EulbPostSubmissionUpdateBatchSchema], default: [] })
  postSubmissionUpdates!: EulbPostSubmissionUpdateBatch[];

  // Injected by Mongoose timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const ElectedUrbanLocalBodiesFormSchema = SchemaFactory.createForClass(ElectedUrbanLocalBodiesForm);

ElectedUrbanLocalBodiesFormSchema.index({ state: 1, year: 1, formType: 1 }, { unique: true });
ElectedUrbanLocalBodiesFormSchema.index({ state: 1, year: 1, isActive: 1 });
