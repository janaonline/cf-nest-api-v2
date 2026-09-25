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
}
