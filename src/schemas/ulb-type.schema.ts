import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'ulbtypes', timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class UlbType {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  /**
   * Grant cycles this ULB type is NOT eligible for (e.g. `['XVIFC']` for Cantonment Board).
   */
  @Prop({ type: [String], default: [] })
  ineligibleForGrantCycles?: string[];
}

export type UlbTypeDocument = UlbType & Document;
export const UlbTypeSchema = SchemaFactory.createForClass(UlbType);

UlbTypeSchema.index({ name: 1, isActive: 1 }, { unique: true });
