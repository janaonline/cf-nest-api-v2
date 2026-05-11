export const FORM_STATUS = {
  NO_STATUS: 0,
  NOT_STARTED: 1,
  IN_PROGRESS: 2,
  UNDER_REVIEW_BY_STATE: 3,
  RETURNED_BY_STATE: 4,
  UNDER_REVIEW_BY_MOHUA: 5,
  RETURNED_BY_MOHUA: 6,
  SUBMISSION_ACKNOWLEDGED_BY_MOHUA: 7,
} as const;

export type FormStatusType = (typeof FORM_STATUS)[keyof typeof FORM_STATUS];

export const FORM_STATUS_LABELS: Readonly<Record<FormStatusType, string>> = {
  [FORM_STATUS.NO_STATUS]: 'No Status',
  [FORM_STATUS.NOT_STARTED]: 'Not Started',
  [FORM_STATUS.IN_PROGRESS]: 'In Progress',
  [FORM_STATUS.UNDER_REVIEW_BY_STATE]: 'Under Review by State',
  [FORM_STATUS.RETURNED_BY_STATE]: 'Returned by State',
  [FORM_STATUS.UNDER_REVIEW_BY_MOHUA]: 'Under Review by MoHUA',
  [FORM_STATUS.RETURNED_BY_MOHUA]: 'Returned by MoHUA',
  [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]: 'Acknowledged by MoHUA',
};

/**
 * Returns the human-readable label for a form status code.
 * @param status Numeric form status value.
 * @returns Display label, or 'Unknown' if status is not recognised.
 */
export function getFormStatusLabel(status: number): string {
  return (FORM_STATUS_LABELS as Record<number, string>)[status] ?? 'Unknown';
}

/**
 * Checks whether a status represents a terminal (no further transitions) state.
 * @param status Numeric form status value.
 * @returns True if no further workflow transitions are possible.
 */
export function isTerminalStatus(status: number): boolean {
  return status === FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
}

/**
 * Returns the default owner org type for a given form status.
 * Used to set currentOwnerOrgType after a status transition.
 * @param status Target form status.
 * @returns Org type string ('ULB', 'STATE', 'MoHUA'), or null for no-owner statuses.
 */
export function getDefaultOwnerForStatus(status: number): string | null {
  switch (status) {
    case FORM_STATUS.NOT_STARTED:
    case FORM_STATUS.IN_PROGRESS:
    case FORM_STATUS.RETURNED_BY_STATE:
    case FORM_STATUS.RETURNED_BY_MOHUA:
      return 'ULB';
    case FORM_STATUS.UNDER_REVIEW_BY_STATE:
      return 'STATE';
    case FORM_STATUS.UNDER_REVIEW_BY_MOHUA:
      return 'MoHUA';
    case FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA:
    case FORM_STATUS.NO_STATUS:
      return null;
    default:
      return null;
  }
}
