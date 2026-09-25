export const GTC_FORM_NAME = 'Grant Transfer Certificate';
export const GTC_FORM_TYPE = 'GTC';
export const GTC_FORM_ID = 35;

export const GTC_INSTALLMENTS = [1, 2] as const;
export type GtcInstallment = (typeof GTC_INSTALLMENTS)[number];

/** Shared supporting-content action id - same taxonomy as Devolution/EULB/FC Unspent. See
 *  CLAUDE.md's "Static template download" section. */
export const GTC_ACTION_DOWNLOAD_TEMPLATE = 'download-template';
