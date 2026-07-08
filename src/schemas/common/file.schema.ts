import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false, versionKey: false })
export class CommonFile {
  @Prop({ type: String, required: true })
  originalName: string;

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
