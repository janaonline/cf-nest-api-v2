import type { FieldConfig, SectionFieldPlacement } from 'src/module/xvi-fc/common/types/field-config.type';

/** `type` key under which the ULB master form definition is stored in the formjsons collection. */
export const ULB_FORM_JSON_TYPE = 'ULB_MASTER';

const OBJECT_ID_PATTERN = '^[0-9a-fA-F]{24}$';
const MOBILE_PATTERN = '^[6-9]\\d{9}$';

/**
 * Fallback field definition used when no admin-configured FormJson document
 * exists yet for ULB_FORM_JSON_TYPE. Mirrors the core fields on the `Ulb` schema.
 * Admins can override any of this via the generic /form-json CRUD endpoints
 * (create a document with type: 'ULB_MASTER') without a code change.
 */
export const DEFAULT_ULB_FIELDS: FieldConfig[] = [
  // {
  //   key: 'code',
  //   label: 'ULB Code',
  //   formFieldType: 'text',
  //   required: true,
  //   displayInlineLabel: true,
  //   validations: [
  //     { name: 'required', validator: null, message: 'ULB code is required.' },
  //     { name: 'maxlength', validator: 20, message: 'ULB code must be at most 20 characters.' },
  //   ],
  // },
  {
    key: 'name',
    label: 'ULB Name1',
    displayInlineLabel: true,
    hideLabel: true,
    formFieldType: 'text',
    required: true,
    validations: [
      { name: 'required', validator: null, message: 'ULB name is required.' },
      { name: 'maxlength', validator: 200, message: 'ULB name must be at most 200 characters.' },
    ],
  },
  // {
  //   key: 'state',
  //   label: 'State',
  //   formFieldType: 'select',
  //   displayInlineLabel: true,
  //   required: true,
  //   validations: [
  //     { name: 'required', validator: null, message: 'State is required.' },
  //     { name: 'pattern', validator: OBJECT_ID_PATTERN, message: 'State must be a valid id.' },
  //   ],
  // },
  {
    key: 'ulbType',
    label: 'ULB Type',
    formFieldType: 'select',
    displayInlineLabel: true,
    placeholder: 'Select type...',
    required: true,
    options: [], // populated dynamically in UlbService.buildResolvedFieldsByKey()
    validations: [
      { name: 'required', validator: null, message: 'ULB type is required.' },
      { name: 'pattern', validator: OBJECT_ID_PATTERN, message: 'ULB type must be a valid id.' },
    ],
  },
  {
    key: 'district',
    label: 'District',
    formFieldType: 'text',
    displayInlineLabel: true,
    required: true,
    validations: [
      { name: 'required', validator: null, message: 'District is required.' },
      { name: 'maxlength', validator: 100, message: 'District must be at most 100 characters.' },
    ],
  },
  {
    key: 'censusCode',
    label: '2011 Census Code',
    displayInlineLabel: true,
    formFieldType: 'text',
    validations: [{ name: 'maxlength', validator: 20, message: 'Census code must be at most 20 characters.' }],
  },
  // {
  //   key: 'sbCode',
  //   label: 'SB Code',
  //   formFieldType: 'text',
  //   displayInlineLabel: true,
  //   validations: [],
  // },
  // {
  //   key: 'population',
  //   label: 'Population',
  //   formFieldType: 'number',
  //   validations: [{ name: 'min', validator: 0, message: 'Population must be ≥ 0.' }],
  // },
  // {
  //   key: 'area',
  //   label: 'Area',
  //   formFieldType: 'number',
  //   validations: [{ name: 'min', validator: 0, message: 'Area must be ≥ 0.' }],
  // },
  // {
  //   key: 'wards',
  //   label: 'Wards',
  //   formFieldType: 'number',
  //   validations: [{ name: 'min', validator: 0, message: 'Wards must be ≥ 0.' }],
  // },
  // {
  //   key: 'natureOfUlb',
  //   label: 'Nature of ULB',
  //   formFieldType: 'text',
  //   validations: [],
  // },
  // {
  //   key: 'isUA',
  //   label: 'Is Urban Agglomeration',
  //   formFieldType: 'select',
  //   options: ['YES', 'No'],
  //   validations: [],
  // },
  // {
  //   key: 'isMillionPlus',
  //   label: 'Is Million Plus',
  //   formFieldType: 'select',
  //   options: ['YES', 'No'],
  //   validations: [],
  // },
  // {
  //   key: 'amrut',
  //   label: 'AMRUT',
  //   formFieldType: 'text',
  //   validations: [],
  // },
  // {
  //   key: 'lgdCode',
  //   label: 'LGD Code',
  //   formFieldType: 'text',
  //   displayInlineLabel: true,
  //   validations: [],
  // },
  // {
  //   key: 'regionalName',
  //   label: 'Regional Name',
  //   formFieldType: 'text',
  //   validations: [],
  // },
  {
    key: 'dateOfConstitution',
    label: 'Date of Constitution',
    displayInlineLabel: true,
    formFieldType: 'date',
    required: true,
    validations: [{ name: 'required', validator: null, message: 'Date of constitution is required.' }],
  },
  {
    key: 'gazetteNotificationNumber',
    label: 'Gazette Notification Number',
    displayInlineLabel: true,
    formFieldType: 'text',
    validations: [{ name: 'maxlength', validator: 100, message: 'Must not exceed 100 characters.' }],
  },
  {
    key: 'gazetteNotificationFile',
    label: 'Gazette Notification',
    displayInlineLabel: true,
    formFieldType: 'file',
    required: true,
    allowedFileTypes: ['pdf'],
    maxFileSize: 5,
    validations: [{ name: 'required', validator: null, message: 'Gazette notification PDF is required.' }],
  },
  {
    key: 'primaryContactName',
    label: 'Full Name',
    displayInlineLabel: true,
    formFieldType: 'text',
    required: true,
    validations: [
      { name: 'required', validator: null, message: 'Primary contact name is required.' },
      { name: 'maxlength', validator: 200, message: 'Name must be at most 200 characters.' },
    ],
  },
  {
    key: 'primaryContactDesignation',
    label: 'Designation',
    displayInlineLabel: true,
    formFieldType: 'text',
    validations: [{ name: 'maxlength', validator: 100, message: 'Designation must be at most 100 characters.' }],
  },
  {
    key: 'primaryContactEmail',
    label: 'Email Address',
    displayInlineLabel: true,
    formFieldType: 'text',
    required: true,
    validations: [
      { name: 'required', validator: null, message: 'Primary contact email is required.' },
      { name: 'email', validator: null, message: 'Enter a valid email address.' },
    ],
  },
  {
    // Required (unlike the other optional fields here) because this becomes the ULB login's
    // `mobile`, which carries a non-sparse unique index — a missing value would collide with
    // any other user account that also has no mobile on file.
    key: 'primaryContactMobile',
    label: 'Mobile Number',
    displayInlineLabel: true,
    formFieldType: 'text',
    required: true,
    validations: [
      { name: 'required', validator: null, message: 'Primary contact mobile number is required.' },
      { name: 'pattern', validator: MOBILE_PATTERN, message: 'Enter a valid 10-digit mobile number.' },
    ],
  },
];

