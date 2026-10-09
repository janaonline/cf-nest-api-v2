import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';

/**
 * A state-condition form counts as completed once it has been submitted onward: under review by
 * MoHUA (5, or 8 on the same footing), acknowledged (7), or under review by PMU (13).
 */
export const MOHUA_OVERVIEW_COMPLETED_FORM_STATUSES: ReadonlySet<number> = new Set<number>([
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.APPROVED_BY_STATE,
  FORM_STATUS.UNDER_REVIEW_BY_PMU,
]);

/**
 * The one set of labels shown for state-condition forms, whatever the form: not started / in
 * progress / under review. Statuses not listed fall back to the standard FORM_STATUS label.
 */
export const MOHUA_OVERVIEW_STATE_FORM_STATUS_LABEL: Readonly<Record<number, string>> = {
  [FORM_STATUS.NO_STATUS]: 'Not Started',
  [FORM_STATUS.NOT_STARTED]: 'Not Started',
  [FORM_STATUS.IN_PROGRESS]: 'In Progress',
  [FORM_STATUS.UNDER_REVIEW_BY_MOHUA]: 'Under Review by MoHUA',
  [FORM_STATUS.APPROVED_BY_STATE]: 'Under Review by MoHUA',
  [FORM_STATUS.UNDER_REVIEW_BY_PMU]: 'Under Review by PMU',
};

/**
 * A ULB form counts as submitted once it has reached the State or gone beyond it: under review by
 * State, under review by MoHUA, acknowledged, approved by State, awaiting claim letter — or the ULB
 * is exempt from it (a genuinely new ULB). Returned statuses (4, 6) do not count. Using only
 * "under review by State" would drop a ULB from the count as soon as the State acts on it.
 */
export const MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES: ReadonlySet<number> = new Set<FormStatusType>([
  FORM_STATUS.UNDER_REVIEW_BY_STATE,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.APPROVED_BY_STATE,
  FORM_STATUS.AWAITING_CLAIM_LETTER,
  FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
]);

/**
 * SLB has no State review step: a ULB's final submit goes straight to APPROVED_BY_STATE (8), so 8 is
 * what "submitted" means for it. Exempt (12) still counts. Other statuses, e.g. a draft, do not.
 */
export const MOHUA_OVERVIEW_SLB_SUBMITTED_STATUSES: ReadonlySet<number> = new Set<FormStatusType>([
  FORM_STATUS.APPROVED_BY_STATE,
  FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
]);

/** The five state conditions the Overview tracks are the 1st instalment's. */
export const MOHUA_OVERVIEW_INSTALMENT = 1;

export const RUPEES_PER_CRORE = 10_000_000;

// TODO: hard-coded national figures (in crore) — no source collection holds them yet. Replace once
// the annual / instalment-1 totals are stored somewhere.
export const MOHUA_OVERVIEW_ANNUAL_ALLOCATION_CRORE = 37272;
export const MOHUA_OVERVIEW_INSTALMENT_1_CRORE = 18636;

export const MOHUA_OVERVIEW_STAGE = {
  NOT_STARTED: 'notStarted',
  IN_PROGRESS: 'inProgress',
  UNDER_REVIEW: 'underReview',
} as const;

/** Order matters: the service loads the five collections in this order and zips the results back by index. */
export const MOHUA_OVERVIEW_FORMS = [
  { key: 'SFC_STATUS', label: 'SFC Status' },
  { key: 'ELECTED_BODIES', label: 'Elected Bodies' },
  { key: 'DEVOLUTION', label: 'Devolution' },
  { key: 'FC_UNSPENT', label: 'FC Unspent Disclosure' },
  { key: 'GTC', label: 'Grant Transfer Certificate' },
] as const;

/** The ULB forms counted on the State detail page, in display order. `source` is a key of SubmittedUlbIdsByForm. */
export const MOHUA_STATE_DETAIL_ULB_FORMS = [
  { key: 'AUDITED', label: 'Annual Accounts', source: 'audited' },
  { key: 'UNAUDITED', label: 'Provisional Accounts', source: 'unaudited' },
  { key: 'PFMS', label: 'PFMS Bank Account', source: 'pfms' },
  { key: 'SLB', label: 'Service Level Benchmarks', source: 'slb' },
  { key: 'DUR', label: 'DUR', source: 'dur' },
] as const;

export const MOHUA_STATE_ULBS_DEFAULT_LIMIT = 15;
/** The biggest state has about 800 ULBs; one page never needs more than this. */
export const MOHUA_STATE_ULBS_MAX_LIMIT = 100;
