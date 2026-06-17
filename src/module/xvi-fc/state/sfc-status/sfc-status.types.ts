import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';

export interface SfcFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface SfcFormActor {
  action: 'Created by' | 'Updated by' | 'Submitted by';
  by: string | null;
  date: string | null;
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
  actors: SfcFormActor[];
  instructions: unknown[];
  meta: { version: number };
}
