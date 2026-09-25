import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import JSZip from 'jszip';
import { ElectedUrbanLocalBodiesDocxService } from './elected-urban-local-bodies-docx.service';
import { ElectedUrbanLocalBodiesDocumentService } from './elected-urban-local-bodies-document.service';
import type { EulbListDocumentData } from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies-document.types';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';

const COLUMNS = [
  { key: 'censusCode', label: 'Census Code' },
  { key: 'ulbName', label: 'ULB Name' },
  { key: 'electedBodyStatus', label: 'Elected Body Status' },
  { key: 'dateOfConstitution', label: 'Date on which the elected body is in place' },
  { key: 'dateOfExpiry', label: 'Date of Expiry' },
  { key: 'remarks', label: 'Remarks' },
];

function buildDocumentData(rowCount: number): EulbListDocumentData {
  return {
    stateName: 'Andhra Pradesh',
    ulbCount: rowCount,
    designYearLabel: '2026-27',
    columns: COLUMNS,
    rows: Array.from({ length: rowCount }, (_, i) => ({
      slNo: i + 1,
      censusCode: `C00${i + 1}`,
      ulbName: `Sample ULB ${i + 1}`,
      electedBodyStatus: 'Constituted',
      dateOfConstitution: new Date('2022-06-15T00:00:00.000Z'),
      dateOfExpiry: new Date('2027-06-14T00:00:00.000Z'),
      remarks: '',
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

describe('ElectedUrbanLocalBodiesDocxService', () => {
  let service: ElectedUrbanLocalBodiesDocxService;
  let documentService: { getDocumentData: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  beforeEach(async () => {
    documentService = { getDocumentData: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesDocxService,
        { provide: ElectedUrbanLocalBodiesDocumentService, useValue: documentService },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesDocxService);
  });

  it('propagates the noRows/rowsNotValid gate exception from getDocumentData', async () => {
    documentService.getDocumentData.mockRejectedValue(new BadRequestException('validation failed'));
    await expect(service.generateElectedBodiesListDocument(stateId, yearId, user)).rejects.toThrow(BadRequestException);
  });

  it('produces a well-formed .docx (ZIP container with PK magic bytes)', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(2));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    expect(result.buffer.subarray(0, 2).toString('utf8')).toBe('PK');
  });

  it('renders the title heading, bold/underlined/centered, above the address block', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('Format of Letter to be Submitted by the State reg. Elected Bodies Status');
    expect(xml).toContain('w:jc w:val="center"');
    expect(xml).toMatch(/<w:u\b/);
  });

  it('opens with the EULB-specific addressee block, not the shared MoHUA one', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
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

  it('renders the new subject line and "Sir," salutation, not the old wording', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('Subject: Declaration in respect of Elected Body Status of Urban Local Bodies -reg.');
    expect(xml).toContain('Sir,');
    expect(xml).not.toContain('Declaration regarding Elected Body Status of Urban Local Bodies');
    expect(xml).not.toContain('Respected Sir/Madam,');
  });

  it('builds the CF_{StateName}_Elected-body-list_{YearLabel}.docx filename', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    expect(result.fileName).toBe('CF_Andhra-Pradesh_Elected-body-list_2026-27.docx');
  });

  it('interpolates the real state name and ULB count into the intro paragraph', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(3));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('State of Andhra Pradesh');
    expect(xml).toContain('all 3 Urban Local Bodies');
  });

  it('always uses the plural noun, even for a single-ULB dataset, matching the MoHUA specimen', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('all 1 Urban Local Bodies');
  });

  it('renders table headers from the form-json-sourced column labels, not hardcoded text', async () => {
    const data = buildDocumentData(1);
    data.columns = data.columns.map((c) => (c.key === 'censusCode' ? { ...c, label: 'Renamed Census Label' } : c));
    documentService.getDocumentData.mockResolvedValue(data);

    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('Renamed Census Label');
  });

  it('renders the closing signature block as literal, non-interpolated placeholder text — including its own "[State Name]" — right-aligned', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
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

  it('interpolates designYearLabel into the numbered closing paragraph rather than a hardcoded FY', async () => {
    const data = buildDocumentData(1);
    data.designYearLabel = '2031-32';
    documentService.getDocumentData.mockResolvedValue(data);

    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).toContain('2. This is submitted for the consideration of the claim of first installment');
    expect(xml).toContain('FY 2031-32');
    expect(xml).not.toContain('2026-27');
  });

  it('sets Times New Roman 12pt as the document default font', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(1));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const stylesXml = await extractStylesXml(result.buffer);

    expect(stylesXml).toContain('Times New Roman');
    expect(stylesXml).toContain('w:sz w:val="24"');
  });

  it('never emits an em dash anywhere in the generated document', async () => {
    documentService.getDocumentData.mockResolvedValue(buildDocumentData(2));
    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);
    const xml = await extractDocumentXml(result.buffer);

    expect(xml).not.toContain('—');
  });

  it('handles blank remarks and null dates without throwing', async () => {
    const data = buildDocumentData(1);
    data.rows[0].remarks = '';
    data.rows[0].dateOfConstitution = null;
    data.rows[0].dateOfExpiry = null;
    documentService.getDocumentData.mockResolvedValue(data);

    const result = await service.generateElectedBodiesListDocument(stateId, yearId, user);

    expect(result.buffer.length).toBeGreaterThan(0);
  });
});
