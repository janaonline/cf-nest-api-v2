import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import {
  DF_FORM_TYPE,
  DF_VALIDATION_STATUS,
  type DfInstallment,
  type DfValidationStatus,
} from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import type { DfRowError } from 'src/module/xvi-fc/state/devolution-formula/types/devolution-formula.types';

export { DF_FORM_TYPE as DEVOLUTION_FORMULA_FORM_TYPE };

export type DevolutionFormulaFormDocument = HydratedDocument<DevolutionFormulaForm>;

/** A row excluded from persistence at the last validateExcel call (unmatched to the registry, or an
 *  intra-batch duplicate ULB). Kept only so getErrorSheet can surface these rows — they never appear
 *  in DevolutionFormulaRow. */
export interface DfExcludedRowEntry {
  rowNumber: number;
  censusCode: string;
  ulbName: string;
  totalGrantAllocation?: unknown;
  installment1Amount?: unknown;
  installment2Amount?: unknown;
  devolutionFormula?: string;
  errors: DfRowError[];
}

@Schema({ _id: false })
class DfRowErrorSubdoc {
  @Prop({ type: String, required: true }) field!: string;
  @Prop({ type: String, required: true }) code!: string;
  @Prop({ type: String, required: true }) message!: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) value?: unknown;
}
const DfRowErrorSubdocSchema = SchemaFactory.createForClass(DfRowErrorSubdoc);

@Schema({ _id: false })
class DfExcludedRowSubdoc {
  @Prop({ type: Number, required: true }) rowNumber!: number;
  @Prop({ type: String, default: '' }) censusCode!: string;
  @Prop({ type: String, default: '' }) ulbName!: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) totalGrantAllocation?: unknown;
  @Prop({ type: MongooseSchema.Types.Mixed }) installment1Amount?: unknown;
  @Prop({ type: MongooseSchema.Types.Mixed }) installment2Amount?: unknown;
  @Prop({ type: String }) devolutionFormula?: string;
  @Prop({ type: [DfRowErrorSubdocSchema], default: [] }) errors!: DfRowError[];
}
const DfExcludedRowSubdocSchema = SchemaFactory.createForClass(DfExcludedRowSubdoc);

@Schema({
  collection: 'xvifc_devolution_forms',
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
  @Prop({ type: FileInfoSchema })
  excelFile?: FileInfo;

  @Prop({ type: FileInfoSchema })
  errorExcelFile?: FileInfo;

  @Prop({ type: [DfExcludedRowSubdocSchema], default: [] })
  excludedRows!: DfExcludedRowEntry[];

  @Prop({ type: Number, default: 0 })
  excelRowCount!: number;

  @Prop({ type: Number, default: 0 })
  errorRowCount!: number;

  @Prop({ type: Number, default: 0 })
  newUlbCount!: number;

  @Prop({ type: Number, default: 0 })
  missingUlbCount!: number;

  @Prop({ type: Number, default: 0 })
  duplicateUlbCount!: number;

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
  @Prop({ type: Number, default: 0 })
  ulbCount!: number;

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
