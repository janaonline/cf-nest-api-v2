import type { FcUnspentTypedFieldConfig } from '../helpers/fc-unspent-declaration-form-json.helpers';

/**
 * Test-only fixture shaped like the DB-backed `fcUnspent` formJson document
 * (design_year/formId/type/isActive/data) — used by this module's spec files as a realistic
 * `FcUnspentTypedFieldConfig[]` satisfying `validateFcUnspentFormJsonData`'s invariants (the 4
 * required main-form keys, `fcDeclaration`'s `download-template` action, `fcUnspentDeclaration`'s
 * `download-declaration` action, all 8 `FC_UNSPENT_ROW_EDIT_FIELDS`-tagged columns).
 * Self-contained — mirrors the real `FC_UNSPENT_STATE_FORM_JSON` seed payload's shape but never
 * reads any external file, so tests never depend on anything outside this repo.
 */
export function loadFcUnspentSeedDocument(): {
  design_year: string;
  formId: number;
  type: string;
  isActive: boolean;
  data: FcUnspentTypedFieldConfig[];
} {
  return {
    design_year: '67d7d136d3d038946a5239e9', // 2026-27
    formId: 25,
    type: 'FC_UNSPENT_STATE',
    isActive: true,
    data: [
      {
        fieldTypes: ['FC_UNSPENT_MAIN_FORM_FIELDS'],
        formFieldType: 'radio',
        label: 'Do any ULBs in the state have unspent 14th FC balance to report?',
        key: 'isFcUnspent',
        value: 'no',
        options: [
          { label: 'No (no ULB in the state has unspent 14th FC balance to report)', id: 'no' },
          { label: 'Yes (one or more ULBs have unspent 14th FC balance to report)', id: 'yes' },
        ],
        validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
        radioLayout: 'vertical',
        supportingContent: [
          {
            type: 'info',
            position: 'after',
            description:
              'Select No if your state has confirmed that none of its ULBs hold any unspent 14th Finance Commission balance. Select Yes if one or more ULBs need to report a balance.',
          },
        ],
      },
      {
        fieldTypes: ['FC_UNSPENT_MAIN_FORM_FIELDS'],
        formFieldType: 'file',
        label: 'State-Level Declaration - 14th Finance Commission',
        key: 'fcDeclaration',
        value: null,
        validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
        folderPathKey: 'fc-unspent/fc-declaration',
        maxFileSize: 5,
        allowedFileTypes: ['pdf'],
        appearance: { color: 'success', variant: 'soft' },
        visibleWhen: { mode: 'all', conditions: [{ key: 'isFcUnspent', operator: 'equals', value: 'no' }] },
        clearValueWhenDisabled: true,
        layout: { variant: 'inline', labelWidth: 'lg' },
        supportingContent: [
          {
            type: 'actions',
            position: 'before',
            layout: 'inline',
            separator: 'dot',
            description:
              'Download the declaration, have it signed by the authorized State DMA officer, and upload the signed copy below. Declarations on unofficial letterhead will not be accepted.',
            actions: [
              {
                id: 'download-template',
                label: 'Download the declaration',
                icon: 'bi bi-file-earmark-word',
                tone: 'primary',
                visible: true,
              },
            ],
            badges: [],
          },
        ],
      },
      {
        fieldTypes: ['FC_UNSPENT_MAIN_FORM_FIELDS'],
        formFieldType: 'file',
        label: 'State-Level Declaration - 14th Finance Commission (ULB-wise)',
        key: 'fcUnspentDeclaration',
        value: null,
        validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
        folderPathKey: 'fc-unspent/fc-unspent-declaration',
        maxFileSize: 5,
        allowedFileTypes: ['pdf'],
        appearance: { color: 'success', variant: 'soft' },
        visibleWhen: { mode: 'all', conditions: [{ key: 'isFcUnspent', operator: 'equals', value: 'yes' }] },
        clearValueWhenDisabled: true,
        layout: { variant: 'inline', labelWidth: 'lg' },
        supportingContent: [
          {
            type: 'actions',
            position: 'before',
            layout: 'inline',
            separator: 'dot',
            description:
              'Download the declaration (with the ULB-wise table filled in), have it signed by the authorized State DMA officer, and upload the signed copy below.',
            actions: [
              {
                id: 'download-declaration',
                label: 'Download the declaration',
                icon: 'bi bi-file-earmark-word',
                tone: 'primary',
                visible: true,
              },
            ],
            badges: [],
          },
        ],
      },
      {
        fieldTypes: ['FC_UNSPENT_MAIN_FORM_FIELDS'],
        formFieldType: 'checkbox',
        key: 'checkboxConfirmation',
        label:
          'I certify that the 14th FC unspent balances entered above have been compiled from figures reported by each ULB, and are accurate to the best of my knowledge.',
        value: false,
        validations: [{ name: 'requiredTrue', validator: null, message: 'Please confirm before submitting.' }],
        visibleWhen: { mode: 'all', conditions: [{ key: 'isFcUnspent', operator: 'equals', value: 'yes' }] },
        clearValueWhenDisabled: true,
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'select',
        key: 'ulbId',
        label: 'ULB',
        validations: [{ name: 'required', validator: null, message: 'ULB selection is required.' }],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'number',
        key: 'unspentAmount',
        label: 'Unspent Amount',
        validations: [
          { name: 'required', validator: null, message: 'Unspent amount is required.' },
          { name: 'min', validator: Number.MIN_VALUE, message: 'Unspent amount must be greater than zero.' },
          { name: 'max', validator: 1000, message: 'Unspent amount cannot exceed 1000.' },
        ],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'text',
        key: 'censusCode',
        label: 'Census Code',
        disabled: true,
        includeInPayload: false,
        validations: [],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'text',
        key: 'sbCode',
        label: 'SB Code',
        disabled: true,
        includeInPayload: false,
        validations: [],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'text',
        key: 'ulbName',
        label: 'ULB Name',
        disabled: true,
        includeInPayload: false,
        validations: [],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'number',
        key: 'allocationAmount',
        label: 'Devolution Allocation Amount',
        disabled: true,
        includeInPayload: false,
        validations: [],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'number',
        key: 'allocationPerc',
        label: 'Allocation %',
        disabled: true,
        includeInPayload: false,
        validations: [],
      },
      {
        fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
        formFieldType: 'text',
        key: 'eligibility',
        label: 'Eligible',
        disabled: true,
        includeInPayload: false,
        validations: [],
      },
    ],
  };
}
