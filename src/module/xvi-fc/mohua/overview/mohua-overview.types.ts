import type { MOHUA_OVERVIEW_STAGE } from './mohua-overview.constants';

export type MohuaOverviewStage = (typeof MOHUA_OVERVIEW_STAGE)[keyof typeof MOHUA_OVERVIEW_STAGE];

export interface MohuaOverviewForm {
  key: string;
  label: string;
  /** FORM_STATUS enum key, e.g. 'UNDER_REVIEW_BY_MOHUA'. */
  status: string;
  statusCode: number;
  statusLabel: string;
  completed: boolean;
  /** Whether MoHUA may open this form's read-only screen (same status gate as PMU's review pages). */
  canView: boolean;
}

export interface MohuaOverviewState {
  id: string;
  code: string;
  name: string;
  slug: string;
  stage: MohuaOverviewStage;
  /** Set only for under-review states: when their five condition forms were all submitted (ISO). */
  underReviewSince: string | null;
  /** The year's allocation (basic + performance), in crore. */
  allocation: number;
  /** Not sourced yet — the UI shows "--". */
  eligible: null;
  /** ULBs (of ulbsTotal) that have submitted all five ULB forms to the State. */
  ulbsDone: number;
  ulbsTotal: number;
  formsDone: number;
  forms: MohuaOverviewForm[];
}

export interface MohuaOverview {
  year: { id: string; label: string };
  totals: {
    stateCount: number;
    ulbsCovered: number;
    /** Hard-coded, in crore. */
    allocation: number;
    /** Hard-coded, in crore. */
    instalment1: number;
    stageCounts: Record<MohuaOverviewStage, number>;
  };
  states: MohuaOverviewState[];
}
