import { getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import type { ClaimLetterBatchSummary, ClaimLetterFinancialSummaryDisplay } from '../types/claim-letter.types';

/**
 * Shared mapper from a raw `ClaimLetterBatch` lean/full document to the display-ready
 * `ClaimLetterBatchSummary` shape — reused by every endpoint that returns a claim letter
 * (`ClaimLetterService.getDetail/listHistory/uploadSignedFile/submit` and
 * `ClaimLetterAssemblyService.createDraft/updateDraft/abandonDraft`) so a client can treat all of
 * them uniformly instead of some returning a raw Mongoose document and others a mapped summary.
 */
export function mapClaimLetterBatchDocToSummary(doc: Record<string, unknown>): ClaimLetterBatchSummary {
  const currentFormStatus = doc['currentFormStatus'] as number;
  const isAbandoned = doc['isAbandoned'] as boolean;
  return {
    claimLetterId: String(doc['_id']),
    installment: doc['installment'] as 1 | 2,
    batchNumber: doc['batchNumber'] as 1 | 2 | 3,
    version: doc['version'] as number,
    currentFormStatus,
    // Abandonment never transitions `currentFormStatus` itself (it's an orthogonal "this draft is
    // dead" flag, not a workflow state) — override the label here so it doesn't read as still-active.
    currentFormStatusLabel: isAbandoned ? 'Abandoned' : getFormStatusLabel(currentFormStatus),
    assemblyStatus: doc['assemblyStatus'] as 'BUILDING' | 'READY',
    ulbCount: doc['ulbCount'] as number,
    isAbandoned,
    hasSignedFile: !!doc['signedClaimFile'],
    // Already Crore-denominated in storage — a direct passthrough, no unit conversion needed.
    financialSummary: doc['financialSummary'] as ClaimLetterFinancialSummaryDisplay,
    revision: doc['revision'] as number,
    submittedAt: (doc['submittedAt'] as Date | null) ?? null,
    resolvedAt: (doc['resolvedAt'] as Date | null) ?? null,
    supersedes: toObjectIdString(doc['supersedes']),
    supersededBy: toObjectIdString(doc['supersededBy']),
    createdAt: doc['createdAt'] as Date,
  };
}
