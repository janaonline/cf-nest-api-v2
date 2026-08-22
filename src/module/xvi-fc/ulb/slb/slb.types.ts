import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import type { XvifcFormActor } from '../../common/types/xvifc-form-actors.type';

export interface SlbFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface SlbFormGetResponseData {
  _id: string | null;
  formName: string;
  formId: number;
  ulbName: string;
  ulbId: string;
  yearId: string;
  /** Design/target year label (e.g. "2026-27"), resolved server-side via YearIdToLabel — the
   *  authoritative source for the "Target Indicator <year>" table header. */
  designYear: string;
  /** The FY immediately before `designYear` (e.g. "2025-26"), resolved via getPreviousYearLabel —
   *  the authoritative source for the "Actual Indicator <year>" table header. Actuals are always
   *  reported for the completed prior year, one FY behind the target being set. Null if
   *  `designYear` is the earliest known year (no prior year to report actuals for). */
  actualYearLabel: string | null;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: SlbFormPermissions;
  actors: XvifcFormActor[];
  meta: { version: number };
}
