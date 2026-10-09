export interface MohuaStateUlbRow {
  ulbId: string;
  name: string;
  censusCode: string | null;
  /** Total grant allocation in crore (Devolution Formula, instalment 1); null when the state has not uploaded one. */
  allocation: number | null;
  /** The elected-body status as uploaded by the state; null when there is no row. */
  electedBody: string | null;
  /** Whether the ULB has submitted each form to the State (same rule as the State detail rings). */
  forms: { audited: boolean; unaudited: boolean; pfms: boolean; slb: boolean; dur: boolean };
}

export interface MohuaStateUlbs {
  items: MohuaStateUlbRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
