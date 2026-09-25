import { ClaimLetterContentHashInput, computeClaimLetterContentHash } from './claim-letter-content-hash.helpers';

const baseInput: ClaimLetterContentHashInput = {
  state: 'state-1',
  year: 'year-1',
  installment: 1,
  batchNumber: 1,
  version: 1,
  children: [
    { ulbId: 'ulb-a', allocatedAmount: 1, claimedAmount: 1 },
    { ulbId: 'ulb-b', allocatedAmount: 2, claimedAmount: 1.9 },
  ],
};

describe('computeClaimLetterContentHash', () => {
  it('is deterministic for the same logical content', () => {
    expect(computeClaimLetterContentHash(baseInput)).toBe(computeClaimLetterContentHash(baseInput));
  });

  it('produces the same hash regardless of child insertion/request order', () => {
    const reordered: ClaimLetterContentHashInput = { ...baseInput, children: [...baseInput.children].reverse() };
    expect(computeClaimLetterContentHash(reordered)).toBe(computeClaimLetterContentHash(baseInput));
  });

  it('changes when a single child amount differs by a small fraction', () => {
    const tweaked: ClaimLetterContentHashInput = {
      ...baseInput,
      children: [
        { ...baseInput.children[0], claimedAmount: baseInput.children[0].claimedAmount + 0.001 },
        baseInput.children[1],
      ],
    };
    expect(computeClaimLetterContentHash(tweaked)).not.toBe(computeClaimLetterContentHash(baseInput));
  });

  it('changes when the ULB set differs even with the same total', () => {
    const differentUlb: ClaimLetterContentHashInput = {
      ...baseInput,
      children: [{ ...baseInput.children[0], ulbId: 'ulb-c' }, baseInput.children[1]],
    };
    expect(computeClaimLetterContentHash(differentUlb)).not.toBe(computeClaimLetterContentHash(baseInput));
  });

  it('changes when parent identity fields differ (e.g. version)', () => {
    const nextVersion: ClaimLetterContentHashInput = { ...baseInput, version: 2 };
    expect(computeClaimLetterContentHash(nextVersion)).not.toBe(computeClaimLetterContentHash(baseInput));
  });

  it('is empty-children safe (no crash, still deterministic)', () => {
    const empty: ClaimLetterContentHashInput = { ...baseInput, children: [] };
    expect(computeClaimLetterContentHash(empty)).toBe(computeClaimLetterContentHash(empty));
  });

  it('produces a 64-character lowercase hex SHA-256 digest', () => {
    expect(computeClaimLetterContentHash(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});
