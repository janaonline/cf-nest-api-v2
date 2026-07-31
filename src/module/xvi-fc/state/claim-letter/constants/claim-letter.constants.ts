/** V1 supports Installment 1 only — Installment 2 stays schema-legal but is rejected here. */
export const CLAIM_LETTER_SUPPORTED_INSTALLMENT = 1;

/**
 * Claim Letter's own `formjsons` entry (currently just the `signedClaimFile` upload field) — the
 * source of truth for `getDetail()`'s `questions`, matching every other state form's own formId
 * convention (SFC=22, EULB=23, Devolution=24, FC Unspent=25, upload-config=30/31, SLB=32). Confirmed
 * free by grepping every existing formId usage in this backend before assigning it.
 */
export const CLAIM_LETTER_FORM_ID = 26;

/** At most 3 logical claim batches per State/year/installment — see
 *  docs/adr/0002-batching-and-locks.md for the reservation model this enforces. */
export const CLAIM_LETTER_MAX_BATCH_NUMBER = 3;

export const CLAIM_LETTER_PAGINATION_DEFAULT_PAGE = 1;
export const CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT = 20;
export const CLAIM_LETTER_PAGINATION_MAX_LIMIT = 100;

/** Bulk-insert claim-letter children in bounded chunks, never one giant array — a single
 *  transaction wouldn't scale to states with 700+ ULBs (docs/adr/0002-batching-and-locks.md). */
export const CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE = 200;

/** Matches the common 20MB ceiling used for other PDF uploads across xvi-fc (e.g. SFC Status extension orders). */
export const CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB = 20 * 1024;

/** Generous default so no legitimate synchronous build is ever mistaken for stale — real value
 *  should reflect observed p99 build latency once there's production traffic. Used by the stale-
 *  BUILDING recovery paths in docs/adr/0002-batching-and-locks.md. */
export const CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES = 30;

/**
 * Self-expiring lease duration for `updateDraft`'s `editLockToken` (hardening pass) — once a claim
 * on this lock is older than this, every guard that checks it (`updateDraft`'s own re-claim,
 * `abandonDraft`, `submit`) treats it as unclaimed, inline, with no separate cleanup job. Much
 * tighter than `CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES` on purpose: this only ever needs to
 * cover one delete+insert child rebuild (normally sub-second), not the full multi-stage assembly
 * pipeline that threshold was sized for. Only matters if the process crashes mid-request — has no
 * relationship to how long a draft may sit unsubmitted, which is unbounded by design.
 */
export const CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES = 5;
