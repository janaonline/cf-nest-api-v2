import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import { CLAIM_LETTER_MAX_LETTERS_LIMIT } from 'src/module/xvi-fc/state/claim-letter/constants/claim-letter.constants';
import {
  ClaimLetterFinalPdf,
  ClaimLetterFinalPdfSchema,
  type ClaimLetterBatchNumber,
  type ClaimLetterInstallment,
} from './claim-letter-batch.schema';

/**
 * Brain §16.5's action-source vocabulary: 'DIRECT_STATE_REVIEW' (create, submit, abandon), 'DIRECT_MOHUA_REVIEW' (SO
 * approve), 'CLAIM_LETTER_REJECTION' (SO return) and 'DEPENDENCY_INVALIDATION' (a letter returned with another
 * letter's State form, ADR 0009). 'CLAIM_LETTER_APPROVAL' is reserved for MoHUA's final step.
 */
export type ClaimLetterHistoryActionSource =
  | 'DIRECT_STATE_REVIEW'
  | 'DIRECT_MOHUA_REVIEW'
  | 'CLAIM_LETTER_APPROVAL'
  | 'CLAIM_LETTER_REJECTION'
  | 'DEPENDENCY_INVALIDATION';

export type ClaimLetterBatchHistoryDocument = HydratedDocument<ClaimLetterBatchHistory>;

/** Brain §17.3's rejectedSourceRefs shape — filled only by the SO return (each form or row it reopened). */
@Schema({ _id: false })
export class ClaimLetterRejectedSourceRef {
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  claimUlb?: Types.ObjectId | null;

  @Prop({ type: Number, required: true })
  formId!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  formDocumentId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  rowDocumentId?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  ulbId?: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  remark!: string;
}

export const ClaimLetterRejectedSourceRefSchema = SchemaFactory.createForClass(ClaimLetterRejectedSourceRef);

/** What a submission sent: the signed letter as uploaded and the final claim letter (the merged PDF). */
@Schema({ _id: false })
export class ClaimLetterSubmittedFiles {
  @Prop({ type: FileInfoSchema, required: true })
  signedClaimFile!: FileInfo;

  @Prop({ type: ClaimLetterFinalPdfSchema, required: true })
  finalClaimPdf!: ClaimLetterFinalPdf;
}

export const ClaimLetterSubmittedFilesSchema = SchemaFactory.createForClass(ClaimLetterSubmittedFiles);

/**
 * Parent status-transition history (brain §14.10) — written only on committed transitions (plan
 * §9: create draft, submit, abandon in V1), never for draft edits or file uploads.
 */
@Schema({
  collection: 'xvifc_claim_letter_batch_logs',
  timestamps: true,
  versionKey: false,
})
export class ClaimLetterBatchHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', required: true })
  claimLetter!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: ClaimLetterInstallment;

  @Prop({ type: Number, min: 1, max: CLAIM_LETTER_MAX_LETTERS_LIMIT, required: true })
  batchNumber!: ClaimLetterBatchNumber;

  @Prop({ type: Number, required: true })
  version!: number;

  // null only for the very first transition (create draft: null -> IN_PROGRESS).
  @Prop({ type: Number, default: null })
  fromStatus!: number | null;

  @Prop({ type: Number, required: true })
  toStatus!: number;

  @Prop({
    type: String,
    enum: [
      'DIRECT_STATE_REVIEW',
      'DIRECT_MOHUA_REVIEW',
      'CLAIM_LETTER_APPROVAL',
      'CLAIM_LETTER_REJECTION',
      'DEPENDENCY_INVALIDATION',
    ],
    required: true,
  })
  actionSource!: ClaimLetterHistoryActionSource;

  @Prop({ type: String, default: null })
  reason?: string | null;

  @Prop({ type: [ClaimLetterRejectedSourceRefSchema], default: [] })
  rejectedSourceRefs!: ClaimLetterRejectedSourceRef[];

  // Set only on the submit transition.
  @Prop({ type: ClaimLetterSubmittedFilesSchema, default: null })
  submittedFiles?: ClaimLetterSubmittedFiles | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  changedAt!: Date;

  @Prop({ type: String, required: true })
  requestId!: string;

  @Prop({ type: String, default: null })
  bulkActionId?: string | null;

  @Prop({ type: String, default: null })
  ipAddress?: string | null;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ClaimLetterBatchHistorySchema = SchemaFactory.createForClass(ClaimLetterBatchHistory);

ClaimLetterBatchHistorySchema.index({ claimLetter: 1, changedAt: -1 });
ClaimLetterBatchHistorySchema.index({ state: 1, year: 1, installment: 1, changedAt: -1 });
