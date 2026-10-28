import { formatHalfRupeesInLakh, formatRupeesInLakh, rupeesToIndianWords } from './xvi-fc-amount-format.util';

describe('xvi-fc amount format', () => {
  describe('formatRupeesInLakh', () => {
    it.each([
      [0, '0.00'],
      [1, '0.00'],
      [499, '0.00'],
      [500, '0.01'], // half-up
      [100000, '1.00'],
      [325000, '3.25'],
      [10000000, '100.00'],
      [123456789, '1,234.57'],
      [2461705000, '24,617.05'],
    ])('%d -> %s', (rupees, expected) => {
      expect(formatRupeesInLakh(rupees)).toBe(expected);
    });
  });

  describe('formatHalfRupeesInLakh', () => {
    it.each([
      [0, '0.00'],
      [4567891, '22.84'], // 22,83,945.5 rupees
      [123456789, '617.28'],
      [999, '0.00'],
      [1000, '0.01'], // 500 rupees, half-up
    ])('%d -> %s', (rupees, expected) => {
      expect(formatHalfRupeesInLakh(rupees)).toBe(expected);
    });
  });

  describe('rupeesToIndianWords', () => {
    it.each([
      [0, 'Zero'],
      [1, 'One'],
      [19, 'Nineteen'],
      [20, 'Twenty'],
      [99, 'Ninety-Nine'],
      [100, 'One Hundred'],
      [101, 'One Hundred One'],
      [100000, 'One Lakh'],
      [10000000, 'One Crore'],
      [15000000, 'One Crore Fifty Lakh'],
      [123456789, 'Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine'],
      [1000000000000, 'One Lakh Crore'],
    ])('%d -> %s', (rupees, expected) => {
      expect(rupeesToIndianWords(rupees)).toBe(expected);
    });
  });
});
