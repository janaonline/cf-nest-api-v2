import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Pre-existing, 2.9M-document production collection — read-only for this
 * feature. Never write to this model; the Ptax review workflow's own state
 * lives entirely in `XvFcPtaxReview` (collection `xvfc_ptax_reviews`).
 *
 * One document per (ulb, year, displayPriority) — verified no duplicates
 * for the codes this feature reads. `year` is an ObjectId ref to `Year`,
 * not a "YYYY-YY" string.
 */
@Schema({ collection: 'propertytaxopmappers', strict: false })
export class PropertyTaxOpMapper {
  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulb: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year' })
  year: Types.ObjectId;

  @Prop({ type: String })
  displayPriority: string;

  @Prop({ type: String })
  type: string;

  @Prop({ type: String })
  value: string;
}

export type PropertyTaxOpMapperDocument = PropertyTaxOpMapper & Document;
export const PropertyTaxOpMapperSchema = SchemaFactory.createForClass(PropertyTaxOpMapper);
