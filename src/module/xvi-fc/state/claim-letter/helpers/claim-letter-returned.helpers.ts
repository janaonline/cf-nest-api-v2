import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

/**
 * A claim letter sent back for correction: by the SO (16) or, once that step exists, by MoHUA (6).
 *
 * A returned letter is also flagged `isAbandoned` (that frees its batch slot and ULB locks), but it is not a
 * discarded draft: MoHUA still lists it, the State sees it by its status, and its amount and ULBs are not
 * "claimed". Ask this helper rather than re-deriving it from `isAbandoned` in each reader.
 */
export const RETURNED_CLAIM_LETTER_STATUSES: readonly number[] = [
  FORM_STATUS.RETURNED_BY_SO,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

export function isReturnedClaimLetter(currentFormStatus: number | null | undefined): boolean {
  return currentFormStatus != null && RETURNED_CLAIM_LETTER_STATUSES.includes(currentFormStatus);
}

/** A State form the SO returned with another letter (ADR 0009): stored on that State's other letters. */
export interface ClaimLetterStateFormReturnInfo {
  /** "Claim Letter 2" or "Claim Letter 2-R1": the letter the SO returned. */
  letterName: string;
  formNames: readonly string[];
  /** Drafts only: their uploaded signed letter was removed. */
  signedFileRemoved?: boolean;
}

/** The name the State's screens and messages use for a letter. */
export function claimLetterName(batchNumber: number, resubmissionNumber: number): string {
  return `Claim Letter ${batchNumber}${resubmissionNumber > 0 ? `-R${resubmissionNumber}` : ''}`;
}

/** "SFC Status", "SFC Status and GTC", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const wasOrWere = (names: readonly string[]) => (names.length > 1 ? 'were' : 'was');
const itOrThey = (names: readonly string[]) => (names.length > 1 ? 'they are' : 'it is');

/** A letter under SO review that came back because another letter's State form was returned. */
export function returnedWithMessage(info: ClaimLetterStateFormReturnInfo): string {
  const forms = joinNames(info.formNames);
  return (
    `Returned because ${forms} ${wasOrWere(info.formNames)} returned for correction with ${info.letterName}. ` +
    `Its ULBs are free again: once ${itOrThey(info.formNames)} corrected and verified, add them to a new claim letter.`
  );
}

/** A draft's banner after another letter's State form return. */
export function draftStateFormReturnMessage(info: ClaimLetterStateFormReturnInfo): string {
  const forms = joinNames(info.formNames);
  const returned = `${forms} ${wasOrWere(info.formNames)} returned for correction by MoHUA with ${info.letterName}`;
  return info.signedFileRemoved
    ? `Your signed letter was removed because ${returned}. Once ${itOrThey(info.formNames)} corrected and verified, ` +
        'download this letter again, get it signed by the concerned authority and upload it.'
    : `${returned}. You can download, sign and submit this letter once ${itOrThey(info.formNames)} corrected and ` +
        'verified.';
}

/** Download, signed upload and submit are refused while the State-level conditions fail. */
export function stateConditionsBlockMessage(failingForms: readonly string[]): string {
  const single = failingForms.length === 1;
  const forms = failingForms.length ? joinNames(failingForms) : 'The State-level conditions';
  return (
    `${forms} ${single ? 'is' : 'are'} not verified yet. This claim letter can be downloaded, signed and submitted ` +
    `once ${single ? 'it is' : 'they are'} verified.`
  );
}

/** The State forms a failed gate names, as the checklist does. */
export function failingStateFormNames(sources: readonly EligibilityEvaluationResult[]): string[] {
  return sources.filter((s) => s.result === 'FAILED').map((s) => s.displayLabel ?? s.formType);
}
