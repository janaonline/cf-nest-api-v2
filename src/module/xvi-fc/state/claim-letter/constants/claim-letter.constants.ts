/** V1 supports Installment 1 only (plan §1) — Installment 2 stays schema-legal but is rejected here. */
export const CLAIM_LETTER_SUPPORTED_INSTALLMENT = 1;

/**
 * Claim Letter's own `formjsons` entry (currently just the `signedClaimFile` upload field) — the
 * source of truth for `getDetail()`'s `questions`, matching every other state form's own formId
 * convention (SFC=22, EULB=23, Devolution=24, FC Unspent=25, upload-config=30/31, SLB=32). Confirmed
 * free by grepping every existing formId usage in this backend before assigning it.
 */
export const CLAIM_LETTER_FORM_ID = 26;

/** Brain §15.6: at most 3 logical claim batches per State/year/installment. */
export const CLAIM_LETTER_MAX_BATCH_NUMBER = 3;

export const CLAIM_LETTER_PAGINATION_DEFAULT_PAGE = 1;
export const CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT = 20;
export const CLAIM_LETTER_PAGINATION_MAX_LIMIT = 100;

/** Brain §14.7: bulk-insert claim-letter children in bounded chunks (200-250), never one giant array. */
export const CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE = 200;

/** Matches the common 20MB ceiling used for other PDF uploads across xvi-fc (e.g. SFC Status extension orders). */
export const CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB = 20 * 1024;

/** Plan §7.9: generous default so no legitimate synchronous build is ever mistaken for stale —
 *  real value should reflect observed p99 build latency once there's production traffic. */
export const CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES = 30;
