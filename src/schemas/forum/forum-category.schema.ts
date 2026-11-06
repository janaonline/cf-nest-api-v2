import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ForumCategoryDocument = HydratedDocument<ForumCategory>;

@Schema({ collection: 'categories', versionKey: false })
export class ForumCategory {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, unique: true })
  slug!: string;

  @Prop({ type: String, required: true })
  description!: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}

export const ForumCategorySchema = SchemaFactory.createForClass(ForumCategory);
