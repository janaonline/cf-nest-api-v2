import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { AnnualAccountOcrApiService } from './annual-account-ocr-api.service';
import { AnnualAccountOcrResultWriter, OcrCtx } from './annual-account-ocr-result.writer';

/**
 * Cron fallback for OCR jobs that outlive AnnualAccountOcrProcessor's bounded poll loop (e.g. a
 * large, hundreds-of-pages PDF). Writes through the same AnnualAccountOcrResultWriter as the
 * processor, so a late result lands on the right section document instead of leaving it at
 * PROCESSING until the UI's stale timeout.
 */
@Injectable()
export class AnnualAccountStatusSyncService {
  private readonly logger = new Logger(AnnualAccountStatusSyncService.name);
  private isSyncing = false;

  constructor(
    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    private readonly ocrApi: AnnualAccountOcrApiService,
    private readonly resultWriter: AnnualAccountOcrResultWriter,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'Asia/Kolkata' })
  async syncPendingJobs() {
    if (this.isSyncing) {
      console.log(`[StatusSync] ⏭ Skipping — previous sync still running`);
      return;
    }
    this.isSyncing = true;

    const staleThreshold = new Date(Date.now() - 30_000);

    try {
      const processingDocs = await this.uploadHistoryModel
        .find({
          processingStatus: 'PROCESSING',
          'ocrInfo.jobId': { $ne: null },
          startedAt: { $lt: staleThreshold },
        })
        .lean()
        .exec();

      console.log(`[StatusSync] 🔄 Cron tick — found ${processingDocs.length} PROCESSING uploads`);

      if (processingDocs.length === 0) return;

      await Promise.allSettled(processingDocs.map((doc) => this.syncOne(doc)));
    } catch (err: any) {
      this.logger.error('Status sync error', err?.message);
      console.error(`[StatusSync] ❌ Error:`, err?.message);
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncOne(historyDoc: any) {
    const { uploadId, annualAccountId, section, docId, ocrInfo } = historyDoc;
    const pythonJobId: string = ocrInfo.jobId;

    console.log(`[StatusSync] syncOne — uploadId=${uploadId} pythonJobId=${pythonJobId}`);

    try {
      const targetDocId = await this.resultWriter.resolveTargetDocId(annualAccountId, section);
      const ctx: OcrCtx = { uploadId, targetDocId, docId };

      try {
        const statusResp = await this.ocrApi.getJobStatus(pythonJobId);
        const statusNorm = statusResp.status?.toUpperCase();
        console.log(`[StatusSync] Python status response =`, JSON.stringify(statusResp), `→ normalized=${statusNorm}`);

        if (statusResp.progress_step && statusResp.progress_step !== ocrInfo.progressStep) {
          console.log(`[StatusSync] progressStep changed → ${statusResp.progress_step}`);
          await this.resultWriter.writeProgress(ctx, statusNorm, statusResp.progress_step);
        }

        if (statusNorm === 'COMPLETED') {
          console.log(`[StatusSync] ✅ COMPLETED — fetching /result for pythonJobId=${pythonJobId}`);
          const result = await this.ocrApi.getJobResult(pythonJobId);
          console.log(`[StatusSync] /result response =`, JSON.stringify(result));
          await this.resultWriter.writeCompleted(ctx, result);
        } else if (statusNorm === 'FAILED') {
          console.log(`[StatusSync] ❌ FAILED — uploadId=${uploadId} reason=${statusResp.message}`);
          await this.resultWriter.writeFailed(ctx, statusResp.message);
        } else {
          console.log(`[StatusSync] ⏳ Still running — status=${statusNorm}`);
        }
      } catch (err: any) {
        const status = err?.response?.status ?? err?.status;
        if (status !== 404) throw err;
        // OCR job no longer exists on the Python server — mark as FAILED so cron stops retrying
        this.logger.warn(`OCR job ${pythonJobId} not found (404) — marking uploadId=${uploadId} as FAILED`);
        await this.resultWriter.writeFailed(ctx, 'OCR job not found on processing server (404)');
      }
    } catch (err: any) {
      this.logger.error(`Failed to sync OCR job ${pythonJobId} (uploadId=${uploadId})`, err?.message);
      console.error(`[StatusSync] ❌ syncOne error:`, err?.message);
    }
  }
}
