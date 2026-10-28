import { Packer } from 'docx';
import JSZip from 'jszip';
import { Types } from 'mongoose';
import { ClaimLetterDocxService } from './claim-letter-docx.service';
import type { ClaimLetterDocumentService } from './claim-letter-document.service';
import type { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import type { ClaimLetterFullDocument, ClaimLetterParagraph } from '../../types/claim-letter-document.types';

const p = (text: string, extra: Partial<ClaimLetterParagraph> = {}): ClaimLetterParagraph => ({
  runs: [{ text }],
  ...extra,
});

function fullDocument(): ClaimLetterFullDocument {
  return {
    refNo: 'CL/SS/2026-27/1-2',
    stateName: 'Sample State',
    designYearLabel: '2026-27',
    installment: 1,
    batchNumber: 2,
    asOn: '27 Oct 2026, 15:30',
    letter: {
      letterhead: {
        runs: [
          { text: 'GOVERNMENT OF SAMPLE STATE', bold: true },
          { text: '\n' },
          { text: '<NAME OF DEPARTMENT>', placeholder: true },
        ],
      },
      letterNo: p('Letter No.: UD/1'),
      refAndDate: p('CF Ref No.- CL/SS/2026-27/1-2'),
      addressee: p('To,\nEconomic Advisor'),
      subject: p('Subject: Claim'),
      referencesTitle: 'Reference:',
      references: [p('Operational Guidelines', { number: '1.' })],
      salutation: p('Sir/Madam,'),
      body: [p('The undersigned'), p('The State Government hereby claims', { number: '2.' })],
      complianceHeaders: ['S. No.', 'Type of condition', 'Status of Compliance'],
      compliance: [{ key: 'A.', condition: [p('GTC')], status: [p('b) No')] }],
      note: p('Note: as on 27 Oct 2026, 15:30.'),
      closing: [p('Certified', { number: '4.' }), p('Requested', { number: '5.' })],
      signOff: p('Yours faithfully,'),
      signature: { runs: [{ text: '<Signature>', placeholder: true }] },
    },
    annexure: {
      title: 'Annexure',
      columns: [
        { header: 'S. No.', kind: 'serial' },
        { header: 'ULB Name', kind: 'name' },
        { header: 'Election Status', kind: 'value' },
        { header: 'Audited Accounts submitted', kind: 'yesNo' },
        { header: '14th FC (₹ lakh)', kind: 'amount' },
        { header: 'Tied grant Allocation (₹ lakh)', kind: 'amount' },
        { header: 'Untied grant allocation (₹ lakh)', kind: 'amount' },
      ],
      lists: [
        { key: 'ELIGIBLE', heading: '1. List of Eligible ULBs', subheading: 'ULBs in this proposal.', total: 1 },
        { key: 'INELIGIBLE', heading: '2. List of Ineligible ULBs', subheading: 'All ULBs, for record.', total: 0 },
      ],
    },
    counts: {
      stateUlbTotal: 4,
      proposalUlbs: 1,
      eligibleInProposal: 1,
      ineligibleStateWide: 0,
      withUnspentInProposal: 0,
      sixthScheduleInProposal: 0,
      criteria: [],
    },
    rowsByList: {
      ELIGIBLE: [{ ulbId: 'u1', cells: ['1', 'ULB A', 'Constituted', 'Yes', 'Nil', '617.28', '617.28'] }],
      INELIGIBLE: [],
    },
  };
}

async function documentXml(service: ClaimLetterDocxService, doc: ClaimLetterFullDocument): Promise<string> {
  const buffer = await Packer.toBuffer(service.render(doc));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

describe('ClaimLetterDocxService', () => {
  const documentService = { buildFullDocument: jest.fn(), loadParent: jest.fn() };
  const letterDetailsService = { assertComplete: jest.fn() };
  const service = new ClaimLetterDocxService(
    documentService as unknown as ClaimLetterDocumentService,
    letterDetailsService as unknown as ClaimLetterLetterDetailsService,
  );

  describe('generateForDownload', () => {
    const user = { _id: 'u1' } as never;
    const parent = { _id: new Types.ObjectId(), year: new Types.ObjectId(), letterDetails: {} };

    beforeEach(() => {
      documentService.loadParent.mockResolvedValue(parent);
      documentService.buildFullDocument.mockResolvedValue(fullDocument());
      letterDetailsService.assertComplete.mockReset();
    });

    it('checks the letter details before building the file', async () => {
      const order: string[] = [];
      letterDetailsService.assertComplete.mockImplementation(() => order.push('check'));
      documentService.buildFullDocument.mockImplementation(() => {
        order.push('build');
        return Promise.resolve(fullDocument());
      });

      await service.generateForDownload('claim-1', user);

      expect(documentService.loadParent).toHaveBeenCalledWith('claim-1', user);
      expect(letterDetailsService.assertComplete).toHaveBeenCalledWith(parent, 'downloading');
      expect(order).toEqual(['check', 'build']);
    });

    it('does not build the file when the letter details are incomplete', async () => {
      documentService.buildFullDocument.mockClear();
      letterDetailsService.assertComplete.mockRejectedValue(new Error('incomplete'));

      await expect(service.generateForDownload('claim-1', user)).rejects.toThrow('incomplete');
      expect(documentService.buildFullDocument).not.toHaveBeenCalled();
    });
  });

  it('generates a .docx named after the ref number', async () => {
    documentService.buildFullDocument.mockResolvedValue(fullDocument());
    const parent = { _id: new Types.ObjectId() } as never;

    const { buffer, fileName } = await service.generate(parent);

    expect(documentService.buildFullDocument).toHaveBeenCalledWith(parent);
    expect(fileName).toBe('CF_Sample-State_Claim-letter-1-2_2026-27.docx');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('renders model text, highlights placeholders and lays the annexure out landscape', async () => {
    const xml = await documentXml(service, fullDocument());

    expect(xml).toContain('GOVERNMENT OF SAMPLE STATE');
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>[\s\S]*?&lt;NAME OF DEPARTMENT&gt;/);
    expect(xml).toContain('617.28');
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('<w:t xml:space="preserve">Nil</w:t>');
  });

  it('prints a slot lead only before a filled value and skips an empty slot', async () => {
    const doc = fullDocument();
    doc.letter.references = [
      {
        runs: [
          { text: 'MoHUA letter/guidelines' },
          { text: '18 Sep 2026', field: 'mohuaReferenceDate', lead: ' dated ' },
          { text: ', if applicable.' },
        ],
        number: '2.',
      },
      {
        runs: [{ text: 'Blank reference' }, { text: '', field: 'mohuaReferenceDate', lead: ' dated ' }],
        number: '3.',
      },
    ];

    const xml = await documentXml(service, doc);

    expect(xml).toContain('<w:t xml:space="preserve"> dated 18 Sep 2026</w:t>');
    expect(xml.match(/ dated /g)).toHaveLength(1);
  });

  it('has no enclosure list after the annexure', async () => {
    const xml = await documentXml(service, fullDocument());
    expect(xml).not.toContain('Copy Elected body');
    expect(xml).not.toContain('Copy of GTC');
  });

  it('splits the landscape width by column kind (Yes/No columns share the rest)', async () => {
    const xml = await documentXml(service, fullDocument());
    const grids = [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map((m) =>
      [...m[1].matchAll(/w:w="(\d+)"/g)].map((w) => Number(w[1])),
    );
    const annexureGrid = grids[1];

    expect(annexureGrid.reduce((a, w) => a + w, 0)).toBe(16838 - 2 * 1440);
    expect(annexureGrid).toHaveLength(7);
  });
});
