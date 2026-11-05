import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { OcrBasicValidation, OcrResultResponse } from './annual-account-ocr-api.service';
import { MAX_POST_REJECTION_ATTEMPTS, POST_REJECTION_COOLDOWN_HOURS } from './annual-account-status-access.util';

export interface OcrCtx {
  uploadId: string;
  /** The physical XviFcAnnualAccount document holding this section's `documents` array — the
   *  'audited' anchor itself when section is 'auditedData', otherwise its 'unaudited' sibling
   *  (see resolveTargetDocId). */
  targetDocId: Types.ObjectId;
  docId: string;
}

/**
 * The single place an OCR outcome is written to the upload history and the section's document
 * slot. Shared by AnnualAccountOcrProcessor (jobs that settle within its poll loop) and
 * AnnualAccountStatusSyncService (the cron fallback for jobs that outlive it, e.g. a large PDF),
 * so both write to the same flat `documents.$` path and both apply the post-rejection strike
 * counter.
 */
@Injectable()
export class AnnualAccountOcrResultWriter {
  private readonly logger = new Logger(AnnualAccountOcrResultWriter.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,
  ) {}

  async writeProgress(ctx: OcrCtx, status: string | undefined, progressStep: string): Promise<void> {
    const { uploadId, targetDocId, docId } = ctx;
    await Promise.all([
      this.uploadHistoryModel.updateOne(
        { uploadId },
        { $set: { 'ocrInfo.status': status, 'ocrInfo.progressStep': progressStep } },
      ),
      this.annualAccountModel.updateOne(
        { _id: targetDocId, 'documents.docId': docId },
        {
          $set: {
            'documents.$.currentUpload.ocrInfo.status': status,
            'documents.$.currentUpload.ocrInfo.progressStep': progressStep,
          },
        },
      ),
    ]);
  }

  async writeCompleted(ctx: OcrCtx, resp: OcrResultResponse): Promise<void> {
    const { uploadId, targetDocId, docId } = ctx;
    const completedAt = new Date();

    // Python nests validation inside result.basic_validation and uses "PASS"/"FAIL"
    const bv: OcrBasicValidation | undefined = resp.result?.basic_validation;
    const validationStatus = bv?.validation_status ?? null;
    const processingStatus = validationStatus?.toUpperCase() === 'PASS' ? 'PASSED' : 'FAILED';

    const postRejectionUpdate = await this.computePostRejectionUpdate(targetDocId, docId, processingStatus);

    await Promise.all([
      this.uploadHistoryModel.updateOne(
        { uploadId },
        {
          $set: {
            processingStatus,
            'queue.status': 'completed',
            'ocrInfo.status': 'COMPLETED',
            'ocrInfo.completedAt': completedAt,
            'ocrInfo.validationStatus': validationStatus,
            'ocrInfo.validationDetails': bv?.validation_details ?? null,
            'ocrInfo.failedChecks': resp.result?.error_messages ?? [],
          },
        },
      ),
      this.annualAccountModel.updateOne(
        { _id: targetDocId, 'documents.docId': docId },
        {
          $set: {
            'documents.$.processingStatus': processingStatus,
            'documents.$.currentUpload.ocrInfo.status': 'COMPLETED',
            'documents.$.currentUpload.ocrInfo.completedAt': completedAt,
            'documents.$.currentUpload.ocrInfo.validationStatus': validationStatus,
            'documents.$.currentUpload.ocrInfo.validationDetails': bv?.validation_details ?? null,
            'documents.$.currentUpload.ocrInfo.failedChecks': resp.result?.error_messages ?? [],
            ...postRejectionUpdate,
          },
        },
      ),
    ]);

    this.logger.log(`OCR result written — uploadId=${uploadId} processingStatus=${processingStatus}`);
  }

  async writeFailed(ctx: OcrCtx, reason?: string): Promise<void> {
    const { uploadId, targetDocId, docId } = ctx;
    const completedAt = new Date();

    const postRejectionUpdate = await this.computePostRejectionUpdate(targetDocId, docId, 'FAILED');

    await Promise.all([
      this.uploadHistoryModel.updateOne(
        { uploadId },
        {
          $set: {
            processingStatus: 'FAILED',
            error: reason ?? 'OCR job failed',
            'queue.status': 'failed',
            'ocrInfo.status': 'FAILED',
            'ocrInfo.completedAt': completedAt,
          },
        },
      ),
      this.annualAccountModel.updateOne(
        { _id: targetDocId, 'documents.docId': docId },
        {
          $set: {
            'documents.$.processingStatus': 'FAILED',
            'documents.$.currentUpload.ocrInfo.status': 'FAILED',
            'documents.$.currentUpload.ocrInfo.completedAt': completedAt,
            ...postRejectionUpdate,
          },
        },
      ),
    ]);

    this.logger.warn(`OCR failure written — uploadId=${uploadId} reason=${reason}`);
  }

