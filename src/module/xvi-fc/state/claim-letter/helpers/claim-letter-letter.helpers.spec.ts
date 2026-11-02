import type { ClaimLetterCriterionDetail } from '../services/eligibility/claim-letter-eligibility.service';
import {
  buildAnnexureCell,
  formatDetailValue,
  formatFraction,
  formatFractionOrNil,
  formatIsoDate,
  formatIstDateTime,
  formatPercent,
  ordinal,
  previousInstallmentLabel,
  printedText,
  shiftFinancialYear,
  slotRun,
} from './claim-letter-letter.helpers';

function criterion(overrides: Partial<ClaimLetterCriterionDetail>): ClaimLetterCriterionDetail {
  return {
    formId: 1,
    type: 'SLB',
    label: 'SLB',
    letterColumnLabel: 'SLB',
    displayOrder: null,
    formJsonId: 'form-json-1',
    ruleVersion: 1,
    ownerLevel: 'ULB',
    evaluationLevel: 'FORM',
    acceptedFormStatuses: [],
    buckets: new Map(),
    rowEvidence: new Map(),
    formEvidence: new Map(),
    discretionaryExemptions: new Map(),
    ...overrides,
  };
}

const row = (rowValue: string, rowAccepted: boolean | null) => ({
  bucket: 'ELIGIBLE' as const,
  rowDocumentId: 'row-1',
  rowStatusAtEvaluation: 7 as const,
  datasetVersion: 1,
  rowValue,
  rowAccepted,
  exemptionId: null,
  exemptionStatus: null,
  exemptionKind: null,
});

