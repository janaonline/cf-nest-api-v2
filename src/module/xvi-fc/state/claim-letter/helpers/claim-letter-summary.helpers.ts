import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type {
  ClaimLetterBatchSummary,
  ClaimLetterFinalStage,
  ClaimLetterFinancialSummaryDisplay,
} from '../types/claim-letter.types';
import { buildClaimLetterPermissions } from './claim-letter-permissions.helpers';

/** The one batch-to-summary mapper, so every endpoint returns the same shape. Callers have already
 *  asserted state access. */
export function mapClaimLetterBatchDocToSummary(doc: Record<string, unknown>, user: AuthUser): ClaimLetterBatchSummary {
  const currentFormStatus = doc['currentFormStatus'] as number;
  const isAbandoned = doc['isAbandoned'] as boolean;
  return {
    claimLetterId: String(doc['_id']),
    installment: doc['installment'] as 1 | 2,
    batchNumber: doc['batchNumber'] as 1 | 2 | 3,
    version: doc['version'] as number,
    currentFormStatus,
    // Abandon is a flag and leaves currentFormStatus as is, so the label is overridden.
    currentFormStatusLabel: isAbandoned ? 'Abandoned' : getFormStatusLabel(currentFormStatus),
    assemblyStatus: doc['assemblyStatus'] as 'BUILDING' | 'READY',
    ulbCount: doc['ulbCount'] as number,
    isAbandoned,
    hasSignedFile: !!doc['signedClaimFile'],
    finalClaimLetterStage: resolveFinalClaimLetterStage(doc, currentFormStatus, isAbandoned),
    // .lean() skips schema defaults, so batches saved before these fields existed read undefined.
    financialSummary: {
      ...(doc['financialSummary'] as ClaimLetterFinancialSummaryDisplay),
      totalClaimInProgress: (doc['financialSummary'] as ClaimLetterFinancialSummaryDisplay)?.totalClaimInProgress ?? 0,
      totalClaimInDraft: (doc['financialSummary'] as ClaimLetterFinancialSummaryDisplay)?.totalClaimInDraft ?? 0,
      availableToClaim: (doc['financialSummary'] as ClaimLetterFinancialSummaryDisplay)?.availableToClaim ?? 0,
    },
    revision: doc['revision'] as number,
    submittedAt: (doc['submittedAt'] as Date | null) ?? null,
    resolvedAt: (doc['resolvedAt'] as Date | null) ?? null,
    supersedes: toObjectIdString(doc['supersedes']),
    supersededBy: toObjectIdString(doc['supersededBy']),
    createdAt: doc['createdAt'] as Date,
    permissions: buildClaimLetterPermissions(user, currentFormStatus, isAbandoned),
  };
}

/** Same rule as `ClaimLetterFinalPdfService`: a submitted batch keeps its copy; a draft merges once signed. */
function resolveFinalClaimLetterStage(
  doc: Record<string, unknown>,
  currentFormStatus: number,
  isAbandoned: boolean,
): ClaimLetterFinalStage | null {
  if (doc['submittedAt'] && currentFormStatus !== FORM_STATUS.IN_PROGRESS) {
    return doc['finalClaimPdf'] ? 'SUBMITTED' : null;
  }
  return currentFormStatus === FORM_STATUS.IN_PROGRESS && !isAbandoned && doc['signedClaimFile'] ? 'DRAFT' : null;
}