  /**
   * Advances the post-manual-review-rejection strike counter. A PASS always clears the whole
   * cycle (manualReviewDecision, the attempt counter, the rejection counter, and any cooldown)
   * regardless of how it got there. A FAIL only counts as a "strike" while a RETURNED manual-review
   * decision is still the live one for this document — an ordinary first-time OCR failure (no
   * rejection yet) must not consume any of the 3 attempts. The moment the strike count reaches
   * MAX_POST_REJECTION_ATTEMPTS, the document is blocked for POST_REJECTION_COOLDOWN_HOURS right
   * here — no second manual-review request/rejection round-trip required first. Once that cooldown
   * has run its course, the *next* strike starts a brand-new batch of MAX_POST_REJECTION_ATTEMPTS
   * rather than continuing the exhausted one — a lingering uploadBlockedUntil is the signal that a
   * cooldown already completed, since the upload couldn't have reached here while it was still
   * active. So the ULB cycle repeats indefinitely: fail x N → cooldown → fresh fail x N → cooldown →
   * ... with "Request Manual Review" re-offered at the end of every batch, same as the first time.
   * Reads the current docSlot first since Mongo can't conditionally $inc off another field of the
   * same array element in one plain updateOne.
   */
  private async computePostRejectionUpdate(
    targetDocId: Types.ObjectId,
    docId: string,
    processingStatus: 'PASSED' | 'FAILED',
  ): Promise<Record<string, unknown>> {
    if (processingStatus === 'PASSED') {
      return {
        'documents.$.manualReviewDecision': null,
        'documents.$.postRejectionAttemptsUsed': 0,
        'documents.$.manualReviewRejectionCount': 0,
        'documents.$.uploadBlockedUntil': null,
      };
    }

    const doc = await this.annualAccountModel
      .findOne(
        { _id: targetDocId, 'documents.docId': docId },
        { 'documents.$': 1 },
      )
      .lean()
      .exec();
    const docSlot = doc?.documents?.[0];
    if (docSlot?.manualReviewDecision?.status !== 'RETURNED') return {};

    // A previously-set uploadBlockedUntil can only mean the ULB already served out a full cooldown
    // before this retry/re-upload was ever allowed to start (the upload-blocked guard rejects while
    // one is still active) — so this failure opens a fresh batch of attempts, not a continuation of
    // the batch that triggered the old lock. Without this, the ULB would get only one attempt per
    // cycle after the first lock instead of a full fresh MAX_POST_REJECTION_ATTEMPTS.
    const startingFreshBatch = docSlot.uploadBlockedUntil != null;
    const attemptsUsed = Math.min((startingFreshBatch ? 0 : docSlot.postRejectionAttemptsUsed ?? 0) + 1, MAX_POST_REJECTION_ATTEMPTS);
    const update: Record<string, unknown> = { 'documents.$.postRejectionAttemptsUsed': attemptsUsed };
    if (attemptsUsed >= MAX_POST_REJECTION_ATTEMPTS) {
      update['documents.$.uploadBlockedUntil'] = new Date(
        Date.now() + POST_REJECTION_COOLDOWN_HOURS * 60 * 60 * 1000,
      );
    } else if (startingFreshBatch) {
      update['documents.$.uploadBlockedUntil'] = null;
    }
    return update;
  }

  /**
   * `annualAccountId` always names the 'audited' anchor document (see
   * AnnualAccountsService.resolveSectionDocument for the invariant this mirrors). For
   * section === 'auditedData' that's already the right document; for 'unauditedData' the actual
   * `documents` array lives on the sibling document, looked up by {ulb, design_year,
   * sectionType:'unaudited'} — created lazily by upsertDocumentSlot before this job was ever
   * enqueued, so it's expected to already exist here.
   */
  async resolveTargetDocId(annualAccountId: string | Types.ObjectId, section: string): Promise<Types.ObjectId> {
    const anchorId = new Types.ObjectId(annualAccountId);
    if (section === 'auditedData') return anchorId;

    const anchor = await this.annualAccountModel.findById(anchorId).select('ulb design_year').lean().exec();
    if (!anchor) {
      this.logger.error(`OCR write target: annual account not found — annualAccountId=${annualAccountId.toString()}`);
      return anchorId;
    }

    const sibling = await this.annualAccountModel
      .findOne({ ulb: anchor.ulb, design_year: anchor.design_year, sectionType: 'unaudited' })
      .select('_id')
      .lean()
      .exec();

    if (!sibling) {
      this.logger.error(
        `OCR write target: 'unaudited' sibling not found — annualAccountId=${annualAccountId.toString()} ulb=${anchor.ulb.toString()} design_year=${anchor.design_year.toString()}`,
      );
      return anchorId;
    }

    return sibling._id;
  }
}
