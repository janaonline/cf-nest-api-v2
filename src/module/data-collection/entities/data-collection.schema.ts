import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, ValidatorProps } from 'mongoose';
import { lineItems } from '../constant';

export type LineItemKey = (typeof lineItems)[number]['cfCode'];
export type LineItemsMap = Partial<Record<LineItemKey, number | null>>;
const LINE_ITEM_KEYS = lineItems.map((i) => i.cfCode);
export const LINE_ITEM_KEY_SET = new Set(LINE_ITEM_KEYS);

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
        return invalidKeys.length === 0;
      },
      message: (props: ValidatorProps) => {
        const value = props.value as LineItemsMap;
        const obj = (value instanceof Map ? Object.fromEntries(value) : value) as LineItemsMap;
        const invalidKeys = Object.keys(obj).filter((key) => !LINE_ITEM_KEY_SET.has(key));
        return `Invalid line item keys: ${invalidKeys.join(', ')}`;
      },
    },
  })
  lineItems: Map<LineItemKey, number | null>;
}

export type DataCollectionDocument = HydratedDocument<DataCollection>;
export const DataCollectionSchema = SchemaFactory.createForClass(DataCollection);

// TODO: add index.
