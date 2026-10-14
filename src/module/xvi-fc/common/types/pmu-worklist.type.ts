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

/** Raw counts for the overview cards above the worklist, over every record in scope (selected form,
 *  state filter, installment filter) and independent of the Form Status filter and of paging.
 *  Percentages and sub-text are the client's job. Role-neutral: any reviewer table can reuse it. */
export interface PmuWorklistSummary {
  /** N: records in scope. One per state, or one per state per installment when an installment-scoped
   *  form is queried without an `installment` filter. */
  total: number;
  /** Distinct states in scope, so a client can show "N / statesInScope per state". */
  statesInScope: number;
  /** `total` minus every record whose status is anything other than Not Started. */
  notStarted: number;
  inProgress: number;
  underReview: { mohua: number; pmu: number };
  returned: { mohua: number; pmu: number };
  acknowledged: number;
}

export interface PmuWorklistData {
  rows: PmuWorklistRow[];
  summary: PmuWorklistSummary;
}
