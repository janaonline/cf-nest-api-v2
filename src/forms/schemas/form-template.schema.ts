import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FormTemplateDocument = FormTemplate & Document;

@Schema({ timestamps: true, collection: 'form_templates' })
export class FormTemplate {
  @Prop({ required: true, unique: true, index: true })
  code!: string;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export const FormTemplateSchema = SchemaFactory.createForClass(FormTemplate);
