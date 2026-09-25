import mongoose, { Types } from 'mongoose';
import { ClaimLetterUlbLock, ClaimLetterUlbLockSchema } from './claim-letter-ulb-lock.schema';

function buildValidDoc(overrides: Record<string, unknown> = {}) {
  const ClaimLetterUlbLockModel =
    (mongoose.models['__TestClaimLetterUlbLock'] as mongoose.Model<ClaimLetterUlbLock> | undefined) ??
    mongoose.model<ClaimLetterUlbLock>('__TestClaimLetterUlbLock', ClaimLetterUlbLockSchema);

  return new ClaimLetterUlbLockModel({
    state: new Types.ObjectId(),
    year: new Types.ObjectId(),
    installment: 1,
    ulbId: new Types.ObjectId(),
    claimLetter: new Types.ObjectId(),
    buildRequestId: 'build-1',
    ...overrides,
  });
}

describe('ClaimLetterUlbLockSchema', () => {
  it('validates with all required fields set', () => {
    expect(buildValidDoc().validateSync()).toBeUndefined();
  });

  it('defaults lockState to ACTIVE', () => {
    expect(buildValidDoc().lockState).toBe('ACTIVE');
  });

  it('restricts lockState to ACTIVE | ACKNOWLEDGED', () => {
    const path = ClaimLetterUlbLockSchema.path('lockState') as unknown as { enumValues: string[] };
    expect(path.enumValues).toEqual(['ACTIVE', 'ACKNOWLEDGED']);
  });

  it('requires buildRequestId', () => {
    expect(ClaimLetterUlbLockSchema.path('buildRequestId').isRequired).toBe(true);
  });

  it('has no TTL (expireAfterSeconds) on any index — an active draft may stay open indefinitely', () => {
    const indexes = ClaimLetterUlbLockSchema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;
    for (const [, opts] of indexes) {
      expect((opts as { expireAfterSeconds?: number }).expireAfterSeconds).toBeUndefined();
    }
  });
});

describe('ClaimLetterUlbLockSchema indexes', () => {
  type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

  it('enforces the actual concurrency gate: one lock per State/year/installment/ULB', () => {
    const indexes = ClaimLetterUlbLockSchema.indexes() as IndexEntry[];
    const target = indexes.find(
      ([fields]) =>
        fields['state'] === 1 && fields['year'] === 1 && fields['installment'] === 1 && fields['ulbId'] === 1,
    );
    expect(target).toBeDefined();
    expect(target![1]).toMatchObject({ unique: true });
  });

  it('defines a claimLetter-scoped index for ownership-checked release', () => {
    const indexes = ClaimLetterUlbLockSchema.indexes() as IndexEntry[];
    expect(indexes.some(([fields]) => Object.keys(fields).length === 1 && fields['claimLetter'] === 1)).toBe(true);
  });

  it('defines a buildRequestId index for stale-build recovery', () => {
    const indexes = ClaimLetterUlbLockSchema.indexes() as IndexEntry[];
    expect(indexes.some(([fields]) => Object.keys(fields).length === 1 && fields['buildRequestId'] === 1)).toBe(true);
  });
});
