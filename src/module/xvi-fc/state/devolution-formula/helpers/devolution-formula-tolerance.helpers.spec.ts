import { FLOAT_EQUALITY_EPSILON, amountsAreEqual, snapToWholeRupee } from './devolution-formula-tolerance.helpers';

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

  describe('snapToWholeRupee', () => {
    it('leaves an exact integer unchanged', () => {
      expect(snapToWholeRupee(63_579_870)).toBe(63_579_870);
      expect(snapToWholeRupee(0)).toBe(0);
    });

    it('snaps realistic IEEE-754 formula noise to the nearest whole Rupee', () => {
      // The exact failure mode reported: a 50/50 installment split of 63,579,870 lands on a value
      // a few billionths of a Rupee off in the cell's raw stored value, even though Excel displays
      // 63579870. Expressed as arithmetic (not a high-precision literal) to avoid silently losing
      // precision at parse time.
      expect(snapToWholeRupee(63_579_870 - 4e-9)).toBe(63_579_870);
      expect(snapToWholeRupee(44_357_670.00000001)).toBe(44_357_670);
      expect(snapToWholeRupee(0.1 + 0.2 + 88_715_339.7)).toBe(88_715_340); // classic 0.1+0.2 noise, at scale
    });

    it('snaps just inside the epsilon boundary but leaves just-outside untouched', () => {
      expect(snapToWholeRupee(63_579_869.9995)).toBe(63_579_870); // diff 0.0005 < 0.001 epsilon
      expect(snapToWholeRupee(63_579_869.998)).toBe(63_579_869.998); // diff 0.002, outside epsilon
    });

    it('does not touch a genuine fractional Rupee amount — only float noise is absorbed', () => {
      expect(snapToWholeRupee(63_579_869.5)).toBe(63_579_869.5);
      // The exact value from devolution-formula-excel.service.spec.ts's fractional-rejection test —
      // must stay untouched here too so the two specs agree on what counts as "genuinely fractional".
      expect(snapToWholeRupee(141_792_452.83)).toBe(141_792_452.83);
    });

    it('passes non-numeric, NaN, and non-finite input through unchanged', () => {
      expect(snapToWholeRupee('')).toBe('');
      expect(snapToWholeRupee('63579870')).toBe('63579870');
      expect(snapToWholeRupee(undefined)).toBe(undefined);
      expect(snapToWholeRupee(null)).toBe(null);
      expect(snapToWholeRupee(NaN)).toBe(NaN);
      expect(snapToWholeRupee(Infinity)).toBe(Infinity);
    });
  });
});
