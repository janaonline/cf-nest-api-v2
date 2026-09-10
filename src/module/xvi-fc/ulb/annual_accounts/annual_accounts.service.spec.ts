import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AnnualAccountsService } from './annual_accounts.service';
import { XviFcAnnualAccount } from '../../../../schemas/xvi-fc/annual-account.schema';
import { XviFcAnnualAccountUploadHistory } from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { XviFcAnnualAccountFormLog } from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import { XviFcDocumentActionGate } from '../../../../schemas/xvi-fc/document-action-gate.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { User } from '../../../../schemas/user/user.schema';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../file/s3-upload.service';
import { FormJsonService } from '../../../../master/form-json/form-json.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { UlbEligibilityService } from '../../../ulb-eligibility/ulb-eligibility.service';
import { FormReturnedNotificationService } from '../../common/reminders/form-returned-notification.service';
import type { AuthUser } from '../../../auth/auth-user.interface';

/** Shape of the second argument passed to Mongoose's updateOne in the tests below. */
interface MongoUpdateCall {
  $set?: Record<string, unknown>;
  $push?: Record<string, unknown>;
}

/** Mimics a Mongoose query — `.select()`/`.lean()` are no-ops that return the same
 *  chain object, `.exec()` resolves to the given value, regardless of call order. */
function mockQuery<T>(result: T) {
  const query: Record<string, unknown> = {
    exec: () => Promise.resolve(result),
  };
  query.select = () => query;
  query.lean = () => query;
  return query;
}

