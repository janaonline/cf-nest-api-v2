import type { Types } from 'mongoose';
import type { GtcInstallment } from 'src/module/xvi-fc/state/gtc/constants/gtc.constants';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { PmuReviewPermissions } from 'src/module/xvi-fc/common/types/pmu-review-permissions.type';

/** Lean form projection read/written by the PMU review service — includes `data` so a history
 *  write can snapshot it (GTC has no row collection, same situation as SFC Status). */
export interface GtcPmuFormLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: GtcInstallment;
  currentFormStatus: number;
  data?: Record<string, unknown>;
}

export type GtcPmuReviewPermissions = PmuReviewPermissions;

export interface GtcPmuReviewData {
  formId: string;
  stateId: string;
  stateName: string;
  yearId: string;
  installment: GtcInstallment;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  /** Set on PMU reject, never cleared until the next transition overwrites it. */
  pmuRemarks: string | null;
  questions: HydratedFieldConfig[];
  permissions: GtcPmuReviewPermissions;
  actors: XvifcFormActor[];
}

export interface GtcPmuSubmitData {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}
