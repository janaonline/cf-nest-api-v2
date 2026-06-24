import type { FieldConfig } from '../../../common/types/field-config.type';

export const EULB_FORM_NAME = 'Elected Urban Local Bodies';

export const ELECTED_BODY_STATUSES = ['Constituted', 'Not Constituted', 'Exempt'] as const;
export type ElectedBodyStatus = (typeof ELECTED_BODY_STATUSES)[number];

export const DATE_OF_CONSTITUTION_MIN = new Date('2021-05-31T00:00:00.000Z');
export const DATE_OF_EXPIRY_MAX = new Date('2030-03-31T23:59:59.999Z');

export const EXCEL_HEADER_MAP: Record<string, string> = {
  censusCode: 'censusCode',
  'Census Code': 'censusCode',
  ulbName: 'ulbName',
  'ULB Name': 'ulbName',
  electedBodyStatus: 'electedBodyStatus',
  'Elected Body Status': 'electedBodyStatus',
  dateOfConstitution: 'dateOfConstitution',
  'Date of constitution': 'dateOfConstitution',
  dateOfExpiry: 'dateOfExpiry',
  'Date of expiry': 'dateOfExpiry',
  remarks: 'remarks',
  Remarks: 'remarks',
};

export const REQUIRED_EXCEL_KEYS = [
  'censusCode',
  'ulbName',
  'electedBodyStatus',
  'dateOfConstitution',
  'dateOfExpiry',
  'remarks',
] as const;

export const TEMPLATE_HEADERS = [
  { label: 'Census Code', key: 'censusCode', width: 15 },
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  { label: 'Elected Body Status', key: 'electedBodyStatus', width: 25 },
  { label: 'Date of constitution', key: 'dateOfConstitution', width: 22 },
  { label: 'Date of expiry', key: 'dateOfExpiry', width: 22 },
  { label: 'Remarks', key: 'remarks', width: 35 },
];

export const ERROR_EXCEL_HEADERS = [...TEMPLATE_HEADERS, { label: 'Errors', key: 'errors', width: 60 }];

export const EULB_ACTION_DOWNLOAD_TEMPLATE = 'download-template';
export const EULB_ACTION_VIEW_UPLOADED_DATA = 'view-uploaded-data';
export const EULB_ACTION_DOWNLOAD_ERROR_SHEET = 'download-error-sheet';
export const EULB_ACTION_REVALIDATE_EXCEL = 'revalidate-excel';

export const POST_SUBMIT_UPDATE_FIELDS: FieldConfig[] = [
  {
    formFieldType: 'file',
    label: 'Proof of Election',
    key: 'proofOfElection',
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    folderPath: 'state/2026-27/elected-body/post-update',
    value: { fileName: '', fileUrl: '', fileSize: null, mimeType: '' },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    appearance: { color: 'success', variant: 'soft' },
  },
];

export const EULB_CENSUS_CODE_MAX_LENGTH = 10;
export const EULB_ULB_NAME_MAX_LENGTH = 250;

/** Static field config for editable uploaded-row fields.
 *  Returned as `rowEditFields` in the GET form response for frontend row-edit dialog rendering. */
