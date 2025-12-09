import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DigitizationJobData } from '../../dto/digitization-job-data';
import { DigitizationJobDataDto } from '../../dto/digitization-job.dto';
import { firstValueFrom, map } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import FormData from 'form-data';
import { AxiosRequestConfig } from 'axios';

@Injectable()
export class DigitizationQueueService {
  private readonly logger = new Logger(DigitizationQueueService.name);

  constructor(
    @InjectQueue('afsDigitization')
    private readonly digitizationQueue: Queue<DigitizationJobData>,
    private readonly http: HttpService,
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

    const respData = digitizeResp.data;
    // this.logger.debug(`Digitize API response for job ${job.id}: ${JSON.stringify(respData)}`);

    // 4. TODO: Save S3_Excel_Storage_Link, request_id, metrics in your DB
    //    - You can inject a repository/service here and persist:
    //      respData.S3_Excel_Storage_Link, respData.request_id, etc.
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
}
