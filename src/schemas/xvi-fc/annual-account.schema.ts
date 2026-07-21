import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from '../common/file.schema';

export { FileInfo, FileInfoSchema };

// Mirrors the shared FORM_STATUS lifecycle (src/common/constants/form-status.constants.ts) —
// state approval hands off to MOHUA, it does not terminate the workflow.
export enum AnnualAccountFormStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  UNDER_REVIEW_BY_STATE = 'UNDER_REVIEW_BY_STATE',
  RETURNED_BY_STATE = 'RETURNED_BY_STATE',
  UNDER_REVIEW_BY_MOHUA = 'UNDER_REVIEW_BY_MOHUA',
  RETURNED_BY_MOHUA = 'RETURNED_BY_MOHUA',
  SUBMISSION_ACKNOWLEDGED_BY_MOHUA = 'SUBMISSION_ACKNOWLEDGED_BY_MOHUA',
}

export const FORM_STATUS_ID: Record<AnnualAccountFormStatus, number> = {
  [AnnualAccountFormStatus.NOT_STARTED]: 1,
  [AnnualAccountFormStatus.IN_PROGRESS]: 2,
  [AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE]: 3,
  [AnnualAccountFormStatus.RETURNED_BY_STATE]: 4,
  [AnnualAccountFormStatus.UNDER_REVIEW_BY_MOHUA]: 5,
  [AnnualAccountFormStatus.RETURNED_BY_MOHUA]: 6,
  [AnnualAccountFormStatus.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]: 7,
};

export type XviFcAnnualAccountDocument = HydratedDocument<XviFcAnnualAccount>;

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class OCRInfo {
  @Prop({ type: String, default: null })
  jobId: string | null;

  @Prop({ type: String, default: null })
  status: string | null;

  @Prop({ type: String, default: null })
  progressStep: string | null;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: String, default: null })
  validationStatus!: string | null;

  @Prop({ type: String, default: null })
  validationDetails!: string | null;

  @Prop({ type: [String], default: [] })
  failedChecks!: string[];
}

export const OCRInfoSchema = SchemaFactory.createForClass(OCRInfo);

@Schema({ _id: false, versionKey: false })
export class UserInfo {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  role!: string;

  @Prop({ type: String, default: null })
  ipAddress!: string | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;
}

export const UserInfoSchema = SchemaFactory.createForClass(UserInfo);

// ─── DecisionInfo ─────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class DecisionInfo {
  @Prop({ type: String, enum: ['APPROVED', 'RETURNED'], required: true })
  status!: 'APPROVED' | 'RETURNED';

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: UserInfoSchema, required: true })
  decidedBy!: UserInfo;

  @Prop({ default: () => new Date() })
  decidedAt!: Date;
}

export const DecisionInfoSchema = SchemaFactory.createForClass(DecisionInfo);

// ─── CurrentUpload ────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class CurrentUpload {
  @Prop({ required: true })
  uploadId: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  versionLabel: string;

  @Prop({ type: FileInfoSchema, required: true })
  file: FileInfo;

  @Prop({ type: OCRInfoSchema, default: () => ({}) })
  ocrInfo!: OCRInfo;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const CurrentUploadSchema = SchemaFactory.createForClass(CurrentUpload);

// ─── DocumentItem ─────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class DocumentItem {
  @Prop({ required: true })
  docId: string;

  @Prop({
    type: String,
    enum: ['NOT_UPLOADED', 'UPLOADED'],
    default: 'NOT_UPLOADED',
  })
  uploadStatus!: string;

  @Prop({
    type: String,
    enum: ['NOT_STARTED', 'PROCESSING', 'PASSED', 'FAILED'],
    default: 'NOT_STARTED',
  })
  processingStatus: string;

  @Prop({ type: CurrentUploadSchema, default: null })
  currentUpload: CurrentUpload | null;

  /**
   * Every decision recorded against THIS document, oldest first. The last entry is "current" —
   * when its status is APPROVED the document is locked from re-upload; RETURNED unlocks it.
   * Never cleared on re-upload — the prior entry stays as history, a new one is pushed once
   * the resubmitted document is decided again.
   */
  @Prop({ type: [DecisionInfoSchema], default: [] })
  stateDecision!: DecisionInfo[];
}

export const DocumentItemSchema = SchemaFactory.createForClass(DocumentItem);

// ─── AnnualAccountSection ─────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class AnnualAccountSection {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  yearId: Types.ObjectId;

  @Prop({ required: true })
  year: string;

  @Prop({
    type: String,
    enum: Object.values(AnnualAccountFormStatus),
    default: AnnualAccountFormStatus.IN_PROGRESS,
  })
  form_status!: string;

  @Prop({ type: Number, default: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS] })
  form_status_id!: number;

  @Prop({ type: [DocumentItemSchema], default: [] })
  documents!: DocumentItem[];

  @Prop({ type: Boolean, default: false })
  selfDeclared!: boolean;

  @Prop({ type: UserInfoSchema, default: null })
  declaredBy: UserInfo | null;

  @Prop({ type: Date, default: null })
  declaredAt: Date | null;

  /** Current/latest STATE decision for the whole section — null until a state user makes a final call. */
  @Prop({ type: DecisionInfoSchema, default: null })
  stateDecision: DecisionInfo | null;

  /** Current/latest MOHUA decision for the whole section — null until MOHUA acts on what state handed off. */
  @Prop({ type: DecisionInfoSchema, default: null })
  mohuaDecision: DecisionInfo | null;

  /** Placeholder for a future claim-letter-generation feature — not set by any code path yet. */
  @Prop({ type: Boolean, default: false })
  claimLetterGenerated!: boolean;
}

export const AnnualAccountSectionSchema = SchemaFactory.createForClass(AnnualAccountSection);

// ─── Root document ────────────────────────────────────────────────────────────

@Schema({
  collection: 'xvifc_annualaccount_datas',
  timestamps: true,
  versionKey: false,
})
export class XviFcAnnualAccount {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year!: Types.ObjectId;

  @Prop({ type: AnnualAccountSectionSchema, default: null })
  auditedData: AnnualAccountSection | null;

  @Prop({ type: AnnualAccountSectionSchema, default: null })
  unauditedData: AnnualAccountSection | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  modifiedBy: Types.ObjectId;
}

export const XviFcAnnualAccountSchema = SchemaFactory.createForClass(XviFcAnnualAccount);

XviFcAnnualAccountSchema.index({ ulb: 1, design_year: 1 }, { unique: true });
XviFcAnnualAccountSchema.index({ state: 1, design_year: 1 });
