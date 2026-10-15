import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import JSZip from 'jszip';
import { FcUnspentDeclarationDocxService } from './fc-unspent-declaration-docx.service';
import { FcUnspentDeclarationDocumentService } from './fc-unspent-declaration-document.service';
import type { FcUnspentDeclarationDocumentData } from 'src/module/xvi-fc/state/fc-unspent-declaration/types/fc-unspent-declaration-document.types';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';

function buildNoBranchData(
  overrides: Partial<FcUnspentDeclarationDocumentData> = {},
): FcUnspentDeclarationDocumentData {
  return {
    isFcUnspent: false,
    stateName: 'Andhra Pradesh',
    designYearLabel: '2026-27',
    priorFcCycleLabel: '14th FC',
    priorFcCycleFullLabel: '14th Finance Commission',
    ...overrides,
  } as FcUnspentDeclarationDocumentData;
}

function buildYesBranchData(rowCount: number): FcUnspentDeclarationDocumentData {
  return {
    isFcUnspent: true,
    stateName: 'Andhra Pradesh',
    designYearLabel: '2026-27',
    priorFcCycleLabel: '14th FC',
    priorFcCycleFullLabel: '14th Finance Commission',
    rows: Array.from({ length: rowCount }, (_, i) => ({
      slNo: i + 1,
      censusCode: `C00${i + 1}`,
      ulbName: `Sample ULB ${i + 1}`,
      unspentAmount: 400000 + i,
      previousFcUnspentBalance: 200000 + i,
    })),
  };
}

/** Unzips the generated .docx and returns the main body's raw XML, so tests can assert on
 *  literal, real text content rather than trusting the `docx` library's own API surface. */
async function extractDocumentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml missing from generated docx');
  return file.async('text');
}

/** The `Document`-level default font/size lands in word/styles.xml's <w:docDefaults>, not
 *  word/document.xml — separate extraction helper for that file. */
async function extractStylesXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/styles.xml');
  if (!file) throw new Error('word/styles.xml missing from generated docx');
  return file.async('text');
}

