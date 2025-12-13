import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import FormData from 'form-data';
import mongoose, { Model, Types } from 'mongoose';
import * as path from 'path';
import { firstValueFrom, map } from 'rxjs';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { DigitizationJobData } from '../../dto/digitization-job-data';
import { DigitizationJobDataDto } from '../../dto/digitization-job.dto';

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
    private readonly digitizationQueue: Queue<DigitizationJobData>,
    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,
    private readonly http: HttpService,
    private readonly s3Service: S3Service,
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
            uploadedBy: file.uploadedBy,
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

  async getFile(id: string) {
    return this.afsExcelFileModel.findById(id);
  }

  async handleDigitizationJob(job: DigitizationJobData): Promise<AfsExcelFileDocument | null> {
    const digitizeResp = await this.callDigitizationApi(job);
    // const digitizeResp = {
    //   request_id: 'req-20251211-36a54f',
    //   status: 'success',
    //   message: 'Document processing completed successfully',
    //   processing_mode: 'direct',
    //   S3_Excel_Storage_Link:
    //     'https://cf-digitization-dev.s3.amazonaws.com/excel-output/default_user/default_session/document.xlsx?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAYMBHWUBN5KGTKY2E%2F20251211%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20251211T100507Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=b63122ef2725b731cdbc4c94d8c30dec4e214f5396a548fb8fdb49dba911fee7',
    //   total_processing_time_ms: 86428,
    //   error_code: null,
    //   overall_confidence_score: 99.39,
    //   status_code: 200,
    // };

    this.logger.log(`Digitization job for ${job.fileUrl} completed with status `, digitizeResp);

    // copy digitized excel to our S3 bucket
    job.digitizedExcelUrl = await this.copyDigitizedExcel(job, digitizeResp.S3_Excel_Storage_Link);
    // job.digitizedExcelUrl = `afs/5dd24729437ba31f7eb42f46_606aadac4dff55e6c075c507_audited_bal_sheet_schedules_68d7d461-8e4d-4e64-b1cc-8146f37a2034.xlsx`;
    this.logger.log(`Copied digitized Excel to ${job.digitizedExcelUrl}`);

    return await this.saveAfsExcelFileRecord(job, digitizeResp);
    // 4. TODO: Save S3_Excel_Storage_Link, request_id, metrics in your DB
    //    - You can inject a repository/service here and persist:
    //      respData.S3_Excel_Storage_Link, respData.request_id, etc.
  }

  getKeyFromS3Url(url: string): string {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.substring(1); // remove leading '/'
  }

  async getFormDataForDigitization(job: DigitizationJobData): Promise<FormData> {
    const key = this.getKeyFromS3Url(job.fileUrl);
    this.logger.log(`Fetching S3 object for digitization: ${key}`);
    const buffer = await this.s3Service.getBuffer(key);
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: 'document.pdf',
      //   contentType: 'application/pdf',
    });

    formData.append('Document_type_ID', job.docType || 'bal_sheet');
    return formData;
  }

  async callDigitizationApi(job: DigitizationJobData): Promise<DigitizationResponse> {
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

  async copyDigitizedExcel(job: DigitizationJobData, sourceUrl: string): Promise<string> {
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

  async saveAfsExcelFileRecord(
    job: DigitizationJobData,
    digitizationResp: DigitizationResponse,
  ): Promise<AfsExcelFileDocument | null> {
    mongoose.set('debug', true);
    // Define the common fields for the filter
    const filter = {
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    };

    const parsedData = await this.readDataFromExcelBuffer(job.digitizedExcelUrl!);
    // Prepare the new file object to push
    const newFileEntry = {
      overallConfidenceScore: digitizationResp.overall_confidence_score,
      requestId: digitizationResp.request_id,
      uploadedAt: new Date(),
      uploadedBy: job.uploadedBy,
      pdfUrl: job.fileUrl || '',
      excelUrl: job.digitizedExcelUrl || '',
      // This part requires you to move your readDataFromExcelBuffer call
      // outside this atomic block if you use this method directly.
      // data: [parsedData[0]],
      data: parsedData,
    };

    // Atomically find and update the document (if it exists) using $push
    // const updateResult = await this.afsExcelFileModel.updateOne(filter, { $push: { files: newFileEntry } });
    // const updateResult = await this.afsExcelFileModel.updateOne(
    //   filter,
    //   {
    //     // 1️⃣ remove old entry for same uploadedBy
    //     $pull: { files: { uploadedBy: job.uploadedBy } },

    //     // 2️⃣ add new file entry
    //     $push: { files: newFileEntry },
    //   },
    //   // Use the $ operator as a placeholder for the matched element
    //   // { $set: { 'files.$.data': newFileEntry.data } },
    // );

    // await this.afsExcelFileModel.updateOne(filter, { $pull: { files: { uploadedBy: job.uploadedBy } } });
    // const updateResult = await this.afsExcelFileModel.updateOne(filter, { $push: { files: newFileEntry } });

    const updateResult = await this.afsExcelFileModel.bulkWrite([
      { updateOne: { filter, update: { $pull: { files: { uploadedBy: job.uploadedBy } } } } },
      { updateOne: { filter, update: { $push: { files: newFileEntry } } } },
    ]);

    this.logger.log('Update result:', updateResult);
    // If updateResult.modifiedCount is 0, the document didn't exist.
    // We need to create it and insert the data.
    if (updateResult.modifiedCount === 0) {
      const newDocData = {
        ...filter,
        annualAccountsId: new Types.ObjectId(job.annualAccountsId),
        files: [newFileEntry], // Initialize with the first entry
      };
      const newDoc = new this.afsExcelFileModel(newDocData);
      return newDoc.save(); // Insert the new document
    }

    // Return something meaningful if the update succeeded
    return await this.afsExcelFileModel.findOne(filter);
  }
  async saveAfsExcelFileRecord_bkp(
    job: DigitizationJobData,
    digitizationResp: DigitizationResponse,
  ): Promise<AfsExcelFileDocument> {
    let parentDoc = await this.afsExcelFileModel.findOne({
      ulb: new Types.ObjectId(job.ulb),
      year: new Types.ObjectId(job.year),
      auditType: job.auditType,
      docType: job.docType,
    });

    if (!parentDoc) {
      parentDoc = new this.afsExcelFileModel({
        annualAccountsId: new Types.ObjectId(job.annualAccountsId),
        ulb: new Types.ObjectId(job.ulb),
        year: new Types.ObjectId(job.year),
        auditType: job.auditType,
        docType: job.docType,
        files: [],
      });
    }

    if (!Array.isArray(parentDoc.files)) {
      parentDoc.files = [];
    }
    if (!job.digitizedExcelUrl) {
      throw new Error('Digitized Excel URL is missing in the job data.');
    }

    const parsedData = await this.readDataFromExcelBuffer(job.digitizedExcelUrl);

    parentDoc.files.push({
      overallConfidenceScore: digitizationResp.overall_confidence_score,
      requestId: digitizationResp.request_id,
      uploadedAt: new Date(),
      uploadedBy: job.uploadedBy,
      pdfUrl: job.fileUrl || '',
      excelUrl: job.digitizedExcelUrl || '',
      data: parsedData,
      // data: [],
    });
    return parentDoc.save();
  }

  async readDataFromExcelBuffer(url: string) {
    // const buffer = await this.s3Service.getObjectBuffer(url);
    // const buffer = await this.s3Service.getBuffer(url);
    // const buffer = await this.getBufferFromS3(url);
    this.logger.log('Reading Excel from S3 URL:', url);
    const buffer: Buffer = await this.s3Service.getBuffer(url);
    // const buffer: Buffer = await this.s3Service.readExcelFromS3AsJson(url);
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

    // const data: any[] = [];
    // worksheet.eachRow((row, rowNumber) => {
    //   const rowData: any = {};
    //   row.eachCell((cell, colNumber) => {
    //     rowData[`Column${colNumber}`] = cell.value;
    //   });
    //   data.push(rowData);
    // });

    // return data;
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
