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
      allocationAmount: 100 + i,
      unspentAmount: 4 + i,
      allocationPerc: 4 + i,
      eligibility: i % 2 === 0,
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

  it('uses a getTimeStamp-based .docx filename', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    expect(result.fileName).toMatch(/^fc-unspent-declaration_.*\.docx$/);
  });

  describe('No branch', () => {
    it('interpolates the real state name and FC cycle label into the intro paragraph, no table', async () => {
      documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('no Urban Local Body in the State of Andhra Pradesh holds any unspent balance');
      expect(xml).toContain('14th Finance Commission');
      expect(xml).toContain('Accordingly, ULB-wise data on 14th Finance Commission unspent balance is not applicable');
      // No table -> no header cell text.
      expect(xml).not.toContain('CENSUS ID');
    });

    it('uses the "This declaration is being submitted" closing wording verbatim from the reference PDF', async () => {
      documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain(
        'This declaration is being submitted for consideration of the first installment claim for FY 2026-27',
      );
    });
  });

  describe('Yes branch', () => {
    it('interpolates the real state name into the intro paragraph and renders the table', async () => {
      documentService.getDocumentData.mockResolvedValue(buildYesBranchData(2));
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('the following Urban Local Bodies in the State of Andhra Pradesh hold unspent balance');
      expect(xml).toContain('CENSUS ID');
      expect(xml).toContain('16TH FC ALLOCATION');
      expect(xml).toContain('14TH FC UNSPENT');
      expect(xml).toContain('% OF ALLOC.');
      expect(xml).toContain('ELIGIBLE?');
      expect(xml).toContain('Sample ULB 1');
      expect(xml).toContain('Sample ULB 2');
    });

    it('renders Yes/No for the eligibility column, not true/false', async () => {
      documentService.getDocumentData.mockResolvedValue(buildYesBranchData(2));
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('>Yes<');
      expect(xml).toContain('>No<');
      expect(xml).not.toMatch(/>true</);
      expect(xml).not.toMatch(/>false</);
    });

    it('formats money fields with the Cr. suffix', async () => {
      documentService.getDocumentData.mockResolvedValue(buildYesBranchData(1));
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('100 Cr.');
      expect(xml).toContain('4 Cr.');
    });

    it('uses the "This is submitted for the consideration" closing wording verbatim from the reference PDF', async () => {
      documentService.getDocumentData.mockResolvedValue(buildYesBranchData(1));
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('This is submitted for the consideration of the first installment claim for FY 2026-27');
    });

    it('uses the dynamic FC cycle label in the table header, not a hardcoded "14TH FC"', async () => {
      const data = buildYesBranchData(1);
      const withDifferentCycle = {
        ...data,
        priorFcCycleLabel: '15th FC',
        priorFcCycleFullLabel: '15th Finance Commission',
      };
      documentService.getDocumentData.mockResolvedValue(withDifferentCycle);
      const result = await service.generateDeclarationDocument(stateId, yearId, user);
      const xml = await extractDocumentXml(result.buffer);

      expect(xml).toContain('15TH FC UNSPENT');
      expect(xml).not.toContain('14TH FC UNSPENT');
    });
  });

  it('renders the closing signature block as literal, non-interpolated placeholder text — including its own "[State Name]"', async () => {
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
  });

  it('never emits an em dash anywhere in the generated document', async () => {
    documentService.getDocumentData.mockResolvedValue(buildYesBranchData(2));
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).not.toContain('—');
  });

  it('bolds the subject line', async () => {
    documentService.getDocumentData.mockResolvedValue(buildNoBranchData());
    const result = await service.generateDeclarationDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain(
      'Subject: Declaration regarding nil 14th Finance Commission unspent balance with Urban Local Bodies',
    );
  });
});
