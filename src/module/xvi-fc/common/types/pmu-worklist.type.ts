/** One row per state (or per state+installment for GTC/Devolution Formula) returned by each PMU
 *  module's `GET worklist/:yearId` endpoint — the list page's cross-state view. Shared across all
 *  5 PMU modules since the shape is genuinely identical; only the installment-scoped two populate
 *  `installment`. */
export interface PmuWorklistRow {
  stateId: string;
  stateName: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  /** The form document's own `updatedAt` timestamp — a deliberate simplification, not a precise
   *  "entered PMU queue at" history lookup. `null` for a state with no document at all yet (a
   *  synthesized `NOT_STARTED` row — there is no real timestamp to report). */
  updatedAt: string | null;
  /** Only present for GTC / Devolution Formula rows — one worklist row per installment. */
  installment?: 1 | 2;
}

export interface PmuWorklistData {
  rows: PmuWorklistRow[];
}
