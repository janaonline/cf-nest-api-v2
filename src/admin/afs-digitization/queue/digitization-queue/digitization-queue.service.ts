import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AxiosError } from 'axios';
import { Queue } from 'bullmq';
import FormData from 'form-data';
import { Model, Types } from 'mongoose';
import * as path from 'path';
import { firstValueFrom, map } from 'rxjs';
import { YearIdToLabel } from 'src/core/constants/years';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric, AfsMetricDocument } from 'src/schemas/afs/afs-metrics.schema';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { DigitizationJobDto, DigitizationUploadedBy } from '../../dto/digitization-job.dto';
import { AFS_DIGITIZATION_QUEUE } from 'src/core/constants/queues';
import { QueueStatus } from 'src/schemas/queue.schema';

export interface DigitizationResponse {
  request_id: string;
  status: string;
  message: string;
  processing_mode: string;
  S3_Excel_Storage_Link: string;
  total_processing_time_ms?: number;
  error_code: string | null;
  overall_confidence_score: number;
  status_code: number;
}

//  data: {
// 7|dev-cf-nest-api-v2  |       request_id: 'req-20251222-593af9',
// 7|dev-cf-nest-api-v2  |       status: 'error',
// 7|dev-cf-nest-api-v2  |       message: 'An error occurred during confidence scoring. Please try again, and if it persists, contact support.',
// 7|dev-cf-nest-api-v2  |       processing_mode: 'direct',
// 7|dev-cf-nest-api-v2  |       S3_Excel_Storage_Link: null,
// 7|dev-cf-nest-api-v2  |       total_processing_time_ms: 114844,
// 7|dev-cf-nest-api-v2  |       error_code: 'DOC_016',
// 7|dev-cf-nest-api-v2  |       overall_confidence_score: null,
// 7|dev-cf-nest-api-v2  |       status_code: '500'
// 7|dev-cf-nest-api-v2  |     }

// sample respData:
//   request_id: 'req-20251209-80ea34',
//   status: 'success',
//   message: 'Document processing completed successfully',
//   processing_mode: 'direct',
//   S3_Excel_Storage_Link: 'https://cf-digitization-dev.s3.amazonaws.com/excel-output/default_user/default_session/document.xlsx?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAYMBHWUBN5KGTKY2E%2F20251209%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20251209T104427Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=17cb39415d6e321266aa6e6797a9a6bd5d35ced5a76f5d9890ca3241dfec897e',
//   total_processing_time_ms: 90117,
//   error_code: null,
//   overall_confidence_score: 98.67,
//   status_code: 200
// }

@Injectable()
export class DigitizationQueueService {
  private readonly logger = new Logger(DigitizationQueueService.name);

  constructor(
    @InjectQueue(AFS_DIGITIZATION_QUEUE)
    private readonly digitizationQueue: Queue<DigitizationJobDto>,
    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,
    @InjectModel(AfsMetric.name)
    private readonly afsMetricModel: Model<AfsMetricDocument>,
    private readonly http: HttpService,
    private readonly s3Service: S3Service,
    private readonly config: ConfigService,
  ) {}

  async jobStatus(id: string) {
    const job = await this.digitizationQueue.getJob(id);
    if (!job) return { status: 'not_found' };

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    const progress = job.progress || 0;

    if (state === 'completed') {
      // const result = (await job.returnvalue) as ZipJobResult & { url: string };
      return {
        status: 'completed',
        progress: 100,
        data: job.data,
        // , result
      };
    }

    if (state === 'failed') {
      return { status: 'failed', progress, reason: job.failedReason, data: job.data };
    }

    return { status: state, progress };
  }

