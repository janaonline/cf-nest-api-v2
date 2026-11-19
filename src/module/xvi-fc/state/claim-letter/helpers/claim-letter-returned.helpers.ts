import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/**
 * A claim letter sent back for correction: by the SO (16) or, once that step exists, by MoHUA (6).
 *
 * A returned letter is also flagged `isAbandoned` (that frees its batch slot and ULB locks), but it is not a
 * discarded draft: MoHUA still lists it, the State sees it by its status, and its amount and ULBs are not
 * "claimed". Ask this helper rather than re-deriving it from `isAbandoned` in each reader.
 */
export const RETURNED_CLAIM_LETTER_STATUSES: readonly number[] = [FORM_STATUS.RETURNED_BY_SO, FORM_STATUS.RETURNED_BY_MOHUA];

export function isReturnedClaimLetter(currentFormStatus: number | null | undefined): boolean {
  return currentFormStatus != null && RETURNED_CLAIM_LETTER_STATUSES.includes(currentFormStatus);
}
