import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Types } from 'mongoose';
import { AnnualAccountsService } from './annual_accounts.service';
import { XviFcAnnualAccount } from '../../../../schemas/xvi-fc/annual-account.schema';
import { XviFcAnnualAccountUploadHistory } from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { XviFcAnnualAccountFormLog } from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import { XviFcDocumentActionGate } from '../../../../schemas/xvi-fc/document-action-gate.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { Year } from '../../../../schemas/year.schema';
import { User } from '../../../../schemas/user/user.schema';
import { ExemptionResolverService } from '../../common/services/exemption-resolver.service';
import { YearAccessService } from '../../common/services/year-access.service';
import { FORM_STATUS } from '../../../../common/constants/form-status.constants';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../file/s3-upload.service';
import { FormJsonService } from '../../../../master/form-json/form-json.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { UlbEligibilityService } from '../../../ulb-eligibility/ulb-eligibility.service';
import { FormReturnedNotificationService } from '../../common/reminders/form-returned-notification.service';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { Permission } from '../../../auth/enum/roles-xvi-fc.enum';

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
  let mockYearModel: { findById: jest.Mock };
  let mockExemptionResolverService: { resolveBulk: jest.Mock; resolveDiscretionaryBulk: jest.Mock; resolveDiscretionary: jest.Mock };
  let mockYearAccessService: { getExemptFormIds: jest.Mock };

  beforeEach(async () => {
    mockAnnualAccountModel = {
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      exists: jest.fn().mockResolvedValue(null),
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
      find: jest.fn().mockReturnValue(mockQuery([])),
      aggregate: jest.fn().mockReturnValue(mockQuery([{ data: [], totalCount: [], counts: [] }])),
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
    mockYearModel = {
      findById: jest.fn().mockReturnValue(mockQuery({ _id: 'year-1', year: '2026-27' })),
    };
    mockExemptionResolverService = {
      resolveBulk: jest.fn().mockResolvedValue(new Map()),
      resolveDiscretionaryBulk: jest.fn().mockResolvedValue(new Map()),
      resolveDiscretionary: jest.fn().mockResolvedValue(null),
    };
    mockYearAccessService = {
      getExemptFormIds: jest.fn().mockResolvedValue(new Set()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualAccountsService,
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcAnnualAccountUploadHistory.name), useValue: mockUploadHistoryModel },
        { provide: getModelToken(XviFcAnnualAccountFormLog.name), useValue: mockFormLogModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(XviFcDocumentActionGate.name), useValue: mockActionGateModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3UploadService, useValue: mockS3UploadService },
        { provide: getQueueToken(ANNUAL_ACCOUNT_PROCESSING_QUEUE), useValue: mockOcrQueue },
        { provide: FormJsonService, useValue: mockFormJsonService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
        { provide: FormReturnedNotificationService, useValue: mockFormReturnedNotification },
        { provide: ExemptionResolverService, useValue: mockExemptionResolverService },
        { provide: YearAccessService, useValue: mockYearAccessService },
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

    it('getProcessingStatus zeroes canUpload (not other permissions) while a discretionary exemption request is Pending or Approved, leaves it untouched otherwise', async () => {
      // canUpload only ever applies to a ULB-scoped caller (buildAnnualAccountPermissions gates it
      // on `user.scope === Scope.ULB`) - the shared ADMIN `user` fixture above always gets
      // canUpload:false regardless of exemption, which wouldn't demonstrate this fix at all.
      // permissionOverrides.allow is needed too: getEffectivePermissions currently gives every
      // ULB-scoped user zero base permissions ("ULB permission matrix is not yet implemented" -
      // permissions.map.ts) - without the override, canUpload would be false before AND after this
      // fix, for an unrelated reason, and the test would prove nothing.
      const ulbUser: AuthUser = {
        _id: 'ulb-user-1',
        role: 'ULB-EDITOR',
        scope: 'ULB',
        ulb: ULB_ID,
        permissionOverrides: { allow: [Permission.UPLOAD_DOCUMENTS] },
      } as AuthUser;
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(auditedAnchor));
      mockUlbModel.findById.mockReturnValue(mockQuery({ name: 'Test ULB', code: 'TU1' }));

      // Baseline: no exemption on record - canUpload reflects the section's own status normally.
      let result = await service.getProcessingStatus(ACCOUNT_ID, 'auditedData', ulbUser);
      const baselinePermissions = result.data.permissions;
      expect(baselinePermissions.canUpload).toBe(true);

      mockExemptionResolverService.resolveDiscretionary.mockResolvedValueOnce({
        requestId: '507f1f77bcf86cd799439099',
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });
      result = await service.getProcessingStatus(ACCOUNT_ID, 'auditedData', ulbUser);
      expect(result.exemptionStatus).toBe('PENDING');
      // Blocked while Pending, even though the section's own status would otherwise allow it - the
      // write endpoints would reject an upload right now (assertNotBlockedByPendingExemption), so
      // the response must not advertise it. Every other permission is untouched (a separate
      // question from whether the ULB can write to this section).
      expect(result.data.permissions).toEqual({ ...baselinePermissions, canUpload: false });

      mockExemptionResolverService.resolveDiscretionary.mockResolvedValueOnce({
        requestId: '507f1f77bcf86cd799439099',
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: null,
      });
      result = await service.getProcessingStatus(ACCOUNT_ID, 'auditedData', ulbUser);
      expect(result.exemptionStatus).toBe('APPROVED');
      expect(result.data.permissions).toEqual({ ...baselinePermissions, canUpload: false });

      mockExemptionResolverService.resolveDiscretionary.mockResolvedValueOnce({
        requestId: '507f1f77bcf86cd799439099',
        currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: 'Not eligible',
      });
      result = await service.getProcessingStatus(ACCOUNT_ID, 'auditedData', ulbUser);
      expect(result.exemptionStatus).toBe('REJECTED');
      // Rejected - the section's real status governs again, unaffected by this override.
      expect(result.data.permissions).toEqual(baselinePermissions);
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

    describe('findByUlbAndYear — dynamic year access exemption', () => {
      // Shadows the outer `user` fixture - materializeExemptionStubIfNeeded constructs
      // `new Types.ObjectId(user._id)`, which needs a real 24-char hex string.
      const user: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

      const exemptedAnchor = {
        _id: ACCOUNT_ID,
        ulb: ULB_ID,
        design_year: YEAR_ID,
        sectionType: 'audited',
        form_status: 'EXEMPTED_ACKNOWLEDGED',
        form_status_id: 12,
        isExemptionStub: true,
        documents: [],
      };

      beforeEach(() => {
        mockUlbModel.findById.mockReturnValue(mockQuery({ name: 'Test ULB', code: 'TU1', state: { toString: () => 'state-1' } }));
      });

      it('rejects an out-of-scope ULB caller before any write, not after materialization', async () => {
        const otherUlbUser = { _id: user._id, role: 'ULB', scope: 'ULB', ulb: 'a-different-ulb-id' } as AuthUser;
        mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set([30, 31]));
        mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));

        await expect(service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', otherUlbUser)).rejects.toThrow(
          ForbiddenException,
        );

        expect(mockAnnualAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('does not materialize a stub when neither formId is exempt (unchanged behavior)', async () => {
        mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(null));

        const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

        expect(mockAnnualAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(result).toBeNull();
      });

      it('materializes the anchor as EXEMPTED when only formId 30 (audited) is exempt', async () => {
        mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set([30]));
        mockAnnualAccountModel.findOne
          .mockReturnValueOnce(mockQuery(null)) // findByUlbAndYear's initial check: no anchor yet
          .mockReturnValueOnce(mockQuery(null)) // materialize's own existingAnchor check: still none
          .mockReturnValueOnce(mockQuery(exemptedAnchor)); // re-read after materialization
        mockAnnualAccountModel.findById.mockReturnValue(mockQuery(exemptedAnchor));

        const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

        expect(mockYearAccessService.getExemptFormIds).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          [30, 31],
        );
        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ sectionType: 'audited' }),
          expect.objectContaining({
            $setOnInsert: expect.objectContaining({
              form_status: 'EXEMPTED_ACKNOWLEDGED',
              isExemptionStub: true,
            }),
          }),
          { upsert: true },
        );
        expect(result?.data.form_status).toBe('EXEMPTED_ACKNOWLEDGED');
      });

      it('materializes the anchor as NOT_STARTED but the sibling as EXEMPTED when only formId 31 (unaudited) is exempt', async () => {
        mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set([31]));
        const notStartedAnchor = { ...exemptedAnchor, form_status: 'NOT_STARTED', form_status_id: 1 };
        mockAnnualAccountModel.findOne
          .mockReturnValueOnce(mockQuery(null))
          .mockReturnValueOnce(mockQuery(notStartedAnchor));
        mockAnnualAccountModel.findById.mockReturnValue(mockQuery(notStartedAnchor));

        const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ sectionType: 'audited' }),
          expect.objectContaining({
            $setOnInsert: expect.objectContaining({ form_status: 'NOT_STARTED' }),
          }),
          { upsert: true },
        );
        expect(mockAnnualAccountModel.findOneAndUpdate.mock.calls[0][1].$setOnInsert.isExemptionStub).toBeUndefined();
        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ sectionType: 'unaudited' }),
          expect.objectContaining({
            $setOnInsert: expect.objectContaining({ form_status: 'EXEMPTED_ACKNOWLEDGED', isExemptionStub: true }),
          }),
          { upsert: true },
        );
        expect(result?.data.form_status).toBe('NOT_STARTED');
      });

      it('materializes both the anchor and sibling as EXEMPTED when both formIds are exempt', async () => {
        mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set([30, 31]));
        mockAnnualAccountModel.findOne
          .mockReturnValueOnce(mockQuery(null)) // findByUlbAndYear's initial check: no anchor yet
          .mockReturnValueOnce(mockQuery(null)) // materialize's own existingAnchor check: still none
          .mockReturnValueOnce(mockQuery(exemptedAnchor)); // re-read after materialization
        mockAnnualAccountModel.findById.mockReturnValue(mockQuery(exemptedAnchor));

        await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ sectionType: 'audited' }),
          expect.objectContaining({ $setOnInsert: expect.objectContaining({ form_status: 'EXEMPTED_ACKNOWLEDGED' }) }),
          { upsert: true },
        );
        expect(mockAnnualAccountModel.findOneAndUpdate).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ sectionType: 'unaudited' }),
          expect.objectContaining({ $setOnInsert: expect.objectContaining({ form_status: 'EXEMPTED_ACKNOWLEDGED' }) }),
          { upsert: true },
        );
      });

      it('upgrades an untouched NOT_STARTED anchor placeholder in place when formId 30 becomes exempt', async () => {
        // findOrInitialize (a real, unrelated unaudited-only upload) leaves the audited anchor
        // sitting exactly like this - a plain, non-stub NOT_STARTED placeholder with no documents.
        // A blind $setOnInsert-only upsert would silently no-op against it forever; materialize
        // must instead recognize it as untouched and upgrade it.
        const untouchedPlaceholder = {
          _id: ACCOUNT_ID,
          ulb: ULB_ID,
          design_year: YEAR_ID,
          sectionType: 'audited',
          form_status: 'NOT_STARTED',
          form_status_id: 1,
          isExemptionStub: false,
          documents: [],
        };
        const upgradedAnchor = { ...untouchedPlaceholder, form_status: 'EXEMPTED_ACKNOWLEDGED', form_status_id: 12, isExemptionStub: true };
        mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set([30]));
        mockAnnualAccountModel.findOne
          .mockReturnValueOnce(mockQuery(untouchedPlaceholder)) // findByUlbAndYear's initial anchor fetch
          .mockReturnValueOnce(mockQuery(untouchedPlaceholder)) // materialize's own existingAnchor check
          .mockReturnValueOnce(mockQuery(null)) // revalidate's unaudited sibling check - never touched
          .mockReturnValueOnce(mockQuery(upgradedAnchor)); // final refetch, post-upgrade
        mockAnnualAccountModel.findById.mockReturnValue(mockQuery(upgradedAnchor));

        const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

        expect(mockAnnualAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(mockAnnualAccountModel.updateOne).toHaveBeenCalledWith(
          { _id: ACCOUNT_ID, form_status: 'NOT_STARTED', isExemptionStub: { $ne: true } },
          {
            $set: expect.objectContaining({
              form_status: 'EXEMPTED_ACKNOWLEDGED',
              form_status_id: 12,
              isExemptionStub: true,
            }),
          },
        );
        expect(result?.data.form_status).toBe('EXEMPTED_ACKNOWLEDGED');
      });

      it('never writes when a real anchor document already exists (golden rule)', async () => {
        // materialize now runs unconditionally (to catch the untouched-placeholder case below), so
        // it always probes live exemption state - but since neither formId is exempt by default
        // (mockYearAccessService.getExemptFormIds resolves an empty Set), it makes no writes. And
        // since this anchor represents real, settled progress (not NOT_STARTED, not a stub), neither
        // materialize's own upgrade path nor revalidate ever touches it.
        const realAnchor = { ...exemptedAnchor, form_status: 'IN_PROGRESS', form_status_id: 2, isExemptionStub: false };
        mockAnnualAccountModel.findOne.mockReturnValue(mockQuery(realAnchor));
        mockAnnualAccountModel.findById.mockReturnValue(mockQuery(realAnchor));

        await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

        expect(mockAnnualAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
        expect(mockAnnualAccountModel.deleteOne).not.toHaveBeenCalled();
      });

      describe('undoing an exemption (existing stub, no longer exempt)', () => {
        const UNAUDITED_ID = '507f1f77bcf86cd799439015';
        const unauditedStub = {
          _id: UNAUDITED_ID,
          ulb: ULB_ID,
          design_year: YEAR_ID,
          sectionType: 'unaudited',
          form_status: 'EXEMPTED_ACKNOWLEDGED',
          form_status_id: 12,
          isExemptionStub: true,
          documents: [],
        };

        it('is a no-op when still exempt - neither document is touched', async () => {
          mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set([30, 31]));
          mockAnnualAccountModel.findOne
            .mockReturnValueOnce(mockQuery(exemptedAnchor)) // findByUlbAndYear's initial anchor fetch
            .mockReturnValueOnce(mockQuery(exemptedAnchor)) // materialize's own existingAnchor check - already a stub
            .mockReturnValueOnce(mockQuery(unauditedStub)) // revalidate's sibling stub-flag check
            .mockReturnValueOnce(mockQuery(exemptedAnchor)); // final refetch
          mockAnnualAccountModel.findById.mockReturnValue(mockQuery(exemptedAnchor));

          const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

          expect(mockAnnualAccountModel.deleteOne).not.toHaveBeenCalled();
          expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
          expect(result?.data.form_status).toBe('EXEMPTED_ACKNOWLEDGED');
        });

        it('deletes only the unaudited sibling when just formId 31 is undone, leaving a real audited doc alone', async () => {
          const realAnchor = { ...exemptedAnchor, form_status: 'IN_PROGRESS', form_status_id: 2, isExemptionStub: false };
          mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set()); // 31 no longer exempt
          mockAnnualAccountModel.findOne
            .mockReturnValueOnce(mockQuery(realAnchor)) // initial anchor fetch - real, not a stub
            .mockReturnValueOnce(mockQuery(unauditedStub)) // sibling stub-flag check
            .mockReturnValueOnce(mockQuery(realAnchor)); // final refetch
          mockAnnualAccountModel.findById.mockReturnValue(mockQuery(realAnchor));

          await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

          expect(mockAnnualAccountModel.deleteOne).toHaveBeenCalledWith({ _id: UNAUDITED_ID, isExemptionStub: true });
          expect(mockAnnualAccountModel.deleteOne).toHaveBeenCalledTimes(1);
          expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
        });

        it('resets the anchor in place (does not delete it) when formId 30 is undone but the sibling still exists', async () => {
          const realSibling = { ...unauditedStub, form_status: 'IN_PROGRESS', form_status_id: 2, isExemptionStub: false };
          const resetAnchor = { ...exemptedAnchor, form_status: 'NOT_STARTED', form_status_id: 1, isExemptionStub: false };
          mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set()); // 30 no longer exempt
          mockAnnualAccountModel.findOne
            .mockReturnValueOnce(mockQuery(exemptedAnchor)) // initial anchor fetch - stub
            .mockReturnValueOnce(mockQuery(realSibling)) // sibling stub-flag check - sibling exists (not a stub)
            .mockReturnValueOnce(mockQuery(resetAnchor)); // final refetch after reset
          mockAnnualAccountModel.exists.mockResolvedValue(true); // sibling document still exists
          mockAnnualAccountModel.findById.mockReturnValue(mockQuery(resetAnchor));

          const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

          expect(mockAnnualAccountModel.deleteOne).not.toHaveBeenCalled();
          expect(mockAnnualAccountModel.updateOne).toHaveBeenCalledWith(
            { _id: ACCOUNT_ID, isExemptionStub: true },
            {
              $set: expect.objectContaining({
                form_status: 'NOT_STARTED',
                form_status_id: 1,
                isExemptionStub: false,
                exemptionMaterializedAt: null,
              }),
            },
          );
          expect(result?.data.form_status).toBe('NOT_STARTED');
        });

        it('deletes the anchor outright when formId 30 is undone and no sibling document remains', async () => {
          mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set()); // 30 no longer exempt
          mockAnnualAccountModel.findOne
            .mockReturnValueOnce(mockQuery(exemptedAnchor)) // initial anchor fetch - stub
            .mockReturnValueOnce(mockQuery(null)) // sibling stub-flag check - no sibling at all
            .mockReturnValueOnce(mockQuery(null)); // final refetch - anchor is gone
          mockAnnualAccountModel.exists.mockResolvedValue(null); // no sibling document

          const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

          expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
          expect(mockAnnualAccountModel.deleteOne).toHaveBeenCalledWith({ _id: ACCOUNT_ID, isExemptionStub: true });
          expect(result).toBeNull();
        });

        it('deletes both documents when both formIds are undone together, cleaning up to complete absence', async () => {
          mockYearAccessService.getExemptFormIds.mockResolvedValue(new Set()); // both no longer exempt
          mockAnnualAccountModel.findOne
            .mockReturnValueOnce(mockQuery(exemptedAnchor)) // initial anchor fetch - stub
            .mockReturnValueOnce(mockQuery(unauditedStub)) // sibling stub-flag check - also a stub
            .mockReturnValueOnce(mockQuery(null)); // final refetch - anchor is gone too
          mockAnnualAccountModel.exists.mockResolvedValue(null); // sibling already deleted by the time the anchor is checked

          const result = await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

          expect(mockAnnualAccountModel.deleteOne).toHaveBeenNthCalledWith(1, { _id: UNAUDITED_ID, isExemptionStub: true });
          expect(mockAnnualAccountModel.deleteOne).toHaveBeenNthCalledWith(2, { _id: ACCOUNT_ID, isExemptionStub: true });
          expect(result).toBeNull();
        });

        it('does not delete/reset anything when neither the anchor nor the sibling is a stub', async () => {
          // materialize still runs unconditionally and probes live exemption state (empty Set by
          // default), but since this anchor is real, settled progress - not NOT_STARTED, not a
          // stub - it makes no writes; revalidate's own fast path then avoids a second exemption
          // check entirely, since neither document is a stub.
          const realAnchor = { ...exemptedAnchor, form_status: 'IN_PROGRESS', form_status_id: 2, isExemptionStub: false };
          const realSibling = { ...unauditedStub, form_status: 'IN_PROGRESS', form_status_id: 2, isExemptionStub: false };
          mockAnnualAccountModel.findOne
            .mockReturnValueOnce(mockQuery(realAnchor))
            .mockReturnValueOnce(mockQuery(realSibling))
            .mockReturnValueOnce(mockQuery(realAnchor));
          mockAnnualAccountModel.findById.mockReturnValue(mockQuery(realAnchor));

          await service.findByUlbAndYear(ULB_ID, YEAR_ID, 'auditedData', user);

          expect(mockYearAccessService.getExemptFormIds).toHaveBeenCalledTimes(1);
          expect(mockAnnualAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
          expect(mockAnnualAccountModel.deleteOne).not.toHaveBeenCalled();
          expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
        });
      });
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

    it('blocks the upload while a discretionary exemption request is pending MoHUA review, even before any section document exists', async () => {
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });
      const dto = {
        ...baseDto,
        docId: 'auditors-report',
        s3Key: `xvi-fc/annual-accounts/${ULB_ID}/${YEAR_ID}/auditedData/auditors-report/upload-1.pdf`,
      };

      const result = service.confirmUpload(dto as any, baseUser);
      await expect(result).rejects.toBeInstanceOf(ConflictException); // 409, not 403 - a 403 would force-log the user out
      await expect(result).rejects.toThrow(/pending MoHUA review/);
      expect(mockExemptionResolverService.resolveDiscretionary).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        30,
      );
    });

    it('blocks the upload while a discretionary exemption request is MoHUA-approved, even though the section document itself was never touched by that approval', async () => {
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: null,
      });
      const dto = {
        ...baseDto,
        docId: 'auditors-report',
        s3Key: `xvi-fc/annual-accounts/${ULB_ID}/${YEAR_ID}/auditedData/auditors-report/upload-1.pdf`,
      };

      const result = service.confirmUpload(dto as any, baseUser);
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/MoHUA-approved discretionary exemption/);
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

    it('blocks submission while a discretionary exemption request is pending MoHUA review', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(
        mockQuery({
          _id: ACCOUNT_ID,
          ulb: '507f1f77bcf86cd799439011',
          design_year: YEAR_ID,
          sectionType: 'audited',
          form_status_id: 2,
          documents: [{ docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null }],
        }),
      );
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });

      const result = service.submitSection(ACCOUNT_ID, 'auditedData', baseUser);
      await expect(result).rejects.toBeInstanceOf(ConflictException); // 409, not 403 - a 403 would force-log the user out
      await expect(result).rejects.toThrow(/pending MoHUA review/);
      expect(mockUlbEligibilityService.assertUlbEligibleForGrantCycle).not.toHaveBeenCalled();
    });
  });

  describe('removeDocument', () => {
    const baseUser: AuthUser = {
      _id: '507f1f77bcf86cd799439099',
      role: 'ULB-EDITOR',
      scope: 'ULB',
      ulb: '507f1f77bcf86cd799439011',
    } as AuthUser;
    const ACCOUNT_ID = '507f1f77bcf86cd799439014';
    const YEAR_ID = '507f1f77bcf86cd799439013';

    const sectionDoc = {
      _id: ACCOUNT_ID,
      ulb: '507f1f77bcf86cd799439011',
      design_year: YEAR_ID,
      sectionType: 'audited',
      form_status_id: FORM_STATUS.IN_PROGRESS,
      documents: [{ docId: 'auditors-report', processingStatus: 'PASSED', stateDecision: null, currentUpload: null }],
    };

    it('removes a document slot when the section is editable and not exemption-blocked', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(sectionDoc));
      mockAnnualAccountModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.removeDocument(ACCOUNT_ID, 'auditedData', 'auditors-report', baseUser);

      expect(result.docId).toBe('auditors-report');
      expect(mockAnnualAccountModel.updateOne).toHaveBeenCalled();
    });

    it('blocks removal while a discretionary exemption request is pending MoHUA review', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(sectionDoc));
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });

      const result = service.removeDocument(ACCOUNT_ID, 'auditedData', 'auditors-report', baseUser);
      await expect(result).rejects.toBeInstanceOf(ConflictException); // 409, not 403 - a 403 would force-log the user out
      await expect(result).rejects.toThrow(/pending MoHUA review/);
      expect(mockAnnualAccountModel.updateOne).not.toHaveBeenCalled();
    });

    it('does not block removal once the discretionary request has been rejected - the section\'s real status governs again', async () => {
      mockAnnualAccountModel.findById.mockReturnValue(mockQuery(sectionDoc));
      mockAnnualAccountModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: 'Not eligible.',
      });

      const result = await service.removeDocument(ACCOUNT_ID, 'auditedData', 'auditors-report', baseUser);

      expect(result.docId).toBe('auditors-report');
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

  describe('listUlbSubmissions', () => {
    const adminUser: AuthUser = { _id: 'user-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;
    const baseDto = { section: 'auditedData' as const, designYearId: '507f1f77bcf86cd799439013', page: 1, pageSize: 20 };

    beforeEach(() => {
      mockYearModel.findById.mockReturnValue(mockQuery({ _id: 'year-1', year: '2026-27' }));
    });

    it('runs the aggregation against the Ulb model and returns rows/counts/total', async () => {
      const row = {
        ulbId: 'ulb-1',
        ulbCode: 'ULB1',
        censusCode: '900001',
        ulbName: 'Test ULB',
        formStatus: 'IN_PROGRESS',
        formStatusId: 2,
        lastUpdatedAt: null,
        enteredReviewAt: null,
        annualAccountId: null,
        hasManualReviewRequests: false,
      };
      mockUlbModel.aggregate.mockReturnValue(
        mockQuery([{ data: [row], totalCount: [{ count: 1 }], counts: [{ _id: 'IN_PROGRESS', count: 1 }] }]),
      );

      const result = await service.listUlbSubmissions(baseDto, adminUser);

      expect(mockUlbModel.aggregate).toHaveBeenCalled();
      expect(result.total).toBe(1);
      expect(result.rows).toEqual([row]);
      expect(result.counts.IN_PROGRESS).toBe(1);
      expect(result.counts.NOT_STARTED).toBe(0);
      // Synthetic exemption-overlay buckets are always present, even when nothing landed in them.
      expect(result.counts.EXEMPTION_PENDING).toBe(0);
      expect(result.counts.EXEMPTION_REJECTED).toBe(0);
      expect(result.counts.EXEMPTION_APPROVED).toBe(0);
      expect(result.counts.AUTO_EXEMPTED).toBe(0);
    });

    it('resolves the automatic-exemption candidate set with the section formId (30 for auditedData)', async () => {
      await service.listUlbSubmissions(baseDto, adminUser);

      expect(mockExemptionResolverService.resolveBulk).toHaveBeenCalledWith(
        [],
        { _id: 'year-1', year: '2026-27' },
        30,
      );
    });

    it('resolves the section formId as 31 for unauditedData', async () => {
      await service.listUlbSubmissions({ ...baseDto, section: 'unauditedData' }, adminUser);

      expect(mockExemptionResolverService.resolveBulk).toHaveBeenCalledWith(expect.anything(), expect.anything(), 31);
      expect(mockExemptionResolverService.resolveDiscretionaryBulk).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Types.ObjectId),
        31,
      );
    });

    it('feeds AUTOMATIC-exempt ULB ids into the documentless-fallback $addFields stage', async () => {
      const exemptUlbId = new Types.ObjectId();
      mockUlbModel.find.mockReturnValue(mockQuery([{ _id: exemptUlbId, startYear: 2026, yearAccess: {} }]));
      mockExemptionResolverService.resolveBulk.mockResolvedValue(
        new Map([[String(exemptUlbId), { exempted: true, source: 'AUTOMATIC' }]]),
      );

      await service.listUlbSubmissions(baseDto, adminUser);

      const pipeline = mockUlbModel.aggregate.mock.calls[0][0];
      const fallbackStage = pipeline.find(
        (stage: Record<string, any>) => stage.$addFields?.formStatus?.$cond !== undefined,
      );
      expect(fallbackStage.$addFields.formStatus.$cond[2].$cond[0].$in[1]).toEqual([exemptUlbId]);
      expect(fallbackStage.$addFields.formStatus.$cond[2].$cond[1]).toBe('EXEMPTED_ACKNOWLEDGED');
    });

    it('does not trust a stale exemption stub\'s stored status - falls through to the live exemption check', async () => {
      await service.listUlbSubmissions(baseDto, adminUser);

      const pipeline = mockUlbModel.aggregate.mock.calls[0][0];
      const fallbackStage = pipeline.find(
        (stage: Record<string, any>) => stage.$addFields?.formStatus?.$cond !== undefined,
      );
      const [condition, trueBranch] = fallbackStage.$addFields.formStatus.$cond;
      expect(condition).toEqual({
        $and: [
          { $ne: [{ $ifNull: ['$sectionAccount', null] }, null] },
          { $ne: ['$sectionAccount.form_status', 'NOT_STARTED'] },
          { $ne: ['$sectionAccount.isExemptionStub', true] },
        ],
      });
      expect(trueBranch).toBe('$sectionAccount.form_status');

      const formStatusIdCond = fallbackStage.$addFields.formStatusId.$cond;
      expect(formStatusIdCond[0]).toEqual(condition);
      expect(formStatusIdCond[1]).toBe('$sectionAccount.form_status_id');
    });

    it('does not trust an untouched NOT_STARTED anchor placeholder\'s stored status either - the same live fallback applies', async () => {
      const exemptUlbId = new Types.ObjectId();
      mockUlbModel.find.mockReturnValue(mockQuery([{ _id: exemptUlbId, startYear: 2026, yearAccess: {} }]));
      mockExemptionResolverService.resolveBulk.mockResolvedValue(
        new Map([[String(exemptUlbId), { exempted: true, source: 'AUTOMATIC' }]]),
      );

      await service.listUlbSubmissions(baseDto, adminUser);

      const pipeline = mockUlbModel.aggregate.mock.calls[0][0];
      const fallbackStage = pipeline.find(
        (stage: Record<string, any>) => stage.$addFields?.formStatus?.$cond !== undefined,
      );
      const [condition] = fallbackStage.$addFields.formStatus.$cond;
      expect(condition.$and).toContainEqual({ $ne: ['$sectionAccount.form_status', 'NOT_STARTED'] });
    });

    it('feeds Pending/Rejected/Approved discretionary ULB ids into the exemption-overlay $switch stage', async () => {
      const pendingId = new Types.ObjectId();
      const rejectedId = new Types.ObjectId();
      const approvedId = new Types.ObjectId();
      mockUlbModel.find.mockReturnValue(
        mockQuery([
          { _id: pendingId, startYear: null, yearAccess: {} },
          { _id: rejectedId, startYear: null, yearAccess: {} },
          { _id: approvedId, startYear: null, yearAccess: {} },
        ]),
      );
      mockExemptionResolverService.resolveDiscretionaryBulk.mockResolvedValue(
        new Map([
          [String(pendingId), { currentFormStatus: 5, requestId: new Types.ObjectId(), decidedAt: null, mohuaRemarks: null }],
          [String(rejectedId), { currentFormStatus: 6, requestId: new Types.ObjectId(), decidedAt: new Date(), mohuaRemarks: 'No' }],
          [String(approvedId), { currentFormStatus: 7, requestId: new Types.ObjectId(), decidedAt: new Date(), mohuaRemarks: null }],
        ]),
      );

      await service.listUlbSubmissions(baseDto, adminUser);

      const pipeline = mockUlbModel.aggregate.mock.calls[0][0];
      const overlayStage = pipeline.find((stage: Record<string, any>) => stage.$addFields?.formStatus?.$switch !== undefined);
      const branches = overlayStage.$addFields.formStatus.$switch.branches;

      expect(branches[0].case.$in[1]).toEqual([pendingId]);
      expect(branches[0].then).toBe('EXEMPTION_PENDING');
      expect(branches[1].case.$and[0].$in[1]).toEqual([rejectedId]);
      // Only while still genuinely untouched (NOT_STARTED, id 1) - not the whole ULB_EDITABLE_STATUS_IDS
      // set. IN_PROGRESS/RETURNED_BY_STATE/RETURNED_BY_MOHUA all mean real work happened since the
      // rejection, so those fall through to the real live status instead of a stale "Exemption Rejected".
      expect(branches[1].case.$and[1]).toEqual({ $eq: ['$formStatusId', 1] });
      expect(branches[1].then).toBe('EXEMPTION_REJECTED');
      expect(branches[2].case.$in[1]).toEqual([approvedId]);
      expect(branches[2].then).toBe('EXEMPTION_APPROVED');
      expect(branches[3].then).toBe('AUTO_EXEMPTED');
    });

    it('skips every exemption lookup when the design year is not found', async () => {
      mockYearModel.findById.mockReturnValue(mockQuery(null));

      await service.listUlbSubmissions(baseDto, adminUser);

      expect(mockUlbModel.find).not.toHaveBeenCalled();
      expect(mockExemptionResolverService.resolveBulk).not.toHaveBeenCalled();
      // Discretionary lookup still runs even with an empty candidate set - resolveDiscretionaryBulk
      // itself short-circuits to an empty map when given no ULB ids (see its own implementation).
      expect(mockExemptionResolverService.resolveDiscretionaryBulk).toHaveBeenCalledWith([], expect.any(Types.ObjectId), 30);
    });

    it('rejects a caller without REVIEW_ULB_SUBMISSIONS permission', async () => {
      const ulbUser: AuthUser = { _id: 'u-1', role: 'ULB-EDITOR', scope: 'ULB' } as AuthUser;

      await expect(service.listUlbSubmissions(baseDto, ulbUser)).rejects.toThrow(ForbiddenException);
    });
  });
});
