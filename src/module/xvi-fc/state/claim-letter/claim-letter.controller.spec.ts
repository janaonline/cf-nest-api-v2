import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { REQUIRED_PERMISSIONS_KEY } from 'src/module/auth/require-permissions.decorator';
import { ClaimLetterController } from './claim-letter.controller';
import { ClaimLetterService } from './services/main/claim-letter.service';
import { ClaimLetterUlbOptionsService } from './services/ulb-options/claim-letter-ulb-options.service';
import { ClaimLetterUlbRowsService } from './services/ulb-rows/claim-letter-ulb-rows.service';
import { ClaimLetterAssemblyService } from './services/assembly/claim-letter-assembly.service';
import { ClaimLetterDocumentService } from './services/document/claim-letter-document.service';
import { ClaimLetterPdfService } from './services/document/claim-letter-pdf.service';

/** Reads permission metadata off the class prototype — avoids extracting an unbound instance
 *  method (the decorator attaches metadata to the prototype function itself either way). */
function requiredPermissions(methodName: keyof ClaimLetterController): unknown {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ClaimLetterController.prototype[methodName]);
}

describe('ClaimLetterController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const claimLetterId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: ClaimLetterController;
  let claimLetterService: Record<string, jest.Mock>;
  let ulbOptionsService: Record<string, jest.Mock>;
  let ulbRowsService: Record<string, jest.Mock>;
  let assemblyService: Record<string, jest.Mock>;
  let documentService: Record<string, jest.Mock>;
  let pdfService: Record<string, jest.Mock>;

  beforeEach(async () => {
    claimLetterService = {
      getEligibilitySummary: jest.fn().mockResolvedValue({ success: true }),
      getDetail: jest.fn().mockResolvedValue({ success: true }),
      listHistory: jest.fn().mockResolvedValue({ success: true, data: [] }),
      uploadSignedFile: jest.fn().mockResolvedValue({ success: true }),
      submit: jest.fn().mockResolvedValue({ success: true }),
    };
    ulbOptionsService = { getOptions: jest.fn().mockResolvedValue({ success: true, data: [] }) };
    ulbRowsService = { getUlbs: jest.fn().mockResolvedValue({ success: true, data: [] }) };
    assemblyService = {
      createDraft: jest.fn().mockResolvedValue({ success: true }),
      updateDraft: jest.fn().mockResolvedValue({ success: true }),
      abandonDraft: jest.fn().mockResolvedValue({ success: true }),
    };
    documentService = { getDocumentData: jest.fn().mockResolvedValue({ success: true }) };
    pdfService = {
      generateDocumentPdf: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from('pdf-bytes'), fileName: 'claim-letter-CL-AP-1-1.pdf' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClaimLetterController],
      providers: [
        { provide: ClaimLetterService, useValue: claimLetterService },
        { provide: ClaimLetterUlbOptionsService, useValue: ulbOptionsService },
        { provide: ClaimLetterUlbRowsService, useValue: ulbRowsService },
        { provide: ClaimLetterAssemblyService, useValue: assemblyService },
        { provide: ClaimLetterDocumentService, useValue: documentService },
        { provide: ClaimLetterPdfService, useValue: pdfService },
      ],
    }).compile();

    controller = module.get(ClaimLetterController);
  });

  it('GET :stateId/:yearId/:installment/eligibility-summary delegates with a parsed numeric installment', async () => {
    await controller.getEligibilitySummary(stateId, yearId, '1', user);
    expect(claimLetterService['getEligibilitySummary']).toHaveBeenCalledWith(stateId, yearId, 1, user);
    expect(requiredPermissions('getEligibilitySummary')).toEqual([Permission.VIEW_STATE_FORMS]);
  });

  it('rejects a non-1/2 installment before reaching the service', () => {
    // parseInstallment throws synchronously (the controller method isn't async), so the
    // exception surfaces from the call itself, not from a rejected promise.
    expect(() => controller.getEligibilitySummary(stateId, yearId, 'abc', user)).toThrow();
    expect(claimLetterService['getEligibilitySummary']).not.toHaveBeenCalled();
  });

  it('GET :stateId/:yearId/:installment/ulb-options delegates with a parsed numeric installment', async () => {
    const query = { search: 'a', page: 1, limit: 10 };
    await controller.getUlbOptions(stateId, yearId, '1', query, user);
    expect(ulbOptionsService['getOptions']).toHaveBeenCalledWith(stateId, yearId, 1, query, user);
    expect(requiredPermissions('getUlbOptions')).toEqual([Permission.VIEW_STATE_FORMS]);
  });

  it('POST :stateId/:yearId/:installment/draft delegates to ClaimLetterAssemblyService.createDraft', async () => {
    const dto = { ulbSelections: [{ ulbId: 'u1', claimedAmount: 100 }], idempotencyKey: 'key-1' };
    await controller.createDraft(stateId, yearId, '1', dto, user);
    expect(assemblyService['createDraft']).toHaveBeenCalledWith({
      stateId,
      yearId,
      installment: 1,
      ulbSelections: dto.ulbSelections,
      buildRequestId: 'key-1',
      user,
    });
    expect(requiredPermissions('createDraft')).toEqual([Permission.PREPARE_GRANT_LETTERS]);
  });

  it('PATCH :claimLetterId/draft delegates to ClaimLetterAssemblyService.updateDraft', async () => {
    const dto = { ulbSelections: [{ ulbId: 'u1', claimedAmount: 100 }], expectedRevision: 2 };
    await controller.updateDraft(claimLetterId, dto, user);
    expect(assemblyService['updateDraft']).toHaveBeenCalledWith(claimLetterId, dto.ulbSelections, 2, user);
    expect(requiredPermissions('updateDraft')).toEqual([Permission.PREPARE_GRANT_LETTERS]);
  });

  it('POST :claimLetterId/abandon delegates to ClaimLetterAssemblyService.abandonDraft', async () => {
    await controller.abandonDraft(claimLetterId, user);
    expect(assemblyService['abandonDraft']).toHaveBeenCalledWith(claimLetterId, user);
    expect(requiredPermissions('abandonDraft')).toEqual([Permission.PREPARE_GRANT_LETTERS]);
  });

  it('POST :claimLetterId/signed-file delegates to ClaimLetterService.uploadSignedFile', async () => {
    const fileRef = { originalName: 'x.pdf', path: 'x', mimeType: 'application/pdf', sizeKb: 1 } as never;
    await controller.uploadSignedFile(claimLetterId, fileRef, user);
    expect(claimLetterService['uploadSignedFile']).toHaveBeenCalledWith(claimLetterId, fileRef, user);
    expect(requiredPermissions('uploadSignedFile')).toEqual([Permission.PREPARE_GRANT_LETTERS]);
  });

  it('POST :claimLetterId/submit delegates to ClaimLetterService.submit with ip/userAgent', async () => {
    await controller.submit(claimLetterId, user, '127.0.0.1', 'jest-agent');
    expect(claimLetterService['submit']).toHaveBeenCalledWith(claimLetterId, user, '127.0.0.1', 'jest-agent');
    expect(requiredPermissions('submit')).toEqual([Permission.FINAL_SUBMIT_TO_MOHUA]);
  });

  it('GET :stateId/:yearId/history delegates to ClaimLetterService.listHistory', async () => {
    const query = { page: 1, limit: 10 };
    await controller.listHistory(stateId, yearId, query, user);
    expect(claimLetterService['listHistory']).toHaveBeenCalledWith(stateId, yearId, query, user);
    expect(requiredPermissions('listHistory')).toEqual([Permission.VIEW_STATE_FORMS]);
  });

  it('GET :claimLetterId delegates to ClaimLetterService.getDetail', async () => {
    await controller.getDetail(claimLetterId, user);
    expect(claimLetterService['getDetail']).toHaveBeenCalledWith(claimLetterId, user);
    expect(requiredPermissions('getDetail')).toEqual([Permission.VIEW_STATE_FORMS]);
  });

  it('GET :claimLetterId/ulbs delegates to ClaimLetterUlbRowsService.getUlbs', async () => {
    const query = { page: 1, limit: 10 };
    await controller.getUlbs(claimLetterId, query, user);
    expect(ulbRowsService['getUlbs']).toHaveBeenCalledWith(claimLetterId, query, user);
    expect(requiredPermissions('getUlbs')).toEqual([Permission.VIEW_STATE_FORMS]);
  });

  it('GET :claimLetterId/document delegates to ClaimLetterDocumentService.getDocumentData', async () => {
    await controller.getDocument(claimLetterId, user);
    expect(documentService['getDocumentData']).toHaveBeenCalledWith(claimLetterId, user);
    expect(requiredPermissions('getDocument')).toEqual([Permission.VIEW_STATE_FORMS]);
  });

  it('GET :claimLetterId/document/pdf returns a StreamableFile built from ClaimLetterPdfService', async () => {
    const result = await controller.getDocumentPdf(claimLetterId, user);

    expect(pdfService['generateDocumentPdf']).toHaveBeenCalledWith(claimLetterId, user);
    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.options.type).toBe('application/pdf');
    expect(result.options.disposition).toBe('attachment; filename="claim-letter-CL-AP-1-1.pdf"');
    expect(requiredPermissions('getDocumentPdf')).toEqual([Permission.VIEW_STATE_FORMS]);
  });
});
