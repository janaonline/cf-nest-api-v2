import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFinalPdfService, FINAL_PDF_OUTDATED } from '../final-pdf/claim-letter-final-pdf.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import { ClaimLetterSubmitService } from './claim-letter-submit.service';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'select', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const financialSummary = {
  totalInstallmentAllocation: 0,
  totalAlreadyAcknowledged: 0,
  selectedAllocation: 0,
  currentSelectedClaim: 0,
  remainingIfAcknowledged: 0,
};

describe('ClaimLetterSubmitService', () => {
  let service: ClaimLetterSubmitService;
  let eligibilityService: {
    resolveRemainingUlbIds: jest.Mock;
    evaluateStateLevelGate: jest.Mock;
    resolveUlbLevelEligibility: jest.Mock;
  };
  let expectedUlbSetService: { resolve: jest.Mock };
  let historyService: { recordTransition: jest.Mock };
  let letterDetailsService: { assertComplete: jest.Mock };
  let activeBatchService: { assertActive: jest.Mock };
  let batchUlbModel: { find: jest.Mock };
  let finalPdfService: { assertReviewedKey: jest.Mock };
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let batchModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; findById: jest.Mock };

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
      resolveRemainingUlbIds: jest.fn().mockResolvedValue([]),
      evaluateStateLevelGate: jest.fn().mockResolvedValue({ passed: true, sources: [] }),
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({ perUlbEligible: new Map() }),
    };
    expectedUlbSetService = { resolve: jest.fn() };
    historyService = { recordTransition: jest.fn().mockResolvedValue(undefined) };
    letterDetailsService = { assertComplete: jest.fn().mockResolvedValue(undefined) };
    activeBatchService = { assertActive: jest.fn().mockResolvedValue(undefined) };
    batchUlbModel = { find: jest.fn().mockReturnValue(q([])) };
    finalPdfService = { assertReviewedKey: jest.fn().mockResolvedValue(undefined) };
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    batchModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn(), findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterSubmitService,
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: ClaimLetterHistoryService, useValue: historyService },
        { provide: ClaimLetterLetterDetailsService, useValue: letterDetailsService },
        { provide: ClaimLetterActiveBatchService, useValue: activeBatchService },
        { provide: ClaimLetterFinalPdfService, useValue: finalPdfService },
        { provide: getConnectionToken(), useValue: connection },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(ClaimLetterBatchUlb.name), useValue: batchUlbModel },
      ],
    }).compile();

    service = module.get(ClaimLetterSubmitService);
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
      finalClaimPdf: { sourceKey: 'reviewed-key' },
      financialSummary,
      createdAt: new Date(),
    };

    it('throws NotFoundException when no READY claim matches the id', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the claim belongs to a different state', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, state: new Types.ObjectId() }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent: returns the current state without re-transitioning when already submitted', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, currentFormStatus: 5 }));

      const result = await service.submit('x', stateUser, 'reviewed-key');

      expect(result.message).toMatch(/already submitted/i);
      expect(connection.startSession).not.toHaveBeenCalled();
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('throws ConflictException when status is neither IN_PROGRESS nor UNDER_REVIEW_BY_MOHUA', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, currentFormStatus: 6 }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(ConflictException);
    });

    it('refuses an abandoned batch, which abandon leaves IN_PROGRESS', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, isAbandoned: true }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow('This claim batch was abandoned.');
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no signed file has been uploaded', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, signedClaimFile: null }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(BadRequestException);
    });

    it('transitions to UNDER_REVIEW_BY_MOHUA and records history with both files inside one transaction', async () => {
      const finalClaimPdf = { file: { path: 'final/x.pdf' }, sourceKey: 'reviewed-key', pageCount: 7 };
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 5, finalClaimPdf }));

      const result = await service.submit('x', stateUser, 'reviewed-key', '127.0.0.1', 'jest-agent');

      expect(result.data?.currentFormStatus).toBe(5);
      expect(historyService.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: 2,
          toStatus: 5,
          actionSource: 'DIRECT_STATE_REVIEW',
          submittedFiles: { signedClaimFile: { path: 'x/signed.pdf' }, finalClaimPdf },
        }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();

      const [filter] = batchModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
      expect(filter['$or']).toEqual([{ editLockToken: null }, { editLockAcquiredAt: { $lt: expect.any(Date) } }]);
      // Pinned as read, so a re-upload or letter-details save in between cannot slip in.
      expect(filter['signedClaimFile.path']).toBe('x/signed.pdf');
      expect(filter['finalClaimPdf.sourceKey']).toBe('reviewed-key');
      expect(filter['isAbandoned']).toBe(false);
      expect(filter['letterDetailsUpdatedAt']).toBeNull();
      expect(letterDetailsService.assertComplete).toHaveBeenCalledWith(
        { state: stateId, year: yearId, letterDetails: undefined },
        'submitting',
      );
    });

    it('refuses to submit while the mandatory letter details are incomplete', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      letterDetailsService.assertComplete.mockRejectedValue(new BadRequestException('Complete the letter details'));

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow('Complete the letter details');
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('checks the reviewed final-PDF key and refuses a stale one', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, finalClaimPdf: { sourceKey: 'old' } }));
      finalPdfService.assertReviewedKey.mockRejectedValue(new ConflictException('The documents changed'));

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow('The documents changed');
      expect(finalPdfService.assertReviewedKey).toHaveBeenCalledWith(
        expect.objectContaining({ signedClaimFile: { path: 'x/signed.pdf' }, finalClaimPdf: { sourceKey: 'old' } }),
        'reviewed-key',
      );
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('refuses to submit while another batch is the active one', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      activeBatchService.assertActive.mockRejectedValue(new ConflictException('Batch 1 is still in progress'));

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow('Batch 1 is still in progress');
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('re-checks the State gate fresh and names the failed conditions', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      eligibilityService.evaluateStateLevelGate.mockResolvedValue({
        passed: false,
        sources: [
          { result: 'PASSED', displayLabel: 'SFC', formType: 'SFC' },
          { result: 'FAILED', displayLabel: 'Grant Transfer Certificate', formType: 'GTC' },
        ],
      });

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(
        'The State-level claim conditions are no longer met: Grant Transfer Certificate.',
      );
      expect(eligibilityService.resolveUlbLevelEligibility).not.toHaveBeenCalled();
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('re-checks every batch ULB fresh and names the ones no longer eligible (first 10 + more)', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      const children = Array.from({ length: 12 }, (_, i) => ({
        ulbId: new Types.ObjectId(),
        ulbSnapshot: { name: `ULB ${i + 1}` },
      }));
      batchUlbModel.find.mockReturnValue(q(children));
      eligibilityService.resolveUlbLevelEligibility.mockResolvedValue({
        perUlbEligible: new Map(children.map((c) => [String(c.ulbId), false])),
      });

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(
        /12 ULB\(s\) in this batch are no longer eligible: ULB 1, .*ULB 10 and 2 more\./,
      );
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('treats a concurrent race as idempotent if the doc is already UNDER_REVIEW_BY_MOHUA', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q({ ...readyParent, currentFormStatus: 5 }));

      const result = await service.submit('x', stateUser, 'reviewed-key');

      expect(result.message).toMatch(/already submitted/i);
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('throws ConflictException on a genuine race with no idempotent resolution', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q({ ...readyParent, currentFormStatus: 6 }));

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(ConflictException);
    });

    it('throws a specific ConflictException when an updateDraft call is currently mid-rebuild', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      // The atomic submit guard now also requires the edit lock to be absent/expired — simulate a
      // real DB rejecting the match because an update currently holds a *fresh* (unexpired) lock.
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(
        q({ ...readyParent, editLockToken: 'some-update-token', editLockAcquiredAt: new Date() }),
      );

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(/currently being edited/i);
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

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(/changed while submitting/);
    });

    it('refuses with FINAL_PDF_OUTDATED when an older merge replaced the reviewed PDF after the key check', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q({ ...readyParent, finalClaimPdf: { sourceKey: 'older-key' } }));

      const err = await service.submit('x', stateUser, 'reviewed-key').catch((e: ConflictException) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: FINAL_PDF_OUTDATED });
      expect(historyService.recordTransition).not.toHaveBeenCalled();
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

        await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(BadRequestException);
        await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(/Beta ULB/);
        expect(connection.startSession).not.toHaveBeenCalled();
      });

      it('allows submission once no ULBs remain unclaimed', async () => {
        batchModel.findOne.mockReturnValue(q(finalBatchParent));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...finalBatchParent, currentFormStatus: 5 }));
        expectedUlbSetService.resolve.mockResolvedValue([{ ulbId: 'ulb-1', name: 'Alpha ULB' }]);
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue([]);

        const result = await service.submit('x', stateUser, 'reviewed-key');

        expect(result.data?.currentFormStatus).toBe(5);
      });

      it('does not run the completeness check for a non-final batch (batchNumber 2)', async () => {
        batchModel.findOne.mockReturnValue(q({ ...readyParent, batchNumber: 2 }));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, batchNumber: 2, currentFormStatus: 5 }));

        const result = await service.submit('x', stateUser, 'reviewed-key');

        expect(result.data?.currentFormStatus).toBe(5);
        expect(expectedUlbSetService.resolve).not.toHaveBeenCalled();
        expect(eligibilityService.resolveRemainingUlbIds).not.toHaveBeenCalled();
      });
    });
  });
});
