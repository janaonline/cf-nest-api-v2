/**
 * Shared per-row review-workflow status, reused across any XVI-FC state form that
 * models individually-reviewable rows (currently: FC Unspent Declaration).
 *
 * `null` on a row means "pre-submission" (draft, never yet finalized) — it is not a
 * member of this enum, just the absence of a status.
 *
 * - `UPDATE_PENDING` — set by a state final submit; awaiting MoHUA row review.
 * - `ACTIVE` — approved by MoHUA (individually or via complete-form approval).
 * - `REJECTED` — rejected by MoHUA (individually or via complete-form rejection).
 * - `NEEDS_UPDATE` — reserved for a future state-correction/resubmission phase;
 *   nothing in the current MoHUA review phase produces this value.
 */
export const ROW_STATUS = {
  ACTIVE: 'active',
  NEEDS_UPDATE: 'needs_update',
  UPDATE_PENDING: 'update_pending',
  REJECTED: 'rejected',
} as const;

export type RowStatusType = (typeof ROW_STATUS)[keyof typeof ROW_STATUS];
