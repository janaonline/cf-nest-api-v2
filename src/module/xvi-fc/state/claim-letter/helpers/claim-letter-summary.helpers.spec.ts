import { Types } from 'mongoose';
import { mapClaimLetterBatchDocToSummary } from './claim-letter-summary.helpers';

const zeroFinancialSummary = {
  totalInstallmentAllocation: 0,
  totalAlreadyAcknowledged: 0,
  totalClaimInProgress: 0,
  totalClaimInDraft: 0,
  availableToClaim: 0,
  selectedAllocation: 0,
  currentSelectedClaim: 0,
  remainingIfAcknowledged: 0,
};

function batchDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: new Types.ObjectId(),
    installment: 1,
    batchNumber: 1,
    version: 1,
    currentFormStatus: 2, // IN_PROGRESS
    assemblyStatus: 'READY',
    ulbCount: 1,
    isAbandoned: false,
    financialSummary: zeroFinancialSummary,
    revision: 0,
    submittedAt: null,
    resolvedAt: null,
    supersedes: null,
    supersededBy: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('mapClaimLetterBatchDocToSummary', () => {
  it('labels an active draft from its raw currentFormStatus', () => {
    const summary = mapClaimLetterBatchDocToSummary(batchDoc({ currentFormStatus: 2, isAbandoned: false }));
    expect(summary.currentFormStatusLabel).toBe('In Progress');
  });

  it('labels an abandoned draft "Abandoned" even though currentFormStatus is still IN_PROGRESS', () => {
    const summary = mapClaimLetterBatchDocToSummary(batchDoc({ currentFormStatus: 2, isAbandoned: true }));
    expect(summary.currentFormStatusLabel).toBe('Abandoned');
    expect(summary.currentFormStatus).toBe(2);
  });

  it('labels an abandoned draft "Abandoned" regardless of which currentFormStatus it was abandoned from', () => {
    const summary = mapClaimLetterBatchDocToSummary(batchDoc({ currentFormStatus: 5, isAbandoned: true }));
    expect(summary.currentFormStatusLabel).toBe('Abandoned');
  });

  it('defaults totalClaimInProgress/totalClaimInDraft/availableToClaim to 0 for a pre-existing document that predates these fields', () => {
    const legacyFinancialSummary = {
      totalInstallmentAllocation: 100,
      totalAlreadyAcknowledged: 20,
      selectedAllocation: 10,
      currentSelectedClaim: 10,
      remainingIfAcknowledged: 70,
      // totalClaimInProgress/totalClaimInDraft/availableToClaim intentionally absent, as a `.lean()`
      // read of a document saved before these fields were added would return it.
    };
    const summary = mapClaimLetterBatchDocToSummary(batchDoc({ financialSummary: legacyFinancialSummary }));

    expect(summary.financialSummary.totalClaimInProgress).toBe(0);
    expect(summary.financialSummary.totalClaimInDraft).toBe(0);
    expect(summary.financialSummary.availableToClaim).toBe(0);
    expect(summary.financialSummary.totalInstallmentAllocation).toBe(100);
  });
});
