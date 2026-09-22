import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job } from 'bullmq';
import { Model, Types } from 'mongoose';
import { DUR_VALIDATION_QUEUE } from 'src/core/constants/queues';
import { S3Service } from 'src/core/s3/s3.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { XviFcDur, XviFcDurDocument } from 'src/schemas/xvi-fc/dur.schema';
import { DurValidationApiService } from './dur-validation-api.service';
import { DurValidationResultWriter } from './dur-validation-result-writer.service';
import type { DurValidationJobData } from './dto/dur-validation-job.dto';
import { DUR_DOC_ID_TO_GRANT_TYPE } from './constants/dur-form.constants';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 10;

/**
 * Own bounded poll loop (~50s) for the common case where the validation job settles quickly —
 * see the captured real-world example (~9s). A job that outlives this loop is NOT lost: it's
 * picked up by DurStatusSyncService's cron fallback (mirrors Annual Account's own
 * processor+cron-fallback split), which shares this processor's exact PASS/FAIL interpretation
 * via DurValidationResultWriter rather than re-deriving it.
 */
@Processor(DUR_VALIDATION_QUEUE, { concurrency: 14 })
export class DurValidationProcessor extends WorkerHost {
  private readonly logger = new Logger(DurValidationProcessor.name);

  constructor(
    @InjectModel(XviFcDur.name)
    private readonly durModel: Model<XviFcDurDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    private readonly s3Service: S3Service,
    private readonly durApi: DurValidationApiService,
    private readonly resultWriter: DurValidationResultWriter,
  ) {
    super();
  }

  async process(job: Job<DurValidationJobData>): Promise<void> {
    const { uploadId, durId, ulbId, docId, s3Key, financialYear } = job.data;
    this.logger.log(`[DUR Processor] START — uploadId=${uploadId} bullJobId=${job.id}`);

    const ulb = await this.ulbModel.findById(new Types.ObjectId(ulbId)).select('name slug').lean().exec();
    if (!ulb) throw new Error(`ULB not found: ${ulbId}`);
    const ulbName = `${ulb.name}|${ulb.slug}`;

    // Everything from here on talks to the external validation service, which has been observed
    // to hang indefinitely with no error (see DUR_VALIDATION_API_TIMEOUT_MS's own doc comment) —
    // any failure in this block, timeout included, must resolve the document to FAILED rather
    // than leaving it stuck PROCESSING forever with no path to recovery. Deliberately doesn't
    // re-throw: BullMQ would otherwise retry a call that's very likely to hang the same way again,
    // just delaying the ULB's "Retry"/"Request Manual Review" options further.
    try {
      const pdfBuffer = await this.s3Service.getPdfBufferFromS3(s3Key);

      const submitResp = await this.durApi.submitJob({
        pdfBuffer,
        fileName: `${docId}-${uploadId}.pdf`,
        ulbName,
        financialYear,
        grantType: DUR_DOC_ID_TO_GRANT_TYPE[docId],
      });
      const jobId = submitResp.job_id;
      const submittedAt = new Date();

      await this.durModel.updateOne(
        { _id: new Types.ObjectId(durId), 'documents.docId': docId },
        {
          $set: {
            'documents.$.currentUpload.ocrInfo.jobId': jobId,
            'documents.$.currentUpload.ocrInfo.status': submitResp.status,
            'documents.$.currentUpload.ocrInfo.submittedAt': submittedAt,
          },
        },
      );

      let settled = false;
      for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const statusResp = await this.durApi.getJobStatus(jobId);
        const statusNorm = statusResp.status?.toLowerCase();
        this.logger.log(`[DUR Processor] poll ${attempt}/${MAX_POLLS} — status=${statusResp.status} step=${statusResp.progress_step ?? '-'}`);

        if (statusResp.progress_step) {
          await this.durModel.updateOne(
            { _id: new Types.ObjectId(durId), 'documents.docId': docId },
            {
              $set: {
                'documents.$.currentUpload.ocrInfo.status': statusNorm,
                'documents.$.currentUpload.ocrInfo.progressStep': statusResp.progress_step,
              },
            },
          );
        }

        if (statusNorm === 'completed') {
          const result = await this.durApi.getJobResult(jobId);
          await this.resultWriter.writeCompleted(durId, docId, result);
          settled = true;
          break;
        }

        if (statusNorm === 'failed') {
          await this.resultWriter.writeFailed(durId, docId, statusResp.error_message ?? statusResp.message);
          settled = true;
          break;
        }
      }

      if (!settled) {
        this.logger.warn(
          `[DUR Processor] not settled after ${MAX_POLLS} polls — uploadId=${uploadId} — cron fallback will pick it up`,
        );
      }
    } catch (err) {
      this.logger.error(`[DUR Processor] validation call failed — uploadId=${uploadId}`, err);
      await this.resultWriter.writeFailed(durId, docId, this.describeError(err));
    }
  }

  private describeError(err: unknown): string {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return 'The validation service did not respond in time. Please try again.';
    }
    return 'Failed to validate this document. Please try again.';
  }
}
