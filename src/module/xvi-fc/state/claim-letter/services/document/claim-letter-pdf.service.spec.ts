import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { ClaimLetterPdfService } from './claim-letter-pdf.service';
import { ClaimLetterDocumentService } from './claim-letter-document.service';
import type { ClaimLetterDocumentData } from '../../types/claim-letter.types';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';

const CRITERIA_COLUMNS = [
  { type: 'UPLOAD_CONFIG_AUDITED', label: 'Audited Financial Statement', shortLabel: 'AFS' },
  { type: 'UPLOAD_CONFIG_PROVISIONAL', label: 'Provisional Financial Statement', shortLabel: 'PFS' },
  { type: 'FC_UNSPENT_STATE', label: 'FC Unspent Balance Disclosure', shortLabel: 'FC Disclosure' },
  { type: 'ELECTED_BODY', label: 'Confirmation of constituted elected body', shortLabel: 'Elected Bodies' },
];

function buildDocumentData(rowCount: number): ClaimLetterDocumentData {
  const coveringLetterRows = Array.from({ length: rowCount }, (_, i) => ({
    slNo: i + 1,
    ulbId: `ulb-${i}`,
    ulbName: `Sample Municipal Corporation ${i}`,
    claimAmount: 1.5,
  }));

  return {
    refNo: 'CL/AP/2026-27/1-1',
    letterDate: '2026-06-30T00:00:00.000Z',
    stateName: 'Andhra Pradesh',
    departmentName: 'Directorate of Municipal Administration',
    designYearLabel: '2026-27',
    installment: 1,
    batchNumber: 1,
    priorFcCycleLabel: '14th FC',
    subjectLine: 'Claim Letter subject line',
    introParagraph: 'Intro paragraph text describing the batch of Urban Local Bodies being recommended.',
    closingParagraph: 'Closing paragraph text forwarding the letter to MoHUA for review.',
    signatoryName: 'Vikram Rao',
    signatoryDesignation: 'Finance Analyst',
    coveringLetterRows,
    totalClaimAmount: rowCount * 1.5,
    annexure1Rows: coveringLetterRows.map((row) => ({
      slNo: row.slNo,
      ulbId: row.ulbId,
      ulbName: row.ulbName,
      priorFcUnspentAmount: 0.08,
      claimedAmount: row.claimAmount,
      eligible: true,
    })),
    annexure2Columns: CRITERIA_COLUMNS,
    annexure2Rows: coveringLetterRows.map((row) => ({
      slNo: row.slNo,
      ulbId: row.ulbId,
      ulbName: row.ulbName,
      criteria: CRITERIA_COLUMNS.map((col) => ({ type: col.type, met: true })),
    })),
  };
}

describe('ClaimLetterPdfService', () => {
  let service: ClaimLetterPdfService;
  let documentService: { getDocumentData: jest.Mock };

  const claimLetterId = 'claim-letter-1';
  const user: AuthUser = { _id: 'user-1', role: 'STATE', scope: Scope.STATE, accessLevel: null };

  beforeEach(async () => {
    documentService = { getDocumentData: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ClaimLetterPdfService, { provide: ClaimLetterDocumentService, useValue: documentService }],
    }).compile();

    service = module.get(ClaimLetterPdfService);
  });

  it('propagates NotFoundException from getDocumentData', async () => {
    documentService.getDocumentData.mockRejectedValue(new NotFoundException('not found'));
    await expect(service.generateDocumentPdf(claimLetterId, user)).rejects.toThrow(NotFoundException);
  });

  it('propagates ForbiddenException from getDocumentData', async () => {
    documentService.getDocumentData.mockRejectedValue(new ForbiddenException('denied'));
    await expect(service.generateDocumentPdf(claimLetterId, user)).rejects.toThrow(ForbiddenException);
  });

  it('sanitizes "/" and "\\\\" out of refNo for the filename', async () => {
    documentService.getDocumentData.mockResolvedValue({
      success: true,
      message: 'ok',
      data: buildDocumentData(1),
      timestamp: new Date().toISOString(),
    });

    const result = await service.generateDocumentPdf(claimLetterId, user);

    expect(result.fileName).toBe('claim-letter-CL-AP-2026-27-1-1.pdf');
  });

  it('produces a well-formed PDF with at least 3 pages (one per section) for a small batch', async () => {
    documentService.getDocumentData.mockResolvedValue({
      success: true,
      message: 'ok',
      data: buildDocumentData(2),
      timestamp: new Date().toISOString(),
    });

    const result = await service.generateDocumentPdf(claimLetterId, user);

    const loaded = await PdfLibDocument.load(result.buffer);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it('adds extra pages (with a repeated header) once a section overflows a single page', async () => {
    documentService.getDocumentData.mockResolvedValue({
      success: true,
      message: 'ok',
      data: buildDocumentData(2),
      timestamp: new Date().toISOString(),
    });
    const small = await service.generateDocumentPdf(claimLetterId, user);
    const smallPageCount = (await PdfLibDocument.load(small.buffer)).getPageCount();

    documentService.getDocumentData.mockResolvedValue({
      success: true,
      message: 'ok',
      data: buildDocumentData(80),
      timestamp: new Date().toISOString(),
    });
    const large = await service.generateDocumentPdf(claimLetterId, user);
    const largePageCount = (await PdfLibDocument.load(large.buffer)).getPageCount();

    expect(largePageCount).toBeGreaterThan(smallPageCount);
  });
});
