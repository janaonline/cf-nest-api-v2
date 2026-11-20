import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/** Statuses of an approved claim letter: MoHUA's final approval lands on 7. */
export const CLAIM_LETTER_APPROVED_STATUSES: number[] = [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA];

/** V1 supports Installment 1 only; Installment 2 stays schema-legal but is rejected. */
export const CLAIM_LETTER_SUPPORTED_INSTALLMENT = 1;

/** Claim Letter's own formjsons document (registry: master/form-json-config/CLAUDE.md). */
export const CLAIM_LETTER_FORM_ID = 26;

/** Claim letters per State/year/installment when formjson 26 `meta.maxClaimLetters` is unset or invalid (ADR 0009). */
export const CLAIM_LETTER_DEFAULT_MAX_LETTERS = 3;

/** Highest `meta.maxClaimLetters`; also the schema's upper bound on `batchNumber`. */
export const CLAIM_LETTER_MAX_LETTERS_LIMIT = 10;

export const CLAIM_LETTER_PAGINATION_DEFAULT_PAGE = 1;
export const CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT = 20;
export const CLAIM_LETTER_PAGINATION_MAX_LIMIT = 100;

/** History Status filter, in the State's terms: under review covers 15 and 5, returned covers 16 and 6. */
export const CLAIM_LETTER_HISTORY_STATUS_FILTERS = [
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'RETURNED',
  'ACKNOWLEDGED',
  'DISCARDED',
] as const;
export type ClaimLetterHistoryStatusFilter = (typeof CLAIM_LETTER_HISTORY_STATUS_FILTERS)[number];

/** History columns the State can sort by; `updatedAt` (Last activity) is the default. */
export const CLAIM_LETTER_HISTORY_SORT_FIELDS = [
  'updatedAt',
  'submittedAt',
  'batchNumber',
  'ulbCount',
  'claimedTotal',
] as const;
export type ClaimLetterHistorySortField = (typeof CLAIM_LETTER_HISTORY_SORT_FIELDS)[number];

/** Most ULBs one batch holds, and one ULB-picker load returns; above any State's ULB count. */
export const CLAIM_LETTER_MAX_ULBS = 1000;

/** Children are inserted in chunks, outside a transaction (docs/adr/0002-batching-and-locks.md). */
export const CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE = 200;

/** Same 20MB ceiling as other xvi-fc PDF uploads. */
export const CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB = 20 * 1024;

/** 409 for any action on an abandoned batch (preview, .docx, signed-file upload, submit). */
export const CLAIM_LETTER_ABANDONED_MESSAGE = 'This claim batch was discarded.';

/** Generous so no live build is taken for stale; tune from production p99 build time (ADR 0002). */
export const CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES = 30;

/** Lease on updateDraft's edit lock: covers one child rebuild, not a whole build (ADR 0002). */
export const CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES = 5;

/** Supporting-content action id on `signedClaimFile` that opens the letter editor
 *  (`ClaimLetterService.applySignedFileSupportingContent()`). */
export const CLAIM_LETTER_ACTION_PREVIEW_TEMPLATE = 'preview-template';

/** ULB rows per page in the letter preview's annexure lists (the .docx always has every row). */
export const CLAIM_LETTER_DOCUMENT_PAGE_SIZE = 20;

/** How long the built annexure (eligibility, counts, lists) is reused by the preview; the .docx and
 *  Submit always evaluate fresh, and the letter's as-on note shows when it was built. */
export const CLAIM_LETTER_DOCUMENT_CACHE_TTL_SECONDS = 300;

/** Annexure rows per cache entry; a multiple of the page size, so a page never spans two entries. */
export const CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS = 100;

/** Letter-detail keys the letter prints, with the highlighted text shown while blank. Fields are
 *  defined in formjson 26; a key missing there just keeps printing its placeholder. */
export const CLAIM_LETTER_DETAIL_PLACEHOLDERS = {
  departmentName: '<NAME OF DEPARTMENT>',
  departmentAddress: '<Address>',
  departmentEmail: '<Email>',
  letterNo: '<●>',
  letterDate: '<DD Mon YYYY>',
  mohuaReferenceDate: '',
  gtcTransferredInTime: '<Yes/No>',
  gtcPenalInterestDetails: '<Details of penal interest transferred>',
  sfcAtrDate: '<DD Mon YYYY>',
  officerName: '<Name of Authorised Officer>',
  officerDesignation: '<Designation>',
} as const;

export type ClaimLetterDetailKey = keyof typeof CLAIM_LETTER_DETAIL_PLACEHOLDERS;

/** Row B's ATR date: left out of the letter details while the State's Entire State SFC exemption
 *  counts, since Row B then prints the exemption instead (ADR 0005). */
export const CLAIM_LETTER_SFC_ATR_DATE_KEY: ClaimLetterDetailKey = 'sfcAtrDate';

/** Compliance rows C-I and the eligibility criterion `type` each one counts. Row G counts ULBs
 *  with an unspent balance, not ULBs meeting the condition. */
export const CLAIM_LETTER_ROW_CRITERIA = {
  C: 'ELECTED_BODY',
  D: 'UPLOAD_CONFIG_AUDITED',
  E: 'UPLOAD_CONFIG_PROVISIONAL',
  F: 'BANK_ACCOUNT',
  G: 'FC_UNSPENT_STATE',
  H: 'SLB',
  I: 'DUR',
} as const;

/** Election Status row value that the row C sentence counts. */
export const CLAIM_LETTER_SIXTH_SCHEDULE_VALUE = '6th Schedule';

/** What the return emails and the State's returned-letter box call each item the SO can return (formIds as in
 *  master/form-json-config/CLAUDE.md). */
export const CLAIM_LETTER_FORM_NAMES: Readonly<Record<number, string>> = {
  26: 'Claim Letter',
  22: 'SFC Status',
  23: 'Elected Body Status',
  24: 'ULB-wise Allocation',
  25: 'FC Unspent Declaration',
  35: 'Grant Transfer Certificate',
  30: 'Annual Accounts (Audited)',
  31: 'Annual Accounts (Provisional)',
  32: 'Service Level Benchmarks',
  33: 'Bank Account',
  36: 'Detailed Utilisation Report',
};
