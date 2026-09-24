export const GTC_FORM_NAME = 'Grant Transfer Certificate';
export const GTC_FORM_TYPE = 'GTC';
export const GTC_FORM_ID = 35;

export const GTC_INSTALLMENTS = [1, 2] as const;
export type GtcInstallment = (typeof GTC_INSTALLMENTS)[number];

/** Shared supporting-content action id (same taxonomy as Devolution/EULB/FC Unspent's
 *  'download-template' action). Only the design year/installment whose formJson field carries
 *  this action with a well-formed `meta` (see resolveTemplateMeta) exposes the download - every
 *  other submission is an ordinary questionnaire with no such field. */
export const GTC_ACTION_DOWNLOAD_TEMPLATE = 'download-template';
