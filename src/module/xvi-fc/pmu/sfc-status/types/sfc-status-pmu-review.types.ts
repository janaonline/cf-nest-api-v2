import type { Types } from 'mongoose';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { PmuReviewPermissions } from 'src/module/xvi-fc/common/types/pmu-review-permissions.type';

/** Lean form projection for PMU review. Includes `data` (unlike FC Unspent's/EULB's own
 *  `*PmuFormLean`) so history can snapshot it — see CLAUDE.md's Dependencies section. */
export interface SfcStatusPmuFormLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  currentFormStatus: number;
  data?: Record<string, unknown>;
}

export type SfcStatusPmuReviewPermissions = PmuReviewPermissions;

export interface SfcStatusPmuReviewData {
  formId: string;
  stateId: string;
  stateName: string;
  yearId: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  /** Set on reject, never cleared on approve — see CLAUDE.md's "Status handling" section. */
  pmuRemarks: string | null;
  questions: HydratedFieldConfig[];
  permissions: SfcStatusPmuReviewPermissions;
  actors: XvifcFormActor[];
}

export interface SfcStatusPmuSubmitData {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}
