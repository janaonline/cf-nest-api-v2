import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EulbRowDocument = HydratedDocument<ElectedUrbanLocalBodiesRow>;

export type EulbRowType = 'DB_ULB' | 'EXTRA_ULB';
export type EulbRowSource = 'EXCEL' | 'PORTAL';
export type EulbRowValidationStatus = 'VALID' | 'INVALID';

export interface EulbRowError {
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

@Schema({ _id: false })
class EulbRowErrorSubdoc {
  @Prop({ type: String, required: true }) field!: string;
  @Prop({ type: String, required: true }) code!: string;
  @Prop({ type: String, required: true }) message!: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) value?: unknown;
}

const EulbRowErrorSubdocSchema = SchemaFactory.createForClass(EulbRowErrorSubdoc);

@Schema({
  collection: 'xvi_fc_elected_urban_local_bodies_rows',
  timestamps: true,
  versionKey: false,
})
export class ElectedUrbanLocalBodiesRow {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ElectedUrbanLocalBodiesForm', required: true })
  form!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  datasetVersion!: number;

  @Prop({ type: Number, required: true })
  rowNumber!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb' })
  ulbId?: Types.ObjectId;

  @Prop({ type: String })
  censusCode?: string;

  @Prop({ type: String, required: true })
  ulbName!: string;

  @Prop({ type: String })
  dbCensusCode?: string;

  @Prop({ type: String })
  dbUlbName?: string;

  @Prop({ type: String })
  electedBodyStatus?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  dateOfConstitution?: Date | string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  dateOfExpiry?: Date | string;

  @Prop({ type: String })
  remarks?: string;

  @Prop({ type: String, enum: ['DB_ULB', 'EXTRA_ULB'], required: true })
  rowType!: EulbRowType;

  @Prop({ type: String, enum: ['EXCEL', 'PORTAL'], required: true })
  lastUpdatedSource!: EulbRowSource;

  @Prop({ type: String, enum: ['VALID', 'INVALID'], required: true })
  validationStatus!: EulbRowValidationStatus;

  @Prop({ type: [EulbRowErrorSubdocSchema], default: [] })
  errors!: EulbRowError[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  rawExcelData?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  // Injected by Mongoose timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const ElectedUrbanLocalBodiesRowSchema = SchemaFactory.createForClass(ElectedUrbanLocalBodiesRow);

ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1 });
ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1, validationStatus: 1 });
ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1, rowType: 1 });
ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1, censusCode: 1 });
ElectedUrbanLocalBodiesRowSchema.index({ state: 1, year: 1, ulbId: 1 });
ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1, rowNumber: 1 });

// Partial unique index: prevents duplicate DB ULBs within the same dataset version
ElectedUrbanLocalBodiesRowSchema.index(
  { form: 1, datasetVersion: 1, ulbId: 1 },
  {
    unique: true,
    partialFilterExpression: { rowType: 'DB_ULB', ulbId: { $exists: true, $ne: null } },
  },
);
