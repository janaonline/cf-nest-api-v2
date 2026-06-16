import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job } from 'bullmq';
import { Model, Types } from 'mongoose';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { S3Service } from '../../../../core/s3/s3.service';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountProcessingJob,
  XviFcAnnualAccountProcessingJobDocument,
} from '../../../../schemas/xvi-fc/annual-account-processing-jobs.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { AnnualAccountOcrApiService, OcrResultResponse, OcrSubmitJobDto } from './annual-account-ocr-api.service';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 10; // 10 × 5s = 50s max wait

interface OcrCtx {
  uploadId: string;
  annualAccountId: string;
  section: string;
  requirementId: string;
}

@Processor(ANNUAL_ACCOUNT_PROCESSING_QUEUE, { concurrency: 2 })
export class AnnualAccountOcrProcessor extends WorkerHost {
  private readonly logger = new Logger(AnnualAccountOcrProcessor.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    @InjectModel(XviFcAnnualAccountProcessingJob.name)
    private readonly processingJobModel: Model<XviFcAnnualAccountProcessingJobDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    private readonly s3Service: S3Service,
    private readonly ocrApi: AnnualAccountOcrApiService,
  ) {
    super();
  }

  async process(job: Job<AnnualAccountOcrJobData>): Promise<void> {
    const { uploadId, annualAccountId, ulbId, section, requirementId, s3Key, expectedDocType, financialYear } =
      job.data;

    console.log(`[OCR Processor] ▶ START — uploadId=${uploadId} bullJobId=${job.id}`);

    await this.processingJobModel.updateOne(
      { uploadId },
      { $set: { 'queue.bullJobId': job.id, 'queue.status': 'active', status: 'RUNNING', startedAt: new Date() } },
    );

    const ulb = await this.ulbModel.findById(new Types.ObjectId(ulbId)).select('name slug keywords').lean().exec();
    if (!ulb) throw new Error(`ULB not found: ${ulbId}`);
    const ulbName = `${ulb.name}|${ulb.slug}|${ulb.keywords ?? ''}`;

    console.log(`[OCR Processor] ⬇ Downloading PDF — key=${s3Key}`);
    const pdfBuffer = await this.s3Service.getPdfBufferFromS3(s3Key);

    const fileName = `${requirementId}-${uploadId}.pdf`;
    const ocrJobData: OcrSubmitJobDto = {
      pdfBuffer,
      fileName,
      docType: expectedDocType,
      ulbName,
      uploadId,
      financialYear,
    };

    console.log(`[OCR Processor] ⬆ Submitting to OCR API — docType=${expectedDocType}`);
    const ocrResp = await this.ocrApi.submitJob(ocrJobData);
    const ocrJobId = ocrResp.job_id;
    console.log(`[OCR Processor] ✔ ocrJobId=${ocrJobId} status=${ocrResp.status}`);

    const submittedAt = new Date();
    const ctx: OcrCtx = { uploadId, annualAccountId, section, requirementId };

    await Promise.all([
      this.processingJobModel.updateOne(
        { uploadId },
        { $set: { 'ocrJob.jobId': ocrJobId, 'ocrJob.status': ocrResp.status } },
      ),
      this.uploadHistoryModel.updateOne(
        { uploadId },
        { $set: { 'ocrInfo.jobId': ocrJobId, 'ocrInfo.status': ocrResp.status, 'ocrInfo.submittedAt': submittedAt } },
      ),
      this.annualAccountModel.updateOne(
        { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.requirementId`]: requirementId },
        {
          $set: {
            [`${section}.documents.$.currentUpload.ocrInfo.jobId`]: ocrJobId,
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: ocrResp.status,
            [`${section}.documents.$.currentUpload.ocrInfo.submittedAt`]: submittedAt,
          },
        },
      ),
    ]);

    // Poll until the OCR job settles; the cron fallback catches anything that exceeds MAX_POLLS
    let settled = false;
    for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusResp = await this.ocrApi.getJobStatus(ocrJobId);
      console.log(
        `[OCR Processor] poll ${attempt}/${MAX_POLLS} — status=${statusResp.status} step=${statusResp.progress_step ?? '-'}`,
      );

      if (statusResp.progress_step) {
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
            { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.requirementId`]: requirementId },
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
        const result = await this.ocrApi.getJobResult(ocrJobId);
        await this.writeCompleted(ctx, result);
        settled = true;
        break;
      }

      if (statusResp.status === 'FAILED') {
        await this.writeFailed(ctx, statusResp.message);
        settled = true;
        break;
      }
    }

    if (!settled) {
      this.logger.warn(
        `OCR job not settled after ${MAX_POLLS} polls — cron fallback will pick it up — uploadId=${uploadId} ocrJobId=${ocrJobId}`,
      );
    }

    console.log(`[OCR Processor] ✅ DONE — uploadId=${uploadId} settled=${settled}`);
    this.logger.log(`OCR processor finished — uploadId=${uploadId} ocrJobId=${ocrJobId} settled=${settled}`);
  }

  private async writeCompleted(ctx: OcrCtx, result: OcrResultResponse): Promise<void> {
    const { uploadId, annualAccountId, section, requirementId } = ctx;
    const completedAt = new Date();
    const processingStatus = result.validation_status === 'PASSED' ? 'PASSED' : 'FAILED';

    console.log(`[OCR Processor] ✔ COMPLETED — uploadId=${uploadId} processingStatus=${processingStatus}`);

    await Promise.all([
      this.processingJobModel.updateOne(
        { uploadId },
        { $set: { status: 'COMPLETED', 'ocrJob.status': 'COMPLETED', completedAt } },
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
        { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.requirementId`]: requirementId },
        {
          $set: {
            [`${section}.documents.$.processingStatus`]: processingStatus,
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: 'COMPLETED',
            [`${section}.documents.$.currentUpload.ocrInfo.completedAt`]: completedAt,
            [`${section}.documents.$.currentUpload.validationResult.validationStatus`]: result.validation_status,
            [`${section}.documents.$.currentUpload.validationResult.validationDetails`]:
              result.validation_details ?? null,
            [`${section}.documents.$.currentUpload.validationResult.failedChecks`]: result.failed_checks ?? [],
          },
        },
      ),
    ]);

    this.logger.log(`OCR result written — uploadId=${uploadId} processingStatus=${processingStatus}`);
  }

  private async writeFailed(ctx: OcrCtx, reason?: string): Promise<void> {
    const { uploadId, annualAccountId, section, requirementId } = ctx;
    const completedAt = new Date();

    console.log(`[OCR Processor] ❌ FAILED — uploadId=${uploadId} reason=${reason}`);

    await Promise.all([
      this.processingJobModel.updateOne(
        { uploadId },
        { $set: { status: 'FAILED', 'ocrJob.status': 'FAILED', error: reason ?? 'OCR job failed', completedAt } },
      ),
      this.uploadHistoryModel.updateOne(
        { uploadId },
        { $set: { processingStatus: 'FAILED', 'ocrInfo.status': 'FAILED', 'ocrInfo.completedAt': completedAt } },
      ),
      this.annualAccountModel.updateOne(
        { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.requirementId`]: requirementId },
        {
          $set: {
            [`${section}.documents.$.processingStatus`]: 'FAILED',
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: 'FAILED',
            [`${section}.documents.$.currentUpload.ocrInfo.completedAt`]: completedAt,
          },
        },
      ),
    ]);

    this.logger.warn(`OCR failure written — uploadId=${uploadId} reason=${reason}`);
  }
}
