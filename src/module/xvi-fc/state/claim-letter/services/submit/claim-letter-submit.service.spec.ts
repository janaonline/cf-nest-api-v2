import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { PmuUndoEligibilityService } from 'src/module/xvi-fc/common/services/pmu-undo-eligibility.service';
import { CLAIM_LETTER_BUSY_MESSAGE } from '../../helpers/claim-letter-concurrency.helpers';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterFormStatusService } from '../form-status/claim-letter-form-status.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFinalPdfService, FINAL_PDF_OUTDATED } from '../final-pdf/claim-letter-final-pdf.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import { ClaimLetterSubmitService } from './claim-letter-submit.service';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'select', 'lean', 'session']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

/** Open letters as the last-draft rule reads them; this letter is 'x'. */
function openLetters(...others: number[]) {
  return [{ _id: 'x', currentFormStatus: 2 }, ...others.map((s, i) => ({ _id: `other-${i}`, currentFormStatus: s }))];
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
    recheckClaimLetter: jest.Mock;
  };
  let expectedUlbSetService: { resolve: jest.Mock };
  let historyService: { recordTransition: jest.Mock };
  let letterDetailsService: { assertComplete: jest.Mock };
  let formJsonService: { loadMaxClaimLetters: jest.Mock };
  let formStatusService: { assertStateFormsStillReady: jest.Mock };
  let undoEligibility: { touchClaimUndoGuard: jest.Mock };
  let batchUlbModel: { find: jest.Mock };
  let finalPdfService: { assertReviewedKey: jest.Mock };
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    inTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let batchModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; findById: jest.Mock; find: jest.Mock };

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
      recheckClaimLetter: jest.fn().mockResolvedValue({ failedStateConditions: [], ineligibleUlbs: [] }),
    };
    expectedUlbSetService = { resolve: jest.fn() };
    historyService = { recordTransition: jest.fn().mockResolvedValue(undefined) };
    letterDetailsService = { assertComplete: jest.fn().mockResolvedValue(undefined) };
    formJsonService = { loadMaxClaimLetters: jest.fn().mockResolvedValue(3) };
    formStatusService = { assertStateFormsStillReady: jest.fn().mockResolvedValue(undefined) };
    undoEligibility = { touchClaimUndoGuard: jest.fn().mockResolvedValue(undefined) };
    batchUlbModel = { find: jest.fn().mockReturnValue(q([])) };
    finalPdfService = { assertReviewedKey: jest.fn().mockResolvedValue(undefined) };
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      inTransaction: jest.fn().mockReturnValue(true),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    // One open letter (this one) under a cap of 3: the last-draft rule does not apply unless a test says so.
    batchModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(() => q(openLetters())),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterSubmitService,
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: ClaimLetterHistoryService, useValue: historyService },
        { provide: ClaimLetterLetterDetailsService, useValue: letterDetailsService },
        { provide: ClaimLetterFormJsonService, useValue: formJsonService },
        { provide: ClaimLetterFormStatusService, useValue: formStatusService },
        { provide: PmuUndoEligibilityService, useValue: undoEligibility },
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

    it('throws ConflictException when status is neither IN_PROGRESS nor an already-submitted status', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, currentFormStatus: 6 }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(ConflictException);
    });

    it('refuses an abandoned batch, which abandon leaves IN_PROGRESS', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, isAbandoned: true }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow('This claim batch was discarded.');
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no signed file has been uploaded', async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, signedClaimFile: null }));
      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(BadRequestException);
    });

    it('transitions to UNDER_REVIEW_BY_SO and records history with both files inside one transaction', async () => {
      const finalClaimPdf = { file: { path: 'final/x.pdf' }, sourceKey: 'reviewed-key', pageCount: 7 };
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 15, finalClaimPdf }));

      const result = await service.submit('x', stateUser, 'reviewed-key', '127.0.0.1', 'jest-agent');

      expect(result.data?.currentFormStatus).toBe(15);
      expect(historyService.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: 2,
          toStatus: 15,
          actionSource: 'DIRECT_STATE_REVIEW',
          submittedFiles: { signedClaimFile: { path: 'x/signed.pdf' }, finalClaimPdf },
        }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();

      const [filter] = batchModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
      expect(filter['$or']).toEqual([
        { editLockToken: null },
        { editLockAcquiredAt: { $lt: expect.any(Date) as unknown } },
      ]);
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

    it("submits while the State's other letters are drafts or under review (ADR 0009)", async () => {
      batchModel.findOne.mockReturnValue(q({ ...readyParent, batchNumber: 2 }));
      batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, batchNumber: 2, currentFormStatus: 15 }));
      batchModel.find.mockImplementation(() => q(openLetters(15)));

      const result = await service.submit('x', stateUser, 'reviewed-key');

      expect(result.data?.currentFormStatus).toBe(15);
    });

    it('takes the per-State guard and re-checks its State forms inside the transaction, before the write', async () => {
      const order: string[] = [];
      batchModel.findOne.mockReturnValue(q(readyParent));
      undoEligibility.touchClaimUndoGuard.mockImplementation(() => order.push('guard'));
      formStatusService.assertStateFormsStillReady.mockImplementation(() => order.push('state forms'));
      batchModel.findOneAndUpdate.mockImplementation(() => {
        order.push('write');
        return q({ ...readyParent, currentFormStatus: 15 });
      });

      await service.submit('x', stateUser, 'reviewed-key');

      expect(order).toEqual(['guard', 'state forms', 'write']);
      expect(undoEligibility.touchClaimUndoGuard).toHaveBeenCalledWith(stateId, yearId, session);
      expect(formStatusService.assertStateFormsStillReady).toHaveBeenCalledWith('x', session);
    });

    it('writes nothing when an SO return reopened a State form after the gate check', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      formStatusService.assertStateFormsStillReady.mockRejectedValue(
        new ConflictException('A State form changed while you were working on this letter. Reload and try again.'),
      );

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow('A State form changed');
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
    });

    it('turns a write conflict with an SO decision on the same State into a 409 to retry', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 15 }));
      session.commitTransaction.mockRejectedValue(Object.assign(new Error('WriteConflict'), { code: 112 }));

      const err = await service.submit('x', stateUser, 'reviewed-key').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(CLAIM_LETTER_BUSY_MESSAGE);
    });

    it('re-checks the State gate fresh and names the failed conditions', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      eligibilityService.recheckClaimLetter.mockResolvedValue({
        failedStateConditions: ['Grant Transfer Certificate'],
        ineligibleUlbs: [],
      });

      await expect(service.submit('x', stateUser, 'reviewed-key')).rejects.toThrow(
        'The State-level claim conditions are no longer met: Grant Transfer Certificate.',
      );
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('re-checks every batch ULB fresh and names the ones no longer eligible (first 10 + more)', async () => {
      batchModel.findOne.mockReturnValue(q(readyParent));
      eligibilityService.recheckClaimLetter.mockResolvedValue({
        failedStateConditions: [],
        ineligibleUlbs: Array.from({ length: 12 }, (_, i) => ({
          ulbId: String(i),
          name: `ULB ${i + 1}`,
          reason: 'NOT_ELIGIBLE',
        })),
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

    describe('no ULB left out by the last draft (ADR 0009)', () => {
      const leftOutMessage =
        'All 3 claim letters for this installment are in use and this is the last draft, so every ULB must be in a ' +
        'claim letter before it can be submitted. Not in any letter yet: Beta ULB.';

      beforeEach(() => {
        // Every place of a cap of 3 taken: this draft and two letters under review.
        batchModel.find.mockImplementation(() => q(openLetters(15, 5)));
        expectedUlbSetService.resolve.mockResolvedValue([
          { ulbId: 'ulb-1', name: 'Alpha ULB' },
          { ulbId: 'ulb-2', name: 'Beta ULB' },
        ]);
      });

      it('refuses the last draft, naming the ULBs in no letter, whatever slot it holds', async () => {
        batchModel.findOne.mockReturnValue(q({ ...readyParent, batchNumber: 1 }));
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['ulb-2']);

        const err = await service.submit('x', stateUser, 'reviewed-key').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).message).toBe(leftOutMessage);
        expect(batchModel.find).toHaveBeenCalledWith({
          state: stateId,
          year: yearId,
          installment: 1,
          isAbandoned: false,
        });
        expect(connection.startSession).not.toHaveBeenCalled();
      });

      it('submits while another draft is open, even over a lowered cap, and checks again in the transaction', async () => {
        // Four drafts under a cap of 3: any of them may go while another is still open.
        const inTransaction = q(openLetters(2, 2, 2));
        batchModel.find.mockReturnValueOnce(q(openLetters(2, 2, 2))).mockReturnValueOnce(inTransaction);
        batchModel.findOne.mockReturnValue(q(readyParent));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 15 }));
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['ulb-2']);

        const result = await service.submit('x', stateUser, 'reviewed-key');

        expect(result.data?.currentFormStatus).toBe(15);
        expect(batchModel.find).toHaveBeenCalledTimes(2);
        expect(inTransaction['session']).toHaveBeenCalledWith(session);
      });

      it('refuses inside the transaction when the other draft was submitted meanwhile', async () => {
        batchModel.find
          .mockReturnValueOnce(q(openLetters(2, 15)))
          // The other draft went to the SO between the check and the transaction: this is now the last draft.
          .mockReturnValueOnce(q(openLetters(15, 15)));
        batchModel.findOne.mockReturnValue(q(readyParent));
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['ulb-2']);

        const err = await service.submit('x', stateUser, 'reviewed-key').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).message).toBe(leftOutMessage);
        expect(session.abortTransaction).toHaveBeenCalled();
        expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(historyService.recordTransition).not.toHaveBeenCalled();
      });

      it('refuses inside the transaction when the other draft dropped a ULB and was submitted after the first check', async () => {
        // First check: another draft is open and holds Beta. Before this transaction, it drops Beta and goes to the SO.
        let otherDraftSubmitted = false;
        batchModel.find.mockReturnValueOnce(q(openLetters(2, 15))).mockImplementationOnce(() => {
          otherDraftSubmitted = true;
          return q(openLetters(15, 15));
        });
        eligibilityService.resolveRemainingUlbIds.mockImplementation(() =>
          Promise.resolve(otherDraftSubmitted ? ['ulb-2'] : []),
        );
        batchModel.findOne.mockReturnValue(q(readyParent));

        const err = await service.submit('x', stateUser, 'reviewed-key').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).message).toBe(leftOutMessage);
        expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('submits when the other draft was discarded meanwhile, since that frees a place', async () => {
        batchModel.find.mockReturnValueOnce(q(openLetters(2, 15))).mockReturnValueOnce(q(openLetters(15)));
        batchModel.findOne.mockReturnValue(q(readyParent));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 15 }));
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue(['ulb-2']);

        const result = await service.submit('x', stateUser, 'reviewed-key');

        expect(result.data?.currentFormStatus).toBe(15);
      });

      it('submits once every ULB is in some letter (a draft counts)', async () => {
        batchModel.findOne.mockReturnValue(q(readyParent));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, currentFormStatus: 15 }));
        eligibilityService.resolveRemainingUlbIds.mockResolvedValue([]);

        const result = await service.submit('x', stateUser, 'reviewed-key');

        expect(result.data?.currentFormStatus).toBe(15);
      });

      it('does not check while a place is still free, by the formjson cap', async () => {
        formJsonService.loadMaxClaimLetters.mockResolvedValue(5);
        batchModel.findOne.mockReturnValue(q({ ...readyParent, batchNumber: 3 }));
        batchModel.findOneAndUpdate.mockReturnValue(q({ ...readyParent, batchNumber: 3, currentFormStatus: 15 }));

        const result = await service.submit('x', stateUser, 'reviewed-key');

        expect(result.data?.currentFormStatus).toBe(15);
        expect(formJsonService.loadMaxClaimLetters).toHaveBeenCalledWith(String(yearId));
        expect(expectedUlbSetService.resolve).not.toHaveBeenCalled();
        expect(eligibilityService.resolveRemainingUlbIds).not.toHaveBeenCalled();
        // Open letters are counted twice: the quick check, and again inside the transaction.
        expect(batchModel.find).toHaveBeenCalledTimes(2);
      });
    });
  });
});
