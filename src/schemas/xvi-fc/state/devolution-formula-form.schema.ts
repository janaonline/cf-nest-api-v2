import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  DF_FORM_TYPE,
  DF_VALIDATION_STATUS,
  type DfInstallment,
  type DfValidationStatus,
} from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';

export { DF_FORM_TYPE as DEVOLUTION_FORMULA_FORM_TYPE };

export type DevolutionFormulaFormDocument = HydratedDocument<DevolutionFormulaForm>;

@Schema({ _id: false })
class DfFileRef {
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

const DfFileRefSchema = SchemaFactory.createForClass(DfFileRef);

@Schema({
  collection: 'xvi_fc_devolution_formula_forms',
  timestamps: true,
  versionKey: false,
})
export class DevolutionFormulaForm {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: DfInstallment;

  @Prop({ type: String, default: DF_FORM_TYPE, immutable: true })
  formType!: string;

  @Prop({ type: Number, default: FORM_STATUS.NOT_STARTED })
  currentFormStatus!: number;

  @Prop({ type: String, enum: Object.values(DF_VALIDATION_STATUS), default: DF_VALIDATION_STATUS.NOT_VALIDATED })
  validationStatus!: DfValidationStatus;

  @Prop({ type: Boolean, default: true })
  isDraft!: boolean;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  // Grant allocation
  @Prop({ type: Number, default: 0 })
  totalMoHUAAllocation!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'GrantAllocation' })
  grantAllocationRef?: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  totalAllocatedSum!: number;

  // Excel tracking
  @Prop({ type: DfFileRefSchema })
  excelFile?: DfFileRef;

  @Prop({ type: DfFileRefSchema })
  errorExcelFile?: DfFileRef;

  @Prop({ type: Number, default: 0 })
  excelRowCount!: number;

  @Prop({ type: Number, default: 0 })
  errorRowCount!: number;

  @Prop({ type: Number, default: 0 })
  activeDatasetVersion!: number;

  @Prop({ type: Date })
  lastExcelUploadedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  lastExcelUploadedBy?: Types.ObjectId;

  // Submission
  @Prop({ type: Date, default: null })
  submittedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  submittedBy?: Types.ObjectId | null;

  // Audit
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  // Form fields
  @Prop({ type: Boolean, default: false })
  checkboxConfirmation!: boolean;

  // MoHUA feedback
  @Prop({ type: String, default: null })
  mohuaRemarks?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'DevolutionFormulaForm', default: null })
  previousVersionId?: Types.ObjectId | null;

  // Mongoose timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export const DevolutionFormulaFormSchema = SchemaFactory.createForClass(DevolutionFormulaForm);

DevolutionFormulaFormSchema.index({ state: 1, year: 1, installment: 1 }, { unique: true });
DevolutionFormulaFormSchema.index({ state: 1, year: 1, isActive: 1 });