export const EULB_ROW_EDIT_FIELDS: FieldConfig[] = [
  {
    key: 'electedBodyStatus',
    formFieldType: 'select',
    label: 'Elected Body Status',
    options: ELECTED_BODY_STATUSES.map((s) => ({ id: s, label: s })),
    validations: [{ name: 'required', validator: null, message: 'Elected Body Status is required.' }],
  },
  {
    key: 'dateOfConstitution',
    formFieldType: 'date',
    label: 'Date of Constitution',
    minDate: '2021-05-31',
    maxDate: 'TODAY',
    enabledWhen: {
      mode: 'all',
      conditions: [{ key: 'electedBodyStatus', operator: 'equals', value: 'Constituted' }],
    },
    validateWhen: {
      mode: 'all',
      conditions: [{ key: 'electedBodyStatus', operator: 'equals', value: 'Constituted' }],
    },
    clearValueWhenDisabled: true,
    disabledReason: 'Not applicable unless Elected Body Status is Constituted.',
    validations: [
      { name: 'required', validator: null, message: 'Date of Constitution is required.' },
      { name: 'minDate', validator: '2021-05-31', message: 'Date of Constitution cannot be before 31 May 2021.' },
      { name: 'maxDate', validator: 'TODAY', message: 'Date of Constitution cannot be a future date.' },
    ],
  },
  {
    key: 'dateOfExpiry',
    formFieldType: 'date',
    label: 'Date of Expiry',
    minDate: 'TODAY',
    maxDate: '2030-03-31',
    enabledWhen: {
      mode: 'all',
      conditions: [{ key: 'electedBodyStatus', operator: 'equals', value: 'Constituted' }],
    },
    validateWhen: {
      mode: 'all',
      conditions: [{ key: 'electedBodyStatus', operator: 'equals', value: 'Constituted' }],
    },
    clearValueWhenDisabled: true,
    disabledReason: 'Not applicable unless Elected Body Status is Constituted.',
    validations: [
      { name: 'required', validator: null, message: 'Date of Expiry is required.' },
      { name: 'minDate', validator: 'TODAY', message: 'Date of Expiry cannot be before today.' },
      { name: 'maxDate', validator: '2030-03-31', message: 'Date of Expiry cannot be after 31 March 2030.' },
    ],
  },
  {
    key: 'remarks',
    formFieldType: 'text',
    label: 'Remarks',
    validations: [{ name: 'maxlength', validator: 250, message: 'Remarks cannot exceed 250 characters.' }],
  },
];

/** Field config for EXTRA_ULB portal editing: identity fields prepended to the common editable fields.
 *  Returned as `extraUlbEditFields` in the GET form response; rendered only when `rowType === 'EXTRA_ULB'`. */
export const EULB_EXTRA_ULB_PORTAL_FIELDS: FieldConfig[] = [
  {
    key: 'censusCode',
    formFieldType: 'text',
    label: 'Census Code',
    validations: [
      { name: 'required', validator: null, message: 'Census code is required.' },
      {
        name: 'maxlength',
        validator: EULB_CENSUS_CODE_MAX_LENGTH,
        message: `Census code must not exceed ${EULB_CENSUS_CODE_MAX_LENGTH} characters.`,
      },
    ],
  },
  {
    key: 'ulbName',
    formFieldType: 'text',
    label: 'ULB Name',
    validations: [
      { name: 'required', validator: null, message: 'ULB name is required.' },
      {
        name: 'maxlength',
        validator: EULB_ULB_NAME_MAX_LENGTH,
        message: `ULB name must not exceed ${EULB_ULB_NAME_MAX_LENGTH} characters.`,
      },
    ],
  },
  ...EULB_ROW_EDIT_FIELDS,
];

// TODO: Replace static "Andhra Pradesh" with dynamic state name when question-label
//       interpolation is supported by the shared form config system.
export const TEMP_QUESTIONS: FieldConfig[] = [
  {
    formFieldType: 'number',
    label: 'How many ULBs are there in the state as of March 31, 2026?',
    key: 'ulbCount',
    value: 0,
    placeholder: '',
    validations: [
      { name: 'required', validator: null, message: 'This field is required.' },
      { name: 'min', validator: 10, message: 'ULB count cannot be less than 10.' },
      { name: 'max', validator: 1000, message: 'ULB count cannot exceed 1000.' },
    ],
    layout: { variant: 'inline', labelWidth: 'lg' },
  },
  {
    formFieldType: 'file',
    label: 'Upload elected bodies list',
    key: 'electedBodyExcelFile',
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    value: { fileName: '', fileUrl: '', fileSize: null, mimeType: '' },
    folderPath: 'state/2026-27/elected-body-status-uploads',
    maxFileSize: 20,
    allowedFileTypes: ['xlsx', 'xls'],
    appearance: { color: 'success', variant: 'soft' },
  },
  {
    formFieldType: 'checkbox',
    label:
      'I understand that this submission may contain information entered or modified by other users. I have reviewed the final submission and confirm that the information being submitted is complete and accurate to the best of my knowledge.',
    key: 'checkboxConfirmation',
    value: false,
    validations: [
      {
        name: 'requiredTrue',
        validator: null,
        message: 'Please confirm before submitting.',
      },
    ],
  },
];
