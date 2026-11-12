import type { ClaimLetterFullDocument } from 'src/module/xvi-fc/state/claim-letter/types/claim-letter-document.types';
import { buildOmContent, todayIso } from './om-content.builder';

const text = (p: { runs: { text: string }[] }) => p.runs.map((r) => r.text).join('');

const letter = {
  refNo: 'CL/AP/2026-27/1-2',
  stateName: 'Andhra Pradesh',
  designYearLabel: '2026-27',
  installment: 1,
  counts: { stateUlbTotal: 123 },
  letter: {
    compliance: [
      {
        key: 'C.',
        condition: [{ runs: [{ text: 'Number of duly constituted ULBs' }] }],
        status: [{ runs: [{ text: '<SFC>', placeholder: true, field: 'sfcName', hint: 'x' }, { text: '107/123 (87%)' }] }],
      },
    ],
  },
  annexure: {
    title: 'Annexure',
    columns: [
      { header: 'S. No.', kind: 'serial' },
      { header: 'ULB Name', kind: 'name' },
    ],
    lists: [
      { key: 'ELIGIBLE', heading: '1. List of Eligible ULBs', subheading: 'ULBs in this proposal.', total: 1 },
      { key: 'INELIGIBLE', heading: '2. List of Ineligible ULBs', subheading: 'For record.', total: 0 },
    ],
  },
  rowsByList: { ELIGIBLE: [{ ulbId: 'u1', cells: ['1', 'Khowai'] }], INELIGIBLE: [] },
} as unknown as ClaimLetterFullDocument;

describe('buildOmContent', () => {
  const content = (extra: Partial<Parameters<typeof buildOmContent>[0]> = {}) =>
    buildOmContent({
      claimLetterId: 'c1',
      letter,
      ulbCount: 12,
      totalAmount: 500_000_000,
      yearAllocation: 15_620_000_000,
      omNumber: null,
      omDate: '2026-11-04',
      ...extra,
    });

  it('writes the subject, the recommendation and the closing from the letter, State, FY and amounts', () => {
    const c = content();

    expect(text(c.subject)).toBe(
      'Subject: Recommendation for release of 1st installment of Basic Grants (Both Tied and Untied) to the State of ' +
        'Andhra Pradesh for FY 2026-27 under 16th Finance Commission-reg.',
    );
    expect(c.recommendation.map(text)).toEqual([
      'Andhra Pradesh',
      'Rs. 1,56,200.00 lakh for the FY 2026-27',
      '1st installment of Rs. 5,000.00 lakh may be recommended for FY 2026-27 for 12 eligible ULBs.',
    ]);
    expect(text(c.closing[0])).toContain('Rs. 5,000.00 lakh is recommended for 12 eligible ULBs out of the total 123 ULBs');
    expect(c.claimLetterRefNo).toBe('CL/AP/2026-27/1-2');
  });

  it("reuses the claim letter's rows A-K as plain text, without the letter's own boxes", () => {
    const [row] = content().compliance;

    expect(row.key).toBe('C.');
    expect(row.status[0].runs).toEqual([{ text: '<SFC>' }, { text: '107/123 (87%)' }]);
  });

  it("freezes the claim letter's ULB lists that rows J and K point to", () => {
    expect(content().ulbLists).toEqual({
      title: 'Annexure',
      columns: letter.annexure.columns,
      lists: [
        { heading: '1. List of Eligible ULBs', subheading: 'ULBs in this proposal.', rows: [['1', 'Khowai']] },
        { heading: '2. List of Ineligible ULBs', subheading: 'For record.', rows: [] },
      ],
      footnote: {
        runs: [
          { text: 'Note: ', bold: true },
          {
            text:
              'The table below lists eligible ULBs included in the current claim batch. Other eligible ULBs may be ' +
              'included in subsequent claims.',
          },
        ],
      },
    });
  });

  it('draws the No. and Dated boxes, blank or filled', () => {
    expect(content().number.runs[1]).toEqual({ text: 'No.', placeholder: true, field: 'omNumber' });
    expect(content({ omNumber: ' F-12/2026 ' }).number.runs[1]).toEqual({ text: 'F-12/2026', field: 'omNumber' });
    expect(text(content().address[2])).toBe('Dated: 04 Nov 2026');
  });

  it('says so when the State has no allocation for the year', () => {
    expect(text(content({ yearAllocation: null }).recommendation[1])).toBe('Not available');
  });

  it("dates today in IST", () => {
    expect(todayIso(new Date('2026-11-03T20:00:00.000Z'))).toBe('2026-11-04');
  });
});
