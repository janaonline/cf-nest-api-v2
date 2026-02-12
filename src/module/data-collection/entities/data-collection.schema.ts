import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { lineItems } from '../constant';

export type LineItemKey = (typeof lineItems)[number]['cfCode'];
export type LineItems = Partial<Record<LineItemKey, number | null>>;
const LINE_ITEM_KEYS = lineItems.map((i) => i.cfCode);
const LINE_ITEM_KEY_SET = new Set(LINE_ITEM_KEYS);

@Schema({ timestamps: true })
export class DataCollection {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulbId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  yearId: Types.ObjectId;

  @Prop({
    type: Map,
    of: { type: Number, default: null },
    required: true,
    validate: {
      validator: function (value: Map<string, number>) {
        const invalidKeys = [...value.keys()].filter((key) => !LINE_ITEM_KEY_SET.has(key));
        if (invalidKeys.length > 0) {
          throw new Error(`Invalid line item keys: ${invalidKeys.join(', ')}`);
        }

        return true;
      },
    },
  })
  lineItems: Map<LineItemKey, number | null>;
}

export type DataCollectionDocument = HydratedDocument<DataCollection>;
export const DataCollectionSchema = SchemaFactory.createForClass(DataCollection);

// TODO: add index.
