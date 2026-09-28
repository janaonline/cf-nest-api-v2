import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import type { XvifcFormActor } from '../../common/types/xvifc-form-actors.type';

export interface SfcFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface SfcFormGetResponseData {
  _id: string | null;
  formName: string;
  formId: number;
  stateName: string;
  stateId: string;
  yearId: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: SfcFormPermissions;
  actors: XvifcFormActor[];
  instructions: unknown[];
  meta: { version: number };
  /** Discretionary Request Exemption status for this state+year's SFC Status (formId 22), if any
   *  has ever been filed. See SfcStatusService.resolveExemptionStatusForResponse. */
  exemptionStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  exemptionMohuaRemarks: string | null;
}
