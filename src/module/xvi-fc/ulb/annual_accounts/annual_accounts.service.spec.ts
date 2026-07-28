import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AnnualAccountsService } from './annual_accounts.service';
import { XviFcAnnualAccount } from '../../../../schemas/xvi-fc/annual-account.schema';
import { XviFcAnnualAccountUploadHistory } from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { XviFcAnnualAccountFormLog } from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../../s3-upload/s3-upload.service';
import { FormJsonService } from '../../../../form-json/form-json.service';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
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
  let mockOcrQueue: { add: jest.Mock };
  let mockFormJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let mockS3Service: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockAnnualAccountModel = {
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
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
    const mockFormLogModel = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockUlbModel = {
      findById: jest.fn().mockReturnValue(mockQuery({ state: { toString: () => 'state-1' } })),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualAccountsService,
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcAnnualAccountUploadHistory.name), useValue: mockUploadHistoryModel },
        { provide: getModelToken(XviFcAnnualAccountFormLog.name), useValue: mockFormLogModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3UploadService, useValue: mockS3UploadService },
        { provide: getQueueToken(ANNUAL_ACCOUNT_PROCESSING_QUEUE), useValue: mockOcrQueue },
        { provide: FormJsonService, useValue: mockFormJsonService },
      ],
    }).compile();

    service = module.get<AnnualAccountsService>(AnnualAccountsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
      mockAnnualAccountModel.findOneAndUpdate.mockReturnValue(
        mockQuery({ _id: { toString: () => ACCOUNT_ID } }),
      );
      mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));
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
      expect((mockUploadHistoryModel.create as jest.Mock)).toHaveBeenCalledWith(
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
              auditedData: {
                form_status_id: 2,
                documents: [
                  { docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null },
                  { docId: 'notes-to-accounts', processingStatus: 'NOT_STARTED', stateDecision: null },
                ],
              },
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
          auditedData: {
            form_status: 'UNDER_REVIEW_BY_STATE',
            documents: [{ docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null }],
          },
          unauditedData: null,
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
      expect(filter).toMatchObject({ 'auditedData.documents.docId': 'auditors-report' });
      expect(update.$push).toBeUndefined();
      expect(update.$set?.['auditedData.documents.$.stateDecision']).toMatchObject({ status: 'APPROVED' });
    });
  });

  describe('undoDocumentDecision', () => {
    const adminUser: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';

    const docWithStatus = (form_status: string) =>
      mockQuery({
        _id: ACCOUNT_ID,
        ulb: '507f1f77bcf86cd799439011',
        auditedData: {
          form_status,
          documents: [
            {
              docId: 'auditors-report',
              processingStatus: 'PASSED',
              stateDecision: { status: 'APPROVED', note: null, decidedAt: new Date() },
            },
          ],
        },
        unauditedData: null,
      });

    it('resets stateDecision to null while the section is still under state review', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithStatus('UNDER_REVIEW_BY_STATE'));

      await service.undoDocumentDecision(ACCOUNT_ID, 'auditedData', 'auditors-report', adminUser);

      const [, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(update.$set?.['auditedData.documents.$.stateDecision']).toBeNull();
    });

    it('is blocked once the section has been finalized past state review', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithStatus('UNDER_REVIEW_BY_MOHUA'));

      await expect(
        service.undoDocumentDecision(ACCOUNT_ID, 'auditedData', 'auditors-report', adminUser),
      ).rejects.toThrow(/cannot be decided/i);
    });
  });
});