  // digitization.service.ts (as before)
  async enqueueBatch(jobs: DigitizationJobDto[]) {
    // add BullMQ job with jobs as payload
    this.logger.log(`Enqueuing batch of ${jobs.length} digitization jobs`);

    for (const job of jobs) {
      await this.upsertAfsExcelFile(job, true);
    }
    // this.logger.log(`Prepared ${queues.length} jobs for enqueuing.`, queues);

    // await this.digitizationQueue.addBulk(queues);

    return { queuedJobs: jobs.length };
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
    const job = await this.digitizationQueue.getJob(jobId); // Retrieve the job instance
    let message = `Job with ID ${jobId} not found.`;
    if (job) {
      await job.remove(); // Call the remove method on the job instance
      message = `Job with ID ${jobId} removed from queue.`;
    }
    return { message };
  }

  async upsertAfsExcelFile(job: DigitizationJobDto, isQueue: boolean = false) {
    let queue: { jobId: string } | undefined = undefined;
    // job.requestId = uuidv4(); // generate a unique request ID for tracking
    job.requestId = `req-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${uuidv4().substring(0, 6)}`;

    job.noOfPages = this.s3Service.getPdfPageCountFromBuffer(await this.s3Service.getPdfBufferFromS3(job.pdfUrl));
    // mongoose.set('debug', true);
    if (isQueue) {
      const jobRes = await this.digitizationQueue.add(`digitization-job-${job.ulb}-${job.year}-${job.docType}`, job);
      // this.logger.log(`Enqueued job `, res.id);

      queue = {
        jobId: jobRes.id || '',
      };
      const metrics = {
        queuedFiles: 1,
        queuedPages: job.noOfPages || 0,
      };
      await this.updateAfsMetrics(metrics);
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

    return this.afsExcelFileModel.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
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

  async updateAfsMetrics(metrics: Partial<AfsMetricDocument>, docType: string = 'all') {
    // const metrics = {
    //   digitizedFiles: 0,
    //   digitizedPages: 0,

    //   failedFiles: 0,
    //   failedPages: 0,

    //   queuedFiles: 0,
    //   queuedPages: 0,
    // };
    metrics.queuedFiles = !metrics.queuedFiles
      ? -(metrics.digitizedFiles || metrics.failedFiles || 0)
      : metrics.queuedFiles;
    metrics.queuedPages = !metrics.queuedPages
      ? -(metrics.digitizedPages || metrics.failedPages || 0)
      : metrics.queuedPages;
    this.logger.log('Updating AFS metrics with: ', metrics);
    await this.afsMetricModel.updateOne({ docType }, { $inc: metrics }, { runValidators: true });
  }

  async markJobCompleted(job: DigitizationJobDto, digitizationResp: DigitizationResponse) {
    // mongoose.set('debug', true);
    const filePath = job.uploadedBy === DigitizationUploadedBy.ULB ? 'ulbFile' : 'afsFile';
    let parsedData: any[] = [];
    let digitizationStatus = 'failed';
    if (job.digitizedExcelUrl) {
      parsedData = await this.readDataFromExcelBuffer(job.digitizedExcelUrl);
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

    // this.logger.log('Parsed data rows count:', job, filter);
    return await this.updateAfsExcelFile(job, {
      [`${filePath}.digitizationStatus`]: digitizationStatus,
      [`${filePath}.noOfPages`]: job.noOfPages,
      [`${filePath}.data`]: parsedData,
      [`${filePath}.excelUrl`]: job.digitizedExcelUrl || '',
      // [`${filePath}.requestId`]: digitizationResp.request_id,
      [`${filePath}.overallConfidenceScore`]: digitizationResp.overall_confidence_score,
      [`${filePath}.totalProcessingTimeMs`]: digitizationResp.total_processing_time_ms,
      // [`${filePath}.digitizationMsg`]: digitizationResp.message,
      // [`${filePath}.queue.jobId`]: job.jobId,
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

    return await this.updateAfsExcelFile(job, {
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

  async handleDigitizationJob(job: DigitizationJobDto) {
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

  getFilenameFromUrl(url: string): string {
    const pathname = new URL(url).pathname;
    return pathname.substring(pathname.lastIndexOf('/') + 1);
  }

  async copyDigitizedExcel(job: DigitizationJobDto, sourceUrl: string): Promise<string> {
    this.logger.log(`Copying digitized Excel for job: ${job.pdfUrl}`);
    const filename = this.getFilenameFromUrl(sourceUrl);
    // Get original extension
    const ext = path.extname(filename) || '.xlsx'; // default to .xlsx
    const sourceBucket: string = this.config.get('AWS_DIGITIZATION_BUCKET_NAME') || 'cf-digitization-dev';
    const yearLabel = YearIdToLabel[job.year] || job.year;
    const uniqueTime = new Date().getTime();
    const destinationKey = `afs/${job.ulb}_${yearLabel}_${job.auditType}_${job.docType}_${uniqueTime}${ext}`;
    await this.s3Service.copyFileBetweenBuckets(
      `${sourceBucket}/excel-output/default_user/default_session/${filename}`, // source key including bucket path
      destinationKey,
    );
    return destinationKey;
  }

  async readDataFromExcelBuffer(url: string) {
    this.logger.log('Reading Excel from S3 URL:', url);

    const buffer: Buffer = await this.s3Service.getBuffer(url);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheetData: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
    });

    if (!sheetData || sheetData.length === 0) {
      throw new Error('Excel file is empty or invalid.');
    }

    // keywords to detect header rows
    const headerKeywords = ['Row ID', 'Source', 'Confidence Score', 'Accuracy'];

    const maxColLength = Math.max(...sheetData.map((row) => row.length));
    const normalizedData = sheetData.map((row) => {
      const cloned = [...row];
      while (cloned.length < maxColLength) cloned.push('');
      return cloned;
    });

    // find header row
    let headerRowIndex = -1;
    for (let r = 0; r < normalizedData.length; r++) {
      const rowStr = normalizedData[r].join(' ');
      if (headerKeywords.some((k) => rowStr.includes(k))) {
        headerRowIndex = r;
        break;
      }
    }

    if (headerRowIndex === -1) {
      throw new BadRequestException('No valid header row found in Excel.');
    }

    // pick headers
    const headers = normalizedData[headerRowIndex].map((h, idx) =>
      h && h.toString().trim() !== '' ? h.toString().trim() : `Column${idx + 1}`,
    );

    // build formatted data after header
    const formattedData = normalizedData.slice(headerRowIndex + 1).map((row) => {
      const rowItems = headers.map((header, idx) => ({
        title: header,
        value: row[idx] !== '' ? row[idx] : null,
      }));

      // add classification + page_number
      rowItems.push({ title: 'classification', value: 'other' });
      rowItems.push({ title: 'page_number', value: 0 });

      // return { row: rowItems };
      return rowItems;
    });
    // this.logger.log('formattedData', formattedData);
    return formattedData;
  }

  normalizeError(err: unknown) {
    const e: any = err;

    const isAxios = !!(e?.isAxiosError || (e?.response && e?.config));
    if (isAxios) {
      const ax = e as AxiosError<any>;
      return {
        kind: 'axios',
        message:
          ax.response?.data?.message ||
          ax.response?.data?.error ||
          (typeof ax.response?.data === 'string' ? ax.response.data : undefined) ||
          ax.message ||
          'Axios error',
        status: ax.response?.status,
        statusText: ax.response?.statusText,
        responseData: ax.response?.data,
      };
    }

    // AWS SDK v3 and similar
    const awsStatus = e?.$metadata?.httpStatusCode;
    const awsRequestId = e?.$metadata?.requestId;
    const awsCode = e?.name || e?.Code || e?.code;

    if (awsStatus || awsRequestId || awsCode) {
      return {
        kind: 'aws',
        message: e?.message || 'AWS error',
        code: awsCode,
        status: awsStatus,
        requestId: awsRequestId,
      };
    }

    if (err instanceof Error) {
      return { kind: 'error', message: err.message };
    }

    return { kind: 'unknown', message: String(err) };
  }
}