describe('AnnualAccountsService', () => {
  let service: AnnualAccountsService;
  let mockAnnualAccountModel: Record<string, jest.Mock>;
  let mockUploadHistoryModel: Record<string, jest.Mock | { dropIndex: jest.Mock }>;
  let mockUlbModel: Record<string, jest.Mock>;
  let mockUserModel: Record<string, jest.Mock>;
  let mockFormLogModel: { create: jest.Mock };

  let mockOcrQueue: { add: jest.Mock };
  let mockFormJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let mockS3Service: Record<string, jest.Mock>;
  let mockActionGateModel: { find: jest.Mock };
  let mockFileTokenService: { signFileUrl: jest.Mock };
  let mockUlbEligibilityService: { assertUlbEligibleForGrantCycle: jest.Mock };
  let mockFormReturnedNotification: { notifyReturned: jest.Mock };

  beforeEach(async () => {
    mockAnnualAccountModel = {
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      aggregate: jest.fn().mockReturnValue(mockQuery([{ data: [], totalCount: [] }])),
    };
    mockUploadHistoryModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      collection: {
        dropIndex: jest.fn().mockResolvedValue(undefined),
      },
    };
    mockFormLogModel = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockUlbModel = {
      findById: jest.fn().mockReturnValue(mockQuery({ state: { toString: () => 'state-1' } })),
    };
    mockUserModel = {
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
    };
    mockS3Service = {
      headObject: jest.fn().mockResolvedValue(undefined),
      getPdfBufferFromS3: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      getPdfPageCountFromBuffer: jest.fn().mockResolvedValue(3),
      presignGet: jest.fn(),
    };
    const mockS3UploadService = {
      generatePutSignedUrl: jest.fn(),
    };
    mockOcrQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    mockFormJsonService = {
      findActiveByDesignYearAndFormId: jest.fn(),
    };
    mockActionGateModel = {
      find: jest.fn().mockReturnValue(mockQuery([])),
    };
    mockFileTokenService = {
      signFileUrl: jest.fn((path: string) => `https://signed.example.com/${path}`),
    };
    mockUlbEligibilityService = {
      assertUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(undefined),
    };
    mockFormReturnedNotification = {
      notifyReturned: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualAccountsService,
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcAnnualAccountUploadHistory.name), useValue: mockUploadHistoryModel },
        { provide: getModelToken(XviFcAnnualAccountFormLog.name), useValue: mockFormLogModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(XviFcDocumentActionGate.name), useValue: mockActionGateModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3UploadService, useValue: mockS3UploadService },
        { provide: getQueueToken(ANNUAL_ACCOUNT_PROCESSING_QUEUE), useValue: mockOcrQueue },
        { provide: FormJsonService, useValue: mockFormJsonService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
        { provide: FormReturnedNotificationService, useValue: mockFormReturnedNotification },
      ],
    }).compile();

    service = module.get<AnnualAccountsService>(AnnualAccountsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProcessingStatus / getDetails / findByUlbAndYear — single-section, data field', () => {
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';
    const ULB_ID = '507f1f77bcf86cd799439011';
    const YEAR_ID = '507f1f77bcf86cd799439013';
    const user: AuthUser = { _id: 'user-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    const auditedAnchor = {
      _id: ACCOUNT_ID,
      ulb: ULB_ID,
      design_year: YEAR_ID,
      sectionType: 'audited',
      form_status: 'UNDER_REVIEW_BY_STATE',
      form_status_id: 3,
      documents: [{ docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null }],
    };

    it('getProcessingStatus resolves the requested section and returns it under `data`, no sibling fetch for auditedData', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(auditedAnchor));
      mockUlbModel.findById.mockReturnValue(mockQuery({ name: 'Test ULB', code: 'TU1' }));

      const result = await service.getProcessingStatus(ACCOUNT_ID, 'auditedData', user);

      expect(mockAnnualAccountModel.findOne).not.toHaveBeenCalled();
      expect(result.annualAccountId).toBe(ACCOUNT_ID);
      expect(result.ulbName).toBe('Test ULB');
      expect(result.data.form_status).toBe('UNDER_REVIEW_BY_STATE');
      expect('auditedData' in result).toBe(false);
      expect('unauditedData' in result).toBe(false);
    });

    it('getProcessingStatus looks up the unaudited sibling by {ulb, design_year, sectionType} and returns NOT_STARTED when it does not exist yet', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(auditedAnchor));
      mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));
      mockUlbModel.findById.mockReturnValue(mockQuery({ name: 'Test ULB', code: 'TU1' }));

      const result = await service.getProcessingStatus(ACCOUNT_ID, 'unauditedData', user);

      expect(mockAnnualAccountModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ ulb: ULB_ID, design_year: YEAR_ID, sectionType: 'unaudited' }),
      );
      expect(result.data.form_status).toBe('NOT_STARTED');
      expect(result.data.documents).toEqual([]);
    });

    it('getDetails returns {annualAccountId, data} for the resolved section, S3 keys stripped', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        mockQuery({
          ...auditedAnchor,
          documents: [
            {
              docId: 'auditors-report',
              currentUpload: { file: { originalName: 'a.pdf', s3Key: 'secret/path.pdf' } },
            },
          ],
        }),
      );

      const result = await service.getDetails(ACCOUNT_ID, 'auditedData', user);

      expect(result.annualAccountId).toBe(ACCOUNT_ID);
      expect(result.data.documents[0].currentUpload.file.s3Key).toBeUndefined();
      expect('auditedData' in result).toBe(false);
    });

    it('findByUlbAndYear always looks up the audited anchor regardless of the requested section, then delegates', async () => {
      mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(auditedAnchor));
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(auditedAnchor));
      mockUlbModel.findById.mockReturnValue(mockQuery({ name: 'Test ULB', code: 'TU1' }));

      const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'unauditedData', user);

      expect(mockAnnualAccountModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ sectionType: 'audited' }));
      expect(result).not.toBeNull();
    });

    it('findByUlbAndYear returns null when no annual account exists yet for this ulb+year', async () => {
      mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));

      const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

      expect(result).toBeNull();
    });
  });

  describe('confirmUpload — OCR skip for optional, direct-to-DB documents', () => {
    const USER_ID = '507f1f77bcf86cd799439099';
    const ULB_ID = '507f1f77bcf86cd799439011';
    const STATE_ID = '507f1f77bcf86cd799439012';
    const YEAR_ID = '507f1f77bcf86cd799439013';
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';
    const baseUser: AuthUser = { _id: USER_ID, role: 'ULB-EDITOR', scope: 'ULB', ulb: ULB_ID } as AuthUser;

    const baseDto = {
      ulbId: ULB_ID,
      stateId: STATE_ID,
      designYearId: YEAR_ID,
      yearId: YEAR_ID,
      year: 'FY 2024-25',
      section: 'auditedData' as const,
      uploadId: 'upload-1',
      originalName: 'notes.pdf',
      fileSize: 1024,
    };

    beforeEach(() => {
      mockAnnualAccountModel.findOneAndUpdate.mockReturnValue(mockQuery({ _id: { toString: () => ACCOUNT_ID } }));
      mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));
      // upsertDocumentSlot resolves the target physical document via findById first — 'auditedData'
      // uploads always land on the anchor itself, no sibling lookup needed.
      mockAnnualAccountModel.findById.mockReturnValue(
        mockQuery({ _id: ACCOUNT_ID, ulb: ULB_ID, state: STATE_ID, design_year: YEAR_ID, sectionType: 'audited' }),
      );
      mockUlbModel.findById.mockReturnValue(mockQuery({ state: { toString: () => STATE_ID } }));
    });

    it('marks a no-OCR docId PASSED immediately and never enqueues an OCR job', async () => {
      const dto = {
        ...baseDto,
        docId: 'notes-to-accounts',
        s3Key: `xvi-fc/annual-accounts/${ULB_ID}/${YEAR_ID}/auditedData/notes-to-accounts/upload-1.pdf`,
      };

      const result = await service.confirmUpload(dto as any, baseUser);

      expect(result.processingStatus).toBe('PASSED');
      expect(mockOcrQueue.add).not.toHaveBeenCalled();
      expect(mockUploadHistoryModel.create as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ processingStatus: 'PASSED' }),
      );
    });

    it('still enqueues OCR and stays PROCESSING for a regular (OCR-backed) docId', async () => {
      const dto = {
        ...baseDto,
        docId: 'auditors-report',
        s3Key: `xvi-fc/annual-accounts/${ULB_ID}/${YEAR_ID}/auditedData/auditors-report/upload-1.pdf`,
      };

      const result = await service.confirmUpload(dto as any, baseUser);

      expect(result.processingStatus).toBe('PROCESSING');
      expect(mockOcrQueue.add).toHaveBeenCalled();
    });

    it('rejects a docId that is neither OCR-mapped nor a known no-OCR document', async () => {
      const dto = {
        ...baseDto,
        docId: 'unknown-doc',
        s3Key: `xvi-fc/annual-accounts/${ULB_ID}/${YEAR_ID}/auditedData/unknown-doc/upload-1.pdf`,
      };

      await expect(service.confirmUpload(dto as any, baseUser)).rejects.toThrow('Unknown docId');
    });
  });

  describe('submitSection — optional documents never block submission', () => {
    const baseUser: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ULB-EDITOR', scope: 'ULB' } as AuthUser;
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';
    const YEAR_ID = '507f1f77bcf86cd799439013';

    it('does not require an optional (required: false) doc to be PASSED', async () => {
      mockAnnualAccountModel.findById.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              _id: ACCOUNT_ID,
              ulb: '507f1f77bcf86cd799439011',
              design_year: YEAR_ID,
              sectionType: 'audited',
              form_status_id: 2,
              documents: [
                { docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null },
                { docId: 'notes-to-accounts', processingStatus: 'NOT_STARTED', stateDecision: null },
              ],
            }),
        }),
      });
      mockFormJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({
        data: [
          { key: 'auditors-report', required: true },
          { key: 'notes-to-accounts', required: false },
        ],
      });

      const result = await service.submitSection(ACCOUNT_ID, 'auditedData', baseUser);

      expect(result.section).toBe('auditedData');
    });
  });

  describe('decideDocument — writes a single stateDecision object, not an array push', () => {
    const adminUser: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';

    it('sets stateDecision via $set with a single object, no $push', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        mockQuery({
          _id: ACCOUNT_ID,
          ulb: '507f1f77bcf86cd799439011',
          sectionType: 'audited',
          form_status: 'UNDER_REVIEW_BY_STATE',
          documents: [{ docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null }],
        }),
      );

      await service.decideDocument(
        ACCOUNT_ID,
        'auditors-report',
        { section: 'auditedData', decision: 'APPROVED' },
        adminUser,
      );

      const [filter, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [
        Record<string, unknown>,
        MongoUpdateCall,
      ];
      expect(filter).toMatchObject({ 'documents.docId': 'auditors-report' });
      expect(update.$push).toBeUndefined();
      expect(update.$set?.['documents.$.stateDecision']).toMatchObject({ status: 'APPROVED' });
    });

    it("resolves the 'unauditedData' sibling by {ulb, design_year, sectionType} when the anchor is 'audited'", async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        mockQuery({ _id: ACCOUNT_ID, ulb: '507f1f77bcf86cd799439011', design_year: 'year-1', sectionType: 'audited' }),
      );
      mockAnnualAccountModel.findOne.mockReturnValue(
        mockQuery({
          _id: 'unaudited-doc-id',
          ulb: '507f1f77bcf86cd799439011',
          sectionType: 'unaudited',
          form_status: 'UNDER_REVIEW_BY_STATE',
          documents: [{ docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null }],
        }),
      );

      await service.decideDocument(
        ACCOUNT_ID,
        'auditors-report',
        { section: 'unauditedData', decision: 'APPROVED' },
        adminUser,
      );

      expect(mockAnnualAccountModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ ulb: '507f1f77bcf86cd799439011', design_year: 'year-1', sectionType: 'unaudited' }),
      );
      const [filter] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(filter).toMatchObject({ _id: 'unaudited-doc-id', 'documents.docId': 'auditors-report' });
    });

    it("throws Section not found when the 'unauditedData' sibling has never been created", async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        mockQuery({ _id: ACCOUNT_ID, ulb: '507f1f77bcf86cd799439011', design_year: 'year-1', sectionType: 'audited' }),
      );
      mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));

      await expect(
        service.decideDocument(
          ACCOUNT_ID,
          'auditors-report',
          { section: 'unauditedData', decision: 'APPROVED' },
          adminUser,
        ),
      ).rejects.toThrow('Section not found');
    });
  });

  describe('undoDocumentDecision', () => {
    const adminUser: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';

    const docWithStatus = (form_status: string) =>
      mockQuery({
        _id: ACCOUNT_ID,
        ulb: '507f1f77bcf86cd799439011',
        sectionType: 'audited',
        form_status,
        documents: [
          {
            docId: 'auditors-report',
            processingStatus: 'PASSED',
            stateDecision: { status: 'APPROVED', note: null, decidedAt: new Date() },
          },
        ],
      });

    it('resets stateDecision to null while the section is still under state review', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithStatus('UNDER_REVIEW_BY_STATE'));

      await service.undoDocumentDecision(ACCOUNT_ID, 'auditedData', 'auditors-report', adminUser);

      const [, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(update.$set?.['documents.$.stateDecision']).toBeNull();
    });

    it('is blocked once the section has been finalized past state review', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithStatus('UNDER_REVIEW_BY_MOHUA'));

      await expect(
        service.undoDocumentDecision(ACCOUNT_ID, 'auditedData', 'auditors-report', adminUser),
      ).rejects.toThrow(/cannot be decided/i);
    });
  });

  describe('getUploadConfig — folds action gates into the formjson response', () => {
    beforeEach(() => {
      mockFormJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({
        meta: { uploadType: 'audited' },
        data: [{ key: 'auditors-report', label: 'Auditor Report' }],
      });
    });

    it('queries gates scoped to this form (or the module-wide wildcard) and returns them alongside formjson data', async () => {
      const gateDocs = [
        { docKey: null, scope: 'document', role: 'ULB', action: 'upload', statusIds: [1, 2, 4, 6] },
        { docKey: null, scope: 'section', role: 'STATE', action: 'approveSection', statusIds: [3] },
      ];
      mockActionGateModel.find.mockReturnValue(mockQuery(gateDocs));

      const result = await service.getUploadConfig('audited', 'year-1');

      expect(mockActionGateModel.find).toHaveBeenCalledWith({
        module: 'XVI-FC',
        formId: { $in: [null, 30] },
        isActive: true,
      });
      expect(result.data).toEqual([{ key: 'auditors-report', label: 'Auditor Report' }]);
      expect(result.actionGates).toEqual(gateDocs.map((g) => ({ ...g })));
    });

    it('returns an empty actionGates array when no gates are configured', async () => {
      mockActionGateModel.find.mockReturnValue(mockQuery([]));

      const result = await service.getUploadConfig('provisional', 'year-1');

      expect(mockActionGateModel.find).toHaveBeenCalledWith({
        module: 'XVI-FC',
        formId: { $in: [null, 31] },
        isActive: true,
      });
      expect(result.actionGates).toEqual([]);
    });
  });
});
