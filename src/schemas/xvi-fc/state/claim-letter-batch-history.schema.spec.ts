import mongoose, { Types } from 'mongoose';
import { ClaimLetterBatchHistory, ClaimLetterBatchHistorySchema } from './claim-letter-batch-history.schema';

function buildValidDoc(overrides: Record<string, unknown> = {}) {
  const ClaimLetterBatchHistoryModel =
    (mongoose.models['__TestClaimLetterBatchHistory'] as mongoose.Model<ClaimLetterBatchHistory> | undefined) ??
    mongoose.model<ClaimLetterBatchHistory>('__TestClaimLetterBatchHistory', ClaimLetterBatchHistorySchema);

  return new ClaimLetterBatchHistoryModel({
    claimLetter: new Types.ObjectId(),
    state: new Types.ObjectId(),
    year: new Types.ObjectId(),
    installment: 1,
    batchNumber: 1,
    version: 1,
    toStatus: 2,
    actionSource: 'DIRECT_STATE_REVIEW',
    changedBy: new Types.ObjectId(),
    requestId: 'req-1',
    ...overrides,
  });
}

describe('ClaimLetterBatchHistorySchema', () => {
  it('validates with fromStatus omitted (create-draft transition: null -> IN_PROGRESS)', () => {
    expect(buildValidDoc().validateSync()).toBeUndefined();
  });

  it('defaults fromStatus to null', () => {
    expect(buildValidDoc().fromStatus).toBe(null);
  });

  it('requires toStatus', () => {
    expect(ClaimLetterBatchHistorySchema.path('toStatus').isRequired).toBe(true);
  });

  it('requires requestId (idempotency key, brain §19.9)', () => {
    expect(ClaimLetterBatchHistorySchema.path('requestId').isRequired).toBe(true);
  });

  it('restricts actionSource to the brain §16.5 vocabulary', () => {
    const path = ClaimLetterBatchHistorySchema.path('actionSource') as unknown as { enumValues: string[] };
    expect(path.enumValues).toEqual([
      'DIRECT_STATE_REVIEW',
      'DIRECT_MOHUA_REVIEW',
      'CLAIM_LETTER_APPROVAL',
      'CLAIM_LETTER_REJECTION',
      'DEPENDENCY_INVALIDATION',
    ]);
  });

  it('defaults rejectedSourceRefs to an empty array', () => {
    expect(buildValidDoc().rejectedSourceRefs).toEqual([]);
  });

  it('rejects an unrecognized actionSource', () => {
    const error = buildValidDoc({ actionSource: 'SOMETHING_ELSE' }).validateSync();
    expect(error).toBeDefined();
  });
});

describe('ClaimLetterBatchHistorySchema indexes', () => {
  type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

  it('defines the per-claim history index', () => {
    const indexes = ClaimLetterBatchHistorySchema.indexes() as IndexEntry[];
    expect(indexes.some(([fields]) => fields['claimLetter'] === 1 && fields['changedAt'] === -1)).toBe(true);
  });

  it('defines the State/year/installment history index', () => {
    const indexes = ClaimLetterBatchHistorySchema.indexes() as IndexEntry[];
    expect(
      indexes.some(
        ([fields]) =>
          fields['state'] === 1 && fields['year'] === 1 && fields['installment'] === 1 && fields['changedAt'] === -1,
      ),
    ).toBe(true);
  });
});
