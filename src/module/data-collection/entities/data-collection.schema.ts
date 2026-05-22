import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const CODE = 'nmamCode';

// Keys are now open strings — validated against DB legends in the service layer.
export type LineItemKey = string;
export type LineItemsMap = Record<string, number | null>;

@Schema({ timestamps: true })
export class DataCollection {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  yearId!: Types.ObjectId;

  @Prop({ type: String })
  templateVersion?: string;

  @Prop({ type: String, enum: ['VALID', 'WARNING'], default: 'VALID' })
  validationStatus?: 'VALID' | 'WARNING';

  @Prop({ type: Map, of: { type: Number, default: null }, required: true })
  lineItems!: Map<string, number | null>;
}

export type DataCollectionDocument = HydratedDocument<DataCollection>;
export const DataCollectionSchema = SchemaFactory.createForClass(DataCollection);
