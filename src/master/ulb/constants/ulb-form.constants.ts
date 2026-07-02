import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

/** `type` key under which the ULB master form definition is stored in the formjsons collection. */
export const ULB_FORM_JSON_TYPE = 'ULB_MASTER';

const OBJECT_ID_PATTERN = '^[0-9a-fA-F]{24}$';

/**
 * Fallback field definition used when no admin-configured FormJson document
 * exists yet for ULB_FORM_JSON_TYPE. Mirrors the core fields on the `Ulb` schema.
 * Admins can override any of this via the generic /form-json CRUD endpoints
 * (create a document with type: 'ULB_MASTER') without a code change.
 */
export const DEFAULT_ULB_FIELDS: FieldConfig[] = [
  {
    key: 'code',
    label: 'ULB Code',
    formFieldType: 'text',
    validations: [
      { name: 'required', validator: null, message: 'ULB code is required.' },
      { name: 'maxlength', validator: 20, message: 'ULB code must be at most 20 characters.' },
    ],
  },
  {
    key: 'name',
    label: 'ULB Name',
    formFieldType: 'text',
    validations: [
      { name: 'required', validator: null, message: 'ULB name is required.' },
      { name: 'maxlength', validator: 200, message: 'ULB name must be at most 200 characters.' },
    ],
  },
  {
    key: 'state',
    label: 'State',
    formFieldType: 'select',
    validations: [
      { name: 'required', validator: null, message: 'State is required.' },
      { name: 'pattern', validator: OBJECT_ID_PATTERN, message: 'State must be a valid id.' },
    ],
  },
  {
    key: 'ulbType',
    label: 'ULB Type',
    formFieldType: 'select',
    validations: [
      { name: 'required', validator: null, message: 'ULB type is required.' },
      { name: 'pattern', validator: OBJECT_ID_PATTERN, message: 'ULB type must be a valid id.' },
    ],
  },
  {
    key: 'district',
    label: 'District',
    formFieldType: 'text',
    validations: [
      { name: 'required', validator: null, message: 'District is required.' },
      { name: 'maxlength', validator: 100, message: 'District must be at most 100 characters.' },
    ],
  },
  {
    key: 'censusCode',
    label: '2011 Census Code',
    formFieldType: 'text',
    validations: [{ name: 'maxlength', validator: 20, message: 'Census code must be at most 20 characters.' }],
  },
  {
    key: 'sbCode',
    label: 'SB Code',
    formFieldType: 'text',
    validations: [],
  },
  {
    key: 'population',
    label: 'Population',
    formFieldType: 'number',
    validations: [{ name: 'min', validator: 0, message: 'Population must be ≥ 0.' }],
  },
  {
    key: 'area',
    label: 'Area',
    formFieldType: 'number',
    validations: [{ name: 'min', validator: 0, message: 'Area must be ≥ 0.' }],
  },
  {
    key: 'wards',
    label: 'Wards',
    formFieldType: 'number',
    validations: [{ name: 'min', validator: 0, message: 'Wards must be ≥ 0.' }],
  },
  {
    key: 'natureOfUlb',
    label: 'Nature of ULB',
    formFieldType: 'text',
    validations: [],
  },
  {
    key: 'isUA',
    label: 'Is Urban Agglomeration',
    formFieldType: 'select',
    options: ['YES', 'No'],
    validations: [],
  },
  {
    key: 'isMillionPlus',
    label: 'Is Million Plus',
    formFieldType: 'select',
    options: ['YES', 'No'],
    validations: [],
  },
  {
    key: 'amrut',
    label: 'AMRUT',
    formFieldType: 'text',
    validations: [],
  },
  {
    key: 'lgdCode',
    label: 'LGD Code',
    formFieldType: 'text',
    validations: [],
  },
  {
    key: 'regionalName',
    label: 'Regional Name',
    formFieldType: 'text',
    validations: [],
  },
];

/** `data` keys that map directly onto typed fields on the `Ulb` mongoose schema. */
export const ULB_DATA_KEYS = DEFAULT_ULB_FIELDS.map((f) => f.key);
