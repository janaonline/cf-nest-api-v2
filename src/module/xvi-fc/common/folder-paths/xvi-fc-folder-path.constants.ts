export const XVI_FC_FOLDER_PATH_KEYS = {
  SFC_EXTENSION_ORDER: 'SFC_EXTENSION_ORDER',
  SFC_REPORT: 'SFC_REPORT',
  SFC_ATR_REPORT: 'SFC_ATR_REPORT',
  SFC_GAZETTE_NOTIFICATION: 'SFC_GAZETTE_NOTIFICATION',
  EULB_EXCEL: 'EULB_EXCEL',
  EULB_POST_SUBMISSION_PROOF: 'EULB_POST_SUBMISSION_PROOF',
  XVI_FC_BANK_ACCOUNT_PROOF: 'XVI_FC_BANK_ACCOUNT_PROOF',
} as const;

export type XviFcFolderPathKey = (typeof XVI_FC_FOLDER_PATH_KEYS)[keyof typeof XVI_FC_FOLDER_PATH_KEYS];

export const XVI_FC_FOLDER_PATH_MAP: Record<XviFcFolderPathKey, string> = {
  SFC_EXTENSION_ORDER: 'sfc-status/extension-order',
  SFC_REPORT: 'sfc-status/sfc-report',
  SFC_ATR_REPORT: 'sfc-status/atr-report',
  SFC_GAZETTE_NOTIFICATION: 'sfc-status/gazette-notification',
  EULB_EXCEL: 'elected-body/elected-bodies-list',
  EULB_POST_SUBMISSION_PROOF: 'elected-body/post-submission-update',
  XVI_FC_BANK_ACCOUNT_PROOF: 'bank-account/proof',
};
