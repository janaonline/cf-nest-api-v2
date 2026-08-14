import { formatValue, normalizeCurrency, PtaxReviewPdfService } from './ptax-review-pdf.service';

const baseParams = {
  ulbName: 'Test ULB',
  financialYear: '2023-24',
  status: 'LOCKED',
  finalAction: 'SUBMIT_WITH_COMMENTS' as const,
  submittedAt: new Date('2026-01-15T10:30:00Z'),
};

describe('ptax-review-pdf.service', () => {
  // ─── normalizeCurrency ───────────────────────────────────────────────────

  describe('normalizeCurrency', () => {
    it.each(['LAKH', 'lakh', 'Lakh', 'CRORE', 'crore', 'Crore'])('normalizes case-insensitively — %s', (input) => {
      expect(normalizeCurrency(input)).toBe(input.toUpperCase());
    });

    it('trims surrounding whitespace before comparing', () => {
      expect(normalizeCurrency('  LAKH  ')).toBe('LAKH');
    });

    it('defaults to INR for null, undefined, empty, or an unrecognized value', () => {
      expect(normalizeCurrency(null)).toBe('INR');
      expect(normalizeCurrency(undefined)).toBe('INR');
      expect(normalizeCurrency('')).toBe('INR');
      expect(normalizeCurrency('USD')).toBe('INR');
    });
  });

  // ─── formatValue ─────────────────────────────────────────────────────────

  describe('formatValue', () => {
    it('returns "-" for null or empty values', () => {
      expect(formatValue(null, '1.9', 'INR')).toBe('-');
      expect(formatValue('', '1.9', 'INR')).toBe('-');
    });

    it('returns the raw string unchanged when it is not numeric', () => {
      expect(formatValue('N/A', '1.9', 'INR')).toBe('N/A');
    });

    it('does not scale a count metric (2.3/2.4 — isRupee: false), regardless of currency', () => {
      expect(formatValue('76', '2.3', 'LAKH')).toBe('76');
      expect(formatValue('76', '2.3', 'CRORE')).toBe('76');
      expect(formatValue('76', '2.3', 'INR')).toBe('76');
    });

    // Rupee metric values (and proposedValue/correctedValue, entered
    // against the same figure) arrive from propertytaxopmappers already
    // expressed in lakhs — confirmed against real data, e.g. a demand of
    // "851.45" is ₹85.145 lakh, not ₹851.45. LAKH is therefore the
    // pass-through case; INR and CRORE convert away from it.
    it('leaves a rupee metric unscaled under LAKH — the stored value is already in lakhs', () => {
      expect(formatValue('851.45', '1.9', 'LAKH')).toBe('851.45');
    });

    it('multiplies by 1,00,000 to expand a lakh-denominated value to raw rupees under INR', () => {
      expect(formatValue('851.45', '1.9', 'INR')).toBe('8,51,45,000');
    });

    it('divides by 100 to convert a lakh-denominated value to crores under CRORE', () => {
      expect(formatValue('851.45', '1.9', 'CRORE')).toBe('8.51');
    });

    it('treats an unknown code as non-rupee (defensive default, matches the validation-rule lookup elsewhere) — unaffected by currency', () => {
      expect(formatValue('851.45', '9.9', 'LAKH')).toBe('851');
      expect(formatValue('851.45', '9.9', 'INR')).toBe('851');
    });

    it('also formats a numeric (not just string) proposedValue/correctedValue input', () => {
      expect(formatValue(965, '1.9', 'LAKH')).toBe('965');
    });
  });

  // ─── buildMetricsPdf ─────────────────────────────────────────────────────

  describe('buildMetricsPdf', () => {
    const service = new PtaxReviewPdfService();
    const unflaggedMetric = {
      code: '1.9',
      label:
        'Total Property Tax Demand (including cess, other taxes, and excluding user charges if user charges are collected with property tax)',
      value: '3.5',
      flagged: false,
      proposedValue: null,
      comment: null,
      adminDecision: null,
    };

    it('resolves a valid PDF buffer for a realistic metric list, including long wrapping labels', async () => {
      const buffer = await service.buildMetricsPdf({
        ...baseParams,
        metrics: [
          unflaggedMetric,
          {
            code: '2.3',
            label: 'Total Number of Properties from which Property Tax was Demanded',
            value: '76',
            flagged: false,
            proposedValue: null,
            comment: null,
            adminDecision: null,
          },
        ],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('resolves for an empty metrics list without throwing', async () => {
      const buffer = await service.buildMetricsPdf({ ...baseParams, metrics: [] });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('resolves when a metric value is null (not-yet-fetched / no data)', async () => {
      const buffer = await service.buildMetricsPdf({
        ...baseParams,
        metrics: [{ ...unflaggedMetric, value: null }],
      });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('resolves for a flagged metric carrying a proposed value, comment, and admin decision', async () => {
      const buffer = await service.buildMetricsPdf({
        ...baseParams,
        metrics: [
          {
            ...unflaggedMetric,
            flagged: true,
            proposedValue: 500,
            comment: 'Verified against our records, figure was underreported',
            adminDecision: { status: 'REJECTED', reason: 'Insufficient evidence', correctedValue: null },
          },
        ],
      });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('renders more content for a flagged metric (with its modification block) than the same metric unflagged', async () => {
      const flagged = {
        ...unflaggedMetric,
        flagged: true,
        proposedValue: 500,
        comment: 'Verified against our records',
        adminDecision: { status: 'PENDING' as const, reason: '', correctedValue: null },
      };
      const unflaggedBuffer = await service.buildMetricsPdf({ ...baseParams, metrics: [unflaggedMetric] });
      const flaggedBuffer = await service.buildMetricsPdf({ ...baseParams, metrics: [flagged] });
      expect(flaggedBuffer.length).toBeGreaterThan(unflaggedBuffer.length);
    });

    it('includes the submission summary (status/finalAction/submittedAt) without throwing when submittedAt is absent', async () => {
      const buffer = await service.buildMetricsPdf({
        ulbName: 'Test ULB',
        financialYear: '2023-24',
        status: 'NOT_STARTED',
        finalAction: null,
        submittedAt: null,
        metrics: [],
      });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('actually converts the amount for a lowercase currency string — regression for the case-sensitivity bug', async () => {
      const params = { ...baseParams, metrics: [{ ...unflaggedMetric, value: '500000' }] };
      const unconverted = await service.buildMetricsPdf(params, 'INR');
      const converted = await service.buildMetricsPdf(params, 'lakh');
      // Different rendered amount ⇒ different byte length; identical length
      // would mean the divisor silently didn't apply (the original bug).
      expect(converted.length).not.toBe(unconverted.length);
    });
  });
});
