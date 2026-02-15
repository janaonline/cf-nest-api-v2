import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { AFS_AUDITORS_REPORT_QUEUE } from 'src/core/constants/queues';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsAuditorsReport, AfsAuditorsReportDocument } from 'src/schemas/afs/afs-auditors-report';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric, AfsMetricDocument } from 'src/schemas/afs/afs-metrics.schema';
import { QueueStatus } from 'src/schemas/queue.schema';
import { v4 as uuidv4 } from 'uuid';
import { DigitizationJobDto, DigitizationUploadedBy } from '../../dto/digitization-job.dto';
import * as path from 'path';
import { DigitizationResponse } from '../digitization-queue/digitization-queue.service';
import { firstValueFrom, map } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import FormData from 'form-data';

@Injectable()
export class AuditorsReportOcrQueueService {
  logger = new Logger(AuditorsReportOcrQueueService.name);

  constructor(
    // @InjectQueue(AFS_DIGITIZATION_QUEUE)
    // private readonly digitizationQueue: Queue<DigitizationJobDto>,
    @InjectQueue(AFS_AUDITORS_REPORT_QUEUE)
    private readonly arQueue: Queue<DigitizationJobDto>,
    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,
    @InjectModel(AfsAuditorsReport.name)
    private readonly afsAuditorsReportModel: Model<AfsAuditorsReportDocument>,
    @InjectModel(AfsMetric.name)
    private readonly afsMetricModel: Model<AfsMetricDocument>,
    private readonly s3Service: S3Service,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  // digitization.service.ts (as before)
  async enqueueBatch(jobs: DigitizationJobDto[]) {
    // add BullMQ job with jobs as payload
    this.logger.log(`Enqueuing batch of ${jobs.length} digitization jobs`);

    for (const job of jobs) {
      await this.upsertAfsAR(job, true);
    }
    // this.logger.log(`Prepared ${queues.length} jobs for enqueuing.`, queues);

    // await this.digitizationQueue.addBulk(queues);

    return { queuedJobs: jobs.length };
  }

  async handleAuditorsReportOcrJob(job: DigitizationJobDto) {
    try {
      const digitizeResp = await this.callDigitizationApi(job);

      this.logger.log(`Digitization job for ${job.pdfUrl} completed with status `, digitizeResp);

      // copy digitized excel to our S3 bucket
      if (digitizeResp.S3_Excel_Storage_Link) {
        job.digitizedExcelUrl = await this.copyDigitizedExcel(job, digitizeResp.S3_Excel_Storage_Link);
      }
      await this.markJobCompleted(job, digitizeResp);
    } catch (error) {
      // this.logger.error(`Error processing digitization : `, error);
      this.logger.error(
        `Error processing digitization :`,
        error instanceof Error ? { message: error.message, stack: error.stack } : {},
      );
      throw error;
      // mark job as failed in DB
      // await this.markJobFailed(job, error);
    }

    // 4. TODO: Save S3_Excel_Storage_Link, request_id, metrics in your DB
    //    - You can inject a repository/service here and persist:
    //      respData.S3_Excel_Storage_Link, respData.request_id, etc.
  }

  async copyDigitizedExcel(job: DigitizationJobDto, sourceUrl: string): Promise<string> {
    try {
      this.logger.log(`Copying digitized excel from ${sourceUrl} for job: ${job.pdfUrl}`);
      const buffer = await this.s3Service.getBuffer(sourceUrl);
      const destKey = `digitized_excels/${job.requestId}.xlsx`;
      await this.s3Service.uploadPublic(
        destKey,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const publicUrl = this.s3Service.getPublicUrl(destKey);
      this.logger.log(`Successfully copied digitized excel to ${publicUrl} for job: ${job.pdfUrl}`);
      return publicUrl;
    } catch (error) {
      this.logger.error(
        `Error copying digitized excel for job: ${job.pdfUrl}`,
        error instanceof Error ? { message: error.message, stack: error.stack } : {},
      );
      throw error;
    }
  }

  async markJobCompleted(job: DigitizationJobDto, digitizationResp: DigitizationResponse) {
    try {
      await this.afsAuditorsReportModel.updateOne(
        {
          ulb: new Types.ObjectId(job.ulb),
          year: new Types.ObjectId(job.year),
          auditType: job.auditType,
          docType: job.docType,
        },
        {
          $set: {
            afsFile: {
              pdfUrl: job.pdfUrl,
              excelUrl: job.digitizedExcelUrl || '',
              digitizationStatus: 'completed',
              overallConfidenceScore: digitizationResp.overall_confidence_score,
              digitizationMsg: digitizationResp.message,
              totalProcessingTimeMs: digitizationResp.total_processing_time_ms,
              requestId: job.requestId || '',
              uploadedBy: job.uploadedBy,
            },
          },
        },
        { upsert: true },
      );
      this.logger.log(`Marked job as completed in DB for ${job.pdfUrl}`);
    } catch (error) {
      this.logger.error(`Error marking job as completed in DB for ${job.pdfUrl}`, error);
    }
  }

  async getFormDataForDigitization(job: DigitizationJobDto): Promise<FormData> {
    try {
      this.logger.log(`Fetching S3 object for digitization: ${job.pdfUrl}`);
      // const buffer = await this.s3Service.getBuffer(job.pdfUrl);
      const buffer = await this.s3Service.getPdfBufferFromS3(job.pdfUrl);
      job.noOfPages = this.s3Service.getPdfPageCountFromBuffer(buffer);
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: path.basename(job.pdfUrl),
        //   contentType: 'application/pdf',
      });
      formData.append('Document_type_ID', job.docType || 'bal_sheet');
      formData.append('request_id', job.requestId);
      this.logger.log(`Prepared form data for digitization API for job: ${job.pdfUrl}, requestId: ${job.requestId}`);
      return formData;
    } catch (error: any) {
      this.logger.error(`Error fetching S3 object for digitization: ${job.pdfUrl}`);
      throw error;
    }
  }

