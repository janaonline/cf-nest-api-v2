import { PDFDocument } from 'pdf-lib';
import type { ClaimLetterFullDocument } from 'src/module/xvi-fc/state/claim-letter/types/claim-letter-document.types';
import { buildOmContent } from './om-content.builder';
import { OmPdfService } from './om-pdf.service';

const row = (key: string) => ({
  key,
  condition: [{ runs: [{ text: 'Number of duly constituted ULBs with elected bodies in place as on the date of claim' }] }],
  status: [{ runs: [{ text: 'Complied: ', bold: true }, { text: '107/123 (87%) ULBs as per the State certificate' }] }],
});

const columns = [
  { header: 'S. No.', kind: 'serial' },
  { header: 'ULB Name', kind: 'name' },
  { header: 'Election Status', kind: 'value' },
  { header: 'Audited Accounts submitted', kind: 'yesNo' },
  { header: 'Tied grant Allocation (₹ lakh)', kind: 'amount' },
  { header: 'Untied grant allocation (₹ lakh)', kind: 'amount' },
];
const ulbRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    ulbId: `u${i}`,
    cells: [String(i + 1), 'Kumarghat Municipal Council Municipality', 'Constituted', 'Yes', '154.76', '154.76'],
  }));

const content = (rows: number, eligibleUlbs = 3) =>
  buildOmContent({
    claimLetterId: 'c1',
    letter: {
      refNo: 'CL/AP/2026-27/1-2',
      stateName: 'Andhra Pradesh',
      designYearLabel: '2026-27',
      installment: 1,
      counts: { stateUlbTotal: 123 },
      letter: { compliance: Array.from({ length: rows }, (_, i) => row(`${String.fromCharCode(65 + (i % 26))}.`)) },
      annexure: {
        title: 'Annexure',
        columns,
        lists: [
          { key: 'ELIGIBLE', heading: '1. List of Eligible ULBs', subheading: 'ULBs in this proposal.', total: 0 },
          { key: 'INELIGIBLE', heading: '2. List of Ineligible ULBs', subheading: 'For record.', total: 0 },
        ],
      },
      rowsByList: { ELIGIBLE: ulbRows(eligibleUlbs), INELIGIBLE: [] },
    } as unknown as ClaimLetterFullDocument,
    ulbCount: 12,
    totalAmount: 500_000_000,
    yearAllocation: 15_620_000_000,
    omNumber: 'F-1/2026',
    omDate: '2026-11-04',
  });

describe('OmPdfService', () => {
  const service = new OmPdfService();

  it('draws the OM as a PDF', async () => {
    const buffer = await service.render(content(11));

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect((await PDFDocument.load(buffer)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('carries a long compliance table onto further pages', async () => {
    const short = (await PDFDocument.load(await service.render(content(1)))).getPageCount();
    const long = (await PDFDocument.load(await service.render(content(40)))).getPageCount();

    expect(long).toBeGreaterThan(short);
  });

  it("prints the claim letter's ULB lists after the OM on landscape pages, continuing a long list", async () => {
    const pages = (await PDFDocument.load(await service.render(content(11, 200)))).getPages();
    const withoutLists = (await PDFDocument.load(await service.render({ ...content(11), ulbLists: undefined }))).getPageCount();

    expect(pages.length).toBeGreaterThan(withoutLists + 1);
    pages.slice(withoutLists).forEach((page) => expect(page.getWidth()).toBeGreaterThan(page.getHeight()));
  });
});
