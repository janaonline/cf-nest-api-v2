import { FC_UNSPENT_STATE_FORM_TYPE } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import type { FcUnspentTypedFieldConfig } from '../helpers/fc-unspent-declaration-form-json.helpers';
import {
  FC_UNSPENT_DECLARATION_ALLOWED_FILE_EXTENSIONS,
  FC_UNSPENT_DECLARATION_FOLDER_PATH_KEY,
  FC_UNSPENT_DECLARATION_MAX_FILE_SIZE_MB,
  FC_UNSPENT_FORM_ID,
} from './fc-unspent-declaration.constants';

/**
 * FC Unspent Declaration question config, shaped exactly like the per-form entries in
 * src/module/xvi-fc/xvifc-payload-15072026.json (design_year/formId/type/isActive/data).
 *
 * Canonical seed/upsert payload only — this is never read at runtime. The main
 * service loads the DB-backed document via FcUnspentDeclarationFormJsonService ->
 * FormJsonService.findActiveByDesignYearAndFormId(yearId, 25), mirroring every
 * sibling state form (SFC Status/Devolution Formula/Elected Urban Local Bodies).
 * Use this object verbatim as the body of `POST /form-json` (see CreateFormJsonDto,
 * ADMIN-only) to seed the real DB-backed document for a given design year.
 *
 * `FC_UNSPENT_MAIN_FORM_FIELDS` — the 3 top-level questions, hydrated into `questions`.
 * `FC_UNSPENT_ROW_EDIT_FIELDS` — metadata for the 8 ULB row-table columns, exposed as
 * `rowEditFields` (mirrors DF_ROW_EDIT_FIELDS/EULB_ROW_EDIT_FIELDS). Metadata only: the
 * ULB options list stays on the separate /ulb-options endpoint, and row validation
 * (ULB-must-be-active, allocation lookups) stays in FcUnspentDeclarationRowService.
 */
export const FC_UNSPENT_STATE_FORM_JSON: {
  design_year: string;
  formId: number;
  type: string;
  isActive: boolean;
  data: FcUnspentTypedFieldConfig[];
} = {
  design_year: '67d7d136d3d038946a5239e9', // 2026-27
  formId: FC_UNSPENT_FORM_ID,
  type: FC_UNSPENT_STATE_FORM_TYPE,
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
      folderPathKey: FC_UNSPENT_DECLARATION_FOLDER_PATH_KEY,
      maxFileSize: FC_UNSPENT_DECLARATION_MAX_FILE_SIZE_MB,
      allowedFileTypes: [...FC_UNSPENT_DECLARATION_ALLOWED_FILE_EXTENSIONS],
      appearance: { color: 'success', variant: 'soft' },
      // The stored value is a strict boolean (see save DTO); the GET response hydrates
      // isFcUnspent as 'yes'/'no' for display so this condition can compare against the
      // same string domain the radio control itself uses — see FcUnspentDeclarationService.getForm.
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
            'Download the official template, have it signed by the authorized State DMA officer, and upload the signed declaration. Declarations on unofficial letterhead will not be accepted.',
          actions: [
            {
              id: 'download-template',
              label: 'Download the official template',
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
    // ─── FC_UNSPENT_ROW_EDIT_FIELDS — ULB row-table column metadata ─────────────
    // Never validated by DynamicFormValidationService (see fc-unspent-declaration.service.ts's
    // three loadFields call sites, all filtered to FC_UNSPENT_MAIN_FORM_FIELDS before use).
    {
      fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
      formFieldType: 'select',
      key: 'ulbId',
      label: 'ULB',
      // No static `options` — the selectable ULB list is resolved dynamically per state/year
      // via GET :stateId/:yearId/ulb-options (FcUnspentUlbOptionsService), unchanged by this.
      validations: [{ name: 'required', validator: null, message: 'ULB selection is required.' }],
    },
    {
      fieldTypes: ['FC_UNSPENT_ROW_EDIT_FIELDS'],
      formFieldType: 'number',
      key: 'unspentAmount',
      label: 'Unspent Amount',
      validations: [
        { name: 'required', validator: null, message: 'Unspent amount is required.' },
        // `min` is inclusive (0 would pass) — Number.MIN_VALUE is the smallest positive
        // double, so this is effectively "> 0" while still using the standard min validator.
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
