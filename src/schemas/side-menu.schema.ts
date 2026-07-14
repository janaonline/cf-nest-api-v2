import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SideMenuDocument = HydratedDocument<SideMenu>;

export type MenuRole = 'ULB' | 'STATE' | 'MOHUA' | 'DOE' | 'ADMIN';
export type MenuItemType = 'header' | 'separator' | 'item' | 'group';
export type MenuSection = 'top' | 'bottom';

/**
 * Shared with the legacy `cityfinance-node-api` Sidemenu model — both apps read/write
 * the same `sidemenus` collection. Legacy 15th-FC documents don't set `module`,
 * `section`, `type`, `parentId`, `featureKey`, or `routerLink`; XVI-FC documents
 * (module: 'XVI-FC') don't set the legacy form-dashboard fields (code, url,
 * collectionName, cardLabel, etc). Keep both sides optional rather than splitting
 * back into two collections.
 */
@Schema({
  collection: 'sidemenus',
  timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' },
  versionKey: false,
})
export class SideMenu {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, default: null })
  category: string | null;

  @Prop({ type: String, default: null })
  code: string | null;

  @Prop({ type: String, default: null })
  url: string | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String, required: true })
  role: MenuRole | 'ULB' | 'STATE' | 'MoHUA';

  @Prop({ type: Number, default: null })
  position: number | null;

  @Prop({ type: String, default: null })
  icon: string | null;

  @Prop({ type: String, default: null })
  collectionName: string | null;

  @Prop({ type: String, default: null })
  path: string | null;

  @Prop({ type: Boolean, default: null })
  optional: boolean | null;

  @Prop({ type: { color_1: String, color_2: String }, default: null })
  color: { color_1: string; color_2: string } | null;

  @Prop({ type: String, default: null })
  prevUrl: string | null;

  @Prop({ type: String, default: null })
  nextUrl: string | null;

  @Prop({ type: Number, default: null })
  cardSequence: number | null;

  @Prop({ type: Number, default: null })
  sequence: number | null;

  @Prop({ type: String, default: null })
  folderName: string | null;

  @Prop({ type: Number, default: null })
  groupSequence: number | null;

  @Prop({ type: Number, default: null })
  formId: number | null;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true, index: true })
  year: Types.ObjectId;

  @Prop({ type: Boolean, default: null })
  isUAApplicable: boolean | null;

  @Prop({ type: String, default: null })
  cardLabel: string | null;

  @Prop({ type: String, default: null })
  cardMessage: string | null;

  @Prop({ type: String, default: null })
  background_image: string | null;

  @Prop({ type: String, default: null })
  dbCollectionName: string | null;

  @Prop({ type: Boolean, default: null })
  isForm: boolean | null;

  // --- XVI-FC fields ---

  @Prop({ type: String, default: null, index: true })
  module: string | null;

  @Prop({ type: String, enum: ['top', 'bottom'], default: null })
  section: MenuSection | null;

  @Prop({ type: String, enum: ['header', 'separator', 'item', 'group'], default: null })
  type: MenuItemType | null;

  // null = top-level item; ObjectId = child of this group
  @Prop({ type: Types.ObjectId, ref: 'SideMenu', default: null })
  parentId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  featureKey: string | null;

  @Prop({ type: [String], default: null })
  routerLink: string[] | null;
}

export const SideMenuSchema = SchemaFactory.createForClass(SideMenu);

SideMenuSchema.index({ module: 1, role: 1, year: 1, isActive: 1 });
SideMenuSchema.index({ parentId: 1 });
