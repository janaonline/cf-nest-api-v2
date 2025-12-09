import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DigitizationJobData } from '../../dto/digitization-job-data';
import { DigitizationJobDataDto } from '../../dto/digitization-job.dto';
import { DigitizationResponseDto } from '../../dto/digitization-response.dto';
import { firstValueFrom, map } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import FormData from 'form-data';
import { AxiosRequestConfig } from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';

@Injectable()
export class DigitizationQueueService {
  private readonly logger = new Logger(DigitizationQueueService.name);

  constructor(
    @InjectQueue('afsDigitization')
    private readonly digitizationQueue: Queue<DigitizationJobData>,
    private readonly http: HttpService,
    @InjectModel(DigitizationLog.name, 'digitization_db')
    private readonly digitizationLogModel: Model<DigitizationLogDocument>,
  ) {}

  // digitization.service.ts (as before)
  async enqueueBatch(jobs: DigitizationJobDataDto[]) {
    // add BullMQ job with jobs as payload
    // this.logger.log(`Enqueuing batch of ${jobs.length} digitization jobs`, jobs);

    const queues: Array<{ name: string; data: any }> = [];

    for (const job of jobs) {
      const data = {
        annualAccountsId: job.annualAccountsId,
        ulb: job.ulb,
        year: job.year,
        docType: job.docType,
      };
      const queue = {
        name: `digitization-job-${job.ulb}-${job.year}`,
        data: data,
        delay: 5000,
      };
      for (const file of job.files) {
        queues.push({
          ...queue,
          data: {
            ...queue.data,
            fileUrl: file.fileUrl,
            sourceType: file.sourceType,
            originalFileName: file.originalFileName,
          },
        });
      }
    }
    // this.logger.log(`Prepared ${queues.length} jobs for enqueuing.`, queues);

    await this.digitizationQueue.addBulk(queues);

    return { queuedJobs: jobs.length };
  }

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
        // , result
      };
    }

    if (state === 'failed') {
      return { status: 'failed', progress, reason: job.failedReason };
    }

    return { status: state, progress };
  }

  async handleDigitizationJob(job: DigitizationJobData): Promise<void> {
    const { fileUrl, docType } = job;

    const pdfResp = await this.getPdfBufferFromS3(fileUrl);

    // 1. Fetch PDF
    // const pdfResp = await firstValueFrom(
    //   this.http.get<ArrayBuffer>(fileUrl, {
    //     responseType: 'arraybuffer' as AxiosRequestConfig['responseType'],
    //   }),
    // );

    // 2.
    // const buffer = Buffer.from(pdfResp.data);

    // // 2. Build multipart form-data using form-data package
    // const formData = new FormData();
    // formData.append('file', buffer, {
    //   filename: 'document.pdf',
    //   //   contentType: 'application/pdf',
    // });

    // formData.append('Document_type_ID', docType || 'bal_sheet');

    const formData = this.getFormDataForDigitization(pdfResp, docType);

    const digitizeResp = await this.callDigitizationApi(formData);

    // 3. Call external digitization API
    // const digitizeResp = await firstValueFrom(
    //   this.http.post(process.env.DIGITIZATION_API_URL + 'digitization/AFS_Digitization', formData, {
    //     headers: formData.getHeaders(),
    //   }),
    // );
    this.logger.log(`Digitization job for ${fileUrl} completed with status ${digitizeResp.status}`, digitizeResp.data);

    const respData = digitizeResp.data as DigitizationResponseDto;
    // this.logger.debug(`Digitize API response for job ${job.id}: ${JSON.stringify(respData)}`);

    // 4. Save S3_Excel_Storage_Link, request_id, metrics in your DB
    await this.saveDigitizationResponse(respData, fileUrl);
  }

  getPdfBufferFromS3(fileUrl: string): Promise<Buffer> {
    return firstValueFrom(
      this.http
        .get<ArrayBuffer>(fileUrl, {
          responseType: 'arraybuffer' as AxiosRequestConfig['responseType'],
        })
        .pipe(map((resp) => Buffer.from(resp.data))), // Convert ArrayBuffer → Buffer
    );
  }

  getFormDataForDigitization(buffer: Buffer, docType: string): FormData {
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: 'document.pdf',
      //   contentType: 'application/pdf',
    });

    formData.append('Document_type_ID', docType || 'bal_sheet');

    return formData;
  }

  callDigitizationApi(formData: FormData) {
    return firstValueFrom(
      this.http.post(process.env.DIGITIZATION_API_URL + 'digitization/AFS_Digitization', formData, {
        headers: formData.getHeaders(),
      }),
    );
  }

  /**
   * Saves the digitization response data to the database.
   * This includes S3_Excel_Storage_Link, request_id, and various metrics.
   */
  async saveDigitizationResponse(respData: DigitizationResponseDto, sourceUrl: string): Promise<void> {
    try {
      const logData: Partial<DigitizationLog> = {
        RequestId: respData.request_id,
        Timestamp: new Date(),
        SourcePDFUrl: sourceUrl,
        DigitizedExcelUrl: respData.S3_Excel_Storage_Link,
        Message: respData.Message || 'Digitization completed',

        // PDF Upload metrics
        PDFUpload_Status: respData.PDFUpload_Status,
        PDFUpload_StatusCode: respData.PDFUpload_StatusCode,
        PDFUpload_FileName: respData.PDFUpload_FileName,
        PDFUpload_FileType: respData.PDFUpload_FileType,
        PDFUpload_FileSize_In_Bytes: respData.PDFUpload_FileSize_In_Bytes,

        // PDF Quality Check metrics
        PDFQualityCheck_Status: respData.PDFQualityCheck_Status,
        PDFQualityCheck_StatusCode: respData.PDFQualityCheck_StatusCode,
        PDFQualityCheck_ProcessingTimeMs: respData.PDFQualityCheck_ProcessingTimeMs,
        PDFQualityCheck_BlurScore: respData.PDFQualityCheck_BlurScore,

        // PDF Enhancement metrics
        PDFEnhancement_Status: respData.PDFEnhancement_Status,
        PDFEnhancement_StatusCode: respData.PDFEnhancement_StatusCode,
        PDFEnhancement_ProcessingTimeMs: respData.PDFEnhancement_ProcessingTimeMs,

        // S3 Upload metrics
        S3Upload_Status: respData.S3Upload_Status,
        S3Upload_StatusCode: respData.S3Upload_StatusCode,
        S3Upload_ProcessingTimeMs: respData.S3Upload_ProcessingTimeMs,

        // OCR metrics
        OCR_Status: respData.OCR_Status,
        OCR_StatusCode: respData.OCR_StatusCode,
        OCR_ProcessingTimeMs: respData.OCR_ProcessingTimeMs,

        // LLM Post-processing metrics
        LLM_Postprocessing_Status: respData.LLM_Postprocessing_Status,
        LLM_Postprocessing_StatusCode: respData.LLM_Postprocessing_StatusCode,
        LLM_Postprocessing_ProcessingTimeMs: respData.LLM_Postprocessing_ProcessingTimeMs,

        // LLM Confidence Scoring metrics
        LLM_ConfidenceScoring_Status: respData.LLM_ConfidenceScoring_Status,
        LLM_ConfidenceScoring_StatusCode: respData.LLM_ConfidenceScoring_StatusCode,
        LLM_ConfidenceScoring_ProcessingTimeMs: respData.LLM_ConfidenceScoring_ProcessingTimeMs,

        // LLM Validation metrics
        LLM_Validation_Status: respData.LLM_Validation_Status,
        LLM_Validation_StatusCode: respData.LLM_Validation_StatusCode,
        LLM_Validation_ProcessingTimeMs: respData.LLM_Validation_ProcessingTimeMs,

        // Excel Generation metrics
        ExcelGeneration_Status: respData.ExcelGeneration_Status,
        ExcelGeneration_StatusCode: respData.ExcelGeneration_StatusCode,
        ExcelGeneration_ProcessingTimeMs: respData.ExcelGeneration_ProcessingTimeMs,

        // Excel Storage metrics
        ExcelStorage_Status: respData.ExcelStorage_Status,
        ExcelStorage_StatusCode: respData.ExcelStorage_StatusCode,
        ExcelStorage_ProcessingTimeMs: respData.ExcelStorage_ProcessingTimeMs,

        // Overall metrics
        TotalProcessingTimeMs: respData.TotalProcessingTimeMs,
        ProcessingMode: respData.ProcessingMode,
        RetryCount: respData.RetryCount || 0,
        FinalStatusCode: respData.FinalStatusCode,

        // Error information (if any)
        ErrorCode: respData.ErrorCode,
        ErrorMessage: respData.ErrorMessage,
        ErrorResolution: respData.ErrorResolution,
        OriginalErrorMessage: respData.OriginalErrorMessage,
        IPAddress: respData.IPAddress,
      };

      // Use upsert to update existing record or create new one
      await this.digitizationLogModel.updateOne(
        { RequestId: respData.request_id },
        { $set: logData },
        { upsert: true },
      );

      this.logger.log(`Saved digitization response for request_id: ${respData.request_id}`);
    } catch (error) {
      this.logger.error(`Failed to save digitization response: ${error.message}`, error.stack);
      // Don't throw error to prevent job failure due to logging issues
    }
  }
}
