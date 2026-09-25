import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EmailTemplateDocument = HydratedDocument<EmailTemplate>;

@Schema({ timestamps: true })
export class EmailTemplate {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ required: true, trim: true })
  name: string;

  /** URL-safe unique key, auto-generated from name. Used to fetch by type. */
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  slug: string;

  @Prop({ required: true, trim: true })
  subject: string;

  /**
   * HTML body. Supports {{variable}} placeholders that are interpolated
   * at send-time using the `variables` map in the send request.
   */
  @Prop({ required: true })
  body: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}

export const EmailTemplateSchema = SchemaFactory.createForClass(EmailTemplate);
EmailTemplateSchema.index({ isDeleted: 1, isActive: 1 });
