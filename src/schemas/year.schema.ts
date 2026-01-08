import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class Year {
  @Prop({ type: String, unique: true, index: 1, required: true })
  year: string;

  @Prop({ type: Boolean, index: 1, default: true })
  isActive: boolean;
}

export type YearDocument = Year & Document;
export const YearSchema = SchemaFactory.createForClass(Year);
