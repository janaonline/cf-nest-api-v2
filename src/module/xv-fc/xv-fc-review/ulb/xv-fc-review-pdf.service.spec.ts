import { normalizeCurrency, XvFcReviewPdfService } from './xv-fc-review-pdf.service';

const baseParams = {
  ulbName: 'Test ULB',
  financialYear: '2022-23',
  status: 'LOCKED',
  finalAction: 'SUBMIT_WITH_COMMENTS' as const,
  submittedAt: new Date('2026-01-15T10:30:00Z'),
};

describe('xv-fc-review-pdf.service', () => {
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

  // ─── buildLineItemsPdf ───────────────────────────────────────────────────

  describe('buildLineItemsPdf', () => {
    const service = new XvFcReviewPdfService();
    const unflaggedItem = {
      code: '480',
      name: 'Miscellaneous Expenditure (to the extent not written off)',
      standardizedAmount: 4741268,
      flagged: false,
      proposedValue: null,
      comment: null,
      adminDecision: null,
    };

    it('resolves a valid PDF buffer, including a long-wrapping catalog name', async () => {
      const buffer = await service.buildLineItemsPdf({
        ...baseParams,
        lineItems: [unflaggedItem, { ...unflaggedItem, code: '110', name: 'Tax Revenue', standardizedAmount: null }],
      });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('resolves for an empty line-item list without throwing', async () => {
      const buffer = await service.buildLineItemsPdf({ ...baseParams, lineItems: [] });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('resolves for a flagged item carrying a proposed value, comment, and admin decision', async () => {
      const buffer = await service.buildLineItemsPdf({
        ...baseParams,
        lineItems: [
          {
            ...unflaggedItem,
            flagged: true,
            proposedValue: 5000000,
            comment: 'This figure looks too low compared to our records',
            adminDecision: { status: 'ACCEPTED', reason: '', correctedValue: 5000000 },
          },
        ],
      });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('renders more content for a flagged item (with its modification block) than the same item unflagged', async () => {
      const flagged = {
        ...unflaggedItem,
        flagged: true,
        proposedValue: 5000000,
        comment: 'This figure looks too low compared to our records',
        adminDecision: { status: 'PENDING' as const, reason: '', correctedValue: null },
      };
      const unflaggedBuffer = await service.buildLineItemsPdf({ ...baseParams, lineItems: [unflaggedItem] });
      const flaggedBuffer = await service.buildLineItemsPdf({ ...baseParams, lineItems: [flagged] });
      expect(flaggedBuffer.length).toBeGreaterThan(unflaggedBuffer.length);
    });

    it('includes the submission summary (status/finalAction/submittedAt) without throwing when submittedAt is absent', async () => {
      const buffer = await service.buildLineItemsPdf({
        ulbName: 'Test ULB',
        financialYear: '2022-23',
        status: 'NOT_STARTED',
        finalAction: null,
        submittedAt: null,
        lineItems: [],
      });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('actually converts the amount for a lowercase currency string — regression for the case-sensitivity bug', async () => {
      const params = { ...baseParams, lineItems: [{ ...unflaggedItem, standardizedAmount: 500000 }] };
      const unconverted = await service.buildLineItemsPdf(params, 'INR');
      const converted = await service.buildLineItemsPdf(params, 'lakh');
      expect(converted.length).not.toBe(unconverted.length);
    });
  });
});
