import { Types } from 'mongoose';
import { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { ClaimEligibilityConfig } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

/** Plain-object shape returned by .lean() queries on the formjsons collection. */
export interface IFormJson {
  _id: Types.ObjectId;
  design_year: Types.ObjectId;
  formId?: number;
  type?: string;
  data?: FieldConfig[];
  meta?: Record<string, unknown>;
  claimEligibility?: ClaimEligibilityConfig | null;
  isActive: boolean;
  createdAt: Date;
  modifiedAt: Date;
}
