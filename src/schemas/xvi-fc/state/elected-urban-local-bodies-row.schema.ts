import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EulbRowDocument = HydratedDocument<ElectedUrbanLocalBodiesRow>;

export type EulbRowType = 'DB_ULB' | 'EXTRA_ULB';
export type EulbRowSource = 'EXCEL' | 'PORTAL' | 'POST_SUBMISSION_UPDATE';
export type EulbRowValidationStatus = 'VALID' | 'INVALID';

export interface EulbRowUpdateHistoryEntry {
  batchId: Types.ObjectId;
  source: 'POST_SUBMISSION_UPDATE';
  previous: {
    electedBodyStatus?: string | null;
    dateOfConstitution?: string | null;
    dateOfExpiry?: string | null;
    remarks?: string | null;
  };
  updated: {
    electedBodyStatus?: string | null;
    dateOfConstitution?: string | null;
    dateOfExpiry?: string | null;
    remarks?: string | null;
  };
  updatedBy: Types.ObjectId;
  updatedAt: Date;
}

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

@Schema({ _id: false })
class EulbRowUpdateHistorySubdoc {
  @Prop({ type: MongooseSchema.Types.ObjectId }) batchId!: Types.ObjectId;
  @Prop({ type: String, enum: ['POST_SUBMISSION_UPDATE'] }) source!: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) previous!: Record<string, unknown>;
  @Prop({ type: MongooseSchema.Types.Mixed }) updated!: Record<string, unknown>;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) updatedBy!: Types.ObjectId;
  @Prop({ type: Date }) updatedAt!: Date;
}
const EulbRowUpdateHistorySubdocSchema = SchemaFactory.createForClass(EulbRowUpdateHistorySubdoc);

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

  @Prop({ type: String, enum: ['EXCEL', 'PORTAL', 'POST_SUBMISSION_UPDATE'], required: true })
  lastUpdatedSource!: EulbRowSource;

  @Prop({ type: String, enum: ['VALID', 'INVALID'], required: true })
  validationStatus!: EulbRowValidationStatus;

  @Prop({ type: [EulbRowErrorSubdocSchema], default: [] })
  errors!: EulbRowError[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  rawExcelData?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  lastUpdateBatchId?: Types.ObjectId;

  @Prop({ type: [EulbRowUpdateHistorySubdocSchema], default: [] })
  updateHistory!: EulbRowUpdateHistoryEntry[];

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

// Primary query + sort: covers all getRows queries filtered by form+datasetVersion and sorted INVALID-first
ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1, validationStatus: 1, rowNumber: 1 });
// rowType filter with the same sort order
ElectedUrbanLocalBodiesRowSchema.index({ form: 1, datasetVersion: 1, rowType: 1, validationStatus: 1, rowNumber: 1 });
// ULB deduplication check used during validate/revalidate
ElectedUrbanLocalBodiesRowSchema.index({ state: 1, year: 1, ulbId: 1 });

// Partial unique index: prevents duplicate DB ULBs within the same dataset version
ElectedUrbanLocalBodiesRowSchema.index(
  { form: 1, datasetVersion: 1, ulbId: 1 },
  {
    unique: true,
    partialFilterExpression: { rowType: 'DB_ULB', ulbId: { $exists: true, $ne: null } },
  },
);
