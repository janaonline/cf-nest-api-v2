import { FORM_STATUS, FormStatusType } from 'src/common/constants/form-status.constants';

/**
 * Valid FORM_STATUS values for a row's review status (FC Unspent Declaration, Elected Urban Local
 * Bodies). `null` = pre-submission. PMU has no terminal status of its own — an approved row lands
 * directly on UNDER_REVIEW_BY_MOHUA, which Feature 2's (not yet wired) claim-batch write-back will
 * also use, so that value will later mean both "PMU-cleared" and "swept into a claim batch".
 */
export type RowReviewStatus = Extract<
  FormStatusType,
  | typeof FORM_STATUS.UNDER_REVIEW_BY_MOHUA
  | typeof FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA
  | typeof FORM_STATUS.RETURNED_BY_MOHUA
  | typeof FORM_STATUS.ACTION_REQUIRED
  | typeof FORM_STATUS.UNDER_REVIEW_BY_PMU
  | typeof FORM_STATUS.RETURNED_BY_PMU
>;

export const ROW_REVIEW_STATUS_VALUES = [
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.ACTION_REQUIRED,
  FORM_STATUS.UNDER_REVIEW_BY_PMU,
  FORM_STATUS.RETURNED_BY_PMU,
] as const;
