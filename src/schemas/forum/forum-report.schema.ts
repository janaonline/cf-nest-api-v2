import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ForumReportDocument = HydratedDocument<ForumReport>;

export const FORUM_REPORT_TARGET_TYPES = ['thread', 'comment'] as const;
export type ForumReportTargetType = (typeof FORUM_REPORT_TARGET_TYPES)[number];

/** TS-1305 report reasons (Off-topic, Wrong information, Personal details shared, Other). */
export const FORUM_REPORT_REASONS = ['off-topic', 'wrong-information', 'personal-details', 'other'] as const;
export type ForumReportReason = (typeof FORUM_REPORT_REASONS)[number];

/** open = waiting for an ADMIN; hidden = the post was hidden; dismissed = the post stays. */
export const FORUM_REPORT_STATUSES = ['open', 'hidden', 'dismissed'] as const;
export type ForumReportStatus = (typeof FORUM_REPORT_STATUSES)[number];

@Schema({ _id: false })
export class ForumReporter {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Forum display name at the time of the report (ULB / State DMA / MoHUA name). */
  @Prop({ type: String, required: true, maxlength: 60 })
  name!: string;

  @Prop({ type: String, required: true })
  role!: string;
}
const ForumReporterSchema = SchemaFactory.createForClass(ForumReporter);

/** A user's report of a thread or a reply, reviewed by an ADMIN in the forum admin area. */
@Schema({ collection: 'reports', versionKey: false })
export class ForumReport {
  @Prop({ type: String, enum: FORUM_REPORT_TARGET_TYPES, required: true })
  targetType!: ForumReportTargetType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  /** The thread itself, or the thread the reported reply belongs to. */
  @Prop({ type: Types.ObjectId, ref: 'ForumThread', required: true })
  threadId!: Types.ObjectId;

  @Prop({ type: String, enum: FORUM_REPORT_REASONS, required: true })
  reason!: ForumReportReason;

  @Prop({ type: ForumReporterSchema, required: true })
  reporter!: ForumReporter;

  @Prop({ type: String, enum: FORUM_REPORT_STATUSES, required: true, default: 'open' })
  status!: ForumReportStatus;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy?: Types.ObjectId | null;
}

export const ForumReportSchema = SchemaFactory.createForClass(ForumReport);
// One report per user per item: a second report of the same thread / reply is a duplicate-key error (409).
ForumReportSchema.index({ targetType: 1, targetId: 1, 'reporter.userId': 1 }, { unique: true });
ForumReportSchema.index({ status: 1, createdAt: -1 });
ForumReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
