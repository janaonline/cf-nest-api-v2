import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterService } from './claim-letter.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import { ClaimLetterFormStatusService } from '../form-status/claim-letter-form-status.service';
import { PmuUndoEligibilityService } from 'src/module/xvi-fc/common/services/pmu-undo-eligibility.service';
import { CLAIM_LETTER_BUSY_MESSAGE } from '../../helpers/claim-letter-concurrency.helpers';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { State } from 'src/schemas/state.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { YearIdToLabel } from 'src/core/constants/years';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

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
    countBatchUlbsWithExemptionUnderReview: jest.Mock;
    assertStateConditionsMet: jest.Mock;
  };
  let expectedUlbSetService: { resolve: jest.Mock };
  let fileInfoNormalizer: { normalizeInboundFileInfo: jest.Mock };
  let formJsonConfigService: { loadFormConfig: jest.Mock; loadClaimAmountConfig: jest.Mock };
  let letterDetailsService: {
    evaluate: jest.Mock;
    assertComplete: jest.Mock;
    isSfcExempted: jest.Mock;
    letterQuestionsFor: jest.Mock;
  };
  let batchModel: {
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findById: jest.Mock;
  };
  let stateModel: { findById: jest.Mock };
  let formStatusService: { assertStateFormsStillReady: jest.Mock };
  let undoEligibility: { touchClaimUndoGuard: jest.Mock };
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };

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
      evaluateStateLevelGateForDisplay: jest.fn().mockResolvedValue({ passed: true, sources: [] }),
      getFinancialOverview: jest.fn().mockResolvedValue({ totalInstallmentAllocation: 0, totalAlreadyAcknowledged: 0 }),
      resolveUlbLevelEligibilityForDisplay: jest.fn().mockResolvedValue({
        perUlbEligible: new Map(),
        standaloneCriteria: [],
        rowTalliesByFormId: new Map(),
      }),
      resolveRemainingUlbIds: jest.fn().mockResolvedValue([]),
      evaluateStateLevelGate: jest.fn().mockResolvedValue({ passed: true, sources: [] }),
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({ perUlbEligible: new Map() }),
      countBatchUlbsWithExemptionUnderReview: jest.fn().mockResolvedValue(0),
      assertStateConditionsMet: jest.fn().mockResolvedValue(undefined),
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
      loadFormConfig: jest.fn().mockResolvedValue({
        questions: [],
        claimAmountEditable: false,
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
        maxClaimLetters: 3,
      }),
      loadClaimAmountConfig: jest.fn().mockResolvedValue({ editable: false, lowerPercent: 90, upperPercent: 110 }),
    };
    letterDetailsService = {
      evaluate: jest.fn().mockReturnValue({ isComplete: true, missingFields: [] }),
      assertComplete: jest.fn().mockResolvedValue(undefined),
      isSfcExempted: jest.fn().mockResolvedValue(false),
      letterQuestionsFor: jest.fn().mockReturnValue([]),
    };
    batchModel = {
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(countQ(0)),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
    };
    stateModel = { findById: jest.fn().mockReturnValue(q({ name: 'Test State' })) };
    formStatusService = { assertStateFormsStillReady: jest.fn().mockResolvedValue(undefined) };
    undoEligibility = { touchClaimUndoGuard: jest.fn().mockResolvedValue(undefined) };
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterService,
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: FileInfoNormalizerService, useValue: fileInfoNormalizer },
        { provide: ClaimLetterFormJsonService, useValue: formJsonConfigService },
        { provide: ClaimLetterLetterDetailsService, useValue: letterDetailsService },
        { provide: ClaimLetterFormStatusService, useValue: formStatusService },
        { provide: PmuUndoEligibilityService, useValue: undoEligibility },
        { provide: getConnectionToken(), useValue: connection },
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
        claimAmountEditable: false,
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
      batchModel.find.mockReturnValue(q([{ batchNumber: 1, currentFormStatus: 2 }]));

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data).toEqual({
        stateName: 'Test State',
        expectedUlbCount: 2,
        batchSlotsUsed: 1,
        batchSlotsMax: 3,
        openDraftCount: 1,
        nextBatchNumber: 2,
        financialOverview: {
          totalInstallmentAllocation: 25,
          totalAlreadyAcknowledged: 5,
          totalClaimInProgress: 0,
          totalClaimInDraft: 0,
          availableToClaim: 20,
        },
        remainingUlbCount: 1,
        claimAmountEditable: false,
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

    it('keeps canCreate on while other letters are drafts or under review (ADR 0009)', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      batchModel.find.mockReturnValue(q([{ batchNumber: 1 }, { batchNumber: 2 }]));
      const reviewerUser: AuthUser = { ...stateUser, xviFcSubrole: 'reviewer' };

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, reviewerUser);

      expect(result.data).toMatchObject({ canCreate: true, createBlockedReason: null, nextBatchNumber: 3 });
    });

    it('turns canCreate off with a reason once every place under the formjson cap is taken', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      batchModel.find.mockReturnValue(q([{ batchNumber: 1 }, { batchNumber: 2 }, { batchNumber: 3 }]));
      const reviewerUser: AuthUser = { ...stateUser, xviFcSubrole: 'reviewer' };

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, reviewerUser);

      expect(result.data).toMatchObject({ canCreate: false, nextBatchNumber: null, batchSlotsMax: 3 });
      expect(result.data?.createBlockedReason).toBe(
        'All 3 claim letters for this installment are in use. A letter that is discarded or returned frees its place.',
      );
    });

    it('offers the next place up to a higher cap', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [],
        claimAmountEditable: false,
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
        maxClaimLetters: 5,
      });
      batchModel.find.mockReturnValue(q([{ batchNumber: 1 }, { batchNumber: 2 }, { batchNumber: 3 }]));

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data).toMatchObject({ batchSlotsMax: 5, batchSlotsUsed: 3, nextBatchNumber: 4 });
    });

    it('counts only the open drafts, for the last-draft note of a new letter (ADR 0009)', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      batchModel.find.mockReturnValue(
        q([
          { batchNumber: 1, currentFormStatus: 15 },
          { batchNumber: 2, currentFormStatus: 2 },
          { batchNumber: 3, currentFormStatus: 5 },
        ]),
      );

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(result.data).toMatchObject({ batchSlotsUsed: 3, openDraftCount: 1 });
    });

    it('sources the claim-amount switch and band from ClaimLetterFormJsonService, keyed by yearId', async () => {
      expectedUlbSetService.resolve.mockResolvedValue([]);
      formJsonConfigService.loadFormConfig.mockResolvedValue({
        questions: [],
        claimAmountEditable: true,
        varianceLowerPercent: 80,
        varianceUpperPercent: 120,
        letterQuestions: [],
        maxClaimLetters: 3,
      });

      const result = await service.getClaimContext(stateId.toString(), yearId.toString(), 1, stateUser);

      expect(formJsonConfigService.loadFormConfig).toHaveBeenCalledWith(yearId.toString());
      expect(result.data?.claimAmountEditable).toBe(true);
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

    it('names the State forms whose Entire State exemption is still under MoHUA review', async () => {
      const claimLetterId = new Types.ObjectId();
      batchModel.findOne.mockReturnValue(
        q({
          _id: claimLetterId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          currentFormStatus: 2,
          assemblyStatus: 'READY',
          ulbCount: 5,
          isAbandoned: false,
          financialSummary,
          createdAt: new Date(),
        }),
      );
      eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
        passed: true,
        sources: [
          {
            formType: 'SFC_STATUS',
            displayLabel: 'State Finance Commission (SFC)',
            result: 'EXEMPTED',
            exemptionStatus: 5,
          },
          { formType: 'GTC', displayLabel: 'Grant Transfer Certificate', result: 'EXEMPTED', exemptionStatus: 7 },
          { formType: 'DEVOLUTION_FORMULA', result: 'PASSED' },
        ],
      });
      letterDetailsService.isSfcExempted.mockResolvedValue(true);

      const { data } = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(data!.stateExemptionsUnderReview).toEqual(['State Finance Commission (SFC)']);
      // Completeness is judged on this State's letter questions (no ATR date while SFC is exempted).
      const [, sfcExempted] = letterDetailsService.letterQuestionsFor.mock.calls[0] as [unknown, boolean];
      expect(sfcExempted).toBe(true);
    });

    it('counts the draft ULBs that rely on an exemption under MoHUA review, and skips it once submitted', async () => {
      const claimLetterId = new Types.ObjectId();
      const doc = {
        _id: claimLetterId,
        state: stateId,
        year: yearId,
        installment: 1,
        batchNumber: 1,
        version: 1,
        currentFormStatus: 2,
        assemblyStatus: 'READY',
        ulbCount: 5,
        isAbandoned: false,
        financialSummary,
        createdAt: new Date(),
      };
      batchModel.findOne.mockReturnValue(q(doc));
      eligibilityService.countBatchUlbsWithExemptionUnderReview.mockResolvedValue(2);

      const draft = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(draft.data!.exemptionUnderReviewUlbCount).toBe(2);
      expect(eligibilityService.countBatchUlbsWithExemptionUnderReview).toHaveBeenCalledWith(
        claimLetterId,
        String(stateId),
        String(yearId),
        1,
      );

      eligibilityService.countBatchUlbsWithExemptionUnderReview.mockClear();
      batchModel.findOne.mockReturnValue(q({ ...doc, currentFormStatus: 5 }));

      const submitted = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(submitted.data!.exemptionUnderReviewUlbCount).toBe(0);
      expect(eligibilityService.countBatchUlbsWithExemptionUnderReview).not.toHaveBeenCalled();
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
        claimAmountEditable: true,
        varianceLowerPercent: 90,
        varianceUpperPercent: 110,
        letterQuestions: [],
      });

      const result = await service.getDetail(claimLetterId.toString(), stateUser);

      expect(formJsonConfigService.loadFormConfig).toHaveBeenCalledWith(yearId.toString());
      expect(formJsonConfigService.loadFormConfig).toHaveBeenCalledTimes(1);
      expect(result.data?.questions).toEqual([signedFileField]);
      expect(result.data?.claimAmountEditable).toBe(true);
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
      letterDetailsService.letterQuestionsFor.mockReturnValue([letterNoField]);

      const result = await service.getDetail(new Types.ObjectId().toString(), stateUser);

      expect(result.data?.questions?.map((f) => f.key)).toEqual(['signedClaimFile']);
      expect(result.data?.letterDetailsComplete).toBe(false);
      expect(letterDetailsService.evaluate).toHaveBeenCalledWith({ letterNo: 'A/1' }, formConfig, [letterNoField]);
    });

    describe("a draft beside the State's other letters (ADR 0009)", () => {
      const signedFileField = { key: 'signedClaimFile', formFieldType: 'file' };
      const draftId = new Types.ObjectId();
      const draft = (extra: Record<string, unknown> = {}) => ({
        _id: draftId,
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
        financialSummary: { ...financialSummary, currentSelectedClaim: 400 },
        createdAt: new Date(),
        ...extra,
      });
      const adminUser: AuthUser = { ...stateUser, xviFcSubrole: 'admin' };

      beforeEach(() => {
        formJsonConfigService.loadFormConfig.mockResolvedValue({
          questions: [signedFileField],
          claimAmountEditable: false,
          varianceLowerPercent: 90,
          varianceUpperPercent: 110,
          letterQuestions: [],
          maxClaimLetters: 3,
        });
      });

      it('hides the letter sections and turns off submit while a State-level condition fails', async () => {
        batchModel.findOne.mockReturnValue(q(draft()));
        eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
          passed: false,
          sources: [{ formType: 'SFC_STATUS', displayLabel: 'SFC Status', result: 'FAILED' }],
        });

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        const message =
          'SFC Status is not verified yet. This claim letter can be downloaded, signed and submitted once it is verified.';
        expect(data?.blockedReason).toBe(message);
        expect(data?.stateFormNotice).toBe(message);
        expect(data?.permissions.canFinalSubmit).toBe(false);
        expect(data?.finalClaimLetterStage).toBeNull();
        const content = data?.questions?.[0]?.supportingContent?.[0];
        expect(content?.description).toBe(message);
        expect(content?.actions?.every((a) => a.visible === false)).toBe(true);
      });

      it('names the letter the State form came back with while it is being corrected', async () => {
        batchModel.findOne.mockReturnValue(
          q(
            draft({
              signedClaimFile: null,
              stateFormReturnNotice: {
                letterName: 'Claim Letter 1',
                formNames: ['SFC Status'],
                signedFileRemoved: false,
              },
            }),
          ),
        );
        eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
          passed: false,
          sources: [{ formType: 'SFC_STATUS', displayLabel: 'SFC Status', result: 'FAILED' }],
        });

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.stateFormNotice).toBe(
          'SFC Status was returned for correction by MoHUA with Claim Letter 1. You can download, sign and submit this ' +
            'letter once it is corrected and verified.',
        );
      });

      it('explains a removed signed letter until the next upload, even once the State forms pass again', async () => {
        batchModel.findOne.mockReturnValue(
          q(
            draft({
              signedClaimFile: null,
              stateFormReturnNotice: {
                letterName: 'Claim Letter 1',
                formNames: ['SFC Status', 'GTC'],
                signedFileRemoved: true,
              },
            }),
          ),
        );

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.blockedReason).toBeNull();
        expect(data?.stateFormNotice).toBe(
          'Your signed letter was removed because SFC Status and GTC were returned for correction by MoHUA with Claim ' +
            'Letter 1. Once they are corrected and verified, download this letter again, get it signed by the concerned ' +
            'authority and upload it.',
        );
      });

      it('names a State form failing beyond the notice in the same banner', async () => {
        batchModel.findOne.mockReturnValue(
          q(
            draft({
              signedClaimFile: null,
              stateFormReturnNotice: {
                letterName: 'Claim Letter 1',
                formIds: [22],
                formNames: ['SFC Status'],
                signedFileRemoved: true,
              },
            }),
          ),
        );
        eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
          passed: false,
          sources: [
            { formId: 22, formType: 'SFC_STATUS', displayLabel: 'SFC Status', result: 'PASSED' },
            { formId: 35, formType: 'GTC', displayLabel: 'Grant Transfer Certificate', result: 'FAILED' },
          ],
        });

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.stateFormNotice).toBe(
          'Your signed letter was removed because SFC Status was returned for correction by MoHUA with Claim Letter 1. ' +
            'Once it is corrected and verified, download this letter again, get it signed by the concerned authority ' +
            'and upload it. Grant Transfer Certificate is not verified yet. This claim letter can be downloaded, signed ' +
            'and submitted once it is verified.',
        );
      });

      it('does not repeat the block reason when only the notice forms fail', async () => {
        batchModel.findOne.mockReturnValue(
          q(
            draft({
              signedClaimFile: null,
              stateFormReturnNotice: {
                letterName: 'Claim Letter 1',
                formIds: [22],
                formNames: ['SFC Status'],
                signedFileRemoved: false,
              },
            }),
          ),
        );
        eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
          passed: false,
          sources: [{ formId: 22, formType: 'SFC_STATUS', displayLabel: 'SFC Status', result: 'FAILED' }],
        });

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.stateFormNotice).toBe(
          'SFC Status was returned for correction by MoHUA with Claim Letter 1. You can download, sign and submit this ' +
            'letter once it is corrected and verified.',
        );
      });

      it("flags the last draft and shows the other letters' money as it is now", async () => {
        batchModel.findOne.mockReturnValue(q(draft()));
        // Every place of 3 taken, and no other draft open.
        batchModel.find.mockReturnValue(
          q([
            { _id: draftId, currentFormStatus: 2 },
            { _id: new Types.ObjectId(), currentFormStatus: 15 },
            { _id: new Types.ObjectId(), currentFormStatus: 5 },
          ]),
        );
        eligibilityService.getFinancialOverview.mockResolvedValue({
          totalInstallmentAllocation: 1000,
          totalAlreadyAcknowledged: 0,
          totalClaimInProgress: 300,
          totalClaimInDraft: 100,
          availableToClaim: 600,
        });
        expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: 'u1' }, { ulbId: 'u2' }, { ulbId: 'u3' }]);
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['u3']);

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.isLastPlace).toBe(true);
        // Read with the flag, so the page never pairs a fresh flag with an old count.
        expect(data?.remainingUlbCount).toBe(1);
        expect(eligibilityService.resolveRemainingUlbIds).toHaveBeenCalledWith(
          stateId.toString(),
          yearId.toString(),
          1,
          ['u1', 'u2', 'u3'],
        );
        expect(batchModel.find).toHaveBeenCalledWith(expect.objectContaining({ installment: 1, isAbandoned: false }));
        expect(eligibilityService.getFinancialOverview).toHaveBeenCalledWith(
          stateId.toString(),
          yearId.toString(),
          1,
          draftId.toString(),
        );
        expect(data?.financialSummary).toMatchObject({
          totalClaimInProgress: 300,
          totalClaimInDraft: 100,
          availableToClaim: 600,
          currentSelectedClaim: 400,
          remainingIfAcknowledged: 200,
        });
        expect(data?.blockedReason).toBeNull();
        expect(data?.stateFormNotice).toBeNull();
      });

      it('is not the last draft while a place is still free', async () => {
        batchModel.findOne.mockReturnValue(q(draft()));
        batchModel.find.mockReturnValue(
          q([
            { _id: draftId, currentFormStatus: 2 },
            { _id: new Types.ObjectId(), currentFormStatus: 15 },
          ]),
        );

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.isLastPlace).toBe(false);
        expect(data?.remainingUlbCount).toBeNull();
        expect(expectedUlbSetService.resolve).not.toHaveBeenCalled();
      });

      it('is not the last draft while another draft is open, even with every place taken', async () => {
        batchModel.findOne.mockReturnValue(q(draft()));
        // Four drafts under a cap lowered to 3.
        batchModel.find.mockReturnValue(
          q([
            { _id: draftId, currentFormStatus: 2 },
            { _id: new Types.ObjectId(), currentFormStatus: 2 },
            { _id: new Types.ObjectId(), currentFormStatus: 2 },
            { _id: new Types.ObjectId(), currentFormStatus: 2 },
          ]),
        );

        const { data } = await service.getDetail(draftId.toString(), adminUser);

        expect(data?.isLastPlace).toBe(false);
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

    it('lists the last modified letter first, with _id breaking ties so paging is stable', async () => {
      const query = q([]);
      batchModel.find.mockReturnValue(query);

      await service.listHistory(stateId.toString(), yearId.toString(), {}, stateUser);

      expect(query['sort']).toHaveBeenCalledWith({ updatedAt: -1, _id: -1 });
    });

    it.each([
      ['IN_PROGRESS', { currentFormStatus: FORM_STATUS.IN_PROGRESS, isAbandoned: false }],
      [
        'UNDER_REVIEW',
        { currentFormStatus: { $in: [FORM_STATUS.UNDER_REVIEW_BY_SO, FORM_STATUS.UNDER_REVIEW_BY_MOHUA] } },
      ],
      ['RETURNED', { currentFormStatus: { $in: [FORM_STATUS.RETURNED_BY_SO, FORM_STATUS.RETURNED_BY_MOHUA] } }],
      ['ACKNOWLEDGED', { currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }],
      // A return also sets isAbandoned, so Discarded leaves returned letters out (same rule as the label).
      [
        'DISCARDED',
        { isAbandoned: true, currentFormStatus: { $nin: [FORM_STATUS.RETURNED_BY_SO, FORM_STATUS.RETURNED_BY_MOHUA] } },
      ],
    ] as const)('filters status %s', async (status, condition) => {
      batchModel.find.mockReturnValue(q([]));

      await service.listHistory(stateId.toString(), yearId.toString(), { status }, stateUser);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toMatchObject({ assemblyStatus: 'READY', ...condition });
    });

    it('adds a batch filter only when provided', async () => {
      batchModel.find.mockReturnValue(q([]));

      await service.listHistory(stateId.toString(), yearId.toString(), {}, stateUser);
      await service.listHistory(stateId.toString(), yearId.toString(), { batchNumber: 2 }, stateUser);

      const [[withoutBatch], [withBatch]] = batchModel.find.mock.calls as [Record<string, unknown>][];
      expect(withoutBatch).not.toHaveProperty('batchNumber');
      expect(withBatch['batchNumber']).toBe(2);
    });

    it.each([
      ['claimedTotal', 'asc', { 'financialSummary.currentSelectedClaim': 1, _id: 1 }],
      ['batchNumber', 'desc', { batchNumber: -1, resubmissionNumber: -1, _id: -1 }],
      ['submittedAt', 'asc', { submittedAt: 1, _id: 1 }],
    ] as const)('sorts by %s %s, with _id last in the same direction', async (sortBy, sortOrder, sort) => {
      const query = q([]);
      batchModel.find.mockReturnValue(query);

      await service.listHistory(stateId.toString(), yearId.toString(), { sortBy, sortOrder }, stateUser);

      const [used] = query['sort'].mock.calls[0] as [Record<string, number>];
      expect(used).toEqual(sort);
      expect(Object.keys(used)).toEqual(Object.keys(sort));
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
            updatedAt: new Date(),
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
        'This claim batch was discarded.',
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

    it('refuses while a State-level condition fails, so nothing is signed before a returned form is fixed', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      eligibilityService.assertStateConditionsMet.mockRejectedValue(
        new ConflictException('SFC Status is not verified yet.'),
      );

      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(
        'SFC Status is not verified yet.',
      );
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
      const [filter, update] = batchModel.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      // No notice was read, so a return that leaves one before this write makes it a conflict (ADR 0009).
      expect(filter).toMatchObject({ _id: 'x', currentFormStatus: 2, isAbandoned: false, stateFormReturnNotice: null });
      // A new signed letter answers the notice left by a State form return (ADR 0009).
      expect(update.$set['stateFormReturnNotice']).toBeNull();
    });

    it('pins the notice it read, so a newer State form return in between is a conflict, not cleared', async () => {
      const at = new Date('2026-11-19T10:00:00Z');
      batchModel.findOne.mockReturnValue(
        q({
          _id: 'x',
          state: stateId,
          currentFormStatus: 2,
          stateFormReturnNotice: { letterName: 'Claim Letter 1', at },
        }),
      );
      batchModel.findOneAndUpdate.mockReturnValue(q(null));

      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(
        'The claim letter changed while uploading. Reload and try again.',
      );
      const [filter] = batchModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
      expect(filter['stateFormReturnNotice.at']).toBe(at);
    });

    it('takes the per-State guard and re-checks its State forms inside the transaction, before the write', async () => {
      const order: string[] = [];
      const parentId = new Types.ObjectId();
      batchModel.findOne.mockReturnValue(q({ _id: parentId, state: stateId, year: yearId, currentFormStatus: 2 }));
      undoEligibility.touchClaimUndoGuard.mockImplementation(() => order.push('guard'));
      formStatusService.assertStateFormsStillReady.mockImplementation(() => order.push('state forms'));
      batchModel.findOneAndUpdate.mockImplementation(() => {
        order.push('write');
        return q({ _id: parentId, state: stateId, currentFormStatus: 2, financialSummary, createdAt: new Date() });
      });

      await service.uploadSignedFile(String(parentId), fileRef, stateUser);

      expect(order).toEqual(['guard', 'state forms', 'write']);
      expect(undoEligibility.touchClaimUndoGuard).toHaveBeenCalledWith(stateId, yearId, session);
      expect(formStatusService.assertStateFormsStillReady).toHaveBeenCalledWith(parentId, session);
      const [, , options] = batchModel.findOneAndUpdate.mock.calls[0] as [unknown, unknown, { session: unknown }];
      expect(options.session).toBe(session);
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });

    it('writes nothing when an SO return reopened a State form after the gate check, even if the notice still matches', async () => {
      // A second return leaves a "signed letter removed" notice as it was, so only this re-check catches it.
      batchModel.findOne.mockReturnValue(
        q({
          _id: 'x',
          state: stateId,
          year: yearId,
          currentFormStatus: 2,
          stateFormReturnNotice: { at: new Date('2026-11-19T10:00:00Z'), signedFileRemoved: true },
        }),
      );
      formStatusService.assertStateFormsStillReady.mockRejectedValue(
        new ConflictException('A State form changed while you were working on this letter. Reload and try again.'),
      );

      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow('A State form changed');
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });

    it('turns a write conflict with an SO decision on the same State into a 409 to retry', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, year: yearId, currentFormStatus: 2 }));
      batchModel.findOneAndUpdate.mockReturnValue(
        q({ _id: 'x', state: stateId, currentFormStatus: 2, financialSummary, createdAt: new Date() }),
      );
      session.commitTransaction.mockRejectedValue(Object.assign(new Error('WriteConflict'), { code: 112 }));

      const err = await service.uploadSignedFile('x', fileRef, stateUser).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(CLAIM_LETTER_BUSY_MESSAGE);
    });

    it('starts no transaction when the gate check or the same-file check ends the upload first', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      eligibilityService.assertStateConditionsMet.mockRejectedValueOnce(new ConflictException('blocked'));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow('blocked');

      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({ file: undefined, errors: [] });
      await service.uploadSignedFile('x', fileRef, stateUser);

      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the guarded update matches nothing (concurrent status change)', async () => {
      batchModel.findOne.mockReturnValue(q({ _id: 'x', state: stateId, currentFormStatus: 2 }));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      await expect(service.uploadSignedFile('x', fileRef, stateUser)).rejects.toThrow(ConflictException);
    });
  });
});
