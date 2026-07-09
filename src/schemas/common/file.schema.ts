import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false, versionKey: false })
export class FileInfo {
  // TODO: remove later
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

  @Prop({ type: String, default: '' })
  sha256!: string;

  @Prop({ type: Date, default: () => new Date() })
  uploadedAt: Date;
}

export const FileInfoSchema = SchemaFactory.createForClass(FileInfo);

// Back-compat alias for existing consumers (e.g. ulb.schema.ts) that still import the old name.
export { FileInfo as CommonFile, FileInfoSchema as CommonFileSchema };
