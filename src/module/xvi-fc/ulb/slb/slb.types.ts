import type { HydratedFieldConfig } from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import type { XvifcFormActor } from '../../common/types/xvifc-form-actors.type';

export interface SlbFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface SlbTableLayoutMeta {
  display: 'table';
  description: string;
  columns: Array<{
    key: 'indicatorNumber' | 'indicator' | 'actual' | 'target';
    label: string;
    fiscalYear?: string;
  }>;
  groupBy: 'indicatorNumber';
  declarationStartKey: 'declarantName';
  declarationTitle: 'Self Declaration';
}

export const SLB_TABLE_LAYOUT_META: SlbTableLayoutMeta = {
  display: 'table',
  description:
    "Report your ULB's actual performance and target for FY 2026-27 across water supply, sanitation, solid waste and storm water indicators.",
  columns: [
    { key: 'indicatorNumber', label: '#' },
    { key: 'indicator', label: 'Sections/Indicators' },
    { key: 'actual', label: 'Actual Indicator', fiscalYear: '2026-27' },
    { key: 'target', label: 'Target Indicator', fiscalYear: '2026-27' },
  ],
  groupBy: 'indicatorNumber',
  declarationStartKey: 'declarantName',
  declarationTitle: 'Self Declaration',
};

export interface SlbFormGetResponseData {
  _id: string | null;
  formName: string;
  formId: number;
  ulbName: string;
  ulbId: string;
  yearId: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  permissions: SlbFormPermissions;
  actors: XvifcFormActor[];
  meta: { version: number; layout: SlbTableLayoutMeta };
}
