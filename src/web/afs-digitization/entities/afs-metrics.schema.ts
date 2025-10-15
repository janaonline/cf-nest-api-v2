import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class AfsMetric {
  @Prop({ type: Number, default: 0 })
  digitizedFiles: number;

  @Prop({ type: Number, default: 0 })
  digitizedPages: number;

  @Prop({ type: Number, default: 0 })
  failedFiles: number;

  @Prop({ type: Number, default: 0 })
  failedPages: number;
}

export type AfsMetricDocument = AfsMetric & Document;
export const AfsMetricSchema = SchemaFactory.createForClass(AfsMetric);
AfsMetricSchema.index({ digitizedFiles: 1, digitizedPages: 1, failedFiles: 1, failedPages: 1 });
