import type { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import type {
  DashboardAmountUnit,
  DashboardCurrency,
  StateDashboardClaimLetterKey,
  StateDashboardClaimLetterStatus,
  StateDashboardFormKey,
  StateDashboardTaskKey,
  StateDashboardTaskStatus,
  StateDashboardUlbSubmissionStatus,
} from './state-dashboard.constants';

export interface StateDashboardContext {
  stateId: string;
  stateName: string;
  yearId: string;
  financialYear: string;
  userRole: string;
  grantType: string | null;
}

export interface StateDashboardMetrics {
  totalUlbs: number;
  allocatedAmount: number;
  claimedAmount: number;
  amountUnit: DashboardAmountUnit;
  currency: DashboardCurrency;
  compliance: {
    rate: number;
    compliantUlbs: number;
    totalUlbs: number;
  };
}

export interface StateDashboardTask {
  key: StateDashboardTaskKey;
  title: string;
  subtitle: string;
  status: StateDashboardTaskStatus;
  actionLabel: string | null;
  route: string | null;
}

export interface StateDashboardUlbSubmissionSummaryItem {
  key: StateDashboardUlbSubmissionStatus;
  label: string;
  count: number;
  description: string;
}

export interface StateDashboardFormCompletionItem {
  key: StateDashboardFormKey;
  label: string;
  completed: number;
  total: number;
}

export interface StateDashboardClaimLetterItem {
  key: StateDashboardClaimLetterKey;
  title: string;
  subtitle: string;
  installment: number;
  status: StateDashboardClaimLetterStatus;
  actionLabel: string | null;
  lockReason: string | null;
  route: string | null;
}

export interface StateDashboardData {
  context: StateDashboardContext;
  metrics: StateDashboardMetrics;
  stateDataTasks: StateDashboardTask[];
  ulbSubmissionSummary: StateDashboardUlbSubmissionSummaryItem[];
  formCompletion: StateDashboardFormCompletionItem[];
  claimLetters: StateDashboardClaimLetterItem[];
}

export type StateDashboardApiResponse = XviFcApiResponse<StateDashboardData>;
