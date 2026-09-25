import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { XviFcDur, XviFcDurDocument, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';
import { DurValidationApiService } from './dur-validation-api.service';
import { DurValidationResultWriter } from './dur-validation-result-writer.service';

/** Past this, DurValidationProcessor's own ~50s bounded poll loop has definitely given up —
 *  safe to let the cron take over without racing the still-active in-process loop. */
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

interface StuckSlot {
  durId: Types.ObjectId;
  docId: XviFcDurDocId;
  jobId: string;
  uploadId: string;
}

/**
 * Cron fallback for DUR validation jobs that outlive DurValidationProcessor's own bounded poll
 * loop (a real, observed case — a Gemini-backed validation can take longer than the ~50s the
 * in-process loop waits). Without this, a document that settles late is stuck at PROCESSING
 * forever — nothing ever writes PASSED/FAILED, so the frontend's status poll finds nothing new
 * on every tick and appears to loop indefinitely (it isn't broken; the backend just never
 * finishes the job).
 *
 * Deliberately NOT modeled on AnnualAccountStatusSyncService's exact query shape — that service
 * still references a pre-refactor field path (`[section].documents.docId`) that no longer matches
 * XviFcAnnualAccount's current flat schema, so it doesn't actually match anything today. Built
 * fresh against DUR's real, current schema instead of copying that bug forward.
 */
@Injectable()
export class DurStatusSyncService {
  private readonly logger = new Logger(DurStatusSyncService.name);
  private isSyncing = false;

  constructor(
    @InjectModel(XviFcDur.name)
    private readonly durModel: Model<XviFcDurDocument>,

    private readonly durApi: DurValidationApiService,
    private readonly resultWriter: DurValidationResultWriter,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'Asia/Kolkata' })
  async syncPendingJobs(): Promise<void> {
    if (this.isSyncing) {
      this.logger.debug('Skipping — previous DUR status sync still running');
      return;
    }
    this.isSyncing = true;

    try {
      const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
      const stuckSlots = await this.findStuckSlots(staleThreshold);
      if (stuckSlots.length === 0) return;

      this.logger.log(`Found ${stuckSlots.length} stuck DUR document(s) — re-checking their validation jobs`);
      await Promise.allSettled(stuckSlots.map((slot) => this.syncOne(slot)));
    } catch (err) {
      this.logger.error('DUR status sync error', err);
    } finally {
      this.isSyncing = false;
    }
  }

  private async findStuckSlots(staleThreshold: Date): Promise<StuckSlot[]> {
    const durs = await this.durModel
      .find({
        documents: {
          $elemMatch: {
            processingStatus: 'PROCESSING',
            'currentUpload.ocrInfo.jobId': { $ne: null },
            'currentUpload.ocrInfo.submittedAt': { $lt: staleThreshold },
          },
        },
      })
      .select('documents')
      .lean()
      .exec();

    return durs.flatMap((dur) =>
      dur.documents
        .filter(
          (d) =>
            d.processingStatus === 'PROCESSING' &&
            d.currentUpload?.ocrInfo?.jobId &&
            d.currentUpload.ocrInfo.submittedAt &&
            d.currentUpload.ocrInfo.submittedAt < staleThreshold,
        )
        .map((d) => ({
          durId: dur._id,
          docId: d.docId as XviFcDurDocId,
          jobId: d.currentUpload!.ocrInfo.jobId!,
          uploadId: d.currentUpload!.uploadId,
        })),
    );
  }

  private async syncOne(slot: StuckSlot): Promise<void> {
    const durId = slot.durId.toString();
    try {
      const statusResp = await this.durApi.getJobStatus(slot.jobId);
      const statusNorm = statusResp.status?.toLowerCase();
      this.logger.log(`syncOne — durId=${durId} docId=${slot.docId} jobId=${slot.jobId} status=${statusResp.status}`);

      if (statusNorm === 'completed') {
        const result = await this.durApi.getJobResult(slot.jobId);
        await this.resultWriter.writeCompleted(durId, slot.docId, slot.uploadId, result);
      } else if (statusNorm === 'failed') {
        await this.resultWriter.writeFailed(durId, slot.docId, slot.uploadId, statusResp.error_message ?? statusResp.message);
      }
      // Still processing / queued — leave it for the next tick, unless it's crossed the threshold
      // again, in which case this same query picks it up again next time.
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;
      if (status === 404) {
        this.logger.warn(`Validation job ${slot.jobId} not found (404) — marking durId=${durId} docId=${slot.docId} as FAILED`);
        await this.resultWriter.writeFailed(durId, slot.docId, slot.uploadId, 'Validation job not found on processing server (404)');
      } else {
        this.logger.error(`Failed to sync DUR validation job ${slot.jobId} (durId=${durId} docId=${slot.docId})`, err);
      }
    }
  }
}
