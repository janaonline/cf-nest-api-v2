import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterService } from './claim-letter.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { State } from 'src/schemas/state.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { YearIdToLabel } from 'src/core/constants/years';

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
    evaluateStateLevelGate: jest.Mock;
    resolveUlbLevelEligibility: jest.Mock;
  };
  let expectedUlbSetService: { resolve: jest.Mock };
  let fileInfoNormalizer: { normalizeInboundFileInfo: jest.Mock };
  let formJsonConfigService: { loadFormConfig: jest.Mock; loadVarianceConfig: jest.Mock };
  let letterDetailsService: { evaluate: jest.Mock; assertComplete: jest.Mock };
  let activeBatchService: {
    resolveActiveBatch: jest.Mock;
    resolveBlockingBatchNumber: jest.Mock;
    assertActive: jest.Mock;
    blockingBatchNumberFor: jest.Mock;
    blockedReason: jest.Mock;
  };
  let batchModel: {
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findById: jest.Mock;
  };
  let stateModel: { findById: jest.Mock };

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
      resolveUlbLevelEligibilityForDisplay: jest.fn().mockResolvedValue({
        perUlbEligible: new Map(),
        standaloneCriteria: [],
        rowTalliesByFormId: new Map(),
      }),
      resolveRemainingUlbIds: jest.fn().mockResolvedValue([]),
      evaluateStateLevelGate: jest.fn().mockResolvedValue({ passed: true, sources: [] }),
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({ perUlbEligible: new Map() }),
    };
    expectedUlbSetService = { resolve: jest.fn() };
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
    formJsonConfigService = {
      loadFormConfig: jest
        .fn()
        .mockResolvedValue({ questions: [], varianceLowerPercent: 90, varianceUpperPercent: 110, letterQuestions: [] }),
      loadVarianceConfig: jest.fn().mockResolvedValue({ lowerPercent: 90, upperPercent: 110 }),
    };
    letterDetailsService = {
      evaluate: jest.fn().mockReturnValue({ isComplete: true, missingFields: [] }),
      assertComplete: jest.fn().mockResolvedValue(undefined),
    };
    activeBatchService = {
      resolveActiveBatch: jest.fn().mockResolvedValue(null),
      resolveBlockingBatchNumber: jest.fn().mockResolvedValue(null),
      assertActive: jest.fn().mockResolvedValue(undefined),
      blockingBatchNumberFor: jest.fn().mockReturnValue(null),
      blockedReason: jest.fn((n: number) => `Batch ${n} is still in progress or under MoHUA review.`),
    };
    batchModel = {
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(countQ(0)),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
    };
    stateModel = { findById: jest.fn().mockReturnValue(q({ name: 'Test State' })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterService,
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: FileInfoNormalizerService, useValue: fileInfoNormalizer },
        { provide: ClaimLetterFormJsonService, useValue: formJsonConfigService },
        { provide: ClaimLetterLetterDetailsService, useValue: letterDetailsService },
        { provide: ClaimLetterActiveBatchService, useValue: activeBatchService },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(State.name), useValue: stateModel },
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
        stateName: 'Test State',
        installment: 1,
        // yearId is a fabricated ObjectId with no YearIdToLabel entry, so this falls back to
        // '14th FC' the same way `resolvePriorFcCycleLabel` falls back for any unmapped year.
        priorFcCycleLabel: '14th FC',
        stateLevelGate: { passed: true, sources: [] },
        expectedUlbCount: 2,
        batchSlotsUsed: 2,
        batchSlotsMax: 3,
        nextBatchNumber: 2,
        financialOverview: { totalInstallmentAllocation: 25, totalAlreadyAcknowledged: 5 },
        ulbLevelCriteria: [],
        ulbReadiness: { eligible: 2, total: 2 },
        remainingUlbCount: 0,
        activeBatchNumber: null,
      });
    });

    it('resolves priorFcCycleLabel from the real design year, matching the Claim Letter document', async () => {
      const realYearId = Object.keys(YearIdToLabel).find((id) => YearIdToLabel[id] === '2026-27')!;
      expectedUlbSetService.resolve.mockResolvedValue([]);
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({ sources: [], passed: true });

      const result = await service.getEligibilitySummary(stateId.toString(), realYearId, 1, stateUser);

      // 2026-27 -> '14th FC', same mapping (and same helper) the Claim Letter document itself uses.
      expect(result.data?.priorFcCycleLabel).toBe('14th FC');
    });

    it('interpolates {{priorFcCycleLabel}} in checklistSummary/displayDescription for stateLevelGate sources', async () => {
      const realYearId = Object.keys(YearIdToLabel).find((id) => YearIdToLabel[id] === '2026-27')!;
      expectedUlbSetService.resolve.mockResolvedValue([]);
      const fcUnspentSource = {
        formId: 25,
        formType: 'FC_UNSPENT_STATE',
        result: 'PASSED',
        checklistSummary:
          'Confirm that all ULBs in the state have submitted their {{priorFcCycleLabel}} unspent balance disclosures',
        displayDescription: '{{priorFcCycleLabel}} Unspent Balance Declaration must be submitted by the state.',
      };
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
        sources: [fcUnspentSource],
        passed: true,
      });

      const result = await service.getEligibilitySummary(stateId.toString(), realYearId, 1, stateUser);

      // Neither field is a hardcoded '14th FC' anywhere in this test's config — the substitution
      // comes entirely from the same resolvePriorFcCycleLabel() call priorFcCycleLabel itself uses.
      expect(result.data?.stateLevelGate.sources[0]).toMatchObject({
        checklistSummary: 'Confirm that all ULBs in the state have submitted their 14th FC unspent balance disclosures',
        displayDescription: '14th FC Unspent Balance Declaration must be submitted by the state.',
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
        perUlbFailedCriteria: new Map(),
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
        perUlbFailedCriteria: new Map(),
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
      await expect(service.getClaimContext(stateId.toString(), yearId.toString(), 1, otherStateUser)).rejects.toThrow(
        ForbiddenException,
      );
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
        stateName: 'Test State',
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
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        // stateUser has no xviFcSubrole set — defaults to 'viewer', which lacks PREPARE_GRANT_LETTERS.
        canCreate: false,
        createBlockedReason: null,
      });
    });

    it('sets canCreate true for a user with PREPARE_GRANT_LETTERS (e.g. reviewer/admin subrole)', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      const reviewerUser: AuthUser = { ...stateUser, xviFcSubrole: 'reviewer' };

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, reviewerUser);

      expect(result.data?.canCreate).toBe(true);
    });

    it('turns canCreate off with a reason while another batch is active', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      activeBatchService.resolveActiveBatch.mockResolvedValue({ _id: new Types.ObjectId(), batchNumber: 1 });
      const reviewerUser: AuthUser = { ...stateUser, xviFcSubrole: 'reviewer' };

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, reviewerUser);

      expect(result.data?.canCreate).toBe(false);
      expect(result.data?.createBlockedReason).toMatch(/Batch 1/);
    });

    it('sources the variance band from ClaimLetterFormJsonService, keyed by yearId', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      formJsonConfigService.loadVarianceConfig.mockResolvedValue({ lowerPercent: 80, upperPercent: 120 });

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(formJsonConfigService.loadVarianceConfig).toHaveBeenCalledWith(yearId.toString());
      expect(result.data?.varianceLowerPercent).toBe(80);
      expect(result.data?.varianceUpperPercent).toBe(120);
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
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(formJsonConfigService.loadFormConfig).toHaveBeenCalledWith(yearId.toString());
      expect(formJsonConfigService.loadFormConfig).toHaveBeenCalledTimes(1);
      expect(result.data?.questions).toEqual([signedFileField]);
      expect(result.data?.varianceLowerPercent).toBe(90);
      expect(result.data?.varianceUpperPercent).toBe(110);
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
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

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
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(result.data?.questions?.[0]?.value).toEqual({
        originalName: '',
        path: '',
        mimeType: '',
        sizeKb: null,
        pageCount: null,
      });
    });

    it('adds the Letter details & Preview action to signedClaimFile when the batch has ULBs and the user can edit', async () => {
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
          ulbCount: 5,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
        }),
      );
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

      // stateUser defaults to the 'viewer' xviFcSubrole (no PREPARE_GRANT_LETTERS) — these actions
      // are canEdit-gated (see applySignedFileSupportingContent), so use an editable user here.
      const editableUser: AuthUser = { ...stateUser, xviFcSubrole: 'admin' };
      const result = await service.getDetail(claimLetterId.toString(), editableUser);

      const supportingContent = result.data?.questions?.[0]?.supportingContent?.[0];
      expect(supportingContent?.description).toBe(
        'Fill in the letter details, preview and download the claim letter, then upload the signed copy below.',
      );
      const actions = supportingContent?.actions ?? [];
      expect(actions).toEqual([
        expect.objectContaining({ id: 'preview-template', label: 'Letter details & Preview', visible: true }),
      ]);
    });

    it('marks the Letter details & Preview action not visible when the batch has ULBs but the user cannot edit', async () => {
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
          ulbCount: 5,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
        }),
      );
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

      // stateUser defaults to the 'viewer' xviFcSubrole — no PREPARE_GRANT_LETTERS, so canEdit is false.
      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      const supportingContent = result.data?.questions?.[0]?.supportingContent?.[0];
      expect(supportingContent?.description).toBe('');
      const actions = supportingContent?.actions ?? [];
      expect(actions.every((a) => a.visible === false)).toBe(true);
    });

    it('marks the Letter details & Preview action not visible when the batch has no ULBs', async () => {
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
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      const actions = result.data?.questions?.[0]?.supportingContent?.[0]?.actions ?? [];
      expect(actions.every((a) => a.visible === false)).toBe(true);
    });

    it('hides letter-detail questions (served by letter-details) and reports letterDetailsComplete', async () => {
      const signedFileField = { key: 'signedClaimFile', formFieldType: 'file' };
      const letterNoField = { key: 'letterNo', formFieldType: 'text' };
      batchModel.findOne.mockReturnValue(
        q({
          _id: new Types.ObjectId(),
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          revision: 0,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 1,
          isAbandoned: false,
          financialSummary,
          letterDetails: { letterNo: 'A/1' },
          createdAt: new Date(),
        }),
      );
      const formConfig = {
        questions: [signedFileField, letterNoField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [letterNoField],
      };
      formJsonConfigService.loadFormConfig.mockResolvedValue(formConfig);
      letterDetailsService.evaluate.mockReturnValue({ isComplete: false, missingFields: ['ATR date'] });

      const result = await service.getDetail(new Types.ObjectId().toString(), stateUser);

      expect(result.data?.questions?.map((f) => f.key)).toEqual(['signedClaimFile']);
      expect(result.data?.letterDetailsComplete).toBe(false);
      expect(letterDetailsService.evaluate).toHaveBeenCalledWith({ letterNo: 'A/1' }, formConfig);
    });

    it('reports the blocking batch, turns off final submit and hides the letter action with the reason', async () => {
      const signedFileField = { key: 'signedClaimFile', formFieldType: 'file' };
      batchModel.findOne.mockReturnValue(
        q({
          _id: new Types.ObjectId(),
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 2,
          version: 1,
          revision: 0,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 3,
          isAbandoned: false,
          signedClaimFile: { path: 'x/signed.pdf' },
          financialSummary,
          createdAt: new Date(),
        }),
      );
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [signedFileField],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });
      activeBatchService.resolveBlockingBatchNumber.mockResolvedValue(1);
      const adminUser: AuthUser = { ...stateUser, xviFcSubrole: 'admin' };

      const result = await service.getDetail(new Types.ObjectId().toString(), adminUser);

      expect(result.data?.blockedByBatchNumber).toBe(1);
      expect(result.data?.blockedReason).toMatch(/Batch 1/);
      // The guard gets the batch's own status, so an abandoned or finished batch is never blocked.
      const [guarded] = activeBatchService.resolveBlockingBatchNumber.mock.calls[0] as [
        { currentFormStatus: unknown; isAbandoned: unknown },
      ];
      expect(typeof guarded.currentFormStatus).toBe('number');
      expect(guarded.isAbandoned).toBe(false);
      expect(result.data?.permissions.canFinalSubmit).toBe(false);
      // Signed, but the final claim letter is not offered while another batch is active.
      expect(result.data?.finalClaimLetterStage).toBeNull();
      const content = result.data?.questions?.[0]?.supportingContent?.[0];
      expect(content?.description).toMatch(/Batch 1/);
      expect(content?.actions?.every((a) => a.visible === false)).toBe(true);
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
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [],
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

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

    it('refuses an abandoned batch, which abandon leaves IN_PROGRESS', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2, isAbandoned: true }));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(
        'This claim batch was abandoned.',
      );
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
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
    });

    it('persists the normalized file, returns the updated summary, and never writes history (file upload is not a workflow transition — docs/adr/0003-workflow-transitions.md)', async () => {
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
      expect(filter).toMatchObject({ _id: 'x', currentFormStatus: 2, isAbandoned: false });
    });

    it('throws ConflictException when the guarded update matches nothing (concurrent status change)', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(ConflictException);
    });
  });
});
