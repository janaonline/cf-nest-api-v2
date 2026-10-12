import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { STATE_FORM_HISTORY_CURSOR_PATTERN, type StateFormHistoryActorRole } from './state-form-history.constants';

/** Paging token for "entries older than this row". Time alone isn't unique (two changes can share a millisecond), so the row id breaks ties. */
export function encodeHistoryCursor(changedAt: Date, id: Types.ObjectId): string {
  return `${changedAt.toISOString()}_${id.toString()}`;
}

/** Returns `null` for anything that isn't a well-formed cursor (the DTO already rejects those; this is the service's own guard). */
export function decodeHistoryCursor(cursor: string): { changedAt: Date; id: Types.ObjectId } | null {
  if (!STATE_FORM_HISTORY_CURSOR_PATTERN.test(cursor)) return null;
  const [iso, id] = cursor.split('_');
  const changedAt = new Date(iso);
  if (Number.isNaN(changedAt.getTime())) return null;
  return { changedAt, id: new Types.ObjectId(id) };
}

/** Statuses whose history entry carries a reviewer's / submitter's return reason worth showing. */
const RETURNED_STATUSES: ReadonlySet<number> = new Set([
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.RETURNED_BY_PMU,
  FORM_STATUS.RETURNED_BY_MOHUA,
]);

export function isReturnedStatus(toStatus: number): boolean {
  return RETURNED_STATUSES.has(toStatus);
}

/**
 * Who performed a transition, derived from the status change rather than the `action` enum (that enum
 * only lists State + PMU actions, and FC Unspent's history has no `action` at all).
 * `UNDER_REVIEW_BY_MOHUA` is a PMU approval only when it came from `UNDER_REVIEW_BY_PMU`; otherwise it is
 * a State submission straight to MoHUA (pre-PMU data).
 */
export function deriveActorRole(fromStatus: number | undefined, toStatus: number): StateFormHistoryActorRole {
  switch (toStatus) {
    case FORM_STATUS.RETURNED_BY_PMU:
      return 'PMU';
    case FORM_STATUS.RETURNED_BY_MOHUA:
    case FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA:
      return 'MoHUA';
    case FORM_STATUS.UNDER_REVIEW_BY_MOHUA:
      return fromStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU ? 'PMU' : 'State';
    default:
      return 'State';
  }
}
