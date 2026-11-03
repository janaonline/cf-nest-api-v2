import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/** V1 of the claim letter flow supports Installment 1 only (see the State-side claim-letter module). */
export const MOHUA_CLAIM_LETTERS_INSTALLMENT = 1;

/**
 * The claim letter statuses MoHUA's Claims & Submissions screens list: letters the State has submitted and MoHUA is
 * has to review: under SO review (15), returned by the SO (16), under MoHUA review (5), returned by MoHUA (6) or
 * approved (7, read-only). Drafts are never shown.
 */
export const MOHUA_CLAIM_LETTERS_LISTED_STATUSES: number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_SO,
  FORM_STATUS.RETURNED_BY_SO,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

/** Returned letters (by the SO or MoHUA): their screens show what the return reopened, read from its history. */
export const MOHUA_CLAIM_LETTER_RETURNED_STATUSES: number[] = [FORM_STATUS.RETURNED_BY_SO, FORM_STATUS.RETURNED_BY_MOHUA];

export const MOHUA_CLAIM_LETTER_REVIEWER_FORBIDDEN_MESSAGE = 'Only MoHUA or admin users may approve a claim letter.';

/** A ULB's own forms the SO can return for it: Audited / Provisional statements, SLB, Bank Account, DUR. */
export const MOHUA_CLAIM_LETTER_RETURNABLE_ULB_FORM_IDS = [30, 31, 32, 33, 36];

/** State forms with a row per ULB, returned per ULB: Elected Body, Devolution, FC Unspent. */
export const MOHUA_CLAIM_LETTER_RETURNABLE_ROW_FORM_IDS = [23, 24, 25];

/** State-wide items the SO can return with the letter: the claim letter itself (26, a remark only), SFC and GTC. */
export const MOHUA_CLAIM_LETTER_RETURNABLE_STATE_FORM_IDS = [26, 22, 35];

/** A ULB's own discretionary exemption request in a claim row's `eligibilitySources` (the only kind MoHUA decides). */
export const MOHUA_CLAIM_LETTER_ULB_EXEMPTION_KIND = 'DISCRETIONARY_ULB';

export const MOHUA_CLAIM_LETTER_ULB_RETURNED_MESSAGE =
  'Some ULBs are marked for return. Return the claim letter for correction, or clear those marks to approve it.';

/** Longest remark MoHUA can attach to an approval. */
export const MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH = 1000;

/** A year's grant (basic + performance) is released in two equal installments. */
export const MOHUA_CLAIM_LETTERS_INSTALLMENTS_PER_YEAR = 2;

export const MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS = {
  RECEIVED: 'RECEIVED',
  PENDING: 'PENDING',
} as const;

export const MOHUA_CLAIM_LETTERS_ULB_STATUS = {
  ELIGIBLE: 'ELIGIBLE',
  ELIGIBLE_VIA_EXEMPTION: 'ELIGIBLE_VIA_EXEMPTION',
} as const;

export const MOHUA_CLAIM_LETTER_ULBS_DEFAULT_LIMIT = 20;
export const MOHUA_CLAIM_LETTER_ULBS_MAX_LIMIT = 100;
