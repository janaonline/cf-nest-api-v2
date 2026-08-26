import { formatXviFcDate } from './xvi-fc-date-format.util';

describe('formatXviFcDate', () => {
  it('formats a Date instance as "D Month YYYY"', () => {
    expect(formatXviFcDate(new Date(Date.UTC(2030, 2, 31)))).toBe('31 March 2030');
  });

  it('formats an ISO date string the same way', () => {
    expect(formatXviFcDate('2031-03-31')).toBe('31 March 2031');
  });

  it('formats a min-date-shaped ISO string', () => {
    expect(formatXviFcDate('2021-05-31')).toBe('31 May 2021');
  });

  it('returns "-" for null', () => {
    expect(formatXviFcDate(null)).toBe('-');
  });

  it('returns "-" for an unparseable string', () => {
    expect(formatXviFcDate('not-a-date')).toBe('-');
  });
});
