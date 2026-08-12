import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from '../common/file.schema';

export { FileInfo, FileInfoSchema };

// Mirrors the shared FORM_STATUS lifecycle (src/common/constants/form-status.constants.ts) —
// state approval now lands on APPROVED_BY_STATE first (STATE may still undo it), then the
// Generate Claim Letter feature (cross-form, built separately) moves it to AWAITING_CLAIM_LETTER
// before it finally hands off to MOHUA.
export enum AnnualAccountFormStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  UNDER_REVIEW_BY_STATE = 'UNDER_REVIEW_BY_STATE',
  RETURNED_BY_STATE = 'RETURNED_BY_STATE',
  UNDER_REVIEW_BY_MOHUA = 'UNDER_REVIEW_BY_MOHUA',
  RETURNED_BY_MOHUA = 'RETURNED_BY_MOHUA',
  SUBMISSION_ACKNOWLEDGED_BY_MOHUA = 'SUBMISSION_ACKNOWLEDGED_BY_MOHUA',
  APPROVED_BY_STATE = 'APPROVED_BY_STATE',
  AWAITING_CLAIM_LETTER = 'AWAITING_CLAIM_LETTER',
  /** Never a live form_status — appears only as a form-log `toStatus` marking an undo event. */
  UNDO = 'UNDO',
  /** Reserved — not wired to any transition yet. */
  ACTION_REQUIRED = 'ACTION_REQUIRED',
}

export const FORM_STATUS_ID: Record<AnnualAccountFormStatus, number> = {
  [AnnualAccountFormStatus.NOT_STARTED]: 1,
  [AnnualAccountFormStatus.IN_PROGRESS]: 2,
  [AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE]: 3,
  [AnnualAccountFormStatus.RETURNED_BY_STATE]: 4,
  [AnnualAccountFormStatus.UNDER_REVIEW_BY_MOHUA]: 5,
  [AnnualAccountFormStatus.RETURNED_BY_MOHUA]: 6,
  [AnnualAccountFormStatus.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]: 7,
  [AnnualAccountFormStatus.APPROVED_BY_STATE]: 8,
  [AnnualAccountFormStatus.AWAITING_CLAIM_LETTER]: 9,
  [AnnualAccountFormStatus.UNDO]: 10,
  [AnnualAccountFormStatus.ACTION_REQUIRED]: 11,
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

  /** ULB has asked a human reviewer to look at this failed OCR result. Set once, cleared on retry/re-upload. */
  @Prop({ type: Boolean, default: false })
  isManualReviewRequested!: boolean;

  @Prop({ type: Date, default: null })
  manualReviewRequestedAt!: Date | null;
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
   * STATE's current decision on THIS document, or null if undecided. When APPROVED the document
   * is locked from re-upload; RETURNED or null leaves it open. Provisional until the section
   * itself is finalized (Approve Section/Return Section) — STATE can undo it (reset to null)
   * any time before then. The full history of who decided what lives in
   * XviFcAnnualAccountFormLog, not here, so this only ever holds the current verdict.
   */
  @Prop({ type: DecisionInfoSchema, default: null })
  stateDecision!: DecisionInfo | null;

  /**
   * ADMIN's verdict on a ULB's manual-review request for this document, or null if undecided/never
   * requested. APPROVED overrides the failed OCR result (processingStatus is forced to PASSED);
   * RETURNED leaves processingStatus FAILED with a note explaining why. Like stateDecision, this is
   * never force-cleared on retry/re-upload — it goes stale once currentUpload.uploadedAt postdates
   * decidedAt, same convention as stateDecision.
   */
  @Prop({ type: DecisionInfoSchema, default: null })
  manualReviewDecision!: DecisionInfo | null;
}

export const DocumentItemSchema = SchemaFactory.createForClass(DocumentItem);

export type AnnualAccountSectionType = 'audited' | 'unaudited';

// ─── Root document ────────────────────────────────────────────────────────────

/**
 * One document per {ulb, design_year, sectionType} — audited AFS (formId 30) and provisional
 * AFS (formId 31) are independent forms with independent lifecycles, not one form with two
 * embedded halves. The 'audited' document is the anchor: it keeps the `_id` that existed before
 * this split (back when both sections lived on one document), so every existing external
 * reference to an "annualAccountId" keeps working unchanged. The 'unaudited' document is a
 * sibling, looked up by {ulb, design_year, sectionType:'unaudited'} — see
 * AnnualAccountsService.resolveSectionDocument.
 */
@Schema({
  collection: 'xvifc_annualaccounts',
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

  @Prop({ type: String, enum: ['audited', 'unaudited'], required: true })
  sectionType!: AnnualAccountSectionType;

  /**
   * Null until this section's first document upload — the flat-document equivalent of the old
   * "section sub-object is null" NOT_STARTED state (the 'audited' document always exists, as
   * the {ulb, design_year} anchor, even before any audited document is ever uploaded).
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  yearId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  year: string | null;

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

  /** Current/latest STATE decision for this section — null until a state user makes a final call. */
  @Prop({ type: DecisionInfoSchema, default: null })
  stateDecision: DecisionInfo | null;

  /** Current/latest MOHUA decision for this section — null until MOHUA acts on what state handed off. */
  @Prop({ type: DecisionInfoSchema, default: null })
  mohuaDecision: DecisionInfo | null;

  /** Placeholder for a future claim-letter-generation feature — not set by any code path yet. */
  @Prop({ type: Boolean, default: false })
  claimLetterGenerated!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  modifiedBy: Types.ObjectId;
}

export const XviFcAnnualAccountSchema = SchemaFactory.createForClass(XviFcAnnualAccount);

XviFcAnnualAccountSchema.index({ ulb: 1, design_year: 1, sectionType: 1 }, { unique: true });
XviFcAnnualAccountSchema.index({ state: 1, design_year: 1 });
