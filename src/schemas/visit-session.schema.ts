import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class VisitSession {
  @Prop({ type: [String], default: [] })
  routes: string[];

  @Prop({ default: true })
  isActive: boolean;
}

export type VisitSessionDocument = HydratedDocument<VisitSession>;
export const VisitSessionSchema = SchemaFactory.createForClass(VisitSession);
