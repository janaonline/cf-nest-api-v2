import {
  amountsAreEqual,
  buildClaimLetterFileBaseName,
  computeDifferenceAmount,
  computeDifferencePercentageBasisPoints,
  isClaimedAmountWithinVariance,
  sumAmountsExactly,
} from './claim-letter-financial.helpers';

describe('isClaimedAmountWithinVariance', () => {
  const allocated = 100;

  it('passes at exactly the 90% lower boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 90)).toBe(true);
  });

  it('passes at exactly the 110% upper boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 110)).toBe(true);
  });

  it('fails just below the 90% lower boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 89.999999999)).toBe(false);
  });

  it('fails just above the 110% upper boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 110.000000001)).toBe(false);
  });

  it('passes for an exact match', () => {
    expect(isClaimedAmountWithinVariance(allocated, allocated)).toBe(true);
  });

  it('never trips on ordinary float imprecision at a realistic Crore boundary', () => {
    // 90% of 13.948 is 12.5532 — a value ordinary IEEE-754 multiplication can misrepresent by a
    // fraction of a paisa; the exact-integer scaling must still classify this as the boundary.
    expect(isClaimedAmountWithinVariance(13.948, 12.5532)).toBe(true);
  });
});

describe('computeDifferenceAmount', () => {
  it('is positive when claimed exceeds allocated', () => {
    expect(computeDifferenceAmount(100, 105)).toBe(5);
  });

  it('is negative when claimed is under allocated', () => {
    expect(computeDifferenceAmount(100, 95)).toBe(-5);
  });

  it('stays exact for typical decimal Crore inputs', () => {
    expect(computeDifferenceAmount(13.948, 14.2)).toBeCloseTo(0.252, 9);
  });
});

describe('computeDifferencePercentageBasisPoints', () => {
  it('computes 500 basis points (5%) for a 5% over-claim', () => {
    expect(computeDifferencePercentageBasisPoints(100, 105)).toBe(500);
  });

  it('computes -1000 basis points (-10%) for a 10% under-claim', () => {
    expect(computeDifferencePercentageBasisPoints(100, 90)).toBe(-1000);
  });

  it('returns 0 rather than dividing by zero when allocated is 0', () => {
    expect(computeDifferencePercentageBasisPoints(0, 1)).toBe(0);
  });
});

describe('sumAmountsExactly', () => {
  it('sums a list of Crore amounts', () => {
    expect(sumAmountsExactly([1, 2, 3])).toBe(6);
  });

  it('returns 0 for an empty list', () => {
    expect(sumAmountsExactly([])).toBe(0);
  });

  it('avoids float drift across many decimal additions', () => {
    const amounts = Array.from({ length: 10 }, () => 0.1);
    // Plain JS `+=` summation of ten 0.1s does not equal 1 exactly (0.9999999999999999).
    expect(amounts.reduce((s, a) => s + a, 0)).not.toBe(1);
    expect(sumAmountsExactly(amounts)).toBe(1);
  });

  it('handles negative amounts (subtraction via negation)', () => {
    expect(sumAmountsExactly([100, -20, -28])).toBe(52);
  });
});

describe('amountsAreEqual', () => {
  it('is true for identical values', () => {
    expect(amountsAreEqual(13.948, 13.948)).toBe(true);
  });

  it('is true for values equal only up to ordinary float noise', () => {
    expect(amountsAreEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('is false for genuinely different values', () => {
    expect(amountsAreEqual(13.948, 13.949)).toBe(false);
  });
});

describe('buildClaimLetterFileBaseName', () => {
  it('formats as CF_<statecode>_<designyear>_<installment>', () => {
    expect(buildClaimLetterFileBaseName('KA', '2026-27', 1)).toBe('CF_KA_2026-27_1');
  });
});
