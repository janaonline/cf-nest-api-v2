import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';

export interface SfcFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface SfcFormGetResponseData {
  _id: string | null;
  formName: string;
  formId: number;
  stateId: string;
  yearId: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: SfcFormPermissions;
  instructions: unknown[];
  meta: { version: number };
}