/** `data` keys that map directly onto typed fields on the `Ulb` mongoose schema. */
export const ULB_DATA_KEYS = DEFAULT_ULB_FIELDS.map((f) => f.key);

/**
 * Primary-contact field keys collected on the Register ULB page. These describe the person who
 * becomes the ULB's first login — they are used to provision a `User` account and are never
 * persisted onto the `Ulb` document itself, so `UlbService.create()` strips them before the patch.
 */
export const ULB_PRIMARY_CONTACT_FIELD_KEYS = [
  'primaryContactName',
  'primaryContactDesignation',
  'primaryContactEmail',
  'primaryContactMobile',
] as const;

/** `type` key under which the Register-ULB page's section/grid layout is stored in the formjsons collection. */
export const ULB_REGISTER_SECTIONS_FORM_JSON_TYPE = 'ULB_REGISTER_SECTIONS';

/** One field's placement within a `RegisterUlbSectionLayout` — layout only; label/validations live on DEFAULT_ULB_FIELDS. */
export interface RegisterUlbFieldLayout extends SectionFieldPlacement {
  key: string;
}

/** One card-sectioned group of fields on the Register ULB page. */
export interface RegisterUlbSectionLayout {
  title: string;
  icon: string;
  /** Muted text rendered inline next to the section title, e.g. "— will be the first login for this ULB". */
  subtitle?: string;
  fields: RegisterUlbFieldLayout[];
}

