import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import type { XvifcFormActor } from '../../common/types/xvifc-form-actors.type';
import type { GtcInstallment } from './constants/gtc.constants';

export interface GtcFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface GtcInstallmentAccessItem {
  canSelect: boolean;
  locked: boolean;
  lockReason: string | null;
}

export interface GtcInstallmentAccess {
  installment1: GtcInstallmentAccessItem;
  installment2: GtcInstallmentAccessItem;
}

export interface GtcFormGetResponseData {
  _id: string | null;
  formName: string;
  formId: number;
  stateName: string;
  stateId: string;
  yearId: string;
  installment: GtcInstallment;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: GtcFormPermissions;
  actors: XvifcFormActor[];
  instructions: unknown[];
  installmentAccess: GtcInstallmentAccess;
}

/** Response shape for the static-template download endpoint - only meaningful for a design
 *  year/installment whose formJson field carries a well-formed download-template `meta`
 *  (e.g. 2026-27 installment 1). */
export interface GtcTemplateResponseData {
  fileName: string;
  mimeType: string;
  url: string;
}