  async callDigitizationApi(job: DigitizationJobDto): Promise<DigitizationResponse> {
    this.logger.log(`Calling digitization API for job: ${job.pdfUrl}`);
    try {
      const formData = await this.getFormDataForDigitization(job);
      return await firstValueFrom(
        this.http
          .post(this.config.get('DIGITIZATION_API_URL') + 'AFS_Digitization', formData, {
            headers: formData.getHeaders(),
          })
          .pipe(map((resp) => resp.data as DigitizationResponse)),
      );
    } catch (error: any) {
      // const err = error as AxiosError<any>;

      const n = this.normalizeError(error);

      // Build a safe failure payload for markJobFailed (prefer response.data when present)
      const err = error as AxiosError<any>;
      const failurePayload = err?.response?.data ?? ({ message: n.message, status: (n as any).status } as any);

      // this.logger.error(`Error:`, error);
      this.logger.error(`Error calling digitization API:`, failurePayload);

      await this.markJobFailed(job, failurePayload as DigitizationResponse);
      // await this.markJobFailed(job, (err.response?.data || error) as DigitizationResponse);
      // For BullMQ retries:
      throw failurePayload;
    }
  }

  async markJobFailed(job: DigitizationJobDto, responseData: DigitizationResponse) {
    try {
      await this.afsAuditorsReportModel.updateOne(
        {
          ulb: new Types.ObjectId(job.ulb),
          year: new Types.ObjectId(job.year),
          auditType: job.auditType,
          docType: job.docType,
        },
        {
          $set: {
            afsFile: {
              pdfUrl: job.pdfUrl,
              digitizationStatus: 'failed',
              digitizationMsg: responseData.message || 'Digitization failed',
              overallConfidenceScore: responseData.overall_confidence_score || 0,
              totalProcessingTimeMs: responseData.total_processing_time_ms || 0,
              requestId: job.requestId || '',
              uploadedBy: job.uploadedBy,
            },
          },
        },
        { upsert: true },
      );
      this.logger.log(`Marked job as failed in DB for ${job.pdfUrl}`);
    } catch (error) {
      this.logger.error(`Error marking job as failed in DB for ${job.pdfUrl}`, error);
    }
  }

  normalizeError(err: unknown) {
    if (err instanceof Error) {
      return { message: err.message, stack: err.stack };
    }
    if (typeof err === 'object' && err !== null) {
      return JSON.parse(JSON.stringify(err));
    }
    return {
      message: String(err),
      // status: (err as any).status || 'unknown',
    };
  }

