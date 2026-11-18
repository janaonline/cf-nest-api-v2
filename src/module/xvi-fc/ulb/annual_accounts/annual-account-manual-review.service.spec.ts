import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AnnualAccountsService } from './annual_accounts.service';
import { AnnualAccountManualReviewService } from './annual-account-manual-review.service';
import { XviFcAnnualAccount } from '../../../../schemas/xvi-fc/annual-account.schema';
import { XviFcAnnualAccountUploadHistory } from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { XviFcAnnualAccountFormLog } from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import { XviFcDocumentActionGate } from '../../../../schemas/xvi-fc/document-action-gate.schema';
import { XviFcManualReviewRequest } from '../../../../schemas/xvi-fc/manual-review-request.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { Adc } from '../../../../schemas/adc.schema';
import { Year } from '../../../../schemas/year.schema';
import { User } from '../../../../schemas/user/user.schema';
import { ExemptionResolverService } from '../../common/services/exemption-resolver.service';
import { YearAccessService } from '../../common/services/year-access.service';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../file/s3-upload.service';
import { FormJsonService } from '../../../../master/form-json/form-json.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { EmailQueueService } from '../../../../core/queue/email-queue/email-queue.service';
import { ConfigService } from '@nestjs/config';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { UlbEligibilityService } from '../../../ulb-eligibility/ulb-eligibility.service';
import { FormReturnedNotificationService } from '../../common/reminders/form-returned-notification.service';
import { ExcelService } from '../../../../services/excel/excel.service';
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

