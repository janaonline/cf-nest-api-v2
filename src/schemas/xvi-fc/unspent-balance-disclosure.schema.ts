import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false, versionKey: false })
class DisclosureDoc {
  @Prop({ required: true })
  filepath: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ default: 0 })
  sizeKb: number;

  @Prop({ default: 0 })
  pages: number;
}
const DisclosureDocSchema = SchemaFactory.createForClass(DisclosureDoc);

@Schema({ _id: false, versionKey: false })
class FcPeriodData {
  @Prop({ required: true, type: Number })
  unspentBalance: number;

  @Prop({ required: true })
  bankAccountNumber: string;

  @Prop({ type: [DisclosureDocSchema], default: [] })
  documents: DisclosureDoc[];
}
const FcPeriodDataSchema = SchemaFactory.createForClass(FcPeriodData);

export type XviFcUnspentBalanceDisclosureDocument = XviFcUnspentBalanceDisclosure & Document;

@Schema({ collection: 'xvi_fc_unspent_balance_disclosures', timestamps: true })
export class XviFcUnspentBalanceDisclosure {
  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulb: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  designYear: Types.ObjectId;

  @Prop({ required: true, enum: ['manual', 'document-assisted'] })
  mode: string;

  @Prop({ type: FcPeriodDataSchema, required: true })
  fc14: FcPeriodData;

  @Prop({ type: FcPeriodDataSchema, required: true })
  fc15: FcPeriodData;

  @Prop({ required: true, enum: ['DRAFT', 'SUBMITTED'], default: 'SUBMITTED' })
  formStatus: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  submittedBy: Types.ObjectId;

  @Prop({ required: true })
  submittedAt: Date;
}

export const XviFcUnspentBalanceDisclosureSchema = SchemaFactory.createForClass(XviFcUnspentBalanceDisclosure);

// One disclosure record per ULB per year; re-submitting overwrites via upsert.
XviFcUnspentBalanceDisclosureSchema.index({ ulb: 1, designYear: 1 }, { unique: true });
