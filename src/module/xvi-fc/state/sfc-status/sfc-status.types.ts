import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';

export interface SfcFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface SfcFormGetResponseData {
  _id: string | null;
  formKey: 'sfc-status';
  formName: 'SFC Status';
  formType: 'STATE_FORM';
  stateId: string;
  yearId: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: SfcFormPermissions;
  instructions: unknown[];
  meta: { version: number };
}
