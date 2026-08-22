import {
  amountsAreEqual,
  buildClaimLetterFileBaseName,
  buildClaimLetterRefNo,
  computeDifferenceAmount,
  computeDifferencePercentageBasisPoints,
  isClaimedAmountWithinVariance,
  sumAmountsExactly,
} from './claim-letter-financial.helpers';

describe('isClaimedAmountWithinVariance', () => {
  const allocated = 100_000; // a whole-Rupee allocatedAmount
  const lowerPercent = 90;
  const upperPercent = 110;

  it('passes at exactly the 90% lower boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 90_000, lowerPercent, upperPercent)).toBe(true);
  });

  it('passes at exactly the 110% upper boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 110_000, lowerPercent, upperPercent)).toBe(true);
  });

  it('fails just below the 90% lower boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 89_999, lowerPercent, upperPercent)).toBe(false);
  });

  it('fails just above the 110% upper boundary', () => {
    expect(isClaimedAmountWithinVariance(allocated, 110_001, lowerPercent, upperPercent)).toBe(false);
  });

  it('passes for an exact match', () => {
    expect(isClaimedAmountWithinVariance(allocated, allocated, lowerPercent, upperPercent)).toBe(true);
  });

  it('never introduces a float division even when the true boundary is not a whole number', () => {
    // 90% of 141,792,453 is 127,613,207.7 — not a whole number, even though both inputs are.
    const oddAllocated = 141_792_453;
    expect(isClaimedAmountWithinVariance(oddAllocated, 127_613_208, 90, 110)).toBe(true); // just at/above 90%
    expect(isClaimedAmountWithinVariance(oddAllocated, 127_613_207, 90, 110)).toBe(false); // just below 90%
  });

  it('respects a configured non-default variance band', () => {
    expect(isClaimedAmountWithinVariance(100, 100, 100, 100)).toBe(true);
    expect(isClaimedAmountWithinVariance(100, 99, 100, 100)).toBe(false);
    expect(isClaimedAmountWithinVariance(100, 101, 100, 100)).toBe(false);
  });
});

describe('computeDifferenceAmount', () => {
  it('is positive when claimed exceeds allocated', () => {
    expect(computeDifferenceAmount(100, 105)).toBe(5);
  });

  it('is negative when claimed is under allocated', () => {
    expect(computeDifferenceAmount(100, 95)).toBe(-5);
  });

  it('stays exact for large whole-Rupee inputs', () => {
    expect(computeDifferenceAmount(139_480_000_013, 142_000_000_038)).toBe(2_520_000_025);
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
  it('sums a list of whole-Rupee amounts', () => {
    expect(sumAmountsExactly([1, 2, 3])).toBe(6);
  });

  it('returns 0 for an empty list', () => {
    expect(sumAmountsExactly([])).toBe(0);
  });

  it('handles negative amounts (subtraction via negation)', () => {
    expect(sumAmountsExactly([100, -20, -28])).toBe(52);
  });

  it('sums a large number of whole-Rupee proportional-split rows without any drift (Maharashtra-style)', () => {
    const perRowShare = 141_792_453;
    const amounts = Array.from({ length: 1000 }, () => perRowShare);
    expect(sumAmountsExactly(amounts)).toBe(perRowShare * 1000);
  });
});

describe('amountsAreEqual', () => {
  it('is true for identical whole-Rupee values', () => {
    expect(amountsAreEqual(139_480_000_25, 139_480_000_25)).toBe(true);
  });

  it('is exact — even a difference of one Rupee is not treated as equal', () => {
    expect(amountsAreEqual(100_000, 100_001)).toBe(false);
  });

  it('is false for genuinely different values', () => {
    expect(amountsAreEqual(139_480_002_5, 139_490_002_5)).toBe(false);
  });
});

describe('buildClaimLetterFileBaseName', () => {
  it('formats as CF_<statecode>_<designyear>_<installment>', () => {
    expect(buildClaimLetterFileBaseName('KA', '2026-27', 1)).toBe('CF_KA_2026-27_1');
  });
});

describe('buildClaimLetterRefNo', () => {
  it('formats as CL/<statecode>/<designyear>/<installment>-<batchnumber>', () => {
    expect(buildClaimLetterRefNo({ stateCode: 'AP', designYearLabel: '2026-27', installment: 1, batchNumber: 1 })).toBe(
      'CL/AP/2026-27/1-1',
    );
  });

  it('is deterministic for the same inputs', () => {
    const params = { stateCode: 'KA', designYearLabel: '2028-29', installment: 2 as const, batchNumber: 3 };
    expect(buildClaimLetterRefNo(params)).toBe(buildClaimLetterRefNo(params));
  });
});
