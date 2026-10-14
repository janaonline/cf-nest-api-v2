/** Same keys the frontend already uses as `PmuReviewFormId`, so the UI passes its form id straight through. */
export enum StateFormHistoryForm {
  SFC_STATUS = 'SFC_STATUS',
  GTC = 'GTC',
  DEVOLUTION_FORMULA = 'DEVOLUTION_FORMULA',
  ELECTED_BODY = 'ELECTED_BODY',
  FC_UNSPENT = 'FC_UNSPENT',
}

/** Forms whose worklist rows (and form documents) are per installment. */
export const STATE_FORM_HISTORY_INSTALLMENTS = [1, 2] as const;

/** Entries per page when the client doesn't ask for a size. */
export const STATE_FORM_HISTORY_DEFAULT_PAGE_SIZE = 20;

/** Hard ceiling on one page — enforced by the query DTO (400 above it) and again in the service, so no client can pull more per call. */
export const STATE_FORM_HISTORY_MAX_PAGE_SIZE = 50;

/** Opaque-looking paging token: `<changedAt ISO>_<history row ObjectId>`. See `state-form-history.util.ts`. */
export const STATE_FORM_HISTORY_CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z_[a-fA-F0-9]{24}$/;

export type StateFormHistoryActorRole = 'State' | 'PMU' | 'MoHUA';
