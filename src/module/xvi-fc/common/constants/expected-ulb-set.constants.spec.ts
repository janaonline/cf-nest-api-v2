import { resolveDesignYearApplicabilityCutoff } from './expected-ulb-set.constants';

describe('resolveDesignYearApplicabilityCutoff', () => {
  it('resolves a standard label to 31 March of the second calendar year', () => {
    const cutoff = resolveDesignYearApplicabilityCutoff('2026-27');
    expect(cutoff.toISOString()).toBe('2027-03-31T23:59:59.999Z');
  });

  it('handles a century rollover (e.g. 2099-00 -> 2100)', () => {
    const cutoff = resolveDesignYearApplicabilityCutoff('2099-00');
    expect(cutoff.getUTCFullYear()).toBe(2100);
  });

  it('throws on an unrecognized label format', () => {
    expect(() => resolveDesignYearApplicabilityCutoff('FY26-27')).toThrow(/Unrecognized design-year label/);
  });

  it('throws on a plain 4-digit year with no range', () => {
    expect(() => resolveDesignYearApplicabilityCutoff('2026')).toThrow(/Unrecognized design-year label/);
  });
});
