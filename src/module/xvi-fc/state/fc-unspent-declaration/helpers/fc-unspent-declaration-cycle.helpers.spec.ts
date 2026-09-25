import { resolvePriorFcCycleFullLabel, resolvePriorFcCycleLabel } from './fc-unspent-declaration-cycle.helpers';

describe('resolvePriorFcCycleLabel', () => {
  it('resolves 14th FC for 2026-27', () => {
    expect(resolvePriorFcCycleLabel('2026-27')).toBe('14th FC');
  });

  it('resolves 14th FC for 2027-28', () => {
    expect(resolvePriorFcCycleLabel('2027-28')).toBe('14th FC');
  });

  it('resolves 15th FC for 2028-29', () => {
    expect(resolvePriorFcCycleLabel('2028-29')).toBe('15th FC');
  });

  it('resolves 15th FC for 2030-31', () => {
    expect(resolvePriorFcCycleLabel('2030-31')).toBe('15th FC');
  });

  it('falls back to 14th FC for an unmapped year label', () => {
    expect(resolvePriorFcCycleLabel('1999-00')).toBe('14th FC');
  });
});

describe('resolvePriorFcCycleFullLabel', () => {
  it('spells out 14th FC as 14th Finance Commission', () => {
    expect(resolvePriorFcCycleFullLabel('2026-27')).toBe('14th Finance Commission');
  });

  it('spells out 15th FC as 15th Finance Commission', () => {
    expect(resolvePriorFcCycleFullLabel('2028-29')).toBe('15th Finance Commission');
  });

  it('falls back to 14th Finance Commission for an unmapped year label', () => {
    expect(resolvePriorFcCycleFullLabel('1999-00')).toBe('14th Finance Commission');
  });
});
