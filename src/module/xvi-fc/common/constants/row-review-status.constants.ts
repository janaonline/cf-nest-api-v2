import { FORM_STATUS, FormStatusType } from 'src/common/constants/form-status.constants';

/**
 * The FORM_STATUS subset valid on a per-row MoHUA-review status field, shared by every XVI-FC
 * state form that models individually-reviewable rows (currently: FC Unspent Declaration,
 * Elected Urban Local Bodies). `null` on a row means "pre-submission" — not a member of this set.
 */
export type RowReviewStatus = Extract<
  FormStatusType,
  | typeof FORM_STATUS.UNDER_REVIEW_BY_MOHUA
  | typeof FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA
  | typeof FORM_STATUS.RETURNED_BY_MOHUA
  | typeof FORM_STATUS.ACTION_REQUIRED
>;

export const ROW_REVIEW_STATUS_VALUES = [
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.ACTION_REQUIRED,
] as const;