describe('FcUnspentDeclarationDocxService', () => {
  let service: FcUnspentDeclarationDocxService;
  let documentService: { getDocumentData: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  } as unknown as AuthUser;

  beforeEach(async () => {
    documentService = { getDocumentData: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentDeclarationDocxService,
        { provide: FcUnspentDeclarationDocumentService, useValue: documentService },
      ],
    }).compile();

    service = module.get(FcUnspentDeclarationDocxService);
  });

  it('propagates a gate exception from getDocumentData', async () => {
    documentService.getDocumentData.mockRejectedValue(new BadRequestException('validation failed'));
    await expect(service.generateDeclarationDocument(stateId, yearId, user)).rejects.toThrow(BadRequestException);
  });

  it('produces a well-formed .docx (ZIP container with PK magic bytes)', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    expect(result.buffer.subarray(0, 2).toString('utf8')).toBe('PK');
  });

  it('opens with the shared MoHUA addressee block, not the old one', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('The Deputy Secretary');
    expect(xml).toContain('Finance Commission Cell');
    expect(xml).toContain('Department of Urban Development');
    expect(xml).toContain('Government of India');
    expect(xml).toContain('Sankalp Bhawan, New Delhi');
    expect(xml).not.toContain('Economic Advisor/ Deputy Secretary (Finance Commission Cell)');
    expect(xml).not.toContain('Sankalp Bhawan, GPOA-2, Pt. Ravi Shankar Shukla Lane,');
    expect(xml).not.toContain('Kasturba Gandhi Marg, New Delhi-110001');
    expect(xml).not.toContain('The Director,');
    expect(xml).not.toContain('AMRUT-IIB');
  });

  it('renders the title heading, bold/underlined/centered, dynamic on the FC cycle label', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain(
      'Format of Letter to be submitted by the State reg. Unspent Balance of 14th Finance Commission and Previous Finance Commissions',
    );
    expect(xml).toContain('w:jc w:val="center"');
    expect(xml).toMatch(/<w:u\b/);
  });

  it('sets Times New Roman 12pt as the document default font', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const stylesXml = await extractStylesXml(result.buffer);

    expect(stylesXml).toContain('Times New Roman');
    expect(stylesXml).toContain('w:sz w:val="24"');
  });

  it('renders the new dynamic subject line and "Sir," salutation, not the old wording', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    // The XML serializer escapes the apostrophe as &apos;.
    expect(xml).toContain(
      'Subject: Declaration regarding 14th Finance Commission and previous Finance Commissions&apos; unspent ' +
        'balance with Urban Local Bodies in the State of Andhra Pradesh -reg.',
    );
    expect(xml).toContain('Sir,');
    expect(xml).not.toContain('Respected Sir/Madam,');
    expect(xml).not.toContain('Declaration regarding nil');
  });

  it('builds the CF_{StateName}_fc-unspent-declaration-no_{YearLabel}.docx filename on the No branch', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    expect(result.fileName).toBe('CF_Andhra-Pradesh_Fc-unspent-declaration-no_2026-27.docx');
  });

  it('builds the CF_{StateName}_fc-unspent-declaration-yes_{YearLabel}.docx filename on the Yes branch', async () => {
    documentService.getDocumentData.mockResolvedValue(buildYesBranchData(1));
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    expect(result.fileName).toBe('CF_Andhra-Pradesh_Fc-unspent-declaration-yes_2026-27.docx');
  });

  describe('No branch', () => {
    it('bolds only "NO" and interpolates the real state name and FC cycle label, no table', async () => {
      documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('This is to certify that,');
      expect(xml).toContain(
        'Urban Local Body in the State of Andhra Pradesh has any unspent balance under the 14th Finance Commission ' +
          'grants and any previous Finance Commission grants.',
      );
      expect(xml).toContain('>NO<');
      // The old preamble/trailing sentences are gone in the new specimen wording.
      expect(xml).not.toContain('as per the records available with the State Government');
      expect(xml).not.toContain('Accordingly, ULB-wise data');
      // No table -> no header cell text.
      expect(xml).not.toContain('Census ID');
    });
  });

  describe('Yes branch', () => {
    it('interpolates the real state name and renders the 5-column table with Lakhs-formatted amounts', async () => {
      documentService.getDocumentData.mockResolvedValue(buildYesBranchData(2));
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('This is to certify that,');
      expect(xml).toContain('Following Urban Local Bodies in the State of Andhra Pradesh has unspent balance under');
      expect(xml).toContain('ULB Name');
      expect(xml).toContain('Census ID');
      expect(xml).toContain('14th FC unspent balance (in Lakhs)');
      expect(xml).toContain('Previous FC unspent balance (in Lakhs)');
      expect(xml).not.toContain('16TH FC ALLOCATION');
      expect(xml).not.toContain('% OF ALLOC.');
      expect(xml).not.toContain('ELIGIBLE?');
      expect(xml).toContain('Sample ULB 1');
      expect(xml).toContain('Sample ULB 2');
      expect(xml).toContain('The above-mentioned ULBs may be excluded from the list of eligible ULBs.');
    });

    it('formats unspent-balance fields in Lakhs, not whole Rupees', async () => {
      documentService.getDocumentData.mockResolvedValue(buildYesBranchData(1));
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      // Row 1: unspentAmount 400000 -> 4.00 Lakhs; previousFcUnspentBalance 200000 -> 2.00 Lakhs.
      expect(xml).toContain('4.00');
      expect(xml).toContain('2.00');
      expect(xml).not.toContain('₹');
    });

    it('uses the dynamic FC cycle label in the table header, not a hardcoded "14th FC"', async () => {
      const data = buildYesBranchData(1);
      const withDifferentCycle = {
        ...data,
        priorFcCycleLabel: '15th FC',
        priorFcCycleFullLabel: '15th Finance Commission',
      };
      documentService.getDocumentData.mockResolvedValue(withDifferentCycle);
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('15th FC unspent balance (in Lakhs)');
      expect(xml).not.toContain('14th FC unspent balance (in Lakhs)');
    });
  });

  it('uses the same "2." numbered closing wording on both branches', async () => {
    documentService.getDocumentData.mockResolvedValueOnce(buildNoBranchData());
    const no = await service.generateDeclarationDocument(stateId, yearId, user);
    const noXml = await extractDocumentXml(no.buffer);
    expect(noXml).toContain(
      '2. This is submitted for the consideration of the claim of first installment for FY 2026-27 under the 16th Finance Commission grants.',
    );

    documentService.getDocumentData.mockResolvedValueOnce(buildYesBranchData(1));
    const yes = await service.generateDeclarationDocument(stateId, yearId, user);
    const yesXml = await extractDocumentXml(yes.buffer);
    expect(yesXml).toContain(
      '2. This is submitted for the consideration of the claim of first installment for FY 2026-27 under the 16th Finance Commission grants.',
    );
  });

  it('renders the closing signature block as literal, non-interpolated, right-aligned placeholder text — including its own "[State Name]"', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('[Name]');
    expect(xml).toContain('[Designation]');
    expect(xml).toContain('[Department / Directorate]');
    expect(xml).toContain('Government of [State Name]');
    expect(xml).toContain('Date: [DD/MM/YYYY]');
    expect(xml).toContain('Place: [Place]');
    expect(xml).toContain('Seal: [Official Seal]');
    // The intro paragraph's real state name must never leak into the signature block's own
    // "[State Name]" placeholder.
    expect(xml).not.toContain('Government of Andhra Pradesh');
    expect(xml).toContain('w:jc w:val="right"');
  });

  it('never emits an em dash anywhere in the generated document', async () => {
    documentService.getDocumentData.mockResolvedValue(buildYesBranchData(2));
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).not.toContain('—');
  });
});
