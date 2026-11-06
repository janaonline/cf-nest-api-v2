import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import {
  CLAIM_EXEMPTION_KINDS,
  type ClaimEligibilityEvidence,
  type ClaimEligibilitySnapshotResult,
  type ClaimExemptionKind,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';

/**
 * Shared subdocument (brain §14.3) — the frozen record of one eligibility-source evaluation,
 * embedded in both the claim parent's `stateEligibilitySources` and each child's
 * `eligibilitySources`. `result` is deliberately narrower than the live evaluator's
 * `EligibilityEvaluationResult` — a 'FAILED' evaluation is never frozen into a claim, only
 * 'PASSED'/'EXEMPTED' ones are.
 */
@Schema({ _id: false })
export class ClaimLetterEligibilitySourceSnapshot {
  @Prop({ type: Number, required: true })
  formId!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'FormJson', required: true })
  formJsonId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  ruleVersion!: number;

  @Prop({ type: String, required: true })
  formType!: string;

  /** Null only for an EXEMPTED source with no document (an Entire State exemption for a form never
   *  started). */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  formDocumentId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  rowDocumentId?: Types.ObjectId | null;

  /** Null with `formDocumentId`. */
  @Prop({ type: Number, default: null })
  statusAtEvaluation!: number | null;

  @Prop({ type: Number, default: null })
  rowStatusAtEvaluation?: number | null;

  @Prop({ type: Number, default: null })
  revision?: number | null;

  @Prop({ type: Number, default: null })
  datasetVersion?: number | null;

  @Prop({ type: String, enum: ['PASSED', 'EXEMPTED'], required: true })
  result!: ClaimEligibilitySnapshotResult;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  exemptionId?: Types.ObjectId | null;

  /** The discretionary request status relied on: 5 under MoHUA review, 7 approved; null otherwise. */
  @Prop({ type: Number, default: null })
  exemptionStatusAtEvaluation?: number | null;

  /** How an EXEMPTED result came about; null for PASSED. */
  @Prop({ type: String, enum: [...CLAIM_EXEMPTION_KINDS, null], default: null })
  exemptionKind?: ClaimExemptionKind | null;

  @Prop({ type: String, required: true })
  reasonCode!: string;

  // Loose at the Mongoose level (like formJson.data/meta elsewhere) — real shape enforcement is
  // the restricted, versioned ClaimEligibilityEvidence union (see claim-eligibility.type.ts and
  // plan §4.1); only ClaimEligibilityEvaluatorService ever constructs this value.
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  evidence!: ClaimEligibilityEvidence;
}

export const ClaimLetterEligibilitySourceSnapshotSchema = SchemaFactory.createForClass(
  ClaimLetterEligibilitySourceSnapshot,
);
