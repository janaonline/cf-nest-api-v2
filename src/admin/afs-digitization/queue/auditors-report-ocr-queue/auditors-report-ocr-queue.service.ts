import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import mongoose, { Model, Types } from 'mongoose';
import { AFS_AUDITORS_REPORT_QUEUE } from 'src/core/constants/queues';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsAuditorsReport, AfsAuditorsReportDocument } from 'src/schemas/afs/afs-auditors-report.schema';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric, AfsMetricDocument } from 'src/schemas/afs/afs-metrics.schema';
import { QueueStatus } from 'src/schemas/queue.schema';
import { v4 as uuidv4 } from 'uuid';
import { DigitizationJobDto, DigitizationUploadedBy } from '../../dto/digitization-job.dto';
import * as path from 'path';
import { firstValueFrom, map } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import FormData from 'form-data';
import { YearIdToLabel } from 'src/core/constants/years';

export interface DigitizationResponse {
  data: {
    ocr_extraction?: {
      ocr_text_key?: string;
    };
  };
  digitizedFileUrl?: string; // new field to track the S3 location of the digitized OCR text
  overall_confidence_score: number;
  total_processing_time_ms: number;
  request_id: string;
  message: string;
}

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

      if (!digitizeResp?.data?.ocr_extraction?.ocr_text_key) {
        this.logger.warn(
          `OCR text key not found in digitization response for job ${job.pdfUrl}. Response: `,
          digitizeResp,
        );
        throw new BadRequestException('OCR text key not found in digitization response');
      }

      const ocrTxtUrl: string = digitizeResp?.data?.ocr_extraction?.ocr_text_key;

      // copy digitized ocr to our S3 bucket
      if (ocrTxtUrl) {
        job.digitizedFileUrl = await this.copyDigitizedUrl(job, ocrTxtUrl);
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

  async getFormDataForDigitization(job: DigitizationJobDto): Promise<FormData> {
    try {
      this.logger.log(`Fetching S3 object for digitization: ${job.pdfUrl}`);
      const buffer = await this.s3Service.getPdfBufferFromS3(job.pdfUrl);
      job.noOfPages = this.s3Service.getPdfPageCountFromBuffer(buffer);
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: path.basename(job.pdfUrl),
        contentType: 'application/pdf',
      });
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
          .post(this.config.get('DIGITIZATION_API_URL') + 'documents/upload', formData, {
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

  async copyDigitizedUrl(job: DigitizationJobDto, sourceUrl: string): Promise<string> {
    this.logger.log(`Copying digitized URL for job: ${job.pdfUrl}`);
    const filename = path.basename(sourceUrl);
    // Get original extension
    const ext = path.extname(filename) || '.txt'; // default to .txt
    const sourceBucket: string = this.config.get('AWS_DIGITIZATION_BUCKET_NAME') || 'cf-digitization-dev';
    const yearLabel = YearIdToLabel[job.year] || job.year;
    const uniqueTime = new Date().getTime();
    const destinationKey = `afs/${job.docType}/${job.ulb}_${yearLabel}_${job.auditType}_${job.docType}_${uniqueTime}${ext}`;
    await this.s3Service.copyFileBetweenBuckets(
      `${sourceBucket}/${sourceUrl}`, // source key including bucket path
      destinationKey,
    );
    return destinationKey;
  }

  async markJobCompleted(job: DigitizationJobDto, digitizationResp: DigitizationResponse) {
    // mongoose.set('debug', true);
    const filePath = job.uploadedBy === DigitizationUploadedBy.ULB ? 'ulbFile' : 'afsFile';
    let parsedData: any[] = [];
    let digitizationStatus = 'failed';
    if (job.digitizedFileUrl) {
      digitizationStatus = 'digitized';
    }

    // Update AFS metrics
    const metrics = {
      digitizedFiles: 1,
      digitizedPages: job.noOfPages || 0,
      // queuedFiles: -1,
      // queuedPages: -(job.noOfPages || 0),
    };
    await this.updateAfsMetrics(metrics);

    if (digitizationResp.data.ocr_extraction) {
      digitizationResp.data.ocr_extraction.ocr_text_key = job.digitizedFileUrl || ''; // update to new S3 location
    }

    // const updateData = {
    //   [`${filePath}.digitizedFileUrl`]: job.digitizedFileUrl || '',
    //   digitizationStatus,
    //   // digitizationStatus: isQueue ? QueueStatus.QUEUED : QueueStatus.NOT_STARTED,
    //   data: digitizationResp.data,
    //   queue: {
    //     jobId: job.jobId,
    //     status: 'completed',
    //     progress: 100,
    //     finishedAt: new Date(),
    //   },
    //   overallConfidenceScore: digitizationResp.overall_confidence_score,
    //   totalProcessingTimeMs: digitizationResp.total_processing_time_ms,
    //   // digitizationMsg: digitizationResp.message,
    //   // noOfPages: job.noOfPages || 0,
    // };
    // this.logger.log('Parsed data rows count:', job, filter);
    return await this.updateAfsAR(job, {
      [`${filePath}.digitizationStatus`]: digitizationStatus,
      // [`${filePath}.noOfPages`]: job.noOfPages,
      [`${filePath}.data`]: digitizationResp.data,
      [`${filePath}.digitizedFileUrl`]: job.digitizedFileUrl || '',
      // [`${filePath}.overallConfidenceScore`]: digitizationResp.overall_confidence_score,
      // [`${filePath}.totalProcessingTimeMs`]: digitizationResp.total_processing_time_ms,
      // [`${filePath}.digitizationMsg`]: digitizationResp.message,
      [`${filePath}.queue.status`]: 'completed',
      [`${filePath}.queue.progress`]: 100,
      [`${filePath}.queue.finishedAt`]: new Date(),
    });
  }

  async markJobFailed(job: DigitizationJobDto, responseData: DigitizationResponse) {
    const filePath = job.uploadedBy === DigitizationUploadedBy.ULB ? 'ulbFile' : 'afsFile';

    // Update AFS metrics
    const metrics = {
      failedFiles: 1,
      failedPages: job.noOfPages || 0,
      // queuedFiles: -1,
      // queuedPages: -(job.noOfPages || 0),
    };
    await this.updateAfsMetrics(metrics);
    const embededData = {
      totalProcessingTimeMs: responseData?.total_processing_time_ms,
      // [`${filePath}.digitizationMsg`]: responseData.message,
      digitizationStatus: 'failed',
      'queue.status': 'failed',
      'queue.progress': 100,
      'queue.finishedOn': new Date(),
      'queue.failedReason': responseData?.message,
    };
    return await this.updateAfsAR(job, {
      // [`${filePath}.requestId`]: responseData?.request_id,
      [`${filePath}.totalProcessingTimeMs`]: responseData?.total_processing_time_ms,
      // [`${filePath}.digitizationMsg`]: responseData.message,
      [`${filePath}.digitizationStatus`]: 'failed',
      [`${filePath}.queue.status`]: 'failed',
      [`${filePath}.queue.progress`]: 100,
      [`${filePath}.queue.finishedOn`]: new Date(),
      [`${filePath}.queue.failedReason`]: responseData?.message,
    });
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
    try {
      // mongoose.set('debug', true);
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
        data: {},
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
    } catch (error) {
      this.logger.error(`Error upserting AfsAuditorsReport for job: ${job.pdfUrl}`, error);
      throw error;
    }
  }

  async markJobRemoved(job: DigitizationJobDto) {
    // const jobId = job.jobId;
    if (!job.jobId) {
      throw new BadRequestException('Job ID is required to remove a job from the queue.');
    }
    await this.removeJob(job.jobId);
    const filePath = job.uploadedBy === DigitizationUploadedBy.ULB ? 'ulbFile' : 'afsFile';
    return await this.updateAfsAR(job, {
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

  async updateAfsAR(job: DigitizationJobDto, updateData: Partial<AfsAuditorsReport>) {
    // mongoose.set('debug', true);
    const filter = {
      // annualAccountsId: new Types.ObjectId(params.annualAccountsId),
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    };
    return await this.afsAuditorsReportModel.updateOne(filter, { $set: updateData }, { runValidators: true });
  }

  async updateAfsMetrics(metrics: Partial<AfsMetricDocument>, docType: string = 'auditor_report') {
    metrics.queuedFiles = !metrics.queuedFiles
      ? -(metrics.digitizedFiles || metrics.failedFiles || 0)
      : metrics.queuedFiles;
    metrics.queuedPages = !metrics.queuedPages
      ? -(metrics.digitizedPages || metrics.failedPages || 0)
      : metrics.queuedPages;
    this.logger.log('Updating AFS metrics with: ', metrics);
    await this.afsMetricModel.updateOne({ docType }, { $inc: metrics }, { runValidators: true });
  }
}
