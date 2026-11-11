import { findDuplicateSlots } from './afs-duplicate.helper';

const pdf = (url: string, fileSizeBytes?: number, pageCount?: number) => ({ url, fileSizeBytes, pageCount });

describe('findDuplicateSlots', () => {
  it('marks the later slot of each identical pair (Adirampattinam example)', () => {
    const result = findDuplicateSlots({
      bal_sheet: pdf('a.pdf', 881, 3),
      bal_sheet_schedules: pdf('b.pdf', 881, 3),
      inc_exp: pdf('c.pdf', 639, 2),
      inc_exp_schedules: pdf('d.pdf', 639, 2),
      cash_flow: pdf('e.pdf', 1920, 5),
    });
    expect([...result.entries()]).toEqual([
      ['bal_sheet_schedules', 'bal_sheet'],
      ['inc_exp_schedules', 'inc_exp'],
    ]);
  });

  it('marks 4 duplicates of the first slot when one PDF is in all 5 slots', () => {
    const same = pdf('a.pdf', 100, 10);
    const result = findDuplicateSlots({
      bal_sheet: same,
      bal_sheet_schedules: same,
      inc_exp: same,
      inc_exp_schedules: same,
      cash_flow: same,
    });
    expect(result.size).toBe(4);
    expect([...new Set(result.values())]).toEqual(['bal_sheet']);
  });

  it('matches the same url even without metadata', () => {
    const result = findDuplicateSlots({ bal_sheet: pdf('a.pdf'), inc_exp: pdf('a.pdf') });
    expect(result.get('inc_exp')).toBe('bal_sheet');
  });

  it('does not match a re-saved copy with a different size', () => {
    expect(findDuplicateSlots({ bal_sheet: pdf('a.pdf', 100, 3), inc_exp: pdf('b.pdf', 101, 3) }).size).toBe(0);
  });

  it('does not match the same size with a different page count', () => {
    expect(findDuplicateSlots({ bal_sheet: pdf('a.pdf', 100, 3), inc_exp: pdf('b.pdf', 100, 4) }).size).toBe(0);
  });

  it('never matches missing metadata or empty urls', () => {
    const result = findDuplicateSlots({
      bal_sheet: pdf('a.pdf', 100),
      bal_sheet_schedules: pdf('b.pdf', 100),
      inc_exp: pdf('', 100, 3),
      inc_exp_schedules: { url: 'c.pdf', fileSizeBytes: null, pageCount: null },
      cash_flow: { url: 'd.pdf', fileSizeBytes: null, pageCount: null },
    });
    expect(result.size).toBe(0);
  });
});
