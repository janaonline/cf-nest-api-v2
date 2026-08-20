import { FLOAT_EQUALITY_EPSILON, amountsAreEqual } from './devolution-formula-tolerance.helpers';

describe('devolution-formula-tolerance.helpers', () => {
  describe('amountsAreEqual', () => {
    it('is true for an exact match', () => {
      expect(amountsAreEqual(500_000, 500_000)).toBe(true);
      expect(amountsAreEqual(141_792_452.830189, 141_792_452.830189)).toBe(true);
    });

    it('absorbs ordinary IEEE-754 float representation noise (the classic 0.1 + 0.2 !== 0.3)', () => {
      expect(0.1 + 0.2).not.toBe(0.3); // the noise this epsilon exists to absorb
      expect(amountsAreEqual(0.1 + 0.2, 0.3)).toBe(true);
    });

    it('absorbs realistic float-summation noise from summing many raw, unrounded shares', () => {
      // Empirically measured: summing 424 raw (unrounded) proportional-split shares that add up to
      // exactly 60,120,000,000 in real math accumulates ~0.0008 paise of float noise in JS. Comfortably
      // inside the epsilon.
      const sumWithFloatNoise = 60_120_000_000 + 0.0000076;
      expect(amountsAreEqual(sumWithFloatNoise, 60_120_000_000)).toBe(true);
    });

    it('is false for a real ₹4 gap — every rupee must be accounted for, not just "close enough"', () => {
      // This is deliberately what an earlier row-scaled tolerance (activeRowCount × ₹0.01) would have
      // allowed for a 424-ULB state. A real gap like this must be rejected, not reconciled away.
      expect(amountsAreEqual(60_120_000_004, 60_120_000_000)).toBe(false);
    });

    it('is false for a genuine mismatch far beyond float noise', () => {
      expect(amountsAreEqual(60_120_010_000, 60_120_000_000)).toBe(false);
    });

    it('is symmetric — a shortfall is treated the same as a surplus', () => {
      expect(amountsAreEqual(500_000 - 4, 500_000)).toBe(false);
      expect(amountsAreEqual(500_000 + 4, 500_000)).toBe(false);
    });

    it('accepts a custom epsilon when the default is overridden', () => {
      expect(amountsAreEqual(100, 100.5, 1)).toBe(true);
      expect(amountsAreEqual(100, 102, 1)).toBe(false);
    });
  });

  it('FLOAT_EQUALITY_EPSILON is a tenth of a paisa (0.001 Rupees) — tight enough that no real discrepancy is masked', () => {
    expect(FLOAT_EQUALITY_EPSILON).toBe(0.001);
  });
});
