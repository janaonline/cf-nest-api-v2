export const FORM_STATUS = {
  NO_STATUS: 0,
  NOT_STARTED: 1,
  IN_PROGRESS: 2,
  UNDER_REVIEW_BY_STATE: 3,
  RETURNED_BY_STATE: 4,
  UNDER_REVIEW_BY_MOHUA: 5,
  RETURNED_BY_MOHUA: 6,
  SUBMISSION_ACKNOWLEDGED_BY_MOHUA: 7,
  APPROVED_BY_STATE: 8,
  AWAITING_CLAIM_LETTER: 9,
  /** Never a live form_status — appears only as a form-log `toStatus` marking an undo event. */
  UNDO: 10,
  /** Reserved — not wired to any transition yet. */
  ACTION_REQUIRED: 11,
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
  [FORM_STATUS.APPROVED_BY_STATE]: 'Approved by State',
  [FORM_STATUS.AWAITING_CLAIM_LETTER]: 'Awaiting Claim Letter',
  [FORM_STATUS.UNDO]: 'Undo',
  [FORM_STATUS.ACTION_REQUIRED]: 'Action Required',
};

/**
 * Returns the human-readable label for a form status code.
 * @param status Numeric form status value.
 * @returns Display label, or 'Unknown' if status is not recognised.
 */
export function getFormStatusLabel(status: number): string {
  return (FORM_STATUS_LABELS as Record<number, string>)[status] ?? 'Unknown';
}

const FORM_STATUS_KEYS: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(FORM_STATUS).map(([key, value]) => [value, key]),
);

/**
 * Returns the enum-key form of a form status code (e.g. 'UNDER_REVIEW_BY_MOHUA').
 * @param status Numeric form status value.
 * @returns The matching FORM_STATUS key, or 'NOT_STARTED' if not recognised.
 */
export function getFormStatusKey(status: number): string {
  return FORM_STATUS_KEYS[status] ?? 'NOT_STARTED';
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
    case FORM_STATUS.APPROVED_BY_STATE:
      return 'STATE';
    case FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA:
    case FORM_STATUS.NO_STATUS:
    case FORM_STATUS.AWAITING_CLAIM_LETTER:
    case FORM_STATUS.UNDO:
    case FORM_STATUS.ACTION_REQUIRED:
      return null;
    default:
      return null;
  }
}
