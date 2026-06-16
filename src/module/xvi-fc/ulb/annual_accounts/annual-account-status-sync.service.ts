import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  XviFcAnnualAccount,
  XviFcAnnualAccountDocument,
} from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountProcessingJob,
  XviFcAnnualAccountProcessingJobDocument,
} from '../../../../schemas/xvi-fc/annual-account-processing-jobs.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { AnnualAccountOcrApiService } from './annual-account-ocr-api.service';

@Injectable()
export class AnnualAccountStatusSyncService {
  private readonly logger = new Logger(AnnualAccountStatusSyncService.name);
  private isSyncing = false;

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountProcessingJob.name)
    private readonly processingJobModel: Model<XviFcAnnualAccountProcessingJobDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    private readonly ocrApi: AnnualAccountOcrApiService,
  ) {}

  // Fallback cron: picks up jobs the processor's poll loop did not settle
  // (e.g. OCR API slower than expected, pod restart mid-poll)
  @Cron('*/5 * * * *', { timeZone: 'Asia/Kolkata' })
  async syncPendingJobs() {
    if (this.isSyncing) {
      console.log(`[StatusSync] ⏭ Skipping — previous sync still running`);
      return;
    }
    this.isSyncing = true;

    // Only touch jobs started >30 s ago so we don't race with the processor's own poll loop
    const staleThreshold = new Date(Date.now() - 30_000);

    try {
      const runningJobs = await this.processingJobModel
        .find({ status: 'RUNNING', 'ocrJob.jobId': { $ne: null }, startedAt: { $lt: staleThreshold } })
        .lean()
        .exec();

      console.log(`[StatusSync] 🔄 Cron tick — found ${runningJobs.length} RUNNING jobs`);

      if (runningJobs.length === 0) return;

      await Promise.allSettled(runningJobs.map((job) => this.syncOne(job)));
    } catch (err: any) {
      this.logger.error('Status sync error', err?.message);
      console.error(`[StatusSync] ❌ Error:`, err?.message);
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncOne(processingJob: any) {
    const { uploadId, annualAccountId, section, requirementId, ocrJob } = processingJob;
    const pythonJobId: string = ocrJob.jobId;

    console.log(`[StatusSync] syncOne — uploadId=${uploadId} pythonJobId=${pythonJobId}`);

    try {
      const statusResp = await this.ocrApi.getJobStatus(pythonJobId);
      console.log(`[StatusSync] Python status response =`, JSON.stringify(statusResp));

      // Update progressStep on all 3 if it changed
      if (statusResp.progress_step && statusResp.progress_step !== ocrJob.progressStep) {
        console.log(`[StatusSync] progressStep changed → ${statusResp.progress_step}`);
        await Promise.all([
          this.processingJobModel.updateOne(
            { uploadId },
            { $set: { 'ocrJob.status': statusResp.status, 'ocrJob.progressStep': statusResp.progress_step } },
          ),
          this.uploadHistoryModel.updateOne(
            { uploadId },
            { $set: { 'ocrInfo.status': statusResp.status, 'ocrInfo.progressStep': statusResp.progress_step } },
          ),
          this.annualAccountModel.updateOne(
            {
              _id: new Types.ObjectId(annualAccountId),
              [`${section}.documents.requirementId`]: requirementId,
            },
            {
              $set: {
                [`${section}.documents.$.currentUpload.ocrInfo.status`]: statusResp.status,
                [`${section}.documents.$.currentUpload.ocrInfo.progressStep`]: statusResp.progress_step,
              },
            },
          ),
        ]);
      }

      if (statusResp.status === 'COMPLETED') {
        console.log(`[StatusSync] ✅ COMPLETED — fetching result for pythonJobId=${pythonJobId}`);
        await this.handleCompleted(processingJob, pythonJobId);
      } else if (statusResp.status === 'FAILED') {
        console.log(`[StatusSync] ❌ FAILED — pythonJobId=${pythonJobId} reason=${statusResp.message}`);
        await this.handleFailed(processingJob, pythonJobId, statusResp.message);
      } else {
        console.log(`[StatusSync] ⏳ Still running — status=${statusResp.status}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to sync OCR job ${pythonJobId} (uploadId=${uploadId})`, err?.message);
      console.error(`[StatusSync] ❌ syncOne error:`, err?.message);
    }
  }

  private async handleCompleted(processingJob: any, pythonJobId: string) {
    const { uploadId, annualAccountId, section, requirementId } = processingJob;

    const result = await this.ocrApi.getJobResult(pythonJobId);
    console.log(`[StatusSync] getJobResult response =`, JSON.stringify(result));

    const completedAt = new Date();
    const processingStatus = result.validation_status === 'PASSED' ? 'PASSED' : 'FAILED';
    console.log(`[StatusSync] Final processingStatus = ${processingStatus}`);

    await Promise.all([
      this.processingJobModel.updateOne(
        { uploadId },
        {
          $set: {
            status: 'COMPLETED',
            'ocrJob.status': 'COMPLETED',
            completedAt,
          },
        },
      ),

      this.uploadHistoryModel.updateOne(
        { uploadId },
        {
          $set: {
            processingStatus,
            'ocrInfo.status': 'COMPLETED',
            'ocrInfo.completedAt': completedAt,
            'validationResult.validationStatus': result.validation_status,
            'validationResult.validationDetails': result.validation_details ?? null,
            'validationResult.failedChecks': result.failed_checks ?? [],
          },
        },
      ),

      this.annualAccountModel.updateOne(
        {
          _id: new Types.ObjectId(annualAccountId),
          [`${section}.documents.requirementId`]: requirementId,
        },
        {
          $set: {
            [`${section}.documents.$.processingStatus`]: processingStatus,
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: 'COMPLETED',
            [`${section}.documents.$.currentUpload.ocrInfo.completedAt`]: completedAt,
            [`${section}.documents.$.currentUpload.validationResult.validationStatus`]: result.validation_status,
            [`${section}.documents.$.currentUpload.validationResult.validationDetails`]: result.validation_details ?? null,
            [`${section}.documents.$.currentUpload.validationResult.failedChecks`]: result.failed_checks ?? [],
          },
        },
      ),
    ]);

    console.log(`[StatusSync] ✔ All 3 collections updated — uploadId=${uploadId} result=${processingStatus}`);
    this.logger.log(`OCR job completed — uploadId=${uploadId} result=${processingStatus}`);
  }

  private async handleFailed(processingJob: any, pythonJobId: string, reason?: string) {
    const { uploadId, annualAccountId, section, requirementId } = processingJob;
    const completedAt = new Date();

    await Promise.all([
      this.processingJobModel.updateOne(
        { uploadId },
        {
          $set: {
            status: 'FAILED',
            'ocrJob.status': 'FAILED',
            error: reason ?? 'Python OCR job failed',
            completedAt,
          },
        },
      ),

      this.uploadHistoryModel.updateOne(
        { uploadId },
        {
          $set: {
            processingStatus: 'FAILED',
            'ocrInfo.status': 'FAILED',
            'ocrInfo.completedAt': completedAt,
          },
        },
      ),

      this.annualAccountModel.updateOne(
        {
          _id: new Types.ObjectId(annualAccountId),
          [`${section}.documents.requirementId`]: requirementId,
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

    console.log(`[StatusSync] ✔ FAILED written to all 3 collections — uploadId=${uploadId}`);
    this.logger.warn(`OCR job failed — uploadId=${uploadId} reason=${reason}`);
  }
}
