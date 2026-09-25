import mongoose, { Types } from 'mongoose';
import { ClaimLetterBatchUlb, ClaimLetterBatchUlbSchema } from './claim-letter-batch-ulb.schema';

function buildValidDoc(overrides: Record<string, unknown> = {}) {
  const ClaimLetterBatchUlbModel =
    (mongoose.models['__TestClaimLetterBatchUlb'] as mongoose.Model<ClaimLetterBatchUlb> | undefined) ??
    mongoose.model<ClaimLetterBatchUlb>('__TestClaimLetterBatchUlb', ClaimLetterBatchUlbSchema);

  return new ClaimLetterBatchUlbModel({
    claimLetter: new Types.ObjectId(),
    state: new Types.ObjectId(),
    year: new Types.ObjectId(),
    installment: 1,
    batchNumber: 1,
    version: 1,
    ulbId: new Types.ObjectId(),
    ulbSnapshot: { name: 'Test ULB', censusCode: '123456', sbCode: null },
    allocatedAmount: 1,
    claimedAmount: 1,
    differenceAmount: 0,
    differencePercentageBasisPoints: 0,
    devolutionSource: {
      formDocumentId: new Types.ObjectId(),
      rowDocumentId: new Types.ObjectId(),
      datasetVersion: 1,
      installment: 1,
      allocatedAmount: 1,
    },
    createdBy: new Types.ObjectId(),
    updatedBy: new Types.ObjectId(),
    ...overrides,
  });
}

describe('ClaimLetterBatchUlbSchema — a minimal valid document passes validation', () => {
  it('validates with all required fields set, including nested subdocuments', () => {
    expect(buildValidDoc().validateSync()).toBeUndefined();
  });

  it('defaults eligibilitySources and appliedExemptionIds to empty arrays', () => {
    const doc = buildValidDoc();
    expect(doc.eligibilitySources).toEqual([]);
    expect(doc.appliedExemptionIds).toEqual([]);
  });

  it('defaults revision to 0', () => {
    expect(buildValidDoc().revision).toBe(0);
  });

  it('fails without a ulbSnapshot', () => {
    const doc = buildValidDoc({ ulbSnapshot: undefined });
    expect(doc.validateSync()).toBeDefined();
  });

  it('fails without a devolutionSource', () => {
    const doc = buildValidDoc({ devolutionSource: undefined });
    expect(doc.validateSync()).toBeDefined();
  });

  it('fails when devolutionSource is missing its required allocatedAmount', () => {
    const doc = buildValidDoc({
      devolutionSource: {
        formDocumentId: new Types.ObjectId(),
        rowDocumentId: new Types.ObjectId(),
        datasetVersion: 1,
        installment: 1,
      },
    });
    expect(doc.validateSync()).toBeDefined();
  });
});

describe('ClaimLetterBatchUlbSchema — immutable identity fields', () => {
  it.each(['claimLetter', 'state', 'year', 'installment', 'batchNumber', 'version'])(
    '%s is marked immutable',
    (field) => {
      const path = ClaimLetterBatchUlbSchema.path(field) as unknown as { options: { immutable?: boolean } };
      expect(path.options.immutable).toBe(true);
    },
  );
});

describe('ClaimLetterBatchUlbSchema indexes', () => {
  type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

  it('enforces one ULB per claim version', () => {
    const indexes = ClaimLetterBatchUlbSchema.indexes() as IndexEntry[];
    const target = indexes.find(([fields]) => fields['claimLetter'] === 1 && fields['ulbId'] === 1);
    expect(target).toBeDefined();
    expect(target![1]).toMatchObject({ unique: true });
  });

  it('defines the single-ULB dashboard lookup index', () => {
    const indexes = ClaimLetterBatchUlbSchema.indexes() as IndexEntry[];
    const target = indexes.find(
      ([fields]) =>
        fields['ulbId'] === 1 && fields['year'] === 1 && fields['installment'] === 1 && fields['createdAt'] === -1,
    );
    expect(target).toBeDefined();
  });

  it('defines the paginated claim-review index sorted by ULB name', () => {
    const indexes = ClaimLetterBatchUlbSchema.indexes() as IndexEntry[];
    const target = indexes.find(([fields]) => fields['claimLetter'] === 1 && fields['ulbSnapshot.name'] === 1);
    expect(target).toBeDefined();
  });
});