/**
 * Fallback layout used when no admin-configured FormJson document exists yet for
 * ULB_REGISTER_SECTIONS_FORM_JSON_TYPE. Admins can override this via the generic /form-json
 * CRUD endpoints (create a document with type: 'ULB_REGISTER_SECTIONS') without a code change.
 */
export const DEFAULT_ULB_REGISTER_SECTIONS: RegisterUlbSectionLayout[] = [
  {
    title: 'ULB Identity',
    icon: 'bi-bank',
    fields: [
      { key: 'name', grid: 'col-12' },
      { key: 'ulbType', grid: 'col-md-6' },
      { key: 'district', grid: 'col-md-6' },
      {
        key: 'censusCode',
        grid: 'col-md-6',
        labelHint: '(if available)',
        hintText: 'Not available? Enter 999999 as a 6-digit placeholder.',
      },
    ],
  },
  {
    title: 'Constitution & Legal Basis',
    icon: 'bi-journal-text',
    fields: [
      { key: 'dateOfConstitution', grid: 'col-md-6' },
      { key: 'gazetteNotificationNumber', grid: 'col-md-6', labelHint: '(if available)' },
      {
        key: 'gazetteNotificationFile',
        grid: 'col-12',
        labelHint: '— upload the PDF of the gazette notifying constitution',
      },
    ],
  },
  {
    title: 'Primary Contact at ULB',
    icon: 'bi-person',
    subtitle: '— will be the first login for this ULB',
    fields: [
      { key: 'primaryContactName', grid: 'col-md-6' },
      { key: 'primaryContactDesignation', grid: 'col-md-6' },
      { key: 'primaryContactEmail', grid: 'col-md-6' },
      { key: 'primaryContactMobile', grid: 'col-md-6' },
    ],
  },
];

/** `type` key under which the Edit-ULB dialog's section/grid layout is stored in the formjsons collection. */
export const ULB_EDIT_SECTIONS_FORM_JSON_TYPE = 'ULB_EDIT_SECTIONS';

/**
 * Fallback layout for the ADMIN-only Edit ULB dialog — covers every field on DEFAULT_ULB_FIELDS
 * (unlike the Register page's subset). Falls back to this when no admin-configured FormJson
 * document exists yet for ULB_EDIT_SECTIONS_FORM_JSON_TYPE; overridable the same way.
 */
export const DEFAULT_ULB_EDIT_SECTIONS: RegisterUlbSectionLayout[] = [
  {
    title: 'ULB Identity',
    icon: 'bi-bank',
    fields: [
      { key: 'code', grid: 'col-md-6' },
      { key: 'name', grid: 'col-md-6' },
      { key: 'state', grid: 'col-md-6' },
      { key: 'ulbType', grid: 'col-md-6' },
      { key: 'district', grid: 'col-md-6' },
      { key: 'censusCode', grid: 'col-md-6' },
    ],
  },
  {
    title: 'Additional Details',
    icon: 'bi-list-ul',
    fields: [
      { key: 'sbCode', grid: 'col-md-6' },
      { key: 'population', grid: 'col-md-4' },
      { key: 'area', grid: 'col-md-4' },
      { key: 'wards', grid: 'col-md-4' },
      { key: 'natureOfUlb', grid: 'col-md-6' },
      { key: 'isUA', grid: 'col-md-4' },
      { key: 'isMillionPlus', grid: 'col-md-4' },
      { key: 'amrut', grid: 'col-md-4' },
      { key: 'lgdCode', grid: 'col-md-6' },
      { key: 'regionalName', grid: 'col-md-6' },
    ],
  },
  {
    title: 'Constitution & Legal Basis',
    icon: 'bi-journal-text',
    fields: [
      { key: 'dateOfConstitution', grid: 'col-md-6' },
      { key: 'gazetteNotificationNumber', grid: 'col-md-6' },
      { key: 'gazetteNotificationFile', grid: 'col-12' },
    ],
  },
];
