import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import {
  ClaimLetterBatch,
  ClaimLetterBatchDocument,
  type ClaimLetterBatchNumber,
  type ClaimLetterFinalPdf,
  type ClaimLetterInstallment,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { PmuUndoEligibilityService } from 'src/module/xvi-fc/common/services/pmu-undo-eligibility.service';
import {
  CLAIM_LETTER_ABANDONED_MESSAGE,
  CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES,
} from '../../constants/claim-letter.constants';
import {
  countOpenLetters,
  isEveryPlaceTaken,
  isLastDraft,
  openLettersFilter,
  type OpenLetterStatus,
  ulbsLeftOutMessage,
} from '../../helpers/claim-letter-cap.helpers';
import { toClaimLetterBusyConflict } from '../../helpers/claim-letter-concurrency.helpers';
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import type { ClaimLetterBatchSummary } from '../../types/claim-letter.types';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFinalPdfService, finalPdfOutdatedError } from '../final-pdf/claim-letter-final-pdf.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterFormStatusService } from '../form-status/claim-letter-form-status.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';

/** The batch as submit reads it (a lean full document; only these fields are used here). */
type SubmitBatch = {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: ClaimLetterInstallment;
  batchNumber: ClaimLetterBatchNumber;
  version: number;
  currentFormStatus: number;
  isAbandoned: boolean;
  signedClaimFile?: FileInfo | null;
  finalClaimPdf?: ClaimLetterFinalPdf | null;
  letterDetails?: Record<string, unknown>;
  letterDetailsUpdatedAt?: Date | null;
  editLockToken?: string | null;
  editLockAcquiredAt?: Date | null;
};

/** A submit that passed the last-draft rule only because another draft was open, re-checked in the transaction. */
type LeftOutRecheck = { maxClaimLetters: number; message: string };

/** Submitted already: with the SO (15), or moved on by the SO to MoHUA review (5) or approved (7). */
const ALREADY_SUBMITTED_STATUSES: number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_SO,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

/** `IN_PROGRESS -> UNDER_REVIEW_BY_SO` and the checks that must pass first (ADR 0003). */
@Injectable()
export class ClaimLetterSubmitService {
  constructor(
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly historyService: ClaimLetterHistoryService,
    private readonly letterDetailsService: ClaimLetterLetterDetailsService,
    private readonly finalPdfService: ClaimLetterFinalPdfService,
    private readonly formJsonConfigService: ClaimLetterFormJsonService,
    private readonly formStatusService: ClaimLetterFormStatusService,
    private readonly undoEligibility: PmuUndoEligibilityService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
  ) {}

