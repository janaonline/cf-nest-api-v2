import {
  fromMetricKey,
  PTAX_METRIC_ORDER_PAIRS,
  toMetricKey,
  validatePtaxMetricOrder,
  validatePtaxMetricValue,
} from './ptax.constants';

describe('ptax.constants', () => {
  // ─── toMetricKey / fromMetricKey ────────────────────────────────────────────

  describe('toMetricKey / fromMetricKey', () => {
    it('round-trips every real metric code without loss', () => {
      for (const code of ['1.9', '1.10', '1.17', '1.18', '2.3', '2.4']) {
        expect(fromMetricKey(toMetricKey(code))).toBe(code);
      }
    });

    it('replaces dots with underscores — the fix for the Mongo dot-path fragmentation bug', () => {
      expect(toMetricKey('1.9')).toBe('1_9');
      expect(toMetricKey('2.10')).toBe('2_10');
    });

    it('is idempotent-safe for keys that never had dots', () => {
      expect(toMetricKey('1_9')).toBe('1_9');
      expect(fromMetricKey('1.9')).toBe('1.9');
    });
  });

  // ─── validatePtaxMetricValue ─────────────────────────────────────────────────

  describe('validatePtaxMetricValue', () => {
    it('returns null for a valid rupee value within bounds and decimal limit', () => {
      expect(validatePtaxMetricValue('1.9', 123.45)).toBeNull();
    });

    it('rejects a negative value (min: 0 applies to every metric)', () => {
      expect(validatePtaxMetricValue('1.9', -1)).toMatch(/at least 0/);
      expect(validatePtaxMetricValue('2.3', -1)).toMatch(/at least 0/);
    });

    it('rejects a rupee value above the 9,999,999 max', () => {
      expect(validatePtaxMetricValue('1.9', 10_000_000)).toMatch(/must not exceed 9999999/);
    });

    it('rejects a rupee value with more than 2 decimal places', () => {
      expect(validatePtaxMetricValue('1.9', 123.456)).toMatch(/at most 2 decimal/);
    });

    it('accepts a rupee value with exactly 2 decimal places', () => {
      expect(validatePtaxMetricValue('1.18', 6.56)).toBeNull();
    });

    it('rejects any decimal on a count metric (2.3/2.4 are whole numbers only)', () => {
      expect(validatePtaxMetricValue('2.3', 100.5)).toMatch(/whole number/);
    });

    it('accepts a large whole-number count up to the 999,999,999,999,999 max', () => {
      expect(validatePtaxMetricValue('2.4', 999_999_999_999_999)).toBeNull();
    });

    it('rejects a count value above its max', () => {
      expect(validatePtaxMetricValue('2.4', 1_000_000_000_000_000)).toMatch(/must not exceed/);
    });

    it('returns null for a code with no known rule (defensive default, not a silent pass-everything hole)', () => {
      expect(validatePtaxMetricValue('9.9', 123)).toBeNull();
    });
  });

  // ─── validatePtaxMetricOrder ─────────────────────────────────────────────────

  describe('validatePtaxMetricOrder', () => {
    it('returns null when every pair is within order (lesser <= greater)', () => {
      const values = { '1.9': 200, '1.10': 100, '1.17': 50, '1.18': 50, '2.3': 10, '2.4': 10 };
      expect(validatePtaxMetricOrder(values)).toBeNull();
    });

    it.each(PTAX_METRIC_ORDER_PAIRS)('rejects when $lesser exceeds $greater', ({ greater, lesser }) => {
      const values = { [greater]: 100, [lesser]: 101 };
      expect(validatePtaxMetricOrder(values)).toBe(`Metric ${lesser} cannot be greater than metric ${greater}`);
    });

    it('does not compare a pair when either side is null/undefined — partial state is not an error', () => {
      expect(validatePtaxMetricOrder({ '1.9': null, '1.10': 500 })).toBeNull();
      expect(validatePtaxMetricOrder({ '1.9': 500 })).toBeNull();
    });

    it('only reports the first violated pair, not all of them', () => {
      const values = { '1.9': 10, '1.10': 20, '1.17': 10, '1.18': 20 };
      expect(validatePtaxMetricOrder(values)).toBe('Metric 1.10 cannot be greater than metric 1.9');
    });
  });
});
