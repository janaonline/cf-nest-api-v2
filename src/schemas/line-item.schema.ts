import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Master NMAM line-item catalog (code -> name/category). Populated externally
// (84 rows today); this schema only reads/joins against it, never writes.
export const HEAD_OF_ACCOUNT_ENUM = ['Asset', 'Debt', 'Expense', 'Liability', 'Other', 'Revenue', 'Tax'] as const;
export type HeadOfAccountType = (typeof HEAD_OF_ACCOUNT_ENUM)[number];

@Schema({ collection: 'lineitems', timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class LineItem {
  @Prop({ type: String, required: true, unique: true, index: true })
  code: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, enum: HEAD_OF_ACCOUNT_ENUM })
  headOfAccount: HeadOfAccountType;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export type LineItemDocument = LineItem & Document;
export const LineItemSchema = SchemaFactory.createForClass(LineItem);
