import { getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { ClaimLetterBatchSummary, ClaimLetterFinancialSummaryDisplay } from '../types/claim-letter.types';
import { buildClaimLetterPermissions } from './claim-letter-permissions.helpers';

/**
 * Shared mapper from a raw `ClaimLetterBatch` lean/full document to the display-ready
 * `ClaimLetterBatchSummary` shape — reused by every endpoint that returns a claim letter
 * (`ClaimLetterService.getDetail/listHistory/uploadSignedFile/submit` and
 * `ClaimLetterAssemblyService.createDraft/updateDraft/abandonDraft`) so a client can treat all of
 * them uniformly instead of some returning a raw Mongoose document and others a mapped summary.
 *
 * `user` drives `permissions` (see `buildClaimLetterPermissions`) — every call site already calls
 * `assertStateAccess(user, stateId)` before reaching this, so state access itself is not
 * re-checked here.
 */
export function mapClaimLetterBatchDocToSummary(doc: Record<string, unknown>, user: AuthUser): ClaimLetterBatchSummary {
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
    // `totalClaimInProgress`/`totalClaimInDraft`/`availableToClaim` are defaulted defensively:
    // reads here go through `.lean()`, which skips Mongoose schema defaults, so a batch saved
    // before these fields existed would otherwise come back with them `undefined` (not `0`) until
    // it's next saved via createDraft/updateDraft.
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
