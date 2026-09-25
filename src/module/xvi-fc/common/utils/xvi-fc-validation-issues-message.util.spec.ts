import { buildValidationIssuesMessage } from './xvi-fc-validation-issues-message.util';

describe('buildValidationIssuesMessage', () => {
  it('returns undefined when not visible, regardless of counts', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 20,
      missingCount: 5,
      newCount: 3,
      duplicateCount: 2,
      allocationMismatch: { differenceLabel: '₹6,50,00,000', targetLabel: '₹1,30,00,00,000' },
      visible: false,
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined when visible but every count is zero and no allocation mismatch', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 0,
      missingCount: 0,
      newCount: 0,
      duplicateCount: 0,
      visible: true,
    });

    expect(result).toBeUndefined();
  });

  it('builds a single-clause sentence for errors only', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 20,
      missingCount: 0,
      newCount: 0,
      duplicateCount: 0,
      visible: true,
    });

    expect(result).toBe('To submit, fix 20 row error(s).');
  });

  it('builds a single-clause sentence for missing ULBs only', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 0,
      missingCount: 5,
      newCount: 0,
      duplicateCount: 0,
      visible: true,
    });

    expect(result).toBe('To submit, add the 5 missing ULB(s).');
  });

  it('builds a single-clause sentence for new ULBs only', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 0,
      missingCount: 0,
      newCount: 3,
      duplicateCount: 0,
      visible: true,
    });

    expect(result).toBe('To submit, register 3 new ULB(s).');
  });

  it('builds a single-clause sentence for duplicate ULBs only', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 0,
      missingCount: 0,
      newCount: 0,
      duplicateCount: 2,
      visible: true,
    });

    expect(result).toBe('To submit, remove 2 duplicate ULB(s).');
  });

  it('builds a single-clause sentence for an allocation mismatch only, naming both amounts', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 0,
      missingCount: 0,
      newCount: 0,
      duplicateCount: 0,
      allocationMismatch: { differenceLabel: '₹6,50,00,000', targetLabel: '₹1,30,00,00,000' },
      visible: true,
    });

    expect(result).toBe('To submit, reconcile the ₹6,50,00,000 to match ₹1,30,00,00,000 (Allocated amount).');
  });

  it('joins exactly two clauses with "and", no Oxford comma', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 20,
      missingCount: 0,
      newCount: 0,
      duplicateCount: 2,
      visible: true,
    });

    expect(result).toBe('To submit, fix 20 row error(s) and remove 2 duplicate ULB(s).');
  });

  it('joins three or more clauses with an Oxford comma', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 20,
      missingCount: 5,
      newCount: 0,
      duplicateCount: 0,
      allocationMismatch: { differenceLabel: '₹6,50,00,000', targetLabel: '₹1,30,00,00,000' },
      visible: true,
    });

    expect(result).toBe(
      'To submit, fix 20 row error(s), add the 5 missing ULB(s), and reconcile the ₹6,50,00,000 ' +
        'to match ₹1,30,00,00,000 (Allocated amount).',
    );
  });

  it('joins all five clauses when every dimension has a problem', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 20,
      missingCount: 5,
      newCount: 3,
      duplicateCount: 2,
      allocationMismatch: { differenceLabel: '₹6,50,00,000', targetLabel: '₹1,30,00,00,000' },
      visible: true,
    });

    expect(result).toBe(
      'To submit, fix 20 row error(s), add the 5 missing ULB(s), register 3 new ULB(s), ' +
        'remove 2 duplicate ULB(s), and reconcile the ₹6,50,00,000 to match ₹1,30,00,00,000 (Allocated amount).',
    );
  });

  it('omits the allocation clause entirely when allocationMismatch is undefined (e.g. EULB)', () => {
    const result = buildValidationIssuesMessage({
      errorRowCount: 20,
      missingCount: 0,
      newCount: 0,
      duplicateCount: 0,
      visible: true,
    });

    expect(result).not.toContain('reconcile');
  });
});
