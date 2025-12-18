import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import FormData from 'form-data';
import { Model, Types } from 'mongoose';
import * as path from 'path';
import { firstValueFrom, map } from 'rxjs';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsExcelFile, AfsExcelFileDocument, QueueStatus } from 'src/schemas/afs/afs-excel-file.schema';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { DigitizationJobDto } from '../../dto/digitization-job.dto';

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
    @InjectQueue('afsDigitization')
    private readonly digitizationQueue: Queue<DigitizationJobDto>,
    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,
    private readonly http: HttpService,
    private readonly s3Service: S3Service,
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
        // , result
      };
    }

    if (state === 'failed') {
      return { status: 'failed', progress, reason: job.failedReason };
    }

    return { status: state, progress };
  }

  // digitization.service.ts (as before)
  async enqueueBatch(jobs: DigitizationJobDto[]) {
    // add BullMQ job with jobs as payload
    this.logger.log(`Enqueuing batch of ${jobs.length} digitization jobs`);

    for (const job of jobs) {
      await this.upsertAfsExcelFile(job);
    }
    // this.logger.log(`Prepared ${queues.length} jobs for enqueuing.`, queues);

    // await this.digitizationQueue.addBulk(queues);

    return { queuedJobs: jobs.length };
  }

  async upsertAfsExcelFile(job: DigitizationJobDto) {
    const jobRes = await this.digitizationQueue.add(`digitization-job-${job.ulb}-${job.year}-${job.docType}`, job);
    // this.logger.log(`Enqueued job `, res.id);

    // mongoose.set('debug', true);
    const filter = {
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    };

    const filePath = job.uploadedBy === 'ULB' ? 'ulbFile' : 'afsFile';

    const now = new Date();

    // Build the embedded object (store only what you need)
    const embedded = {
      uploadedAt: now,
      uploadedBy: job.uploadedBy,
      pdfUrl: job.pdfUrl,
      excelUrl: job.digitizedExcelUrl,
      overallConfidenceScore: -1,
      data: [],
      queue: {
        jobId: jobRes?.id,
        status: QueueStatus.WAITING,
        progress: 0,
        queuedAt: now,
        attemptsMade: 0,
      },
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

  async markJobCompleted(job: DigitizationJobDto, digitizationResp: DigitizationResponse) {
    // mongoose.set('debug', true);
    const filter = {
      // annualAccountsId: new Types.ObjectId(params.annualAccountsId),
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    };

    const filePath = job.uploadedBy === 'ULB' ? 'ulbFile' : 'afsFile';
    const now = new Date();
    let parsedData: any[] = [];
    let digitizationStatus = 'failed';
    if (job.digitizedExcelUrl) {
      parsedData = await this.readDataFromExcelBuffer(job.digitizedExcelUrl);
      digitizationStatus = 'digitized';
    }
    // this.logger.log('Parsed data rows count:', job, filter);
    return await this.afsExcelFileModel.updateOne(
      filter,
      {
        $set: {
          [`${filePath}.digitizationStatus`]: digitizationStatus,
          [`${filePath}.data`]: parsedData,
          [`${filePath}.excelUrl`]: job.digitizedExcelUrl || '',
          [`${filePath}.requestId`]: digitizationResp.request_id,
          [`${filePath}.overallConfidenceScore`]: digitizationResp.overall_confidence_score,
          // [`${filePath}.queue.jobId`]: job.jobId,
          [`${filePath}.queue.status`]: 'completed',
          [`${filePath}.queue.progress`]: 100,
          [`${filePath}.queue.finishedAt`]: now,
        },
      },
      { runValidators: true },
    );
  }

  async handleDigitizationJob(job: DigitizationJobDto) {
    const digitizeResp = await this.callDigitizationApi(job);
    // const digitizeResp = {
    //   request_id: 'req-20251218-9a1b9b',
    //   status: 'success',
    //   message: 'Document processing completed successfully',
    //   processing_mode: 'direct',
    //   S3_Excel_Storage_Link:
    //     'https://cf-digitization-dev.s3.amazonaws.com/excel-output/default_user/default_session/document.xlsx?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAYMBHWUBN5KGTKY2E%2F20251218%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20251218T090433Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=91c9f8351807dce528338662156ad061485432905c999a8f7e9b51b4ad5a4cb7',
    //   total_processing_time_ms: 82163,
    //   error_code: null,
    //   overall_confidence_score: 98.67,
    //   status_code: 200,
    // };
    this.logger.log(`Digitization job for ${job.pdfUrl} completed with status `, digitizeResp);

    //afs/5dd24729437ba31f7eb42f46_606aadac4dff55e6c075c507_audited_bal_sheet_schedules_efabadee-d036-4baf-9d85-8d608f8d8dfa.xlsx

    // copy digitized excel to our S3 bucket
    if (!digitizeResp.S3_Excel_Storage_Link) {
      job.digitizedExcelUrl = await this.copyDigitizedExcel(job, digitizeResp.S3_Excel_Storage_Link);
    }
    await this.markJobCompleted(job, digitizeResp);

    // 4. TODO: Save S3_Excel_Storage_Link, request_id, metrics in your DB
    //    - You can inject a repository/service here and persist:
    //      respData.S3_Excel_Storage_Link, respData.request_id, etc.
  }

  async getFormDataForDigitization(job: DigitizationJobDto): Promise<FormData> {
    this.logger.log(`Fetching S3 object for digitization: ${job.pdfUrl}`);
    const buffer = await this.s3Service.getBuffer(job.pdfUrl);
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: 'document.pdf',
      //   contentType: 'application/pdf',
    });

    formData.append('Document_type_ID', job.docType || 'bal_sheet');
    return formData;
  }

  async callDigitizationApi(job: DigitizationJobDto): Promise<DigitizationResponse> {
    const formData = await this.getFormDataForDigitization(job);
    return firstValueFrom(
      this.http
        .post(process.env.DIGITIZATION_API_URL + 'digitization/AFS_Digitization', formData, {
          headers: formData.getHeaders(),
        })
        .pipe(map((resp) => resp.data as DigitizationResponse)),
    );
  }

  getFilenameFromUrl(url: string): string {
    const pathname = new URL(url).pathname;
    return pathname.substring(pathname.lastIndexOf('/') + 1);
  }

  async copyDigitizedExcel(job: DigitizationJobDto, sourceUrl: string): Promise<string> {
    const filename = this.getFilenameFromUrl(sourceUrl);
    // Get original extension
    const ext = path.extname(filename) || '.xlsx'; // default to .xlsx
    const sourceBucket = 'cf-digitization-dev';
    const destinationKey = `afs/${job.ulb}_${job.year}_${job.auditType}_${job.docType}_${uuidv4()}${ext}`;
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

  // async buildAfsExcelFileItem(job: DigitizationJobData, digitizationResp: DigitizationResponse) {
  //   // Excel → JSON (structured rows)
  //   const workbook = xlsx.read(buffer, { type: 'buffer' });
  //   const sheetName = workbook.SheetNames[0];
  //   const sheetData: any[][] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
  //     header: 1,
  //   });

  //   if (!sheetData || sheetData.length === 0) {
  //     throw new BadRequestException('Excel file is empty or invalid.');
  //   }

  //   const maxColLength = Math.max(...sheetData.map((row) => row.length));
  //   const normalizedData = sheetData.map((row) => {
  //     const cloned = [...row];
  //     while (cloned.length < maxColLength) cloned.push('');
  //     return cloned;
  //   });

  //   // find header row
  //   let headerRowIndex = -1;
  //   for (let r = 0; r < normalizedData.length; r++) {
  //     const rowStr = normalizedData[r].join(' ');
  //     if (headerKeywords.some((k) => rowStr.includes(k))) {
  //       headerRowIndex = r;
  //       break;
  //     }
  //   }

  //   if (headerRowIndex === -1) {
  //     throw new BadRequestException('No valid header row found in Excel.');
  //   }

  //   // pick headers
  //   const headers = normalizedData[headerRowIndex].map((h, idx) =>
  //     h && h.toString().trim() !== '' ? h.toString().trim() : `Column${idx + 1}`,
  //   );

  //   // build formatted data after header
  //   const formattedData = normalizedData.slice(headerRowIndex + 1).map((row) => {
  //     const rowItems = headers.map((header, idx) => ({
  //       title: header,
  //       value: row[idx] !== '' ? row[idx] : null,
  //     }));

  //     // add classification + page_number
  //     rowItems.push({ title: 'classification', value: 'other' });
  //     rowItems.push({ title: 'page_number', value: 0 });

  //     return { row: rowItems };
  //   });

  //   // Remove old entry for same uploader (ULB/AFS)
  //   parentDoc.files = parentDoc.files.filter((f: any) => f.uploadedBy !== uploadedBy);

  //   parentDoc.files.push({
  //     s3Key,
  //     fileUrl,
  //     requestId,
  //     uploadedAt: new Date(),
  //     uploadedBy,
  //     data: formattedData,
  //     overallConfidenceScore,
  //   });
  // }
}