describe('claim letter letter helpers', () => {
  it.each([
    [10, 60, '16.7'],
    [2, 10, '20'],
    [1, 3, '33.3'],
    [2, 3, '66.7'],
    [0, 60, '0'],
    [5, 0, '0'],
  ])('formatPercent(%d, %d) = %s', (part, total, expected) => {
    expect(formatPercent(part, total)).toBe(expected);
  });

  it('formats fractions and Nil', () => {
    expect(formatFraction(10, 60)).toBe('10/60 (16.7%)');
    expect(formatFractionOrNil(0, 60)).toBe('Nil');
    expect(formatFractionOrNil(4, 60)).toBe('4/60 (6.7%)');
  });

  it('shifts financial years and labels the previous installment', () => {
    expect(shiftFinancialYear('2026-27', -2)).toBe('2024-25');
    expect(shiftFinancialYear('2099-00', 1)).toBe('2100-01');
    expect(previousInstallmentLabel(1, '2026-27')).toBe('2nd installment of FY 2025-26');
    expect(previousInstallmentLabel(2, '2026-27')).toBe('1st installment of FY 2026-27');
    expect([1, 2, 3, 6].map(ordinal)).toEqual(['1st', '2nd', '3rd', '6th']);
  });

  it('formats ISO dates in UTC and the as-on stamp in IST', () => {
    expect(formatIsoDate('2026-03-14T00:00:00.000Z')).toBe('14 Mar 2026');
    expect(formatIsoDate('not a date')).toBeNull();
    expect(formatIsoDate(42)).toBeNull();
    expect(formatIstDateTime(new Date('2026-10-27T10:00:00.000Z'))).toBe('27 Oct 2026, 15:30');
    expect(formatIstDateTime(new Date('2026-12-31T20:00:00.000Z'))).toBe('01 Jan 2027, 01:30');
  });

  it('formats letter-detail values by field type', () => {
    const radio = {
      key: 'b',
      label: 'b',
      formFieldType: 'radio',
      options: [
        { label: 'Yes', id: 'yes' },
        { label: 'No', id: 'no' },
      ],
    } as const;
    expect(formatDetailValue('no', radio as never)).toBe('No');
    expect(
      formatDetailValue('2026-11-05T00:00:00.000Z', { key: 'd', label: 'd', formFieldType: 'date' } as never),
    ).toBe('05 Nov 2026');
    expect(formatDetailValue('  UD/1 ', undefined)).toBe('UD/1');
    expect(formatDetailValue('   ', undefined)).toBeNull();
    expect(formatDetailValue(undefined, undefined)).toBeNull();
  });

  it('slotRun prints the value plainly or a highlighted placeholder, tagged with its field', () => {
    expect(slotRun('letterNo', 'UD/1', '<●>')).toEqual({ text: 'UD/1', field: 'letterNo' });
    expect(slotRun('officerName', null, '<Name>', { bold: true })).toEqual({
      text: '<Name>',
      placeholder: true,
      bold: true,
      field: 'officerName',
    });
    expect(slotRun('mohuaReferenceDate', null, '', { lead: ' dated ' })).toEqual({
      text: '',
      field: 'mohuaReferenceDate',
      lead: ' dated ',
    });
  });

  it('printedText adds the lead only before a filled value', () => {
    expect(printedText({ text: '18 Sep 2026', field: 'mohuaReferenceDate', lead: ' dated ' })).toBe(
      ' dated 18 Sep 2026',
    );
    expect(printedText({ text: '', field: 'mohuaReferenceDate', lead: ' dated ' })).toBe('');
    expect(printedText({ text: '<Date>', placeholder: true, lead: ' dated ' })).toBe('<Date>');
    expect(printedText({ text: 'plain' })).toBe('plain');
  });

  describe('buildAnnexureCell (first match wins)', () => {
    const ulb = 'u1';

    it('1. an exemption prints "Exemption requested" under MoHUA review and "Exempted" once approved', () => {
      const exempted = (status: number) =>
        criterion({ buckets: new Map([[ulb, 'EXEMPTED']]), discretionaryExemptions: new Map([[ulb, status]]) });
      expect(buildAnnexureCell(exempted(5), ulb, 0)).toBe('Exemption requested');
      expect(buildAnnexureCell(exempted(7), ulb, 0)).toBe('Exempted');
    });

    it('1. a rejected exemption prints the real result instead', () => {
      const c = criterion({ buckets: new Map([[ulb, 'INELIGIBLE']]), discretionaryExemptions: new Map([[ulb, 6]]) });
      expect(buildAnnexureCell(c, ulb, 0)).toBe('No');
    });

    it('2. the 14th FC column prints the unspent amount (or Nil), with the exemption note', () => {
      const fc = criterion({ type: 'FC_UNSPENT_STATE', evaluationLevel: 'FORM_AND_ROW' });
      expect(buildAnnexureCell(fc, ulb, 1850000)).toBe('18.50');
      expect(buildAnnexureCell(fc, ulb, 0)).toBe('Nil');
      expect(buildAnnexureCell(fc, ulb, 300)).toBe('0.00');
      const underReview = criterion({ ...fc, discretionaryExemptions: new Map([[ulb, 5]]) });
      expect(buildAnnexureCell(underReview, ulb, 1850000)).toBe('18.50 (Exemption requested)');
      const approved = criterion({ ...fc, discretionaryExemptions: new Map([[ulb, 7]]) });
      expect(buildAnnexureCell(approved, ulb, 0)).toBe('Nil (Exempted)');
    });

    it('3. a row-level criterion prints the value as entered, flagged while pending review', () => {
      const eb = criterion({
        type: 'ELECTED_BODY',
        evaluationLevel: 'FORM_AND_ROW',
        rowEvidence: new Map([
          ['a', row('Constituted', true)],
          ['b', row('Constituted', false)],
          ['c', row('6th Schedule', null)],
        ]),
      });
      expect(buildAnnexureCell(eb, 'a', 0)).toBe('Constituted');
      expect(buildAnnexureCell(eb, 'b', 0)).toBe('Constituted (pending review)');
      expect(buildAnnexureCell(eb, 'c', 0)).toBe('6th Schedule');
    });

    it('4. a row-level criterion without a row prints Yes when exempt, else Not submitted', () => {
      const eb = criterion({
        type: 'ELECTED_BODY',
        evaluationLevel: 'FORM_AND_ROW',
        buckets: new Map([
          ['new', 'EXEMPTED'],
          ['missing', 'INELIGIBLE'],
        ]),
      });
      expect(buildAnnexureCell(eb, 'new', 0)).toBe('Yes');
      expect(buildAnnexureCell(eb, 'missing', 0)).toBe('Not submitted');
    });

    it('5. other criteria print Yes / No', () => {
      const slb = criterion({
        buckets: new Map([
          ['ok', 'ELIGIBLE'],
          ['auto', 'EXEMPTED'],
          ['bad', 'INELIGIBLE'],
        ]),
      });
      expect(['ok', 'auto', 'bad', 'unknown'].map((id) => buildAnnexureCell(slb, id, 0))).toEqual([
        'Yes',
        'Yes',
        'No',
        'No',
      ]);
    });
  });
});
