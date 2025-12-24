import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Buffer } from 'buffer';
import * as ExcelJS from 'exceljs';
import { Model, Types } from 'mongoose';
import { YearIdToLabel } from 'src/core/constants/years';
import { getPopulationCategory } from 'src/core/helpers/populationCategory.helper';
import { AfsExcelFile, AfsExcelFileDocument, AfsExcelFileItem } from 'src/schemas/afs/afs-excel-file.schema';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { DOC_TYPES } from './constants/docTypes';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { afsQuery } from './queries/afs-excel-files.query';

@Injectable()
export class AfsDumpService {
  logger = new Logger(AfsDumpService.name);

  constructor(
    @InjectModel(State.name)
    private stateModel: Model<StateDocument>,

    @InjectModel(Ulb.name)
    private ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name) private yearModel: Model<YearDocument>,
    @InjectModel(AfsExcelFile.name) private afsExcelFileModel: Model<AfsExcelFileDocument>,

    @InjectModel(AnnualAccountData.name)
    private readonly annualAccountModel: Model<AnnualAccountDataDocument>,

    @InjectModel(DigitizationLog.name, 'digitization_db')
    private readonly digitizationModel: Model<DigitizationLogDocument>,
  ) {}

  async exportAfsExcelFiles(query: DigitizationReportQueryDto): Promise<Buffer> {
    // const docs = await this.afsExcelFileModel.find().lean();
    // const docs = await this.getAnnualWithAfsExcel(query);

    // console.log('Generating AFS Excel Report for query:', afsQuery(query));
    // const docs = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    // mongoose.set('debug', true);
    // const docs = await this.annualAccountModel.aggregate(afsQueryDump(query)).exec();
    const docs = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    const s3LiveUrlPrefix = 'https://jana-cityfinance-live.s3.ap-south-1.amazonaws.com';
    const s3UrlPrefix = 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com';
    const s3DigitizationUrlPrefix = 'https://cf-digitization-dev.s3.amazonaws.com';
    const yearLabel: string = YearIdToLabel[query.yearId.toString()];

    // console.log('docs', docs);
    // this.logger.log(`docs`, docs);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('AFS Excel Files');

    ws.columns = [
      { header: 'Sate', key: 'stateName', width: 26 },
      { header: 'ULB (ObjectId)', key: 'ulb', width: 26 },
      { header: 'ULB Code', key: 'ulbCode', width: 14 },
      { header: 'ULB Name', key: 'ulbName', width: 26 },
      { header: 'Population Category', key: 'populationCat', width: 12 },
      { header: 'Financial Year', key: 'financialYear', width: 16 },
      { header: 'Audit Type', key: 'auditType', width: 14 },
      { header: 'Doc Type', key: 'docType', width: 30 },
      { header: 'PDF Document ulb uploaded', key: 'ulbUploaded', width: 12 },
      { header: 'PDF Document afs uploaded', key: 'afsUploaded', width: 18 },
      { header: 'Form Uploaded On', key: 'formUploadedOn', width: 18 },
      { header: 'ULB Digitize Status', key: 'ulbDigitizedStatus', width: 18 },
      { header: 'ULB Excel Link', key: 'ulbDigitizedFile', width: 18 },
      { header: 'ULB Digitized On', key: 'ulbDigitizedOn', width: 18 },
      { header: 'ULB Request ID', key: 'ulbRequestId', width: 18 },
      { header: 'ULB Digitize Msg', key: 'ulbDigitizeLogMsg', width: 18 },
      { header: 'AFS Digitize Status', key: 'afsDigitizedStatus', width: 18 },
      { header: 'AFS Excel Link', key: 'afsDigitizedFile', width: 18 },
      { header: 'AFS Digitized On', key: 'afsDigitizedOn', width: 18 },
      { header: 'AFS Request ID', key: 'afsRequestId', width: 18 },
      { header: 'AFS Digitize Msg', key: 'afsDigitizeLogMsg', width: 18 },
    ];

    ws.getRow(1).font = { bold: true };

    // Narrow types for safer access
    type DigitizedFile = {
      requestId?: string;
      fileUrl?: string;
      s3Key?: string;
      uploadedAt?: Date | string;
    };
    type AfsExcelFiles = {
      ulbFile?: AfsExcelFileItem;
      afsFile?: AfsExcelFileItem;
      auditType?: string;
    };
    type AfsReportDoc = {
      afsexcelfiles?: AfsExcelFiles | null;
      // afsfiles?: { s3Key?: string } | null;
      createdAt?: Date | string;
      stateName?: string;
      ulb?: Types.ObjectId | string;
      ulbCode?: string;
      ulbName?: string;
      ulbPopulation?: number;
      [key: string]: unknown;
    };

    const typedDocs = docs as AfsReportDoc[];

    for (const doc of typedDocs) {
      // const ulbDigitizedFiles =
      //   doc.afsexcelfiles?.files && doc.afsexcelfiles.files.length !== 0 ? doc.afsexcelfiles.files[0] : null;
      // const afsDigitizedFiles =
      //   doc.afsexcelfiles?.files && doc.afsexcelfiles.files.length === 2 ? doc.afsexcelfiles.files[1] : null;

      const ulbFile = doc.afsexcelfiles?.ulbFile;
      const afsFile = doc.afsexcelfiles?.afsFile;
      let ulbDigitizeLogMsg = '';
      if (ulbFile?.requestId) {
        // safe optional chaining and await inside an async function context is valid here
        const log = await this.digitizationModel.findOne({ RequestId: ulbFile.requestId }).exec();
        ulbDigitizeLogMsg = log ? log.Message : '';
      }

      let afsDigitizeLogMsg = '';
      if (afsFile?.requestId) {
        const afsDigitizeLog = await this.digitizationModel.findOne({ RequestId: afsFile.requestId }).exec();
        afsDigitizeLogMsg = afsDigitizeLog ? afsDigitizeLog.Message : '';
      }

      const ulbDigitizedStatus = ulbFile?.digitizationStatus || 'Not-Digitized';

      const afsDigitizedStatus = afsFile?.digitizationStatus || 'Not-Digitized';

      // Safely extract the dynamic pdf url property (query.docType)
      let pdfUrl: string | undefined;
      const dynamicField = doc[query.docType];
      if (dynamicField && typeof dynamicField === 'object') {
        const maybeUrl = (dynamicField as Record<string, unknown>)['url'];
        if (typeof maybeUrl === 'string') {
          pdfUrl = maybeUrl;
        }
      }

      // pdfUrl = doc[query.docType] ? doc[query.docType][url] : null;
      ws.addRow({
        stateName: doc.stateName ?? null,
        ulb: doc.ulb?.toString() ?? null,
        ulbCode: doc.ulbCode ?? null,
        ulbName: doc.ulbName ?? null,
        populationCat: getPopulationCategory(doc.ulbPopulation),

        financialYear: yearLabel,
        auditType: doc.afsexcelfiles?.auditType ?? 'audited',
        docType: DOC_TYPES[`${query.docType}`],
        // ulbUploaded: doc.bal_sheet.url,
        ulbUploaded: pdfUrl ? s3LiveUrlPrefix + pdfUrl : null,
        afsUploaded: afsFile?.pdfUrl ? s3UrlPrefix + '/' + afsFile?.pdfUrl : null,
        formUploadedOn: doc.createdAt ?? null,
        ulbDigitizedStatus,
        ulbDigitizedFile: ulbFile?.excelUrl ? s3UrlPrefix + '/' + ulbFile?.excelUrl : null,
        ulbDigitizedOn: ulbFile?.createdAt ?? null,
        ulbRequestId: ulbFile?.requestId ?? null,
        ulbDigitizeLogMsg,

        afsDigitizedStatus,
        afsDigitizedFile: afsFile?.excelUrl ? s3UrlPrefix + '/' + afsFile?.excelUrl : null,
        afsDigitizedOn: afsFile?.createdAt ?? null,
        afsRequestId: afsFile?.requestId ?? null,
        afsDigitizeLogMsg,
      });
    }

    const excelBuffer = await workbook.xlsx.writeBuffer();
    // return buffer as Buffer;
    return Buffer.from(excelBuffer as ArrayBuffer); // convert to Node Buffer
  }

  async getAnnualWithAfsExcel(query: DigitizationReportQueryDto): Promise<any[]> {
    // const auditedYearObjectId = new Types.ObjectId(query.yearId);
    // const ulbObjectId = new Types.ObjectId(query.ulbId);
    return await this.annualAccountModel.aggregate(afsQuery(query)).exec();
  }
}
