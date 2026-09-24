import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { throwXviFcValidationError } from '../response/xvi-fc-response.util';

/** True for a MongoDB duplicate-key error (E11000) - the write raced a concurrent create. */
export function isMongoDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export function throwXviFcConflictError(
  message = 'This form was updated elsewhere. Please reload and try again.',
): never {
  throwXviFcValidationError({ _form: [{ message, code: 'conflict' }] });
}

/**
 * Called after a status-guarded write matched no document (the status changed since it was
 * read). Re-fetches the current status and re-runs `assertFn` so the caller gets the accurate
 * status error when possible; falls back to a generic conflict when the fresh status still
 * passes `assertFn` (e.g. it moved between two editable statuses).
 */
export async function assertFreshFormStatus(
  fetchCurrentStatus: () => Promise<number | undefined>,
  assertFn: (status: number) => void,
): Promise<never> {
  const status = (await fetchCurrentStatus()) ?? FORM_STATUS.NOT_STARTED;
  assertFn(status);
  throwXviFcConflictError();
}
