import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EmailReminderDocument = HydratedDocument<EmailReminder>;

export enum ReminderStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum RecipientCategory {
  ALL_USERS = 'ALL_USERS',
  ALL_ULB = 'ALL_ULB',
  ALL_STATE = 'ALL_STATE',
  ALL_ULB_EDITORS = 'ALL_ULB_EDITORS',
  ALL_STATE_EDITORS = 'ALL_STATE_EDITORS',
  ONLY_ADMIN = 'ONLY_ADMIN',
  ONLY_MOHUA = 'ONLY_MOHUA',
  /** Test only — sends to the address in TEST_RECIPIENT_EMAIL env var */
  ONLY_ME = 'ONLY_ME',
}

@Schema({ timestamps: true })
export class EmailReminder {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'EmailTemplate', required: true })
  templateId: Types.ObjectId;

  @Prop({ required: true })
  deadlineDate: Date;

  @Prop({ required: true, min: 1 })
  reminderDaysBefore: number;

  /** Time in IST (HH:MM 24-hour) when the reminder fires. e.g. "09:00", "14:30" */
  @Prop({ type: String, default: '09:00' })
  reminderTime: string;

  /** Computed: deadlineDate − reminderDaysBefore days at reminderTime IST */
  @Prop({ required: true })
  reminderDate: Date;

  @Prop({ type: String, enum: Object.values(RecipientCategory), required: true })
  recipientCategory: RecipientCategory;

  /** Key-value pairs injected into {{variable}} placeholders in the template */
  @Prop({ type: Object, default: {} })
  variables: Record<string, string>;

  @Prop({ type: String, enum: Object.values(ReminderStatus), default: ReminderStatus.PENDING })
  status: ReminderStatus;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: Number, default: 0 })
  sentCount: number;

  @Prop({ type: Number, default: 0 })
  failedCount: number;

  @Prop({ type: String, default: null })
  lastError: string | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}

export const EmailReminderSchema = SchemaFactory.createForClass(EmailReminder);
EmailReminderSchema.index({ reminderDate: 1, status: 1, isDeleted: 1 });
EmailReminderSchema.index({ status: 1, isActive: 1 });
