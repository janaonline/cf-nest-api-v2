import type { MohuaOverviewForm, MohuaOverviewStage } from './mohua-overview.types';

export interface MohuaStateDetailUlbForm {
  key: string;
  label: string;
  /** ULBs (of totalUlbs) that have submitted this form to the State. */
  completed: number;
}

export interface MohuaStateDetail {
  year: { id: string; label: string };
  state: {
    id: string;
    code: string;
    name: string;
    slug: string;
    stage: MohuaOverviewStage;
  };
  /** The year's allocation (basic + performance), in crore. */
  allocation: number;
  /** The five state-condition forms and their status. */
  forms: MohuaOverviewForm[];
  formsDone: number;
  ulbForms: {
    totalUlbs: number;
    items: MohuaStateDetailUlbForm[];
  };
}
