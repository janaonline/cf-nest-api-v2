import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false, versionKey: false })
export class CommonFile {
  // todo: remove thislater
  @Prop({ type: String })
  originalName: string;
  // TODO: add required validation for the file name to avoid invalid characters and ensure proper formatting
  @Prop({ type: String })
  name: string;

  @Prop({ type: String, required: true })
  path: string;

  @Prop({ type: String, required: true })
  mimeType: string;

  @Prop({ type: String, required: true })
  extension: string;

  @Prop({ type: Number, required: true })
  sizeKb: number;

  @Prop({ type: Number, default: null })
  pageCount: number | null;

  @Prop({ type: Date, default: () => new Date() })
  uploadedAt: Date;
}

export const CommonFileSchema = SchemaFactory.createForClass(CommonFile);
