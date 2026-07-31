import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type {
  ClaimEligibilityEvidence,
  ClaimEligibilitySnapshotResult,
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

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  formDocumentId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  rowDocumentId?: Types.ObjectId | null;

  @Prop({ type: Number, required: true })
  statusAtEvaluation!: number;

  @Prop({ type: String, default: null })
  rowStatusAtEvaluation?: string | null;

  @Prop({ type: Number, default: null })
  revision?: number | null;

  @Prop({ type: Number, default: null })
  datasetVersion?: number | null;

  @Prop({ type: String, enum: ['PASSED', 'EXEMPTED'], required: true })
  result!: ClaimEligibilitySnapshotResult;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  exemptionId?: Types.ObjectId | null;

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