  // async removeFromBatch(jobs: DigitizationJobDto[]) {
  //   for (const job of jobs) {
  //     await this.handleJobRemoval(job);
  //   }
  //   return { queuedJobs: jobs.length };
  // }
  // async handleJobRemoval(job: DigitizationJobDto) {
  //   try {
  //     await this.markJobRemoved(job);
  //   } catch (error) {
  //     this.logger.error(`Error marking job as removed: `);
  //     throw error;
  //   }
  // }

  /**
   * insert or update AfsAuditorsReport with the given job data. If isQueue is true, also add to BullMQ queue and update metrics.
   * @param job
   * @param isQueue
   * @returns
   */
  async upsertAfsAR(job: DigitizationJobDto, isQueue: boolean = false) {
    let queue: { jobId: string } | undefined = undefined;
    // job.requestId = uuidv4(); // generate a unique request ID for tracking
    job.requestId = `req-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${uuidv4().substring(0, 6)}`;

    job.noOfPages = this.s3Service.getPdfPageCountFromBuffer(await this.s3Service.getPdfBufferFromS3(job.pdfUrl));

    // mongoose.set('debug', true);
    if (isQueue) {
      const jobRes = await this.arQueue.add(`ocr-job-${job.ulb}-${job.year}-${job.docType}`, job);
      // this.logger.log(`Enqueued job `, res.id);

      queue = {
        jobId: jobRes.id || '',
      };
      const metrics = {
        queuedFiles: 1,
        queuedPages: job.noOfPages || 0,
      };
      await this.updateAfsMetrics(metrics, '');
    }
    // mongoose.set('debug', true);
    const filter = {
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    };

    const filePath = job.uploadedBy === DigitizationUploadedBy.ULB ? 'ulbFile' : 'afsFile';

    // Build the embedded object (store only what you need)
    const embedded = {
      requestId: job.requestId,
      uploadedBy: job.uploadedBy,
      pdfUrl: job.pdfUrl,
      digitizationStatus: isQueue ? QueueStatus.QUEUED : QueueStatus.NOT_STARTED,
      data: [],
      queue,
      noOfPages: job.noOfPages || 0,
    };

    const update = {
      $setOnInsert: {
        annualAccountsId: new Types.ObjectId(job.annualAccountsId),
        ...filter,
      },
      $set: {
        [filePath]: embedded,
      },
    };

    return this.afsAuditorsReportModel.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  }

  async markJobRemoved(job: DigitizationJobDto) {
    // const jobId = job.jobId;
    if (!job.jobId) {
      throw new BadRequestException('Job ID is required to remove a job from the queue.');
    }
    await this.removeJob(job.jobId);
    const filePath = job.uploadedBy === DigitizationUploadedBy.ULB ? 'ulbFile' : 'afsFile';
    return await this.updateAfsExcelFile(job, {
      [`${filePath}.digitizationStatus`]: 'not-digitized',
      [`${filePath}.queue.status`]: 'removed',
      [`${filePath}.queue.finishedAt`]: new Date(),
    });
  }

  async removeJob(jobId: string): Promise<{ message: string }> {
    const job = await this.arQueue.getJob(jobId); // Retrieve the job instance
    let message = `Job with ID ${jobId} not found.`;
    if (job) {
      await job.remove(); // Call the remove method on the job instance
      message = `Job with ID ${jobId} removed from queue.`;
    }
    return { message };
  }

  async updateAfsExcelFile(job: DigitizationJobDto, updateData: Partial<AfsExcelFile>) {
    // mongoose.set('debug', true);
    const filter = {
      // annualAccountsId: new Types.ObjectId(params.annualAccountsId),
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    };
    return await this.afsExcelFileModel.updateOne(filter, { $set: updateData }, { runValidators: true });
  }

  async updateAfsMetrics(metrics: Partial<AfsMetricDocument>, doctType: string = 'all') {
    metrics.queuedFiles = !metrics.queuedFiles
      ? -(metrics.digitizedFiles || metrics.failedFiles || 0)
      : metrics.queuedFiles;
    metrics.queuedPages = !metrics.queuedPages
      ? -(metrics.digitizedPages || metrics.failedPages || 0)
      : metrics.queuedPages;
    this.logger.log('Updating AFS metrics with: ', metrics);
    await this.afsMetricModel.updateOne({}, { $inc: metrics }, { runValidators: true });
  }
}
