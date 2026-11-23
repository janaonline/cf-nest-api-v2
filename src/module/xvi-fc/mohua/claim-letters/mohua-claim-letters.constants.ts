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
export const MOHUA_CLAIM_LETTER_RETURNED_STATUSES: number[] = [
  FORM_STATUS.RETURNED_BY_SO,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

/** Listed letters that still count as submitted claims: under review or acknowledged, never returned ones. */
export const MOHUA_CLAIM_LETTER_SUBMITTED_STATUSES: number[] = MOHUA_CLAIM_LETTERS_LISTED_STATUSES.filter(
  (status) => !MOHUA_CLAIM_LETTER_RETURNED_STATUSES.includes(status),
);

export const MOHUA_CLAIM_LETTER_REVIEWER_FORBIDDEN_MESSAGE = 'Only MoHUA or admin users may approve a claim letter.';

/** A ULB's own forms the SO can return for it: Audited / Provisional statements, SLB, Bank Account, DUR. */
export const MOHUA_CLAIM_LETTER_RETURNABLE_ULB_FORM_IDS = [30, 31, 32, 33, 36];

/** State forms with a row per ULB, returned per ULB: Elected Body, Devolution, FC Unspent. */
export const MOHUA_CLAIM_LETTER_RETURNABLE_ROW_FORM_IDS = [23, 24, 25];

/** 409 when the State's letters under SO review changed after the return dialog listed the ones it also returns. */
export const MOHUA_CLAIM_LETTER_AFFECTED_CHANGED_MESSAGE =
  'Another claim letter of this State was submitted or decided while you were reviewing. Reload to see which ' +
  'letters this return affects.';

/** State-wide items the SO can return with the letter: the claim letter itself (26, a remark only), SFC and GTC. */
export const MOHUA_CLAIM_LETTER_RETURNABLE_STATE_FORM_IDS = [26, 22, 35];

/** A ULB's own discretionary exemption request in a claim row's `eligibilitySources` (the only kind MoHUA decides). */
export const MOHUA_CLAIM_LETTER_ULB_EXEMPTION_KIND = 'DISCRETIONARY_ULB';

export const MOHUA_CLAIM_LETTER_ULB_RETURNED_MESSAGE =
  'Some ULBs are marked for return. Return the claim letter for correction, or clear those marks to approve it.';

/** 400 when a return picks SFC or GTC the dialog shows as not returnable, with the same reason. */
export function stateFormNotReturnableMessage(
  name: string,
  form: { lockReason: 'ACCEPTED' | 'EXEMPTED' | 'NOT_IN_REVIEW' | null; acceptedWithLetter: string | null },
): string {
  switch (form.lockReason) {
    case 'ACCEPTED':
      return form.acceptedWithLetter
        ? `${name} was accepted with ${form.acceptedWithLetter} and can no longer be returned.`
        : `${name} was already accepted and can no longer be returned.`;
    case 'EXEMPTED':
      return `This letter relies on the State's exemption for ${name}, so there is no form to return.`;
    default:
      return `${name} is not under review with this letter, so it can't be returned with it.`;
  }
}

/**
 * 409 on approve when a ULB of the letter already has an OM row from another letter (`xvifc_om_ulbs`' unique index).
 * Names at most 5 ULBs; `letterNames` empty means the holding letter was not found.
 */
export function omUlbsHeldMessage(ulbNames: readonly string[], letterNames: readonly string[]): string {
  const shown = ulbNames.slice(0, 5);
  const more = ulbNames.length - shown.length;
  const ulbs = `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  const verb = ulbNames.length === 1 ? 'is' : 'are';
  const letters = letterNames.length ? letterNames.join(' and ') : 'another claim letter';
  return (
    `${ulbs} ${verb} already in the OM list of ${letters} for this installment, so this letter can't be approved. ` +
    'Please contact the CityFinance team.'
  );
}

/** Longest remark MoHUA can attach to an approval. */
export const MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH = 1000;
/** A return (of the letter, or the mark on one ULB) must say why: at least this many characters, after trimming. */
export const MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH = 10;

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

/** ULB Eligibility page: 10 rows a page. Only the condition check is cached; batches are read live. */
export const MOHUA_ULB_ELIGIBILITY_DEFAULT_LIMIT = 10;
export const MOHUA_ULB_ELIGIBILITY_MAX_LIMIT = 50;
export const MOHUA_ULB_ELIGIBILITY_CACHE_TTL_SECONDS = 15 * 60;
/** Refresh rebuilds only a cached check older than this, so repeated clicks don't re-run the whole State. */
export const MOHUA_ULB_ELIGIBILITY_REFRESH_FLOOR_SECONDS = 60;

export const MOHUA_ULB_ELIGIBILITY_FILTERS = ['ELIGIBLE', 'INELIGIBLE'] as const;

/** The `batch` filter value for ULBs held by no letter. */
export const MOHUA_ULB_ELIGIBILITY_NOT_IN_LETTER = 'NONE';

/** The failed-condition key for a ULB with no devolution allocation (the others are criterion types). */
export const MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION = 'NO_ALLOCATION';
export const MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION_LABEL = 'No devolution allocation';

/** Statuses of a letter that holds ULB locks: draft (2), under SO review (15), under MoHUA review (5), acknowledged (7). */
export const MOHUA_ULB_ELIGIBILITY_LETTER_STATUSES: number[] = [
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.UNDER_REVIEW_BY_SO,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

export const MOHUA_ULB_ELIGIBILITY_DRAFT_LABEL = 'Draft';
