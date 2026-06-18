import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type XviFcSideMenuDocument = HydratedDocument<XviFcSideMenu>;

export type MenuRole = 'ULB' | 'STATE' | 'MOHUA' | 'DOE' | 'ADMIN';
export type MenuItemType = 'header' | 'separator' | 'item' | 'group';
export type MenuSection = 'top' | 'bottom';

@Schema({
  collection: 'xvifc_side_menus',
  timestamps: true,
  versionKey: false,
})
export class XviFcSideMenu {
  @Prop({ type: String, required: true, default: 'XVI-FC' })
  module: string;

  @Prop({ type: String, required: true })
  role: string;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true, index: true })
  year: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String, enum: ['top', 'bottom'], required: true })
  section: MenuSection;

  @Prop({ type: Number, required: true })
  sequence: number;

  @Prop({ type: String, enum: ['header', 'separator', 'item', 'group'], required: true })
  type: MenuItemType;

  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: String, default: null })
  icon: string | null;

  @Prop({ type: String, default: null })
  featureKey: string | null;

  @Prop({ type: [String], default: null })
  routerLink: string[] | null;

  // null = top-level item; ObjectId = child of this group
  @Prop({ type: Types.ObjectId, ref: 'XviFcSideMenu', default: null })
  parentId: Types.ObjectId | null;
}

export const XviFcSideMenuSchema = SchemaFactory.createForClass(XviFcSideMenu);

XviFcSideMenuSchema.index({ module: 1, role: 1, year: 1, isActive: 1 });
XviFcSideMenuSchema.index({ parentId: 1 });
