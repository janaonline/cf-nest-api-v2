export const EULB_FORM_NAME = 'Elected Urban Local Bodies';

export const EULB_FORM_ID = 23;
export const EULB_FORM_JSON_TYPE = 'ELECTED_BODY';

export type EulbFormJsonFieldType =
  | 'EULB_MAIN_FORM_FIELDS'
  | 'EULB_ROW_EDIT_FIELDS'
  | 'EULB_EXTRA_ULB_PORTAL_FIELDS'
  | 'EULB_POST_SUBMIT_UPDATE_FIELDS';

export const EXCEL_HEADER_MAP: Record<string, string> = {
  censusCode: 'censusCode',
  'Census Code': 'censusCode',
  ulbName: 'ulbName',
  'ULB Name': 'ulbName',
  electedBodyStatus: 'electedBodyStatus',
  'Elected Body Status': 'electedBodyStatus',
  dateOfConstitution: 'dateOfConstitution',
  'Date on which the elected body is in place': 'dateOfConstitution',
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
  { label: 'Date on which the elected body is in place', key: 'dateOfConstitution', width: 48 },
  { label: 'Date of expiry', key: 'dateOfExpiry', width: 22 },
  { label: 'Remarks', key: 'remarks', width: 35 },
];

export const ERROR_EXCEL_HEADERS = [...TEMPLATE_HEADERS, { label: 'Errors', key: 'errors', width: 60 }];

export const EULB_ACTION_DOWNLOAD_TEMPLATE = 'download-template';
export const EULB_ACTION_VIEW_UPLOADED_DATA = 'view-uploaded-data';
export const EULB_ACTION_DOWNLOAD_ERROR_SHEET = 'download-error-sheet';
export const EULB_ACTION_REVALIDATE_EXCEL = 'revalidate-excel';
export const EULB_ACTION_REGISTER_ULB = 'register-ulb';

export function buildEulbRegisterUlbUrl(yearId: string): string {
  return `/xvifc/${yearId}/register-ulb`;
}
