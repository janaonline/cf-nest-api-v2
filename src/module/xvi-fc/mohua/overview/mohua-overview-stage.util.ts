import { getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import { STATE_DASHBOARD_NOT_STARTED_FORM_STATUSES } from 'src/module/xvi-fc/state/dashboard/state-dashboard.constants';
import {
  MOHUA_OVERVIEW_COMPLETED_FORM_STATUSES,
  MOHUA_OVERVIEW_STAGE,
  MOHUA_OVERVIEW_STATE_FORM_STATUS_LABEL,
} from './mohua-overview.constants';
import type { MohuaOverviewStage } from './mohua-overview.types';

/** A form counts as completed once it has been submitted onward (MoHUA / PMU review, or acknowledged). */
export function isFormCompleted(statusCode: number): boolean {
  return MOHUA_OVERVIEW_COMPLETED_FORM_STATUSES.has(statusCode);
}

/** Display label for a state-condition form: Not Started / In Progress / Under Review by MoHUA or PMU. */
export function getStateFormStatusLabel(statusCode: number): string {
  return MOHUA_OVERVIEW_STATE_FORM_STATUS_LABEL[statusCode] ?? getFormStatusLabel(statusCode);
}

/** A missing form document counts as NO_STATUS, so it is treated as not started. */
export function isFormNotStarted(statusCode: number): boolean {
  return STATE_DASHBOARD_NOT_STARTED_FORM_STATUSES.has(statusCode as FormStatusType);
}

/**
 * Derives a state's stage from its five condition forms:
 * all completed -> under review; all not started -> not started; anything else -> in progress.
 */
export function deriveStage(statusCodes: readonly number[]): MohuaOverviewStage {
  if (statusCodes.every(isFormCompleted)) return MOHUA_OVERVIEW_STAGE.UNDER_REVIEW;
  if (statusCodes.every(isFormNotStarted)) return MOHUA_OVERVIEW_STAGE.NOT_STARTED;
  return MOHUA_OVERVIEW_STAGE.IN_PROGRESS;
}
