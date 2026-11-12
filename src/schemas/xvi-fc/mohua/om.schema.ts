import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import type { ClaimLetterInstallment } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';

export type OmDocument = HydratedDocument<Om>;

/** DRAFT while MoHUA fills the letter; GENERATED once issued (content frozen); SIGNED_UPLOADED with the e-Office copy. */
export const OM_STATUS = {
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  SIGNED_UPLOADED: 'SIGNED_UPLOADED',
} as const;
export type OmStatus = (typeof OM_STATUS)[keyof typeof OM_STATUS];

/**
 * One Office Memorandum per claim letter the SO verified: MoHUA's recommendation to the Department of Expenditure
 * to release the installment for the letter's ULBs. Created as a DRAFT when MoHUA first edits it; Generate freezes
 * the rendered content in `content`, so every later download prints exactly what was issued.
 */
@Schema({ collection: 'xvifc_oms', timestamps: true, versionKey: false })
export class Om {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', required: true, immutable: true })
  claimLetter!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true, immutable: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true, immutable: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true, immutable: true })
  installment!: ClaimLetterInstallment;

  @Prop({ type: String, enum: Object.values(OM_STATUS), default: OM_STATUS.DRAFT })
  status!: OmStatus;

  /** The e-Office file number MoHUA types into the letter's "No." box. */
  @Prop({ type: String, default: null })
  omNumber!: string | null;

  /** The letter's "Dated", as an ISO date (yyyy-mm-dd). */
  @Prop({ type: String, default: null })
  omDate!: string | null;

  /** Set on Generate: the n-th OM of this State and year, and the reference built from it (OM/<STATE>/<FY>/<n>). */
  @Prop({ type: Number, default: null })
  sequence!: number | null;

  @Prop({ type: String, default: null })
  refNo!: string | null;

  @Prop({ type: Number, default: 0 })
  ulbCount!: number;

  /** Whole rupees recommended: the claim letter's claimed total. */
  @Prop({ type: Number, default: 0 })
  totalAmount!: number;

  /** The rendered OM (OmContent) frozen on Generate; null while a draft (drafts render live). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  content!: Record<string, unknown> | null;

  /** The signed copy back from e-Office (PDF). */
  @Prop({ type: FileInfoSchema, default: null })
  signedFile!: FileInfo | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  generatedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  generatedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  signedUploadedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  signedUploadedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OmSchema = SchemaFactory.createForClass(Om);

OmSchema.index({ claimLetter: 1 }, { unique: true });
// Two concurrent generates can't take the same number; the loser retries.
OmSchema.index({ state: 1, year: 1, sequence: 1 }, { unique: true, partialFilterExpression: { sequence: { $type: 'number' } } });
OmSchema.index({ year: 1, installment: 1, status: 1 });

export type OmLogDocument = HydratedDocument<OmLog>;

/** Append-only log of what was done to an OM (generated, signed copy uploaded). */
@Schema({ collection: 'xvifc_om_logs', timestamps: true, versionKey: false })
export class OmLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Om', required: true })
  om!: Types.ObjectId;

  @Prop({ type: String, enum: ['GENERATED', 'SIGNED_UPLOADED'], required: true })
  action!: 'GENERATED' | 'SIGNED_UPLOADED';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  changedAt!: Date;

  @Prop({ type: String, default: null })
  ipAddress!: string | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;
}

export const OmLogSchema = SchemaFactory.createForClass(OmLog);

OmLogSchema.index({ om: 1, changedAt: -1 });
