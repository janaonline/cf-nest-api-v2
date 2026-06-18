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

// TODO: Replace static "Andhra Pradesh" with dynamic state name when question-label
//       interpolation is supported by the shared form config system.
export const TEMP_QUESTIONS: FieldConfig[] = [
  {
    formFieldType: 'number',
    label: 'How many ULBs are there in Andhra Pradesh as of March 31, 2026?',
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
