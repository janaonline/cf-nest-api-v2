import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  XviFcAnnualAccount,
  XviFcAnnualAccountDocument,
} from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { AnnualAccountOcrApiService, OcrBasicValidation, OcrResultResponse } from './annual-account-ocr-api.service';

@Injectable()
export class AnnualAccountStatusSyncService {
  private readonly logger = new Logger(AnnualAccountStatusSyncService.name);
  private isSyncing = false;

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    private readonly ocrApi: AnnualAccountOcrApiService,
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
      const statusResp = await this.ocrApi.getJobStatus(pythonJobId);
      const statusNorm = statusResp.status?.toUpperCase();
      console.log(`[StatusSync] Python status response =`, JSON.stringify(statusResp), `→ normalized=${statusNorm}`);

      if (statusResp.progress_step && statusResp.progress_step !== ocrInfo.progressStep) {
        console.log(`[StatusSync] progressStep changed → ${statusResp.progress_step}`);
        await Promise.all([
          this.uploadHistoryModel.updateOne(
            { uploadId },
            { $set: { 'ocrInfo.status': statusNorm, 'ocrInfo.progressStep': statusResp.progress_step } },
          ),
          this.annualAccountModel.updateOne(
            {
              _id: new Types.ObjectId(annualAccountId),
              [`${section}.documents.docId`]: docId,
            },
            {
              $set: {
                [`${section}.documents.$.currentUpload.ocrInfo.status`]: statusNorm,
                [`${section}.documents.$.currentUpload.ocrInfo.progressStep`]: statusResp.progress_step,
              },
            },
          ),
        ]);
      }

      if (statusNorm === 'COMPLETED') {
        console.log(`[StatusSync] ✅ COMPLETED — fetching /result for pythonJobId=${pythonJobId}`);
        const result = await this.ocrApi.getJobResult(pythonJobId);
        console.log(`[StatusSync] /result response =`, JSON.stringify(result));
        await this.handleCompleted(historyDoc, result);
      } else if (statusNorm === 'FAILED') {
        console.log(`[StatusSync] ❌ FAILED — uploadId=${uploadId} reason=${statusResp.message}`);
        await this.handleFailed(historyDoc, statusResp.message);
      } else {
        console.log(`[StatusSync] ⏳ Still running — status=${statusNorm}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to sync OCR job ${pythonJobId} (uploadId=${uploadId})`, err?.message);
      console.error(`[StatusSync] ❌ syncOne error:`, err?.message);
    }
  }

  private async handleCompleted(historyDoc: any, resp: OcrResultResponse) {
    const { uploadId, annualAccountId, section, docId } = historyDoc;
    const completedAt = new Date();

    const bv: OcrBasicValidation | undefined = resp.result?.basic_validation;
    const validationStatus = bv?.validation_status ?? null;
    const processingStatus = validationStatus?.toUpperCase() === 'PASS' ? 'PASSED' : 'FAILED';

    console.log(`[StatusSync] Final processingStatus=${processingStatus} validationStatus=${validationStatus}`);
    console.log(`[StatusSync] basic_validation =`, JSON.stringify(bv));

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
            'ocrInfo.failedChecks': bv?.failed_checks ?? [],
          },
        },
      ),

      this.annualAccountModel.updateOne(
        {
          _id: new Types.ObjectId(annualAccountId),
          [`${section}.documents.docId`]: docId,
        },
        {
          $set: {
            [`${section}.documents.$.processingStatus`]: processingStatus,
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: 'COMPLETED',
            [`${section}.documents.$.currentUpload.ocrInfo.completedAt`]: completedAt,
            [`${section}.documents.$.currentUpload.ocrInfo.validationStatus`]: validationStatus,
            [`${section}.documents.$.currentUpload.ocrInfo.validationDetails`]: bv?.validation_details ?? null,
            [`${section}.documents.$.currentUpload.ocrInfo.failedChecks`]: bv?.failed_checks ?? [],
          },
        },
      ),
    ]);

    console.log(`[StatusSync] ✔ All collections updated — uploadId=${uploadId} result=${processingStatus}`);
    this.logger.log(`OCR job completed — uploadId=${uploadId} result=${processingStatus}`);
  }

  private async handleFailed(historyDoc: any, reason?: string) {
    const { uploadId, annualAccountId, section, docId } = historyDoc;
    const completedAt = new Date();

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
        {
          _id: new Types.ObjectId(annualAccountId),
          [`${section}.documents.docId`]: docId,
        },
        {
          $set: {
            [`${section}.documents.$.processingStatus`]: 'FAILED',
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: 'FAILED',
            [`${section}.documents.$.currentUpload.ocrInfo.completedAt`]: completedAt,
          },
        },
      ),
    ]);

    console.log(`[StatusSync] ✔ FAILED written — uploadId=${uploadId}`);
    this.logger.warn(`OCR job failed — uploadId=${uploadId} reason=${reason}`);
  }
}
