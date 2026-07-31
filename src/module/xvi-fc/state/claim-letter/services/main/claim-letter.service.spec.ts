import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterService } from './claim-letter.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FormJsonService } from 'src/master/form-json/form-json.service';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'select', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

function countQ(value: number) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

const financialSummary = {
  totalInstallmentAllocation: 0,
  totalAlreadyAcknowledged: 0,
  selectedAllocation: 0,
  currentSelectedClaim: 0,
  remainingIfAcknowledged: 0,
};

describe('ClaimLetterService', () => {
  let service: ClaimLetterService;
  let eligibilityService: {
    evaluateStateLevelGateForDisplay: jest.Mock;
    getFinancialOverview: jest.Mock;
    resolveUlbLevelEligibilityForDisplay: jest.Mock;
    resolveRemainingUlbIds: jest.Mock;
  };
  let expectedUlbSetService: { resolve: jest.Mock };
  let historyService: { recordTransition: jest.Mock };
  let fileInfoNormalizer: { normalizeInboundFileInfo: jest.Mock };
  let formJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let batchModel: {
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findById: jest.Mock;
  };

  const stateId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const stateUser: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
    state: stateId.toString(),
  };

  beforeEach(async () => {
    eligibilityService = {
      evaluateStateLevelGateForDisplay: jest.fn(),
      getFinancialOverview: jest.fn().mockResolvedValue({ totalInstallmentAllocation: 0, totalAlreadyAcknowledged: 0 }),
      resolveUlbLevelEligibilityForDisplay: jest
        .fn()
        .mockResolvedValue({ perUlbEligible: new Map(), standaloneCriteria: [], rowTalliesByFormId: new Map() }),
      resolveRemainingUlbIds: jest.fn().mockResolvedValue([]),
    };
    expectedUlbSetService = { resolve: jest.fn() };
    historyService = { recordTransition: jest.fn().mockResolvedValue(undefined) };
    fileInfoNormalizer = {
      normalizeInboundFileInfo: jest.fn().mockReturnValue({
        file: {
          originalName: 'signed.pdf',
          path: 'x/signed.pdf',
          mimeType: 'application/pdf',
          extension: 'pdf',
          sizeKb: 10,
          pageCount: null,
          sha256: '',
        },
        errors: [],
      }),
    };
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockRejectedValue(new NotFoundException('formjson not found')),
    };
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    batchModel = {
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(countQ(0)),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterService,
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: ClaimLetterHistoryService, useValue: historyService },
        { provide: FileInfoNormalizerService, useValue: fileInfoNormalizer },
        { provide: FormJsonService, useValue: formJsonService },
        { provide: getConnectionToken(), useValue: connection },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
      ],
    }).compile();

    service = module.get<ClaimLetterService>(ClaimLetterService);
  });

  describe('getEligibilitySummary', () => {
    it('throws ForbiddenException for a STATE user requesting a different state', async () => {
      const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
      await expect(
        service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, otherStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for installment 2', async () => {
      await expect(service.getEligibilitySummary(stateId.toString(), yearId.toString(), 2, stateUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns expectedUlbCount, the gate result, and batch-slot usage capped at 3', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: '1' }, { ulbId: '2' }]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });
      eligibilityService.getFinancialOverview.mockResolvedValue({
        totalInstallmentAllocation: 25,
        totalAlreadyAcknowledged: 5,
      });
      batchModel.find.mockReturnValue(q([{ batchNumber: 1 }, { batchNumber: 3 }]));

      const result = await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data).toEqual({
        installment: 1,
        stateLevelGate: { passed: true, sources: [] },
        expectedUlbCount: 2,
        batchSlotsUsed: 2,
        batchSlotsMax: 3,
        nextBatchNumber: 2,
        financialOverview: { totalInstallmentAllocation: 25, totalAlreadyAcknowledged: 5 },
        ulbLevelCriteria: [],
        ulbReadiness: { eligible: 2, total: 2 },
        remainingUlbCount: 0,
      });
    });

    it('reports remainingUlbCount from resolveRemainingUlbIds, independent of ulbReadiness', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: '1' }, { ulbId: '2' }, { ulbId: '3' }]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });
      eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['3']);

      const result = await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data?.remainingUlbCount).toBe(1);
      expect(eligibilityService.resolveRemainingUlbIds).toHaveBeenCalledWith(stateId.toString(), yearId.toString(), 1, [
        '1',
        '2',
        '3',
      ]);
    });

    it('passes expectedUlbIds through to resolveUlbLevelEligibilityForDisplay, not a fresh lookup', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: 'ulb-1' }, { ulbId: 'ulb-2' }]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });

      await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(eligibilityService.resolveUlbLevelEligibilityForDisplay).toHaveBeenCalledWith(
        stateId.toString(),
        yearId.toString(),
        1,
        ['ulb-1', 'ulb-2'],
        ['ulb-1', 'ulb-2'],
      );
    });

    it('surfaces standaloneCriteria (SLB, Annual Accounts) as ulbLevelCriteria on the summary', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });
      const tally = { eligible: 5, ineligible: 2, exempted: 0, total: 7 };
      eligibilityService.resolveUlbLevelEligibilityForDisplay.mockResolvedValue({
        perUlbEligible: new Map(),
        standaloneCriteria: [{ displayLabel: 'SLB', displayDescription: 'SLB...', tally }],
        rowTalliesByFormId: new Map(),
      });

      const result = await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data?.ulbLevelCriteria).toEqual([{ displayLabel: 'SLB', displayDescription: 'SLB...', tally }]);
    });

    it('computes ulbReadiness as the true intersection, not derivable from any single criterion tally', async () => {
      // 3 expected ULBs; only ulb-2 passes every ULB-bulk criterion — ulb-1 and ulb-3 each fail a
      // *different* criterion, so no single criterion's own tally would reveal this 1/3 result.
      expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: 'ulb-1' }, { ulbId: 'ulb-2' }, { ulbId: 'ulb-3' }]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });
      eligibilityService.resolveUlbLevelEligibilityForDisplay.mockResolvedValue({
        perUlbEligible: new Map([
          ['ulb-1', false],
          ['ulb-2', true],
          ['ulb-3', false],
        ]),
        standaloneCriteria: [],
        rowTalliesByFormId: new Map(),
      });

      const result = await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data?.ulbReadiness).toEqual({ eligible: 1, total: 3 });
    });

    it('merges rowTalliesByFormId into the matching stateLevelGate source as ulbBreakdown, by formId', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      const electedBodySource = { formId: 23, formType: 'ELECTED_BODY', result: 'PASSED' };
      const sfcSource = { formId: 22, formType: 'SFC', result: 'PASSED' };
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
        sources: [electedBodySource, sfcSource],
        passed: true,
      });
      const eulbTally = { eligible: 10, ineligible: 3, exempted: 1, total: 14 };
      eligibilityService.resolveUlbLevelEligibilityForDisplay.mockResolvedValue({
        perUlbEligible: new Map(),
        standaloneCriteria: [],
        rowTalliesByFormId: new Map([[23, eulbTally]]),
      });

      const result = await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data?.stateLevelGate.sources).toEqual([
        { ...electedBodySource, ulbBreakdown: eulbTally },
        sfcSource, // no matching formId in rowTalliesByFormId -> unchanged, no ulbBreakdown added
      ]);
    });

    it('reports nextBatchNumber as null once all 3 slots are occupied', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });
      batchModel.find.mockReturnValue(q([{ batchNumber: 1 }, { batchNumber: 2 }, { batchNumber: 3 }]));

      const result = await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data?.nextBatchNumber).toBeNull();
      expect(result.data?.batchSlotsUsed).toBe(3);
    });

    it('scopes the batch-slot lookup to non-abandoned drafts only', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });

      await service.getEligibilitySummary(stateId.toString(), yearId.toString(), 1, stateUser);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['isAbandoned']).toBe(false);
    });
  });

  describe('getClaimContext', () => {
    it('throws ForbiddenException for a STATE user requesting a different state', async () => {
      const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
      await expect(
        service.getClaimContext(stateId.toString(), yearId.toString(), 1, otherStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for installment 2', async () => {
      await expect(service.getClaimContext(stateId.toString(), yearId.toString(), 2, stateUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns expectedUlbCount, batch-slot info, financialOverview, and remainingUlbCount', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: '1' }, { ulbId: '2' }]);
      eligibilityService.getFinancialOverview.mockResolvedValue({
        totalInstallmentAllocation: 25,
        totalAlreadyAcknowledged: 5,
        totalClaimInProgress: 0,
        totalClaimInDraft: 0,
        availableToClaim: 20,
      });
      eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['1']);
      batchModel.find.mockReturnValue(q([{ batchNumber: 1 }]));

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data).toEqual({
        expectedUlbCount: 2,
        batchSlotsUsed: 1,
        batchSlotsMax: 3,
        nextBatchNumber: 2,
        financialOverview: {
          totalInstallmentAllocation: 25,
          totalAlreadyAcknowledged: 5,
          totalClaimInProgress: 0,
          totalClaimInDraft: 0,
          availableToClaim: 20,
        },
        remainingUlbCount: 1,
      });
    });

    it('never evaluates the eligibility checklist — the whole point of this lean endpoint', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);

      await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(eligibilityService.evaluateStateLevelGateForDisplay).not.toHaveBeenCalled();
      expect(eligibilityService.resolveUlbLevelEligibilityForDisplay).not.toHaveBeenCalled();
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException when no READY claim matches the id', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.getDetail('missing', stateUser)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the claim belongs to a different state', async () => {
      batchModel.findOne.mockReturnValue(
        q({
          _id: 'x',
          state: new Types.ObjectId(),
          installment: 1,
          batchNumber: 1,
          version: 1,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 0,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
        }),
      );
      await expect(service.getDetail('x', stateUser)).rejects.toThrow(ForbiddenException);
    });

    it('maps a found document to a ClaimLetterBatchSummary, including revision', async () => {
      const claimLetterId = new Types.ObjectId();
      batchModel.findOne.mockReturnValue(
        q({
          _id: claimLetterId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          revision: 3,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 5,
          isAbandoned: false,
          signedClaimFile: null,
          financialSummary,
          submittedAt: null,
          resolvedAt: null,
          supersedes: null,
          supersededBy: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(result.data).toMatchObject({
        claimLetterId: String(claimLetterId),
        currentFormStatus: 2,
        currentFormStatusLabel: 'In Progress',
        ulbCount: 5,
        hasSignedFile: false,
        revision: 3,
      });
    });

    it('attaches questions from the Claim Letter formjsons entry for the claim year', async () => {
      const claimLetterId = new Types.ObjectId();
      const signedFileField = { key: 'signedClaimFile', formFieldType: 'file' };
      batchModel.findOne.mockReturnValue(
        q({
          _id: claimLetterId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          revision: 0,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 0,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
        }),
      );
      formJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({ data: [signedFileField] });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(formJsonService.findActiveByDesignYearAndFormId).toHaveBeenCalledWith(yearId.toString(), 26);
      expect(result.data?.questions).toEqual([signedFileField]);
    });

    it('overlays the actually-persisted signedClaimFile onto the signedClaimFile question, not the blank template', async () => {
      const claimLetterId = new Types.ObjectId();
      const signedFileField = {
        key: 'signedClaimFile',
        formFieldType: 'file',
        value: { originalName: '', path: '', mimeType: '', sizeKb: null, pageCount: null },
      };
      batchModel.findOne.mockReturnValue(
        q({
          _id: claimLetterId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          revision: 0,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 0,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
          signedClaimFile: {
            originalName: 'signed-claim-letter.pdf',
            path: 'claim-letter/signed-file/signed-claim-letter.pdf',
            mimeType: 'application/pdf',
            sizeKb: 512,
            pageCount: 3,
          },
        }),
      );
      formJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({ data: [signedFileField] });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(result.data?.questions?.[0]?.value).toEqual({
        originalName: 'signed-claim-letter.pdf',
        path: 'claim-letter/signed-file/signed-claim-letter.pdf',
        mimeType: 'application/pdf',
        sizeKb: 512,
        pageCount: 3,
      });
    });

    it('leaves the blank template value untouched when no signed file has been uploaded yet', async () => {
      const claimLetterId = new Types.ObjectId();
      const signedFileField = {
        key: 'signedClaimFile',
        formFieldType: 'file',
        value: { originalName: '', path: '', mimeType: '', sizeKb: null, pageCount: null },
      };
      batchModel.findOne.mockReturnValue(
        q({
          _id: claimLetterId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          revision: 0,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 0,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
          signedClaimFile: null,
        }),
      );
      formJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({ data: [signedFileField] });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(result.data?.questions?.[0]?.value).toEqual({
        originalName: '',
        path: '',
        mimeType: '',
        sizeKb: null,
        pageCount: null,
      });
    });

    it('degrades to an empty questions list (not a 500) when the formjsons entry is not yet seeded', async () => {
      const claimLetterId = new Types.ObjectId();
      batchModel.findOne.mockReturnValue(
        q({
          _id: claimLetterId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          revision: 0,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 0,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
        }),
      );
      formJsonService.findActiveByDesignYearAndFormId.mockRejectedValue(new NotFoundException('not found'));

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(result.data?.questions).toEqual([]);
    });
  });

  describe('listHistory', () => {
    it('throws ForbiddenException for a STATE user requesting a different state', async () => {
      const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
      await expect(service.listHistory(stateId.toString(), yearId.toString(), {}, otherStateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('filters to assemblyStatus READY and the requesting state/year', async () => {
      batchModel.find.mockReturnValue(q([]));

      await service.listHistory(stateId.toString(), yearId.toString(), {}, stateUser);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['assemblyStatus']).toBe('READY');
      expect((filter['state'] as Types.ObjectId).toString()).toBe(stateId.toString());
    });

    it('adds an installment filter only when provided', async () => {
      batchModel.find.mockReturnValue(q([]));

      await service.listHistory(stateId.toString(), yearId.toString(), { installment: 1 }, stateUser);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['installment']).toBe(1);
    });

    it('returns paginated batch summaries with total count', async () => {
      const claimLetterId = new Types.ObjectId();
      batchModel.find.mockReturnValue(
        q([
          {
            _id: claimLetterId,
            installment: 1,
            batchNumber: 1,
            version: 1,
            currentFormStatus: 2,
            assemblyStatus: 'READY',
            ulbCount: 3,
            isAbandoned: false,
            signedClaimFile: null,
            financialSummary,
            submittedAt: null,
            resolvedAt: null,
            supersedes: null,
            supersededBy: null,
            createdAt: new Date(),
          },
        ]),
      );
      batchModel.countDocuments.mockReturnValue(countQ(1));

      const result = await service.listHistory(stateId.toString(), yearId.toString(), {}, stateUser);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
    });
  });

  describe('uploadSignedFile', () => {
    const fileRef = {
      originalName: 'signed.pdf',
      path: 'x/signed.pdf',
      mimeType: 'application/pdf',
      sizeKb: 10,
    } as never;

    it('throws NotFoundException when no READY claim matches the id', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the claim belongs to a different state', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: new Types.ObjectId(), currentFormStatus: 2 }));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the claim is not IN_PROGRESS', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 5 }));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when the normalizer reports validation errors', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({
        file: null,
        errors: [{ field: 'signedClaimFile', message: 'mimeType is required.', code: 'required' }],
      });
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(BadRequestException);
    });

    it('returns the current state unchanged when the same file is re-uploaded', async () => {
      const current = {
        _id: 'x',
        state: stateId,
        currentFormStatus: 2,
        installment: 1,
        batchNumber: 1,
        version: 1,
        ulbCount: 0,
        isAbandoned: false,
        financialSummary,
        createdAt: new Date(),
      };
      batchModel.findOne.mockReturnValue(q(current));
      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({ file: undefined, errors: [] });

      const result = await service.uploadSignedFile('x', fileRef, stateUser);

      expect(result.message).toMatch(/unchanged/i);
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('persists the normalized file, returns the updated summary, and never writes history (plan §9: file upload is not a workflow transition)', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      batchModel.findOneAndUpdate.mockReturnValue(
        q({
          _id: 'x',
          state: stateId,
          currentFormStatus: 2,
          installment: 1,
          batchNumber: 1,
          version: 1,
          ulbCount: 0,
          isAbandoned: false,
          signedClaimFile: { path: 'x/signed.pdf' },
          financialSummary,
          createdAt: new Date(),
        }),
      );

      const result = await service.uploadSignedFile('x', fileRef, stateUser);

      expect(result.data?.hasSignedFile).toBe(true);
      const [filter] = batchModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toMatchObject({ _id: 'x', currentFormStatus: 2 });
      expect(historyService.recordTransition).not.toHaveBeenCalled();
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the guarded update matches nothing (concurrent status change)', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(ConflictException);
    });
  });

  describe('submit', () => {
    const readyParent = {
      _id: 'x',
      state: stateId,
      year: yearId,
      installment: 1,
      batchNumber: 1,
      version: 1,
      currentFormStatus: 2,
      ulbCount: 1,
      isAbandoned: false,
      signedClaimFile: { path: 'x/signed.pdf' },
      financialSummary,
      createdAt: new Date(),
    };

    it('throws NotFoundException when no READY claim matches the id', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.submit('x', stateUser)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the claim belongs to a different state', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, state: new Types.ObjectId() }));
      await expect(service.submit('x', stateUser)).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent: returns the current state without re-transitioning when already submitted', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, currentFormStatus: 5 }));

      const result = await service.submit('x', stateUser);

      expect(result.message).toMatch(/already submitted/i);
      expect(connection.startSession).not.toHaveBeenCalled();
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('throws ConflictException when status is neither IN_PROGRESS nor UNDER_REVIEW_BY_MOHUA', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, currentFormStatus: 6 }));
      await expect(service.submit('x', stateUser)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when no signed file has been uploaded', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, signedClaimFile: null }));
      await expect(service.submit('x', stateUser)).rejects.toThrow(BadRequestException);
    });

    it('transitions to UNDER_REVIEW_BY_MOHUA and records history inside one transaction', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 5 }));

      const result = await service.submit('x', stateUser, '127.0.0.1', 'jest-agent');

      expect(result.data?.currentFormStatus).toBe(5);
      expect(historyService.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({ fromStatus: 2, toStatus: 5, actionSource: 'DIRECT_STATE_REVIEW' }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();

      const [filter] = batchModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
      expect(filter['$or']).toEqual([
        { editLockToken: null },
        { editLockAcquiredAt: { $lt: expect.any(Date) } },
      ]);
    });

    it('treats a concurrent race as idempotent if the doc is already UNDER_REVIEW_BY_MOHUA', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q({ ...readyParent, currentFormStatus: 5 }));

      const result = await service.submit('x', stateUser);

      expect(result.message).toMatch(/already submitted/i);
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('throws ConflictException on a genuine race with no idempotent resolution', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q({ ...readyParent, currentFormStatus: 6 }));

      await expect(service.submit('x', stateUser)).rejects.toThrow(ConflictException);
    });

    it('throws a specific ConflictException when an updateDraft call is currently mid-rebuild', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      // The atomic submit guard now also requires the edit lock to be absent/expired — simulate a
      // real DB rejecting the match because an update currently holds a *fresh* (unexpired) lock.
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(
        q({ ...readyParent, editLockToken: 'some-update-token', editLockAcquiredAt: new Date() }),
      );

      await expect(service.submit('x', stateUser)).rejects.toThrow(/currently being edited/i);
    });

    it('treats an expired edit lock as unclaimed and falls through to the generic conflict message', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(
        q({
          ...readyParent,
          editLockToken: 'some-stale-token',
          editLockAcquiredAt: new Date(Date.now() - 60 * 60_000),
        }),
      );

      await expect(service.submit('x', stateUser)).rejects.toThrow('Claim letter status changed. Please retry.');
    });

    describe('final-batch completeness (batchNumber === CLAIM_LETTER_MAX_BATCH_NUMBER)', () => {
      const finalBatchParent = { ...readyParent, batchNumber: 3 };

      it('rejects submission with a BadRequestException naming the still-unclaimed ULBs', async () => {
        batchModel.findOne.mockReturnValue(q(finalBatchParent));
        expectedUlbSetService.resolve.mockResolvedValue([
          { ulbId: 'ulb-1', name: 'Alpha ULB' },
          { ulbId: 'ulb-2', name: 'Beta ULB' },
        ]);
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['ulb-2']);

        await expect(service.submit('x', stateUser)).rejects.toThrow(BadRequestException);
        await expect(service.submit('x', stateUser)).rejects.toThrow(/Beta ULB/);
        expect(connection.startSession).not.toHaveBeenCalled();
      });

      it('allows submission once no ULBs remain unclaimed', async () => {
        batchModel.findOne.mockReturnValue(q(finalBatchParent));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...finalBatchParent, currentFormStatus: 5 }));
        expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: 'ulb-1', name: 'Alpha ULB' }]);
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue([]);

        const result = await service.submit('x', stateUser);

        expect(result.data?.currentFormStatus).toBe(5);
      });

      it('does not run the completeness check for a non-final batch (batchNumber 2)', async () => {
        batchModel.findOne.mockReturnValue(q({ ...readyParent, batchNumber: 2 }));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, batchNumber: 2, currentFormStatus: 5 }));

        const result = await service.submit('x', stateUser);

        expect(result.data?.currentFormStatus).toBe(5);
        expect(expectedUlbSetService.resolve).not.toHaveBeenCalled();
        expect(eligibilityService.resolveRemainingUlbIds).not.toHaveBeenCalled();
      });
    });
  });
});
