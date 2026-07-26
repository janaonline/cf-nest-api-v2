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
  /** Design year label (e.g. "2026-27"), resolved server-side via YearIdToLabel — the
   *  authoritative source for the "Actual/Target Indicator <year>" table headers. */
  designYear: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: SlbFormPermissions;
  actors: XvifcFormActor[];
  meta: { version: number };
}
