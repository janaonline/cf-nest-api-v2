import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { Rule } from 'src/module/data-collection/constant';
import { ACCOUNT_HEAD_VALUES, type AccountHead } from '../constants';

@Schema({ timestamps: true, collection: 'lineitemslegends' })
export class LineItemsLegend {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ required: true, trim: true })
  nmamCode!: string;

  @Prop({ type: String, required: true, enum: ACCOUNT_HEAD_VALUES })
  accountHead!: AccountHead;

  @Prop({ required: true, trim: true })
  majorCode!: string;

  @Prop({ type: String, default: null })
  parentCode!: string | null;

  @Prop({ required: true, trim: true })
  segmentCode!: string;

  @Prop({ type: [String], required: true })
  segmentPath!: string[];

  @Prop({ type: [String], required: true })
  codePath!: string[];

  @Prop({ required: true })
  name!: string;

  @Prop({ type: String, default: '' })
  desc!: string;

  @Prop({ required: true, min: 1 })
  level!: number;

  @Prop({ required: true })
  sortOrder!: number;

  @Prop({ required: true, trim: true })
  templateVersion!: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ type: [Object], default: [] })
  rules!: Rule[];
}

export type LineItemsLegendDocument = HydratedDocument<LineItemsLegend>;
export const LineItemsLegendSchema = SchemaFactory.createForClass(LineItemsLegend);

LineItemsLegendSchema.index({ templateVersion: 1, nmamCode: 1 }, { unique: true });
LineItemsLegendSchema.index({ templateVersion: 1, accountHead: 1 });
LineItemsLegendSchema.index({ templateVersion: 1, majorCode: 1 });
LineItemsLegendSchema.index({ templateVersion: 1, parentCode: 1 });
LineItemsLegendSchema.index({ templateVersion: 1, sortOrder: 1 });
LineItemsLegendSchema.index({ templateVersion: 1, isActive: 1 });
