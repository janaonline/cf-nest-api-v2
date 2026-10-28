import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
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
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import {
  CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES,
  CLAIM_LETTER_MAX_BATCH_NUMBER,
} from '../../constants/claim-letter.constants';
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import type { ClaimLetterBatchSummary } from '../../types/claim-letter.types';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFinalPdfService } from '../final-pdf/claim-letter-final-pdf.service';
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
  signedClaimFile?: FileInfo | null;
  finalClaimPdf?: ClaimLetterFinalPdf | null;
  letterDetails?: Record<string, unknown>;
  letterDetailsUpdatedAt?: Date | null;
  editLockToken?: string | null;
  editLockAcquiredAt?: Date | null;
};

/** `IN_PROGRESS -> UNDER_REVIEW_BY_MOHUA` and the checks that must pass first (ADR 0003). */
@Injectable()
export class ClaimLetterSubmitService {
  constructor(
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly historyService: ClaimLetterHistoryService,
    private readonly letterDetailsService: ClaimLetterLetterDetailsService,
    private readonly activeBatchService: ClaimLetterActiveBatchService,
    private readonly finalPdfService: ClaimLetterFinalPdfService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name)
    private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
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

    if (parent.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(parent, user));
    }
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
      { year: parent.year, letterDetails: parent.letterDetails },
      'submitting',
    );
    await this.activeBatchService.assertActive(parent);
    await this.assertBatchStillEligible(parent);
    await this.finalPdfService.assertReviewedKey(parent, finalPdfSourceKey);
    if (parent.batchNumber === CLAIM_LETTER_MAX_BATCH_NUMBER) {
      await this.assertFinalBatchIsComplete(String(parent.state), String(parent.year), parent.installment);
    }

    const userOid = new Types.ObjectId(user._id);
    const session = await this.connection.startSession();
    let updated: SubmitBatch | null = null;
    try {
      session.startTransaction();

      updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterId,
            currentFormStatus: FORM_STATUS.IN_PROGRESS,
            // Pinned as read: a re-upload or letter-details save in between makes this a conflict.
            'signedClaimFile.path': signedFile.path,
            letterDetailsUpdatedAt: parent.letterDetailsUpdatedAt ?? null,
            // Same self-expiring edit-lock lease as ClaimLetterAssemblyService.
            $or: [{ editLockToken: null }, { editLockAcquiredAt: { $lt: this.editLockStaleBefore() } }],
          },
          {
            $set: {
              currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
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
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
            actionSource: 'DIRECT_STATE_REVIEW',
            // Both exist: the filter pinned the signed file and the key check needs the cached PDF.
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
      throw err;
    } finally {
      await session.endSession();
    }

    if (updated) {
      return xviFcSuccess('Claim letter submitted to MoHUA.', mapClaimLetterBatchDocToSummary(updated, user));
    }

    // Concurrent status change (or an in-flight `updateDraft`) between our initial read and the
    // guarded update.
    const current = await this.batchModel.findById(claimLetterId).lean<SubmitBatch | null>().exec();
    if (current?.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(current, user));
    }
    if (current?.editLockToken && this.isEditLockActive(current.editLockAcquiredAt)) {
      throw new ConflictException('Claim letter is currently being edited. Please retry in a moment.');
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
    const stateId = String(scope.state);
    const yearId = String(scope.year);
    const [children, gate] = await Promise.all([
      this.batchUlbModel
        .find({ claimLetter: scope._id })
        .select('ulbId ulbSnapshot.name')
        .lean<{ ulbId: Types.ObjectId; ulbSnapshot: { name: string } }[]>()
        .exec(),
      this.eligibilityService.evaluateStateLevelGate(stateId, yearId, scope.installment),
    ]);
    if (!gate.passed) {
      const failed = gate.sources.filter((s) => s.result === 'FAILED').map((s) => s.displayLabel ?? s.formType);
      throw new BadRequestException(
        `The State-level claim conditions are no longer met: ${failed.join(', ')}. Resolve them before submitting.`,
      );
    }

    const ulbLevel = await this.eligibilityService.resolveUlbLevelEligibility(
      stateId,
      yearId,
      scope.installment,
      children.map((c) => String(c.ulbId)),
    );
    const ineligible = children
      .filter((c) => ulbLevel.perUlbEligible.get(String(c.ulbId)) === false)
      .map((c) => c.ulbSnapshot.name);
    if (ineligible.length === 0) return;
    const shown = ineligible.slice(0, 10);
    const suffix = ineligible.length > shown.length ? ` and ${ineligible.length - shown.length} more` : '';
    throw new BadRequestException(
      `${ineligible.length} ULB(s) in this batch are no longer eligible: ${shown.join(', ')}${suffix}. ` +
        'Remove them from the batch before submitting.',
    );
  }

  /** The last batch slot is the State's last chance this installment: refuse it while any expected ULB
   *  is in no batch, eligible or not, so none is stranded. */
  private async assertFinalBatchIsComplete(stateId: string, yearId: string, installment: number): Promise<void> {
    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const remainingUlbIds = await this.eligibilityService.resolveRemainingUlbIds(
      stateId,
      yearId,
      installment,
      expectedUlbs.map((u) => u.ulbId),
    );
    if (remainingUlbIds.length === 0) return;

    const remainingUlbIdSet = new Set(remainingUlbIds);
    const remainingNames = expectedUlbs.filter((u) => remainingUlbIdSet.has(u.ulbId)).map((u) => u.name);
    const shown = remainingNames.slice(0, 10);
    const suffix = remainingNames.length > shown.length ? ` and ${remainingNames.length - shown.length} more` : '';

    throw new BadRequestException(
      `This is the final claim batch (Batch ${CLAIM_LETTER_MAX_BATCH_NUMBER} of ${CLAIM_LETTER_MAX_BATCH_NUMBER}) — ` +
        `${remainingNames.length} ULB(s) are not yet included in any batch and must be added before this batch can ` +
        `be submitted: ${shown.join(', ')}${suffix}.`,
    );
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
