import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ComputedValues } from '../types/data-collection.types';

export const CODE = 'nmamCode';

// Keys are open strings — validated against DB legends in the service layer.
export type LineItemKey = string;
export type LineItemsMap = Record<string, number>;

@Schema({ timestamps: true })
export class DataCollection {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'ApiClient', required: true, index: true })
  apiClientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'State', required: true })
  stateId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  yearId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  yearCode!: string;

  @Prop({ type: String, required: true })
  templateVersion!: string;

  @Prop({ type: String, enum: ['VALID', 'WARNING'], default: 'VALID' })
  validationStatus!: 'VALID' | 'WARNING';

  // 0 is valid (explicit zero). Missing key = not submitted. null is rejected at service layer.
  @Prop({ type: Map, of: Number, required: true })
  lineItems!: Map<string, number>;

  @Prop({ type: Boolean, required: true, default: true, index: true })
  isActive!: boolean;

  @Prop({ type: String, enum: ['ACTIVE', 'REVERSED'], required: true, default: 'ACTIVE', index: true })
  status!: 'ACTIVE' | 'REVERSED';

  @Prop({ type: Date })
  reversedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reversedBy?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  reversalReason?: string;

  @Prop({
    type: {
      totIncome: { type: Number, required: true },
      totExpenditure: { type: Number, required: true },
      totRevenue: { type: Number, required: true },
      totOwnRevenue: { type: Number, required: true },
    },
    required: true,
    _id: false,
  })
  computed!: ComputedValues;
}

export type DataCollectionDocument = HydratedDocument<DataCollection>;
export const DataCollectionSchema = SchemaFactory.createForClass(DataCollection);

DataCollectionSchema.index({ ulbId: 1, yearId: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
DataCollectionSchema.index({ stateId: 1, yearId: 1 });
DataCollectionSchema.index({ yearCode: 1 });
DataCollectionSchema.index({ templateVersion: 1 });
DataCollectionSchema.index({ updatedAt: -1 });
