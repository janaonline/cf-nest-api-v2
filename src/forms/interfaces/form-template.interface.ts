import { Types } from 'mongoose';

/** Plain-object shape returned by .lean() queries on form_templates. */
export interface IFormTemplate {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
