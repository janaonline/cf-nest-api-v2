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
import { AnnualAccountOcrApiService, OcrSubmitJobDto } from './annual-account-ocr-api.service';
import { AnnualAccountOcrResultWriter, OcrCtx } from './annual-account-ocr-result.writer';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';

const POLL_INTERVAL_MS = 5_000;
/** ~3 minutes — long enough for a large (hundreds of pages) PDF to settle here rather than wait
 *  for AnnualAccountStatusSyncService's next 5-minute cron tick. */
const MAX_POLLS = 36;

@Processor(ANNUAL_ACCOUNT_PROCESSING_QUEUE, { concurrency: 14 })
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
    private readonly resultWriter: AnnualAccountOcrResultWriter,
  ) {
    super();
  }

  async process(job: Job<AnnualAccountOcrJobData>): Promise<void> {
    const { uploadId, annualAccountId, ulbId, section, auditType, docId, s3Key, expectedDocType, financialYear } =
      job.data;

    console.log(`[OCR Processor] ▶ START — uploadId=${uploadId} bullJobId=${job.id}`);

    await this.uploadHistoryModel.updateOne(
      { uploadId },
      { $set: { 'queue.bullJobId': String(job.id), 'queue.status': 'active', startedAt: new Date() } },
    );

    const ulb = await this.ulbModel
      .findById(new Types.ObjectId(ulbId))
      .select('name slug keywords state')
      .populate<{ state: { name: string } | null }>('state', 'name')
      .lean()
      .exec();
    if (!ulb) throw new Error(`ULB not found: ${ulbId}`);
    const ulbName = `${ulb.name}|${ulb.slug}|${ulb.keywords ?? ''}`;
    const stateName = ulb.state?.name ?? '';

    console.log(`[OCR Processor] ⬇ Downloading PDF — key=${s3Key}`);
    const pdfBuffer = await this.s3Service.getPdfBufferFromS3(s3Key);

    const ocrJobData: OcrSubmitJobDto = {
      pdfBuffer,
      fileName: `${docId}-${uploadId}.pdf`,
      docType: expectedDocType,
      ulbName,
      uploadId,
      financialYear,
      auditType,
      state: stateName,
    };

    console.log(`[OCR Processor] ⬆ Submitting to OCR API — docType=${expectedDocType}`);
    const ocrResp = await this.ocrApi.submitJob(ocrJobData);
    const ocrJobId = ocrResp.job_id;
    console.log(`[OCR Processor] ✔ ocrJobId=${ocrJobId} status=${ocrResp.status}`);

    const submittedAt = new Date();
    const targetDocId = await this.resultWriter.resolveTargetDocId(annualAccountId, section);
    const ctx: OcrCtx = { uploadId, targetDocId, docId };

    await Promise.all([
      this.uploadHistoryModel.updateOne(
        { uploadId },
        { $set: { 'ocrInfo.jobId': ocrJobId, 'ocrInfo.status': ocrResp.status, 'ocrInfo.submittedAt': submittedAt } },
      ),
      this.annualAccountModel.updateOne(
        { _id: targetDocId, 'documents.docId': docId },
        {
          $set: {
            'documents.$.currentUpload.ocrInfo.jobId': ocrJobId,
            'documents.$.currentUpload.ocrInfo.status': ocrResp.status,
            'documents.$.currentUpload.ocrInfo.submittedAt': submittedAt,
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
        await this.resultWriter.writeProgress(ctx, statusNorm, statusResp.progress_step);
      }

      if (statusNorm === 'COMPLETED') {
        console.log(`[OCR Processor] ✅ COMPLETED — fetching /result for ocrJobId=${ocrJobId}`);
        const result = await this.ocrApi.getJobResult(ocrJobId);
        console.log(`[OCR Processor] /result response =`, JSON.stringify(result));
        await this.resultWriter.writeCompleted(ctx, result);
        settled = true;
        break;
      }

      if (statusNorm === 'FAILED') {
        await this.resultWriter.writeFailed(ctx, statusResp.message);
        settled = true;
        break;
      }
    }

    if (!settled) {
      this.logger.warn(
        `OCR not settled after ${MAX_POLLS} polls — cron fallback will pick it up — uploadId=${uploadId}`,
      );
    }

    console.log(`[OCR Processor] ✅ DONE — uploadId=${uploadId} settled=${settled}`);
    this.logger.log(`OCR processor finished — uploadId=${uploadId} ocrJobId=${ocrJobId} settled=${settled}`);
  }
}
