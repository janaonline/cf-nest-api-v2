import { hasDesignYearStarted, isWithinXvifcCycle } from './xvifc-cycle.constants';

describe('isWithinXvifcCycle', () => {
  it('accepts the first year of the 16th FC award period', () => {
    expect(isWithinXvifcCycle('2026-27')).toBe(true);
  });

  it('accepts the last year of the 16th FC award period', () => {
    expect(isWithinXvifcCycle('2030-31')).toBe(true);
  });

  it('accepts a year in the middle of the cycle', () => {
    expect(isWithinXvifcCycle('2028-29')).toBe(true);
  });

  it('rejects a 15th FC year that predates the cycle', () => {
    expect(isWithinXvifcCycle('2025-26')).toBe(false);
  });

  it('rejects a 14th FC year', () => {
    expect(isWithinXvifcCycle('2019-20')).toBe(false);
  });

  it('rejects a year after the cycle ends', () => {
    expect(isWithinXvifcCycle('2031-32')).toBe(false);
  });

  it('rejects, rather than throws, on an unrecognized label format', () => {
    expect(isWithinXvifcCycle('not-a-year')).toBe(false);
  });
});

describe('hasDesignYearStarted', () => {
  it('is true for the year matching the reference date\'s calendar year', () => {
    expect(hasDesignYearStarted('2026-27', new Date('2026-09-09'))).toBe(true);
  });

  it('is true for a year that already ended relative to the reference date', () => {
    expect(hasDesignYearStarted('2026-27', new Date('2030-01-01'))).toBe(true);
  });

  it('is false for a year that has not started yet relative to the reference date', () => {
    expect(hasDesignYearStarted('2027-28', new Date('2026-09-09'))).toBe(false);
  });

  it('e.g. "now" is 2026 -> 2027-28 through 2030-31 have not started', () => {
    const now = new Date('2026-09-09');
    expect(hasDesignYearStarted('2027-28', now)).toBe(false);
    expect(hasDesignYearStarted('2028-29', now)).toBe(false);
    expect(hasDesignYearStarted('2029-30', now)).toBe(false);
    expect(hasDesignYearStarted('2030-31', now)).toBe(false);
  });

  it('rejects, rather than throws, on an unrecognized label format', () => {
    expect(hasDesignYearStarted('not-a-year', new Date('2026-09-09'))).toBe(false);
  });

  it('defaults referenceDate to now when omitted', () => {
    expect(hasDesignYearStarted('2020-21')).toBe(true);
  });
});
