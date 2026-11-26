// Amount formatting for xvi-fc letters: integer maths, no floating-point rounding. Claim amounts can
// end in .50 (instalments are Total / 2); amountToIndianWords spells those paise out.

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Whole rupees -> lakh, 2 decimals, half-up, Indian grouping: 123456789 -> "1,234.57". */
export function formatRupeesInLakh(rupees: number): string {
  return formatHundredthsOfLakh(Math.floor((rupees + 500) / 1000));
}

/** Half of a whole-rupee amount, in lakh (e.g. Tied = Untied = allocation / 2). */
export function formatHalfRupeesInLakh(rupees: number): string {
  return formatHundredthsOfLakh(Math.floor((rupees + 1000) / 2000));
}

function formatHundredthsOfLakh(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, '0');
  return `${whole.toLocaleString('en-IN')}.${fraction}`;
}

/** Rupees and paise in words: 19485981.5 -> "One Crore ... Nine Hundred Eighty-One and Fifty Paise". */
export function amountToIndianWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return paise > 0 ? `${rupeesToIndianWords(rupees)} and ${belowHundred(paise)} Paise` : rupeesToIndianWords(rupees);
}

/** Whole rupees only. Indian system, Title Case: 123456789 -> "Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine". */
export function rupeesToIndianWords(rupees: number): string {
  if (rupees === 0) return 'Zero';
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${rupeesToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  return unit ? `${tens}-${ONES[unit]}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(' ');
}
