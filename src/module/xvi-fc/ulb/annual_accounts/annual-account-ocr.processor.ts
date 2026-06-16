import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job } from 'bullmq';
import { Model, Types } from 'mongoose';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { S3Service } from '../../../../core/s3/s3.service';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistoryDocument,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { AnnualAccountOcrApiService, OcrResultResponse, OcrSubmitJobDto, OcrBasicValidation } from './annual-account-ocr-api.service';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 10;

interface OcrCtx {
  uploadId: string;
  annualAccountId: string;
  section: string;
  docId: string;
}

@Processor(ANNUAL_ACCOUNT_PROCESSING_QUEUE, { concurrency: 2 })
export class AnnualAccountOcrProcessor extends WorkerHost {
  private readonly logger = new Logger(AnnualAccountOcrProcessor.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,

    @InjectModel(XviFcAnnualAccountUploadHistory.name)
    private readonly uploadHistoryModel: Model<XviFcAnnualAccountUploadHistoryDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    private readonly s3Service: S3Service,
    private readonly ocrApi: AnnualAccountOcrApiService,
  ) {
    super();
  }

  async process(job: Job<AnnualAccountOcrJobData>): Promise<void> {
    const { uploadId, annualAccountId, ulbId, section, docId, s3Key, expectedDocType, financialYear } = job.data;

    console.log(`[OCR Processor] ▶ START — uploadId=${uploadId} bullJobId=${job.id}`);

    await this.uploadHistoryModel.updateOne(
      { uploadId },
      { $set: { 'queue.bullJobId': String(job.id), 'queue.status': 'active', startedAt: new Date() } },
    );

    const ulb = await this.ulbModel.findById(new Types.ObjectId(ulbId)).select('name slug keywords').lean().exec();
    if (!ulb) throw new Error(`ULB not found: ${ulbId}`);
    const ulbName = `${ulb.name}|${ulb.slug}|${ulb.keywords ?? ''}`;

    console.log(`[OCR Processor] ⬇ Downloading PDF — key=${s3Key}`);
    const pdfBuffer = await this.s3Service.getPdfBufferFromS3(s3Key);

    const ocrJobData: OcrSubmitJobDto = {
      pdfBuffer,
      fileName: `${docId}-${uploadId}.pdf`,
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
    const ctx: OcrCtx = { uploadId, annualAccountId, section, docId };

    await Promise.all([
      this.uploadHistoryModel.updateOne(
        { uploadId },
        { $set: { 'ocrInfo.jobId': ocrJobId, 'ocrInfo.status': ocrResp.status, 'ocrInfo.submittedAt': submittedAt } },
      ),
      this.annualAccountModel.updateOne(
        { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.docId`]: docId },
        {
          $set: {
            [`${section}.documents.$.currentUpload.ocrInfo.jobId`]: ocrJobId,
            [`${section}.documents.$.currentUpload.ocrInfo.status`]: ocrResp.status,
            [`${section}.documents.$.currentUpload.ocrInfo.submittedAt`]: submittedAt,
          },
        },
      ),
    ]);

    let settled = false;
    for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusResp = await this.ocrApi.getJobStatus(ocrJobId);
      const statusNorm = statusResp.status?.toUpperCase();
      console.log(
        `[OCR Processor] poll ${attempt}/${MAX_POLLS} — status=${statusResp.status} (${statusNorm}) step=${statusResp.progress_step ?? '-'}`,
      );

      if (statusResp.progress_step) {
        await Promise.all([
          this.uploadHistoryModel.updateOne(
            { uploadId },
            { $set: { 'ocrInfo.status': statusNorm, 'ocrInfo.progressStep': statusResp.progress_step } },
          ),
          this.annualAccountModel.updateOne(
            { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.docId`]: docId },
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
        console.log(`[OCR Processor] ✅ COMPLETED — fetching /result for ocrJobId=${ocrJobId}`);
        const result = await this.ocrApi.getJobResult(ocrJobId);
        console.log(`[OCR Processor] /result response =`, JSON.stringify(result));
        await this.writeCompleted(ctx, result);
        settled = true;
        break;
      }

      if (statusNorm === 'FAILED') {
        await this.writeFailed(ctx, statusResp.message);
        settled = true;
        break;
      }
    }

    if (!settled) {
      this.logger.warn(`OCR not settled after ${MAX_POLLS} polls — cron fallback will pick it up — uploadId=${uploadId}`);
    }

    console.log(`[OCR Processor] ✅ DONE — uploadId=${uploadId} settled=${settled}`);
    this.logger.log(`OCR processor finished — uploadId=${uploadId} ocrJobId=${ocrJobId} settled=${settled}`);
  }

  private async writeCompleted(ctx: OcrCtx, resp: OcrResultResponse): Promise<void> {
    const { uploadId, annualAccountId, section, docId } = ctx;
    const completedAt = new Date();

    // Python nests validation inside result.basic_validation and uses "PASS"/"FAIL"
    const bv: OcrBasicValidation | undefined = resp.result?.basic_validation;
    const validationStatus = bv?.validation_status ?? null;
    const processingStatus = validationStatus?.toUpperCase() === 'PASS' ? 'PASSED' : 'FAILED';

    console.log(`[OCR Processor] ✔ writeCompleted — processingStatus=${processingStatus} validationStatus=${validationStatus}`);
    console.log(`[OCR Processor] basic_validation =`, JSON.stringify(bv));

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
        { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.docId`]: docId },
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

    this.logger.log(`OCR result written — uploadId=${uploadId} processingStatus=${processingStatus}`);
  }

  private async writeFailed(ctx: OcrCtx, reason?: string): Promise<void> {
    const { uploadId, annualAccountId, section, docId } = ctx;
    const completedAt = new Date();

    console.log(`[OCR Processor] ❌ FAILED — uploadId=${uploadId} reason=${reason}`);

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
        { _id: new Types.ObjectId(annualAccountId), [`${section}.documents.docId`]: docId },
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
