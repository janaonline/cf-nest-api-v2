import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EulbRowDocument = HydratedDocument<ElectedUrbanLocalBodiesRow>;

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
  collection: 'xvifc_elected_ulb_rows',
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

  @Prop({ type: String, default: '' })
  ulbName!: string;

  @Prop({ type: String })
  dbCensusCode?: string;

  @Prop({ type: String })
  dbUlbName?: string;

  @Prop({ type: String })
  electedBodyStatus?: string;

  // Always stored as UTC midnight (Date.UTC year, month, day, 0,0,0,0) by the Excel service.
  // Do not persist raw xlsx Date objects or timezone-local Dates — use toDate() in the service.
  @Prop({ type: MongooseSchema.Types.Mixed })
  dateOfConstitution?: Date | string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  dateOfExpiry?: Date | string;

  @Prop({ type: String })
  remarks?: string;

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
// ULB deduplication check used during validate/revalidate
ElectedUrbanLocalBodiesRowSchema.index({ state: 1, year: 1, ulbId: 1 });
// Claim-letter eligibility bulk read (evaluateUlbBulkRowStatus) — filters by isActive+datasetVersion
// without ulbId, so the index above (ulbId-keyed) can't be used past the state+year prefix.
ElectedUrbanLocalBodiesRowSchema.index({ state: 1, year: 1, isActive: 1, datasetVersion: 1 });

// Unique index: prevents duplicate ULBs within the same dataset version. Partial (not plain)
// because a row's ulbId can be blank/null on an intra-batch duplicate-census-code row (see
// flagIntraBatchEulbCensusCodeDuplicates in the excel service) — those must be allowed to coexist.
// Every persisted row is registry-backed now (unmatched rows are never written), so this no
// longer needs to be scoped by rowType the way it used to.
ElectedUrbanLocalBodiesRowSchema.index(
  { form: 1, datasetVersion: 1, ulbId: 1 },
  {
    unique: true,
    partialFilterExpression: { ulbId: { $exists: true, $ne: null } },
  },
);

// Partial unique index: prevents duplicate active EULB census codes within the same design year.
// Blank census codes are excluded so INVALID rows with empty identity fields can coexist.
ElectedUrbanLocalBodiesRowSchema.index(
  { year: 1, censusCode: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true, censusCode: { $exists: true, $ne: '' } },
    name: 'uniq_active_eulb_census_code_year',
  },
);
