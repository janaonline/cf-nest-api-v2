/** Award period validation constraints */
export const AWARD_PERIOD_REGEX = /^\d{4}-\d{4}$/;
export const AWARD_PERIOD_START_MIN = 2020;
export const AWARD_PERIOD_START_MAX = 2026;
export const AWARD_PERIOD_END_MIN = 2025;
export const AWARD_PERIOD_END_MAX = 2032;
export const AWARD_PERIOD_REQUIRED_YEAR = 2026;
export const AWARD_PERIOD_VALID_DURATIONS = new Set<number>([1, 5, 6]);

export const SFC_REPORT_STATUS = {
  TO_BE_SUBMITTED: 'toBeSubmitted',
  SUBMITTED_ATR_NOT_TABLED: 'reportSubmittedAtrNotYetTabled',
  SUBMITTED_ATR_TABLED: 'reportSubmittedAtrTabled',
} as const;
