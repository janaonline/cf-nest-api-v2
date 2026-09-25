import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';

// RUPEE is the current unit — dashboard amounts are whole Rupees. CRORE is kept defined but unused,
// leaving room for a future display-preference toggle without a breaking rename.
export const STATE_DASHBOARD_AMOUNT_UNIT = {
  CRORE: 'CRORE',
  RUPEE: 'RUPEE',
} as const;

export type DashboardAmountUnit = (typeof STATE_DASHBOARD_AMOUNT_UNIT)[keyof typeof STATE_DASHBOARD_AMOUNT_UNIT];

export const STATE_DASHBOARD_CURRENCY = {
  INR: 'INR',
} as const;

export type DashboardCurrency = (typeof STATE_DASHBOARD_CURRENCY)[keyof typeof STATE_DASHBOARD_CURRENCY];

export const STATE_DASHBOARD_TASK_KEY = {
  ULB_REGISTRATION: 'ulb-registration',
  DEVOLUTION_FORMULA: 'devolution-formula',
  STATE_CONDITIONS: 'state-conditions',
} as const;

export type StateDashboardTaskKey = (typeof STATE_DASHBOARD_TASK_KEY)[keyof typeof STATE_DASHBOARD_TASK_KEY];

export const STATE_DASHBOARD_TASK_STATUS = {
  DONE: 'DONE',
  PENDING: 'PENDING',
} as const;

export type StateDashboardTaskStatus = (typeof STATE_DASHBOARD_TASK_STATUS)[keyof typeof STATE_DASHBOARD_TASK_STATUS];

export const STATE_DASHBOARD_ULB_SUBMISSION_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ELIGIBLE: 'ELIGIBLE',
  EXEMPTION_REQUESTED: 'EXEMPTION_REQUESTED',
} as const;

export type StateDashboardUlbSubmissionStatus =
  (typeof STATE_DASHBOARD_ULB_SUBMISSION_STATUS)[keyof typeof STATE_DASHBOARD_ULB_SUBMISSION_STATUS];

export const STATE_DASHBOARD_FORM_KEY = {
  ANNUAL_ACCOUNTS: 'annual-accounts',
  PROVISIONAL_ACCOUNTS: 'provisional-accounts',
  PFMS_BANK_ACCOUNT: 'pfms-bank-account',
  FC_UNSPENT_BALANCE: 'fc-unspent-balance',
  SERVICE_LEVEL_BENCHMARKS: 'service-level-benchmarks',
} as const;

export type StateDashboardFormKey = (typeof STATE_DASHBOARD_FORM_KEY)[keyof typeof STATE_DASHBOARD_FORM_KEY];

export const STATE_DASHBOARD_CLAIM_LETTER_KEY = {
  INSTALLMENT_1_BATCH_1: 'installment-1-batch-1',
  INSTALLMENT_2: 'installment-2',
} as const;

export type StateDashboardClaimLetterKey =
  (typeof STATE_DASHBOARD_CLAIM_LETTER_KEY)[keyof typeof STATE_DASHBOARD_CLAIM_LETTER_KEY];

export const STATE_DASHBOARD_CLAIM_LETTER_STATUS = {
  AVAILABLE: 'AVAILABLE',
  LOCKED: 'LOCKED',
} as const;

export type StateDashboardClaimLetterStatus =
  (typeof STATE_DASHBOARD_CLAIM_LETTER_STATUS)[keyof typeof STATE_DASHBOARD_CLAIM_LETTER_STATUS];

export const STATE_DASHBOARD_ERROR_CODE = {
  INVALID_STATE_ID: 'INVALID_STATE_ID',
  INVALID_YEAR_ID: 'INVALID_YEAR_ID',
  STATE_ACCESS_DENIED: 'STATE_ACCESS_DENIED',
  STATE_NOT_FOUND: 'STATE_NOT_FOUND',
  YEAR_NOT_FOUND: 'YEAR_NOT_FOUND',
  DASHBOARD_DATA_UNAVAILABLE: 'DASHBOARD_DATA_UNAVAILABLE',
} as const;

export type StateDashboardErrorCode = (typeof STATE_DASHBOARD_ERROR_CODE)[keyof typeof STATE_DASHBOARD_ERROR_CODE];

export const STATE_DASHBOARD_TASK_ORDER = [
  STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION,
  STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA,
  STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS,
] as const;

export const STATE_DASHBOARD_COMPLETED_STATE_FORM_STATUSES: ReadonlySet<FormStatusType> = new Set<FormStatusType>([
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
]);

export const STATE_DASHBOARD_KNOWN_FORM_STATUSES: ReadonlySet<number> = new Set<number>(Object.values(FORM_STATUS));

export const STATE_DASHBOARD_NOT_STARTED_FORM_STATUSES: ReadonlySet<FormStatusType> = new Set<FormStatusType>([
  FORM_STATUS.NO_STATUS,
  FORM_STATUS.NOT_STARTED,
]);

export const STATE_DASHBOARD_IN_PROGRESS_FORM_STATUSES: ReadonlySet<FormStatusType> = new Set<FormStatusType>([
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.RETURNED_BY_MOHUA,
]);

export const STATE_DASHBOARD_COMPLETED_ULB_FORM_STATUSES: ReadonlySet<FormStatusType> = new Set<FormStatusType>([
  FORM_STATUS.UNDER_REVIEW_BY_STATE,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
]);

export const STATE_DASHBOARD_FINAL_ELIGIBLE_FORM_STATUS: FormStatusType = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;

export const STATE_DASHBOARD_ULB_STATUS_CONTENT: Readonly<
  Record<StateDashboardUlbSubmissionStatus, { label: string; description: string }>
> = {
  [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED]: {
    label: 'Not Started',
    description: 'No forms submitted yet',
  },
  [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS]: {
    label: 'In Progress',
    description: 'Some forms are still being completed',
  },
  [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.UNDER_REVIEW]: {
    label: 'Under Review',
    description: 'All required forms are awaiting State review',
  },
  [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE]: {
    label: 'Eligible',
    description: 'All required forms are cleared',
  },
  [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED]: {
    label: 'Exemption Requested',
    description: 'Pending exemption review',
  },
};

export const STATE_DASHBOARD_FORM_LABELS: Readonly<Record<StateDashboardFormKey, string>> = {
  [STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS]: 'Annual Accounts',
  [STATE_DASHBOARD_FORM_KEY.PROVISIONAL_ACCOUNTS]: 'Provisional Accounts',
  [STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT]: 'PFMS Bank Account',
  [STATE_DASHBOARD_FORM_KEY.FC_UNSPENT_BALANCE]: 'FC Unspent Balance',
  [STATE_DASHBOARD_FORM_KEY.SERVICE_LEVEL_BENCHMARKS]: 'Service Level Benchmarks',
};

export const STATE_DASHBOARD_ULB_STATUS_ORDER = [
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED,
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS,
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS.UNDER_REVIEW,
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE,
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED,
] as const;

export const STATE_DASHBOARD_FORM_ORDER = [
  STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS,
  STATE_DASHBOARD_FORM_KEY.PROVISIONAL_ACCOUNTS,
  STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT,
  STATE_DASHBOARD_FORM_KEY.FC_UNSPENT_BALANCE,
  STATE_DASHBOARD_FORM_KEY.SERVICE_LEVEL_BENCHMARKS,
] as const;

export const STATE_DASHBOARD_CLAIM_LETTER_ORDER = [
  STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1,
  STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2,
] as const;
