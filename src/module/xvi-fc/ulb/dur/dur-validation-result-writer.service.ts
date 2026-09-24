import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { XviFcDur, XviFcDurDocument } from 'src/schemas/xvi-fc/dur.schema';
import { nextPostRejectionAttempts, computeUploadBlockedUntil } from 'src/common/utils/manual-review-cooldown.util';
import type { DurJobResultResponse } from './dur-validation-api.service';

/**
 * Interprets a settled DUR validation job result and writes it to the document slot — shared by
 * both DurValidationProcessor (the BullMQ worker's own bounded poll loop) and DurStatusSyncService
 * (the cron fallback for jobs that outlive that loop), so the PASS/FAIL interpretation and the
 * post-rejection cooldown bookkeeping is written exactly once, not duplicated between them.
 *
 * Every write here is scoped by `uploadId`, not just `docId` — assertCanUlbUpload allows a
 * re-upload while the slot is still PROCESSING, which replaces `documents.$.currentUpload` with a
 * new upload (and a new validation job) before the old one has settled. Without the uploadId
 * check, a late result for the old upload would still match on docId alone and stamp its verdict
 * onto the new upload's currentUpload — marking a file the vendor never actually validated as
 * PASSED. Scoping every write means a stale result simply finds no matching slot and is dropped.
 */
@Injectable()
export class DurValidationResultWriter {
  private readonly logger = new Logger(DurValidationResultWriter.name);

  constructor(
    @InjectModel(XviFcDur.name)
    private readonly durModel: Model<XviFcDurDocument>,
  ) {}

  async writeCompleted(durId: string, docId: string, uploadId: string, resp: DurJobResultResponse): Promise<void> {
    const completedAt = new Date();
    const checks = resp.result?.checks;
    const overallValid = checks?.overall_valid === true;
    const processingStatus = overallValid ? 'PASSED' : 'FAILED';
    const failedChecks = resp.result?.failed_checks ?? [];
    const extraction = resp.result?.extraction;
    const validationDetails = extraction?.extraction_notes ?? null;

    this.logger.log(`writeCompleted — durId=${durId} docId=${docId} uploadId=${uploadId} processingStatus=${processingStatus}`);

    const postRejectionUpdate = await this.computePostRejectionUpdate(durId, docId, uploadId, processingStatus);

    const result = await this.durModel.updateOne(
      { _id: new Types.ObjectId(durId), documents: { $elemMatch: { docId, 'currentUpload.uploadId': uploadId } } },
      {
        $set: {
          'documents.$.processingStatus': processingStatus,
          'documents.$.currentUpload.ocrInfo.status': 'completed',
          'documents.$.currentUpload.ocrInfo.completedAt': completedAt,
          'documents.$.currentUpload.ocrInfo.validationStatus': overallValid ? 'PASS' : 'FAIL',
          'documents.$.currentUpload.ocrInfo.validationDetails': validationDetails,
          'documents.$.currentUpload.ocrInfo.failedChecks': failedChecks,
          ...postRejectionUpdate,
        },
      },
    );
    this.logStaleResultIfUnmatched(result.matchedCount, durId, docId, uploadId);
  }

  async writeFailed(durId: string, docId: string, uploadId: string, reason?: string | null): Promise<void> {
    const completedAt = new Date();
    this.logger.warn(`writeFailed — durId=${durId} docId=${docId} uploadId=${uploadId} reason=${reason}`);

    const postRejectionUpdate = await this.computePostRejectionUpdate(durId, docId, uploadId, 'FAILED');

    const result = await this.durModel.updateOne(
      { _id: new Types.ObjectId(durId), documents: { $elemMatch: { docId, 'currentUpload.uploadId': uploadId } } },
      {
        $set: {
          'documents.$.processingStatus': 'FAILED',
          'documents.$.currentUpload.ocrInfo.status': 'failed',
          'documents.$.currentUpload.ocrInfo.completedAt': completedAt,
          'documents.$.currentUpload.ocrInfo.validationDetails': reason ?? 'DUR validation job failed',
          ...postRejectionUpdate,
        },
      },
    );
    this.logStaleResultIfUnmatched(result.matchedCount, durId, docId, uploadId);
  }

  private logStaleResultIfUnmatched(matchedCount: number, durId: string, docId: string, uploadId: string): void {
    if (matchedCount === 0) {
      this.logger.warn(
        `Dropped a stale validation result — durId=${durId} docId=${docId} uploadId=${uploadId} no longer matches the document's current upload (superseded by a re-upload)`,
      );
    }
  }

  /** Mirrors AnnualAccountOcrProcessor.computePostRejectionUpdate exactly, using the shared
   *  cooldown util instead of a locally re-derived threshold. Scoped by uploadId too, same reason
   *  as the write above — reading a re-uploaded slot's fields here would build an update for the
   *  wrong upload, even though the outer write's own uploadId match would still stop it landing. */
  private async computePostRejectionUpdate(
    durId: string,
    docId: string,
    uploadId: string,
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

    const doc = await this.durModel
      .findOne(
        { _id: new Types.ObjectId(durId), documents: { $elemMatch: { docId, 'currentUpload.uploadId': uploadId } } },
        { 'documents.$': 1 },
      )
      .lean()
      .exec();
    const docSlot = doc?.documents?.[0];
    if (docSlot?.manualReviewDecision?.status !== 'RETURNED') return {};

    const attemptsUsed = nextPostRejectionAttempts(docSlot.postRejectionAttemptsUsed ?? 0);
    const update: Record<string, unknown> = { 'documents.$.postRejectionAttemptsUsed': attemptsUsed };
    const uploadBlockedUntil = computeUploadBlockedUntil(attemptsUsed);
    if (uploadBlockedUntil) update['documents.$.uploadBlockedUntil'] = uploadBlockedUntil;
    return update;
  }
}
