import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FormStatusHistoryDocument = FormStatusHistory & Document;

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: false }, collection: 'form_status_histories' })
export class FormStatusHistory {
  @Prop({ type: Types.ObjectId, ref: 'FormSubmission', required: true, index: true })
  formSubmissionId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  fromStatus!: number;

  @Prop({ type: Number, required: true })
  toStatus!: number;

  @Prop({ type: String, required: true })
  action!: string;

  @Prop({ type: String })
  remarks?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorUserId!: Types.ObjectId;

  @Prop({ type: String })
  actorOrgType?: string;

  @Prop({ type: Types.ObjectId })
  actorOrgId?: Types.ObjectId;

  @Prop({ type: String })
  actorRoleCode?: string;
}

export const FormStatusHistorySchema = SchemaFactory.createForClass(FormStatusHistory);

FormStatusHistorySchema.index({ formSubmissionId: 1, createdAt: 1 });
