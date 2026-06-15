import { Types } from 'mongoose';

export interface FormJsonField {
  id?: string;
  name?: string;
  type?: string;
  required?: boolean;
  label?: string;
  placeholder?: string;
  options?: Record<string, unknown>[];
  [key: string]: unknown;
}

/** Plain-object shape returned by .lean() queries on the formjsons collection. */
export interface IFormJson {
  _id: Types.ObjectId;
  design_year: Types.ObjectId;
  formId?: number;
  type?: string;
  data?: FormJsonField[];
  isActive: boolean;
  createdAt: Date;
  modifiedAt: Date;
}