  /** Idempotent on retry (ADR 0001); the checks before the transaction are listed in ADR 0003. */
  async submit(
    claimLetterId: string,
    user: AuthUser,
    finalPdfSourceKey: string,
    ip?: string,
    userAgent?: string,
  ): Promise<XviFcApiResponse<ClaimLetterBatchSummary>> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<SubmitBatch | null>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, String(parent.state));

    if (ALREADY_SUBMITTED_STATUSES.includes(parent.currentFormStatus)) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(parent, user));
    }
    // Abandon keeps IN_PROGRESS and has already released the locks, so the flag is checked on its own.
    if (parent.isAbandoned) throw new ConflictException(CLAIM_LETTER_ABANDONED_MESSAGE);
    if (parent.currentFormStatus !== FORM_STATUS.IN_PROGRESS) {
      throw new ConflictException(
        `Claim letter cannot be submitted when status is ${getFormStatusLabel(parent.currentFormStatus)}.`,
      );
    }
    const signedFile = parent.signedClaimFile;
    if (!signedFile) {
      throw new BadRequestException('A signed claim letter file must be uploaded before submitting.');
    }
    await this.letterDetailsService.assertComplete(
      { state: parent.state, year: parent.year, letterDetails: parent.letterDetails },
      'submitting',
    );
    await this.assertBatchStillEligible(parent);
    await this.finalPdfService.assertReviewedKey(parent, finalPdfSourceKey);
    const leftOutRecheck = await this.assertNoUlbLeftOut(parent);

    const userOid = new Types.ObjectId(user._id);
    const session = await this.connection.startSession();
    let updated: SubmitBatch | null = null;
    try {
      session.startTransaction();

      // One State's submits and SO decisions run one at a time; a State form returned since the gate check above
      // refuses the submit here (ADR 0009).
      await this.undoEligibility.touchClaimUndoGuard(parent.state, parent.year, session);
      await this.formStatusService.assertStateFormsStillReady(parent._id, session);
      if (leftOutRecheck) await this.assertStillNotLastDraft(parent, leftOutRecheck, session);

      updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterId,
            currentFormStatus: FORM_STATUS.IN_PROGRESS,
            isAbandoned: false,
            // Pinned as read: a re-upload or letter-details save in between makes this a conflict.
            'signedClaimFile.path': signedFile.path,
            letterDetailsUpdatedAt: parent.letterDetailsUpdatedAt ?? null,
            // A slower, older merge finishing after the key check must not be submitted.
            'finalClaimPdf.sourceKey': finalPdfSourceKey,
            // Same self-expiring edit-lock lease as ClaimLetterAssemblyService.
            $or: [{ editLockToken: null }, { editLockAcquiredAt: { $lt: this.editLockStaleBefore() } }],
          },
          {
            $set: {
              currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
              submittedAt: new Date(),
              submittedBy: userOid,
              updatedBy: userOid,
            },
          },
          { new: true, session },
        )
        .lean<SubmitBatch | null>()
        .exec();

      if (updated) {
        await this.historyService.recordTransition(
          {
            claimLetter: updated._id,
            state: updated.state,
            year: updated.year,
            installment: updated.installment,
            batchNumber: updated.batchNumber,
            version: updated.version,
            fromStatus: FORM_STATUS.IN_PROGRESS,
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
            actionSource: 'DIRECT_STATE_REVIEW',
            // Both exist: the filter pinned both.
            submittedFiles: { signedClaimFile: updated.signedClaimFile!, finalClaimPdf: updated.finalClaimPdf! },
            changedBy: userOid,
            requestId: randomUUID(),
            ipAddress: ip ?? null,
            userAgent: userAgent ?? null,
          },
          session,
        );
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw toClaimLetterBusyConflict(err);
    } finally {
      await session.endSession();
    }

    if (updated) {
      return xviFcSuccess('Claim letter submitted to MoHUA.', mapClaimLetterBatchDocToSummary(updated, user));
    }

    // Concurrent status change (or an in-flight `updateDraft`) between our initial read and the
    // guarded update.
    const current = await this.batchModel.findById(claimLetterId).lean<SubmitBatch | null>().exec();
    if (current && ALREADY_SUBMITTED_STATUSES.includes(current.currentFormStatus)) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(current, user));
    }
    if (current?.editLockToken && this.isEditLockActive(current.editLockAcquiredAt)) {
      throw new ConflictException('Claim letter is currently being edited. Please retry in a moment.');
    }
    // Still a draft, but an older merge replaced the reviewed one: the page reloads the final PDF.
    if (
      current?.currentFormStatus === FORM_STATUS.IN_PROGRESS &&
      !current.isAbandoned &&
      current.finalClaimPdf?.sourceKey !== finalPdfSourceKey
    ) {
      throw finalPdfOutdatedError();
    }
    throw new ConflictException(
      'The claim letter, its signed file or its letter details changed while submitting. Please reload and try again.',
    );
  }

  /** Fresh, never the display cache: the letter is built live, so it must still hold at submit. */
  private async assertBatchStillEligible(scope: {
    _id: Types.ObjectId;
    state: Types.ObjectId;
    year: Types.ObjectId;
    installment: ClaimLetterInstallment;
  }): Promise<void> {
    const { failedStateConditions, ineligibleUlbs } = await this.eligibilityService.recheckClaimLetter(scope);
    if (failedStateConditions.length) {
      throw new BadRequestException(
        `The State-level claim conditions are no longer met: ${failedStateConditions.join(', ')}. Resolve them before submitting.`,
      );
    }
    if (ineligibleUlbs.length === 0) return;
    const shown = ineligibleUlbs.slice(0, 10).map((u) => u.name);
    const suffix = ineligibleUlbs.length > shown.length ? ` and ${ineligibleUlbs.length - shown.length} more` : '';
    throw new BadRequestException(
      `${ineligibleUlbs.length} ULB(s) in this batch are no longer eligible: ${shown.join(', ')}${suffix}. ` +
        'Remove them from the batch before submitting.',
    );
  }

  /**
   * Once open letters (drafts, under review, approved) take every place under the cap, a ULB in no letter can only go
   * into a draft, so the last draft is not submitted while one remains, eligible or not (ADR 0009). A ULB a draft
   * holds counts as in a letter; if that draft later drops it, its own submit is refused here.
   * Returns the check to repeat inside the transaction when another draft let this one pass, else null.
   */
  private async assertNoUlbLeftOut(parent: SubmitBatch): Promise<LeftOutRecheck | null> {
    const stateId = String(parent.state);
    const yearId = String(parent.year);
    const installment = parent.installment;
    const [maxClaimLetters, openLetters] = await Promise.all([
      this.formJsonConfigService.loadMaxClaimLetters(yearId),
      this.batchModel
        .find(openLettersFilter({ state: parent.state, year: parent.year, installment }))
        .select('_id currentFormStatus')
        .lean<OpenLetterStatus[]>()
        .exec(),
    ]);
    const { openLetterCount, otherDraftCount } = countOpenLetters(openLetters, String(parent._id));
    if (!isEveryPlaceTaken(openLetterCount, maxClaimLetters)) return null;

    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const remainingUlbIds = await this.eligibilityService.resolveRemainingUlbIds(
      stateId,
      yearId,
      installment,
      expectedUlbs.map((u) => u.ulbId),
    );
    if (remainingUlbIds.length === 0) return null;

    const remainingUlbIdSet = new Set(remainingUlbIds);
    const remainingNames = expectedUlbs.filter((u) => remainingUlbIdSet.has(u.ulbId)).map((u) => u.name);
    const message = ulbsLeftOutMessage(maxClaimLetters, remainingNames);
    if (isLastDraft(openLetterCount, otherDraftCount, maxClaimLetters)) throw new BadRequestException(message);
    return { maxClaimLetters, message };
  }

  /**
   * Two drafts submitted one after the other could each count the other as still open. After the per-State guard,
   * this read sees an earlier submit (or the guard conflicts), so the last draft cannot pass that way.
   */
  private async assertStillNotLastDraft(
    parent: SubmitBatch,
    recheck: LeftOutRecheck,
    session: ClientSession,
  ): Promise<void> {
    const openLetters = await this.batchModel
      .find(openLettersFilter(parent))
      .select('_id currentFormStatus')
      .session(session)
      .lean<OpenLetterStatus[]>()
      .exec();
    const { openLetterCount, otherDraftCount } = countOpenLetters(openLetters, String(parent._id));
    if (isLastDraft(openLetterCount, otherDraftCount, recheck.maxClaimLetters)) {
      throw new BadRequestException(recheck.message);
    }
  }

  /** Mirrors ClaimLetterAssemblyService's lease cutoff. */
  private editLockStaleBefore(): Date {
    return new Date(Date.now() - CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES * 60_000);
  }

  private isEditLockActive(acquiredAt: Date | null | undefined): boolean {
    if (!acquiredAt) return false;
    return new Date(acquiredAt) >= this.editLockStaleBefore();
  }
}
