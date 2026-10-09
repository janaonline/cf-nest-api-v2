import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  FileInfo,
  FileInfoSchema,
  OCRInfo,
  OCRInfoSchema,
  UserInfo,
  UserInfoSchema,
} from './annual-account.schema';
import { DUR_DOC_IDS, type XviFcDurDocId } from './dur.schema';

export type XviFcDurUploadHistoryDocument = HydratedDocument<XviFcDurUploadHistory>;

/**
 * One row per DUR upload attempt (not just the current one) — mirrors
 * XviFcAnnualAccountUploadHistory, minus the fields AA tracks that DUR's own upload/OCR flow
 * doesn't (section/auditType — DUR has no section concept; queue/error/startedAt — DUR's
 * DurValidationProcessor doesn't track BullMQ job bookkeeping or a stalled-processing cutoff the
 * way Annual Account's does). Lets any past upload resolve by uploadId on its own — the DUR
 * document's `documents[].currentUpload` is overwritten wholesale on every re-upload and can no
 * longer answer that question once superseded (see DurManualReviewService.getDocumentDownload,
 * which reads from this collection instead of the live document for exactly this reason).
 *
 * Only covers uploads made from the point this collection was introduced onward — existing DUR
 * documents already in the database have no history rows and can only resolve their *current*
 * upload, same as before.
 */
@Schema({
  collection: 'xvifc_dur_upload_history',
  timestamps: true,
  versionKey: false,
})
export class XviFcDurUploadHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcDur', required: true })
  durId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear: Types.ObjectId;

  @Prop({ type: String, enum: DUR_DOC_IDS, required: true })
  docId: XviFcDurDocId;

  @Prop({ required: true, unique: true })
  uploadId: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  versionLabel: string;

  @Prop({ type: FileInfoSchema, required: true })
  file: FileInfo;

  @Prop({
    type: String,
    enum: ['NOT_STARTED', 'PROCESSING', 'PASSED', 'FAILED'],
    default: 'PROCESSING',
  })
  processingStatus: string;

  @Prop({ type: OCRInfoSchema, default: () => ({}) })
  ocrInfo: OCRInfo;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo: UserInfo;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;

  /** Mirrors documents[].currentUpload.retryValidationCount at write time — kept in sync by
   *  DurService.retryUpload rather than derived, so a past upload's retry count stays readable
   *  after it's been superseded. */
  @Prop({ default: 0 })
  retryValidationCount: number;

  @Prop({ type: Date, default: null })
  retryValidationAt: Date | null;
}

export const XviFcDurUploadHistorySchema = SchemaFactory.createForClass(XviFcDurUploadHistory);

XviFcDurUploadHistorySchema.index({ durId: 1, docId: 1, version: 1 }, { unique: true });
XviFcDurUploadHistorySchema.index({ durId: 1, docId: 1 });
