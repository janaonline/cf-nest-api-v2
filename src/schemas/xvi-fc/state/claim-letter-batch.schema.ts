import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import {
  ClaimLetterEligibilitySourceSnapshot,
  ClaimLetterEligibilitySourceSnapshotSchema,
} from './claim-letter-eligibility-source-snapshot.schema';

export type ClaimLetterInstallment = 1 | 2;
export type ClaimLetterBatchNumber = 1 | 2 | 3;
export type ClaimLetterAssemblyStatus = 'BUILDING' | 'READY';

export type ClaimLetterBatchDocument = HydratedDocument<ClaimLetterBatch>;

/**
 * All monetary fields are whole Rupees (no decimals), matching Devolution's own storage
 * convention (and every other xvi-fc form) — no unit conversion at any boundary, stored and
 * returned as-is. See claim-letter-financial.helpers.ts for the exact-integer comparison/sum
 * helpers used on these fields (the ±10% variance boundary, financial-totals cross-checks).
 */
@Schema({ _id: false })
export class ClaimLetterFinancialSummary {
  @Prop({ type: Number, default: 0 })
  totalInstallmentAllocation!: number;

  @Prop({ type: Number, default: 0 })
  totalAlreadyAcknowledged!: number;

  // Sum claimed across this state/year/installment's OTHER batches at UNDER_REVIEW_BY_MOHUA /
  // IN_PROGRESS respectively, self-excluding this batch — persisted (not just computed transiently)
  // so the frontend can live-recompute `remainingIfAcknowledged`-equivalent values as the user edits
  // claim amounts, without needing a fresh server round-trip on every keystroke.
  @Prop({ type: Number, default: 0 })
  totalClaimInProgress!: number;

  @Prop({ type: Number, default: 0 })
  totalClaimInDraft!: number;

  // totalInstallmentAllocation − totalAlreadyAcknowledged − totalClaimInProgress − totalClaimInDraft.
  @Prop({ type: Number, default: 0 })
  availableToClaim!: number;

  @Prop({ type: Number, default: 0 })
  selectedAllocation!: number;

  @Prop({ type: Number, default: 0 })
  currentSelectedClaim!: number;

  // = availableToClaim − currentSelectedClaim (i.e. also accounts for other concurrent batches, not
  // just this state's already-acknowledged claims — see claim-letter-assembly.service.ts).
  @Prop({ type: Number, default: 0 })
  remainingIfAcknowledged!: number;
}

export const ClaimLetterFinancialSummarySchema = SchemaFactory.createForClass(ClaimLetterFinancialSummary);

/**
 * Parent claim document (brain §14.2) — one immutable version of one logical batch slot per
 * State/year/installment. `assemblyStatus` is an internal build guard, not a workflow status;
 * every normal read/mutation path must ignore a parent until it reaches 'READY' (plan §7.5).
 *
 * PDF generation is parked (plan §1): `generatedClaimFile` stays null in V1, `signedClaimFile` is
 * what the State uploads directly and is the only file required before submit.
 */
@Schema({
  collection: 'xvifc_claim_letter_batches',
  timestamps: true,
  versionKey: false,
})
export class ClaimLetterBatch {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: ClaimLetterInstallment;

  @Prop({ type: Number, enum: [1, 2, 3], required: true })
  batchNumber!: ClaimLetterBatchNumber;

  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  @Prop({ type: Number, default: FORM_STATUS.IN_PROGRESS })
  currentFormStatus!: number;

  @Prop({ type: String, enum: ['BUILDING', 'READY'], default: 'BUILDING' })
  assemblyStatus!: ClaimLetterAssemblyStatus;

  // Idempotency key for the create-draft/version-regeneration pipeline (plan §7.2/§10) — unique
  // indexed below so a retried create request can never produce two parents.
  @Prop({ type: String, required: true })
  buildRequestId!: string;

  @Prop({ type: String, default: '' })
  templateVersion!: string;

  @Prop({ type: String, required: true })
  fileBaseName!: string;

  @Prop({ type: FileInfoSchema, default: null })
  generatedClaimFile!: FileInfo | null;

  @Prop({ type: FileInfoSchema, default: null })
  signedClaimFile!: FileInfo | null;

  @Prop({ type: Date, default: null })
  generatedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  generatedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  submittedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  submittedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  resolvedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  mohuaRemarks?: string | null;

  @Prop({ type: Boolean, default: false })
  dependencyInvalidated!: boolean;

  @Prop({ type: String, default: null })
  dependencyInvalidationReason?: string | null;

  @Prop({ type: [ClaimLetterEligibilitySourceSnapshotSchema], default: [] })
  stateEligibilitySources!: ClaimLetterEligibilitySourceSnapshot[];

  @Prop({ type: Number, default: 0 })
  ulbCount!: number;

  @Prop({ type: String, default: null })
  contentHash!: string | null;

  @Prop({ type: Number, default: null })
  contentHashVersion!: number | null;

  @Prop({ type: ClaimLetterFinancialSummarySchema, default: () => ({}) })
  financialSummary!: ClaimLetterFinancialSummary;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', default: null })
  supersedes?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', default: null })
  supersededBy?: Types.ObjectId | null;

  // Optimistic-concurrency counter for `PATCH .../draft` (plan §7.5/§10) — incremented on every
  // successful content-changing update.
  @Prop({ type: Number, default: 0 })
  revision!: number;

  // Non-null while an `updateDraft` call is mid-rebuild — claimed atomically alongside the
  // `revision`/`currentFormStatus` check so a second concurrent edit can never interleave its
  // delete/insert with this one's, and cleared back to `null` on both the success and every
  // compensating-failure path. `abandonDraft`/`submit` also require this to be `null` (or expired)
  // before they may act, so neither can land while children are mid-rebuild. Self-expiring lease —
  // see CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES; no cron/cleanup counterpart, unlike the BUILDING case.
  @Prop({ type: String, default: null })
  editLockToken!: string | null;

  @Prop({ type: Date, default: null })
  editLockAcquiredAt!: Date | null;

  // Not in brain §14.2 — added to support the abandon endpoint (plan §1) without violating
  // immutability: an abandoned draft is preserved forever, never deleted.
  @Prop({ type: Boolean, default: false })
  isAbandoned!: boolean;

  @Prop({ type: Date, default: null })
  abandonedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  abandonedBy?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ClaimLetterBatchSchema = SchemaFactory.createForClass(ClaimLetterBatch);

// One row per version per logical slot — DB-enforced (plan §1), not just service-checked.
// Abandoned drafts are excluded so their batchNumber becomes reusable (confirmed with the user).
ClaimLetterBatchSchema.index(
  { state: 1, year: 1, installment: 1, batchNumber: 1, version: 1 },
  { unique: true, partialFilterExpression: { isAbandoned: false } },
);

// A retried create request can never produce two parents.
ClaimLetterBatchSchema.index({ buildRequestId: 1 }, { unique: true });

// List/history and eligibility-summary queries.
ClaimLetterBatchSchema.index({ state: 1, year: 1, installment: 1, currentFormStatus: 1 });
