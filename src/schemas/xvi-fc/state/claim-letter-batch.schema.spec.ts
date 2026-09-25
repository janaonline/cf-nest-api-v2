import mongoose, { Types } from 'mongoose';
import { ClaimLetterBatch, ClaimLetterBatchSchema } from './claim-letter-batch.schema';

function buildValidDoc(overrides: Record<string, unknown> = {}) {
  const ClaimLetterBatchModel =
    (mongoose.models['__TestClaimLetterBatch'] as mongoose.Model<ClaimLetterBatch> | undefined) ??
    mongoose.model<ClaimLetterBatch>('__TestClaimLetterBatch', ClaimLetterBatchSchema);

  return new ClaimLetterBatchModel({
    state: new Types.ObjectId(),
    year: new Types.ObjectId(),
    installment: 1,
    batchNumber: 1,
    version: 1,
    buildRequestId: 'build-1',
    fileBaseName: 'CF_KA_2026-27_1',
    createdBy: new Types.ObjectId(),
    updatedBy: new Types.ObjectId(),
    ...overrides,
  });
}

describe('ClaimLetterBatchSchema — defaults', () => {
  it('defaults assemblyStatus to BUILDING', () => {
    const path = ClaimLetterBatchSchema.path('assemblyStatus') as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBe('BUILDING');
  });

  it('defaults currentFormStatus to IN_PROGRESS (2)', () => {
    const path = ClaimLetterBatchSchema.path('currentFormStatus') as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBe(2);
  });

  it('defaults isAbandoned to false and abandonedAt/abandonedBy to null', () => {
    expect((ClaimLetterBatchSchema.path('isAbandoned') as unknown as { defaultValue: unknown }).defaultValue).toBe(
      false,
    );
    expect((ClaimLetterBatchSchema.path('abandonedAt') as unknown as { defaultValue: unknown }).defaultValue).toBe(
      null,
    );
    expect((ClaimLetterBatchSchema.path('abandonedBy') as unknown as { defaultValue: unknown }).defaultValue).toBe(
      null,
    );
  });

  it('defaults generatedClaimFile and signedClaimFile to null', () => {
    expect(
      (ClaimLetterBatchSchema.path('generatedClaimFile') as unknown as { defaultValue: unknown }).defaultValue,
    ).toBe(null);
    expect((ClaimLetterBatchSchema.path('signedClaimFile') as unknown as { defaultValue: unknown }).defaultValue).toBe(
      null,
    );
  });

  it('defaults revision to 0', () => {
    expect((ClaimLetterBatchSchema.path('revision') as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  it('restricts installment to [1, 2] and batchNumber to [1, 2, 3]', () => {
    // Number-typed enum paths expose their allowed values via options.enum, not the
    // .enumValues getter (that getter only exists on String-typed schema paths).
    const installmentPath = ClaimLetterBatchSchema.path('installment') as unknown as {
      options: { enum: number[] };
    };
    const batchNumberPath = ClaimLetterBatchSchema.path('batchNumber') as unknown as {
      options: { enum: number[] };
    };
    expect(installmentPath.options.enum).toEqual([1, 2]);
    expect(batchNumberPath.options.enum).toEqual([1, 2, 3]);
  });

  it('requires buildRequestId', () => {
    expect(ClaimLetterBatchSchema.path('buildRequestId').isRequired).toBe(true);
  });
});

describe('ClaimLetterBatchSchema — a minimal valid document passes validation', () => {
  it('validates with only the required fields set', () => {
    expect(buildValidDoc().validateSync()).toBeUndefined();
  });

  it('applies financialSummary subdocument defaults (all zero)', () => {
    const doc = buildValidDoc();
    expect(doc.financialSummary.totalInstallmentAllocation).toBe(0);
    expect(doc.financialSummary.totalAlreadyAcknowledged).toBe(0);
    expect(doc.financialSummary.selectedAllocation).toBe(0);
    expect(doc.financialSummary.currentSelectedClaim).toBe(0);
    expect(doc.financialSummary.remainingIfAcknowledged).toBe(0);
  });

  it('rejects installment 3 (not a legal value)', () => {
    const error = buildValidDoc({ installment: 3 }).validateSync();
    expect(error).toBeDefined();
  });
});

describe('ClaimLetterBatchSchema indexes', () => {
  type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

  it('defines the unique-per-slot index, partial on non-abandoned drafts', () => {
    const indexes = ClaimLetterBatchSchema.indexes() as IndexEntry[];
    const target = indexes.find(
      ([fields]) =>
        fields['state'] === 1 &&
        fields['year'] === 1 &&
        fields['installment'] === 1 &&
        fields['batchNumber'] === 1 &&
        fields['version'] === 1,
    );

    expect(target).toBeDefined();
    const [, opts] = target!;
    expect(opts).toMatchObject({ unique: true });
    expect((opts as { partialFilterExpression?: Record<string, unknown> }).partialFilterExpression).toEqual({
      isAbandoned: false,
    });
  });

  it('defines a unique index on buildRequestId', () => {
    const indexes = ClaimLetterBatchSchema.indexes() as IndexEntry[];
    const target = indexes.find(([fields]) => fields['buildRequestId'] === 1);
    expect(target).toBeDefined();
    expect(target![1]).toMatchObject({ unique: true });
  });
});
