import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { DfInstallment } from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';

export type DevolutionFormulaRowDocument = HydratedDocument<DevolutionFormulaRow>;

export type DfRowValidationStatus = 'VALID' | 'INVALID';

@Schema({ _id: false })
class DfRowError {
  @Prop({ type: String, required: true })
  field!: string;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  value?: unknown;
}

const DfRowErrorSchema = SchemaFactory.createForClass(DfRowError);

@Schema({
  collection: 'xvi_fc_devolution_formula_rows',
  timestamps: true,
  versionKey: false,
})
export class DevolutionFormulaRow {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'DevolutionFormulaForm', required: true })
  form!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: DfInstallment;

  @Prop({ type: Number, required: true })
  datasetVersion!: number;

  @Prop({ type: Number, required: true })
  rowNumber!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', default: null })
  ulbId?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  censusCode!: string;

  @Prop({ type: String, default: '' })
  sbCode!: string;

  @Prop({ type: String, default: '' })
  ulbName!: string;

  @Prop({ type: Number, required: true })
  totalGrantAllocation!: number;

  @Prop({ type: Number, required: true })
  installment1Amount!: number;

  @Prop({ type: Number, required: true })
  installment2Amount!: number;

  @Prop({ type: String, default: '' })
  devolutionFormula!: string;

  @Prop({ type: String, enum: ['VALID', 'INVALID'], default: 'INVALID' })
  validationStatus!: DfRowValidationStatus;

  @Prop({ type: [DfRowErrorSchema], default: [] })
  errors!: DfRowError[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  rawExcelData?: Record<string, unknown>;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  // Mongoose timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export const DevolutionFormulaRowSchema = SchemaFactory.createForClass(DevolutionFormulaRow);

DevolutionFormulaRowSchema.index({ form: 1, datasetVersion: 1, validationStatus: 1, rowNumber: 1 });
DevolutionFormulaRowSchema.index({ state: 1, year: 1, installment: 1, ulbId: 1, datasetVersion: 1 });
DevolutionFormulaRowSchema.index(
  { form: 1, datasetVersion: 1, ulbId: 1 },
  { unique: true, partialFilterExpression: { ulbId: { $type: 'objectId' } } },
);
DevolutionFormulaRowSchema.index({ form: 1, datasetVersion: 1, isActive: 1, rowNumber: 1 });