describe('AnnualAccountManualReviewService', () => {
  let service: AnnualAccountManualReviewService;
  let mockAnnualAccountModel: Record<string, jest.Mock>;
  let mockUploadHistoryModel: Record<string, jest.Mock | { dropIndex: jest.Mock }>;
  let mockUlbModel: Record<string, jest.Mock>;
  let mockUserModel: Record<string, jest.Mock>;
  let mockFormLogModel: { create: jest.Mock };
  let mockManualReviewRequestModel: {
    create: jest.Mock;
    find: jest.Mock;
    findOneAndUpdate: jest.Mock;
    aggregate: jest.Mock;
  };

  let mockOcrQueue: { add: jest.Mock };
  let mockFormJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let mockS3Service: Record<string, jest.Mock>;
  let mockActionGateModel: { find: jest.Mock };
  let mockFileTokenService: { signFileUrl: jest.Mock };
  let mockEmailQueueService: { addEmailJob: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockUlbEligibilityService: { assertUlbEligibleForGrantCycle: jest.Mock };
  let mockFormReturnedNotification: { notifyReturned: jest.Mock };
  let mockExcelService: { generateExcel: jest.Mock };

  beforeEach(async () => {
    mockAnnualAccountModel = {
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
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
    mockManualReviewRequestModel = {
      create: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockReturnValue(mockQuery([])),
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'mr-1' }),
      aggregate: jest.fn().mockReturnValue(mockQuery([{ data: [], totalCount: [] }])),
    };
    mockUlbModel = {
      findById: jest.fn().mockReturnValue(mockQuery({ state: { toString: () => 'state-1' } })),
      find: jest.fn().mockReturnValue(mockQuery([])),
      aggregate: jest.fn().mockReturnValue(mockQuery([{ data: [], totalCount: [], counts: [] }])),
    };
    const mockYearModel = {
      findById: jest.fn().mockReturnValue(mockQuery(null)),
    };
    const mockExemptionResolverService = {
      resolveBulk: jest.fn().mockResolvedValue(new Map()),
      resolveDiscretionaryBulk: jest.fn().mockResolvedValue(new Map()),
      resolveDiscretionary: jest.fn().mockResolvedValue(null),
    };
    const mockYearAccessService = {
      getExemptFormIds: jest.fn().mockResolvedValue(new Set()),
    };
    mockUserModel = {
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
      // resolveDeciderName (xvi-fc-decision.util.ts) calls findById, not findOne — without this,
      // every decideManualReview test throws 'userModel.findById is not a function'.
      findById: jest.fn().mockReturnValue(mockQuery({ name: 'Admin User' })),
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
    mockEmailQueueService = {
      addEmailJob: jest.fn().mockResolvedValue(undefined),
    };
    mockConfigService = {
      get: jest.fn(),
    };
    mockUlbEligibilityService = {
      assertUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(undefined),
    };
    mockFormReturnedNotification = {
      notifyReturned: jest.fn().mockResolvedValue(undefined),
    };
    mockExcelService = {
      generateExcel: jest.fn().mockResolvedValue(Buffer.from('excel')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualAccountManualReviewService,
        // AnnualAccountsService is a real instance here (not mocked) — the manual-review service
        // reuses its resolveSectionDocument/validateViewAccess/getProcessingStatus, and these
        // tests want the same section-resolution and access-control behavior the moved-from
        // AnnualAccountsService.spec.ts tests exercised.
        AnnualAccountsService,
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcAnnualAccountUploadHistory.name), useValue: mockUploadHistoryModel },
        { provide: getModelToken(XviFcAnnualAccountFormLog.name), useValue: mockFormLogModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Adc.name), useValue: { find: jest.fn(), findById: jest.fn(), exists: jest.fn() } },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(XviFcDocumentActionGate.name), useValue: mockActionGateModel },
        { provide: getModelToken(XviFcManualReviewRequest.name), useValue: mockManualReviewRequestModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3UploadService, useValue: mockS3UploadService },
        { provide: getQueueToken(ANNUAL_ACCOUNT_PROCESSING_QUEUE), useValue: mockOcrQueue },
        { provide: FormJsonService, useValue: mockFormJsonService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
        { provide: FormReturnedNotificationService, useValue: mockFormReturnedNotification },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: ExemptionResolverService, useValue: mockExemptionResolverService },
        { provide: YearAccessService, useValue: mockYearAccessService },
      ],
    }).compile();

    service = module.get<AnnualAccountManualReviewService>(AnnualAccountManualReviewService);
  });

  describe('requestManualReview', () => {
    const ULB_ID = '507f1f77bcf86cd799439011';
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';
    const ulbUser: AuthUser = {
      _id: '507f1f77bcf86cd799439098',
      role: 'ULB-EDITOR',
      scope: 'ULB',
      ulb: ULB_ID,
    } as AuthUser;

    const YEAR_ID = '507f1f77bcf86cd799439012';

    // version 2: past the first attempt, so the "second try" rule lets it through by default.
    const docWithOcr = (ocrInfo: Record<string, unknown>, upload: Record<string, unknown> = { version: 2 }) =>
      mockQuery({
        _id: ACCOUNT_ID,
        ulb: ULB_ID,
        design_year: YEAR_ID,
        sectionType: 'audited',
        form_status: 'IN_PROGRESS',
        documents: [
          {
            docId: 'auditors-report',
            processingStatus: 'FAILED',
            currentUpload: { uploadId: 'upload-1', ocrInfo, ...upload },
            stateDecision: null,
          },
        ],
      });

    it('rejects non-ULB users', async () => {
      const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

      await expect(
        service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', stateUser),
      ).rejects.toThrow('Only ULB users may request manual review');
    });

    it("rejects a ULB user acting on another ULB's account", async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithOcr({ validationStatus: 'FAIL' }));
      const otherUlbUser: AuthUser = { _id: 'user-3', role: 'ULB-EDITOR', scope: 'ULB', ulb: 'other-ulb' } as AuthUser;

      await expect(
        service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', otherUlbUser),
      ).rejects.toThrow('Access denied');
    });

    it('rejects when OCR validation has not failed', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithOcr({ validationStatus: 'PASS' }));

      await expect(service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser)).rejects.toThrow(
        'Manual review can only be requested for a failed OCR validation.',
      );
    });

    it('rejects a technical failure (the OCR job crashed, so no validationStatus)', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithOcr({ validationStatus: null }));

      await expect(service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser)).rejects.toThrow(
        'Manual review can only be requested for a failed OCR validation.',
      );
    });

    it('treats a lowercase "fail" as a failed validation', async () => {
      // Already requested, so it stops at the next check: proof the FAIL check let it through.
      mockAnnualAccountModel.findById.mockReturnValue(docWithOcr({ validationStatus: 'fail', isManualReviewRequested: true }));

      await expect(service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser)).rejects.toThrow(
        'Manual review has already been requested for this document.',
      );
    });

    it('rejects when manual review was already requested', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docWithOcr({ validationStatus: 'FAIL', isManualReviewRequested: true }),
      );

      await expect(service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser)).rejects.toThrow(
        'Manual review has already been requested for this document.',
      );
    });

    it('rejects a first-attempt FAIL (v1, retried at most once), same rule as the UI', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docWithOcr({ validationStatus: 'FAIL' }, { version: 1, retryValidationCount: 1 }),
      );

      await expect(service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser)).rejects.toThrow(
        'Please retry or re-upload the document before requesting a manual review.',
      );
      expect(mockManualReviewRequestModel.create).not.toHaveBeenCalled();
    });

    it('accepts a v1 FAIL once it has been retried twice', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docWithOcr({ validationStatus: 'FAIL' }, { version: 1, retryValidationCount: 2 }),
      );

      await service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser);

      expect(mockManualReviewRequestModel.create).toHaveBeenCalled();
    });

    it('rejects when the section is no longer ULB-editable', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docWithOcr({ validationStatus: 'FAIL' }));
      // assertCanUlbUpload's own section lookup: already approved by the State (8).
      mockAnnualAccountModel.findOne.mockReturnValue(
        mockQuery({ form_status_id: 8, form_status: 'APPROVED_BY_STATE', documents: [] }),
      );

      await expect(service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser)).rejects.toThrow(
        'This section cannot be edited',
      );
      expect(mockManualReviewRequestModel.create).not.toHaveBeenCalled();
    });

    it('sets isManualReviewRequested on both the account and upload-history records', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docWithOcr({ validationStatus: 'FAIL', jobId: 'ocr-job-1' }),
      );
      mockUploadHistoryModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

      await service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser);

      const [filter, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [
        Record<string, unknown>,
        MongoUpdateCall,
      ];
      expect(filter).toMatchObject({ 'documents.docId': 'auditors-report' });
      expect(update.$set?.['documents.$.currentUpload.ocrInfo.isManualReviewRequested']).toBe(true);
      expect(update.$set?.['documents.$.manualReviewDecision']).toBeNull();
      expect(mockUploadHistoryModel.updateOne).toHaveBeenCalledWith(
        { uploadId: 'upload-1' },
        { $set: expect.objectContaining({ 'ocrInfo.isManualReviewRequested': true }) },
      );
      expect(mockManualReviewRequestModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          docId: 'auditors-report',
          uploadId: 'upload-1',
          ocrJobId: 'ocr-job-1',
          status: 'PENDING',
          dueAt: expect.any(Date),
        }),
      );
    });

    const docReturned = (postRejectionAttemptsUsed: number, uploadBlockedUntil: Date | null = null) =>
      mockQuery({
        _id: ACCOUNT_ID,
        ulb: ULB_ID,
        design_year: YEAR_ID,
        sectionType: 'audited',
        form_status: 'IN_PROGRESS',
        documents: [
          {
            docId: 'auditors-report',
            processingStatus: 'FAILED',
            currentUpload: { uploadId: 'upload-1', version: 4, ocrInfo: { validationStatus: 'FAIL' } },
            manualReviewDecision: { status: 'RETURNED', note: 'Wrong document' },
            postRejectionAttemptsUsed,
            uploadBlockedUntil,
          },
        ],
      });

    it('rejects a re-request while self-service attempts remain', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docReturned(1));

      await expect(
        service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser),
      ).rejects.toThrow(/already declined.*2 attempt\(s\) left/);
    });

    it('allows a re-request once all 3 self-service attempts are exhausted', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docReturned(3));

      await service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser);

      const [, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(update.$set?.['documents.$.currentUpload.ocrInfo.isManualReviewRequested']).toBe(true);
    });

    it('rejects while the document is in its post-rejection cooldown', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockAnnualAccountModel.findById.mockReturnValue(docReturned(3, future));

      await expect(
        service.requestManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', ulbUser),
      ).rejects.toThrow('Too many failed attempts');
    });
  });

  describe('decideManualReview', () => {
    const ULB_ID = '507f1f77bcf86cd799439011';
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';
    const adminUser: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    const docAwaitingReview = (overrides: Record<string, unknown> = {}) =>
      mockQuery({
        _id: ACCOUNT_ID,
        ulb: ULB_ID,
        design_year: 'year-1',
        sectionType: 'audited',
        form_status: 'IN_PROGRESS',
        documents: [
          {
            docId: 'auditors-report',
            processingStatus: 'FAILED',
            currentUpload: {
              uploadId: 'upload-1',
              file: { path: 's3/key.pdf' },
              ocrInfo: { validationStatus: 'FAIL', isManualReviewRequested: true },
            },
            manualReviewDecision: null,
            ...overrides,
          },
        ],
      });

    it('rejects non-ADMIN users', async () => {
      const ulbUser: AuthUser = { _id: 'user-1', role: 'ULB-EDITOR', scope: 'ULB', ulb: ULB_ID } as AuthUser;
      mockAnnualAccountModel.findById.mockReturnValue(docAwaitingReview());

      await expect(
        service.decideManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', { decision: 'APPROVED' }, ulbUser),
      ).rejects.toThrow('Only ADMIN users may decide a manual review request');
    });

    it('rejects when no manual review was ever requested', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docAwaitingReview({ currentUpload: { uploadId: 'upload-1', ocrInfo: { isManualReviewRequested: false } } }),
      );

      await expect(
        service.decideManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', { decision: 'APPROVED' }, adminUser),
      ).rejects.toThrow('No manual review has been requested for this document.');
    });

    it('APPROVED forces processingStatus to PASSED and records the decision', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docAwaitingReview());

      await service.decideManualReview(
        ACCOUNT_ID,
        'auditedData',
        'auditors-report',
        { decision: 'APPROVED' },
        adminUser,
      );

      const [filter, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [
        Record<string, unknown>,
        MongoUpdateCall,
      ];
      expect(filter).toMatchObject({
        documents: { $elemMatch: { docId: 'auditors-report', manualReviewDecision: null } },
      });
      expect(update.$set?.['documents.$.processingStatus']).toBe('PASSED');
      expect(update.$set?.['documents.$.manualReviewDecision']).toMatchObject({ status: 'APPROVED' });
      // Same clean-up an OCR PASS does; validationStatus keeps the OCR's own FAIL.
      expect(update.$set?.['documents.$.postRejectionAttemptsUsed']).toBe(0);
      expect(update.$set?.['documents.$.uploadBlockedUntil']).toBeNull();
      expect(update.$set).not.toHaveProperty(['documents.$.currentUpload.ocrInfo.validationStatus']);
      expect(mockUploadHistoryModel.updateOne).toHaveBeenCalledWith(
        { uploadId: 'upload-1' },
        { $set: { processingStatus: 'PASSED' } },
      );
      expect(mockManualReviewRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ docId: 'auditors-report', uploadId: 'upload-1', status: 'PENDING' }),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'APPROVED' }) }),
        expect.objectContaining({ sort: { requestedAt: -1 } }),
      );
    });

    it('rejects a request that is already decided', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docAwaitingReview({ manualReviewDecision: { status: 'APPROVED' } }),
      );

      await expect(
        service.decideManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', { decision: 'RETURNED', note: 'x' }, adminUser),
      ).rejects.toThrow('This manual review request has already been decided.');
      expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
    });

    it('409s when a concurrent decision landed first, and closes no request row', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docAwaitingReview());
      mockAnnualAccountModel.updateOne.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });

      await expect(
        service.decideManualReview(ACCOUNT_ID, 'auditedData', 'auditors-report', { decision: 'APPROVED' }, adminUser),
      ).rejects.toThrow(ConflictException);
      expect(mockManualReviewRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(mockUploadHistoryModel.updateOne).not.toHaveBeenCalled();
    });

    it('falls back to synthesizing a manual-review record when no PENDING row is found (legacy request)', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docAwaitingReview());
      mockManualReviewRequestModel.findOneAndUpdate.mockResolvedValueOnce(null);

      await service.decideManualReview(
        ACCOUNT_ID,
        'auditedData',
        'auditors-report',
        { decision: 'APPROVED' },
        adminUser,
      );

      expect(mockManualReviewRequestModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ docId: 'auditors-report', uploadId: 'upload-1', status: 'APPROVED' }),
      );
    });

    it('RETURNED (reject) leaves processingStatus untouched and requires a note', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docAwaitingReview());

      await service.decideManualReview(
        ACCOUNT_ID,
        'auditedData',
        'auditors-report',
        { decision: 'RETURNED', note: 'File is unreadable, please re-scan.' },
        adminUser,
      );

      const [, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(update.$set?.['documents.$.processingStatus']).toBeUndefined();
      expect(update.$set?.['documents.$.manualReviewDecision']).toMatchObject({ status: 'RETURNED' });
    });

    it('a first RETURNED sets manualReviewRejectionCount to 1 and does not set a cooldown', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(docAwaitingReview({ manualReviewRejectionCount: 0 }));

      await service.decideManualReview(
        ACCOUNT_ID,
        'auditedData',
        'auditors-report',
        { decision: 'RETURNED', note: 'Wrong document' },
        adminUser,
      );

      const [, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(update.$set?.['documents.$.manualReviewRejectionCount']).toBe(1);
      expect(update.$set?.['documents.$.postRejectionAttemptsUsed']).toBe(0);
      expect(update.$set?.['documents.$.uploadBlockedUntil']).toBeUndefined();
    });

    it('a second RETURNED just bumps manualReviewRejectionCount and resets attempts — it no longer sets a cooldown itself (that is now the OCR processor\'s job once attempts run out)', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        docAwaitingReview({ manualReviewRejectionCount: 1, postRejectionAttemptsUsed: 3 }),
      );

      await service.decideManualReview(
        ACCOUNT_ID,
        'auditedData',
        'auditors-report',
        { decision: 'RETURNED', note: 'Still wrong' },
        adminUser,
      );

      const [, update] = mockAnnualAccountModel.updateOne.mock.calls[0] as [Record<string, unknown>, MongoUpdateCall];
      expect(update.$set?.['documents.$.manualReviewRejectionCount']).toBe(2);
      expect(update.$set?.['documents.$.postRejectionAttemptsUsed']).toBe(0);
      expect(update.$set?.['documents.$.uploadBlockedUntil']).toBeUndefined();
    });
  });

  describe('getManualReviewQueue', () => {
    const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    it('rejects non-ADMIN users', async () => {
      const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

      await expect(service.getManualReviewQueue({ page: 1, pageSize: 20 }, stateUser)).rejects.toThrow(
        'Only ADMIN users may view the manual-review queue',
      );
    });

    it('returns the paginated shape from the aggregation result, signing filePath into a fileUrl', async () => {
      const row = { annualAccountId: 'acc-1', ulbName: 'Test ULB', docId: 'auditors-report', filePath: 's3/path.pdf' };
      mockAnnualAccountModel.aggregate.mockReturnValue(mockQuery([{ data: [row], totalCount: [{ count: 1 }] }]));

      const result = await service.getManualReviewQueue({ page: 1, pageSize: 20 }, adminUser);

      expect(result).toEqual({
        total: 1,
        page: 1,
        pageSize: 20,
        rows: [
          {
            annualAccountId: 'acc-1',
            ulbName: 'Test ULB',
            docId: 'auditors-report',
            fileUrl: 'https://signed.example.com/s3/path.pdf',
          },
        ],
      });
    });

    it('returns an empty page when nothing is pending', async () => {
      mockAnnualAccountModel.aggregate.mockReturnValue(mockQuery([{ data: [], totalCount: [] }]));

      const result = await service.getManualReviewQueue({ page: 1, pageSize: 20 }, adminUser);

      expect(result).toEqual({ total: 0, page: 1, pageSize: 20, rows: [] });
    });
  });

  describe('listManualReviewRequestHistory', () => {
    const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    it('rejects non-ADMIN users', async () => {
      const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

      await expect(service.listManualReviewRequestHistory({ page: 1, pageSize: 20 }, stateUser)).rejects.toThrow(
        'Only ADMIN users may view the manual-review history',
      );
    });

    it('returns the paginated shape from the aggregation result, signing filePath into a fileUrl', async () => {
      const row = {
        requestId: 'mr-1',
        ulbName: 'Test ULB',
        status: 'APPROVED',
        docId: 'auditors-report',
        filePath: 's3/path.pdf',
      };
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([{ data: [row], totalCount: [{ count: 1 }] }]));

      const result = await service.listManualReviewRequestHistory({ page: 1, pageSize: 20 }, adminUser);

      expect(result).toEqual({
        total: 1,
        page: 1,
        pageSize: 20,
        rows: [
          {
            requestId: 'mr-1',
            ulbName: 'Test ULB',
            status: 'APPROVED',
            docId: 'auditors-report',
            fileUrl: 'https://signed.example.com/s3/path.pdf',
          },
        ],
      });
    });

    it('returns an empty page when nothing matches', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([{ data: [], totalCount: [] }]));

      const result = await service.listManualReviewRequestHistory({ page: 1, pageSize: 20 }, adminUser);

      expect(result).toEqual({ total: 0, page: 1, pageSize: 20, rows: [] });
    });

    it('joins ULB/State/Year/upload history only for the page, after skip and limit', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([{ data: [], totalCount: [] }]));

      await service.listManualReviewRequestHistory({ page: 2, pageSize: 20 }, adminUser);

      const pipeline = mockManualReviewRequestModel.aggregate.mock.calls.at(-1)?.[0] as Record<string, any>[];
      const facet = pipeline.find((stage) => stage.$facet).$facet;
      expect(pipeline.some((stage) => stage.$lookup)).toBe(false);
      expect(facet.data.slice(0, 2)).toEqual([{ $skip: 20 }, { $limit: 20 }]);
      expect(facet.data.some((stage: Record<string, any>) => stage.$lookup?.from === 'ulbs')).toBe(true);
    });

    it('joins ULBs before paging only to filter by State or search', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([{ data: [], totalCount: [] }]));

      await service.listManualReviewRequestHistory(
        { page: 1, pageSize: 20, stateId: '5dcf9d7416a06aed41c748f0', search: 'nagar' },
        adminUser,
      );

      const pipeline = mockManualReviewRequestModel.aggregate.mock.calls.at(-1)?.[0] as Record<string, any>[];
      const before = pipeline.slice(0, pipeline.findIndex((stage) => stage.$facet));
      expect(before.filter((stage) => stage.$lookup).map((stage) => stage.$lookup.from)).toEqual(['ulbs']);
      expect(String(before.find((stage) => stage.$match?.['ulbDoc.state'])?.$match['ulbDoc.state'])).toBe(
        '5dcf9d7416a06aed41c748f0',
      );
    });
  });

  describe('getManualReviewHistoryStats', () => {
    const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    it('rejects non-ADMIN users', async () => {
      const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

      await expect(service.getManualReviewHistoryStats({ range: 'all' }, stateUser)).rejects.toThrow(
        'Only ADMIN users may view the manual-review history',
      );
    });

    it('computes the overturn rate and warns once enough requests are decided', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(
        mockQuery([
          { received: 18, pending: 2, approved: 15, rejected: 1, over48hCount: 3, avgResponseHours: 26.4 },
        ]),
      );

      const result = await service.getManualReviewHistoryStats({ range: 'all' }, adminUser);

      expect(result).toEqual({
        range: 'all',
        received: 18,
        pending: 2,
        approved: 15,
        rejected: 1,
        over48hCount: 3,
        avgResponseHours: 26.4,
        overturnRatePercent: 94,
        overturnRateWarning: true,
      });
    });

    it('suppresses the warning when fewer than 5 requests have been decided, even at 100%', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(
        mockQuery([{ received: 2, pending: 0, approved: 2, rejected: 0, over48hCount: 0, avgResponseHours: 5 }]),
      );

      const result = await service.getManualReviewHistoryStats({ range: 'today' }, adminUser);

      expect(result.overturnRatePercent).toBe(100);
      expect(result.overturnRateWarning).toBe(false);
    });

    it('returns zeroed/null stats when nothing matches', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([]));

      const result = await service.getManualReviewHistoryStats({ range: 'week' }, adminUser);

      expect(result).toEqual({
        range: 'week',
        received: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        over48hCount: 0,
        avgResponseHours: null,
        overturnRatePercent: null,
        overturnRateWarning: false,
      });
    });

    it('omits the requestedAt filter for the "all" range but applies one for "today"', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([]));

      await service.getManualReviewHistoryStats({ range: 'all' }, adminUser);
      const allPipeline = mockManualReviewRequestModel.aggregate.mock.calls.at(-1)?.[0];
      expect(allPipeline[0]).toEqual({ $match: {} });

      await service.getManualReviewHistoryStats({ range: 'today' }, adminUser);
      const todayPipeline = mockManualReviewRequestModel.aggregate.mock.calls.at(-1)?.[0];
      expect(todayPipeline[0].$match.requestedAt.$gte).toBeInstanceOf(Date);
    });
  });

  describe('getManualReviewRequestDetail', () => {
    const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    it('rejects non-ADMIN users', async () => {
      const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

      await expect(service.getManualReviewRequestDetail('mr-1', stateUser)).rejects.toThrow(
        'Only ADMIN users may view manual-review request details',
      );
    });

    it('returns the single request when found, signing filePath into a fileUrl', async () => {
      const row = { requestId: 'mr-1', ulbName: 'Test ULB', status: 'PENDING', filePath: 's3/path.pdf' };
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([row]));

      const result = await service.getManualReviewRequestDetail('507f1f77bcf86cd799439011', adminUser);

      expect(result).toEqual({
        requestId: 'mr-1',
        ulbName: 'Test ULB',
        status: 'PENDING',
        fileUrl: 'https://signed.example.com/s3/path.pdf',
      });
    });

    it('throws NotFoundException when the request does not exist', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([]));

      await expect(service.getManualReviewRequestDetail('507f1f77bcf86cd799439011', adminUser)).rejects.toThrow(
        'Manual-review request not found',
      );
    });
  });

  describe('dumpManualReviewHistoryToExcel', () => {
    const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

    it('rejects non-ADMIN users', async () => {
      const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

      await expect(service.dumpManualReviewHistoryToExcel({ page: 1, pageSize: 20 }, stateUser)).rejects.toThrow(
        'Only ADMIN users may view the manual-review history',
      );
    });

    it('builds a workbook from every matching row, unpaginated, including the file/OCR-log links', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) =>
        ({ CLIENT_URL: 'https://cityfinance.in', API_BASE_URL_V3: 'https://ocr.example.com/api/v3' })[key] ??
        defaultValue,
      );
      const rows = [
        {
          ulbName: 'Test ULB',
          ulbCode: 'ULB1',
          stateName: 'Karnataka',
          section: 'auditedData',
          year: '2024-25',
          docId: 'auditors-report',
          fileName: 'report.pdf',
          filePath: 's3/path/report.pdf',
          ocrJobId: 'job-42',
          status: 'APPROVED',
          requestedAt: '2024-01-01T00:00:00.000Z',
          requestedBy: { role: 'ULB', name: 'Nodal Officer' },
          dueAt: '2024-01-03T00:00:00.000Z',
          isBreached: false,
          decidedAt: '2024-01-02T00:00:00.000Z',
          decidedBy: { role: 'ADMIN', name: 'Admin User' },
          decisionNote: 'Looks fine',
        },
      ];
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery(rows));

      const buffer = await service.dumpManualReviewHistoryToExcel({ page: 1, pageSize: 20 }, adminUser);

      expect(buffer).toEqual(Buffer.from('excel'));
      expect(mockExcelService.generateExcel).toHaveBeenCalledTimes(1);
      const [headers, excelRows, sheetName] = mockExcelService.generateExcel.mock.calls[0];
      expect(sheetName).toBe('Manual Review History');
      expect(headers.map((h: { key: string }) => h.key)).toEqual(
        expect.arrayContaining(['decisionNote', 'fileUrl', 'ocrLogUrl']),
      );
      expect(excelRows).toEqual([
        expect.objectContaining({
          ulbName: 'Test ULB',
          section: 'Audited',
          status: 'APPROVED',
          requestedBy: 'Nodal Officer',
          isBreached: 'No',
          decidedBy: 'Admin User',
          decisionNote: 'Looks fine',
          fileUrl: 'https://ocr.example.com/api/v3/ocr-validation/jobs/job-42/download',
          ocrLogUrl: 'https://cityfinance.in/ocr/validation?jobId=job-42',
        }),
      ]);
    });

    it('leaves fileUrl/ocrLogUrl blank when there is no file path or OCR job', async () => {
      const rows = [{ ulbName: 'Test ULB', status: 'PENDING', requestedBy: {}, decidedBy: null }];
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery(rows));

      await service.dumpManualReviewHistoryToExcel({ page: 1, pageSize: 20 }, adminUser);

      const [, excelRows] = mockExcelService.generateExcel.mock.calls[0];
      expect(excelRows[0]).toMatchObject({ fileUrl: '', ocrLogUrl: '' });
    });
  });
});
