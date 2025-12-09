import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import * as ExcelJS from 'exceljs';
import { Buffer } from 'buffer';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { YearIdToLabel } from 'src/core/constants/years';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';
import { DOC_TYPES } from './constants/docTypes';
import { getPopulationCategory } from 'src/core/helpers/populationCategory.helper';
import { afsQuery } from './queries/afs-excel-files.query';

@Injectable()
export class AfsDumpService {
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

  async getAfsFilters() {
    const [states, ulbs, years] = await Promise.all([
      this.stateModel.find({ isActive: true }, { _id: 1, name: 1 }).sort({ name: 1 }),
      this.ulbModel
        .find({ isActive: true }, { _id: 1, name: 1, population: 1, state: 1, code: 1 })
        .populate('state', 'name')
        .sort({ name: 1 }),
      this.yearModel.find({ isActive: true }, { _id: 1, name: 1 }).sort({ name: -1 }),
    ]);

    // TODO: migration pending.
    return { states, ulbs, years };
  }

  async dumpReport() {
    return await this.afsExcelFileModel.find({}).limit(10).exec();
    // Implementation for dumping AFS report goes here.
  }

  async exportAfsExcelFiles(query: DigitizationReportQueryDto): Promise<Buffer> {
    // const docs = await this.afsExcelFileModel.find().lean();
    // const docs = await this.getAnnualWithAfsExcel(query);

    // console.log('Generating AFS Excel Report for query:', afsQuery(query));
    const docs = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    const s3LiveUrlPrefix = 'https://jana-cityfinance-live.s3.ap-south-1.amazonaws.com';
    const s3UrlPrefix = 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com';
    const s3DigitizationUrlPrefix = 'https://cf-digitization-dev.s3.amazonaws.com';
    const yearLabel: string = YearIdToLabel[query.yearId.toString()];

    // console.log('docs', docs);

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
      files?: DigitizedFile[];
      auditType?: string;
    };

    type AfsReportDoc = {
      afsexcelfiles?: AfsExcelFiles | null;
      afsfiles?: { s3Key?: string } | null;
      createdAt?: Date | string;
      stateName?: string;
      ulb?: Types.ObjectId | string;
      ulbCode?: string;
      ulbName?: string;
      ulbPopulation?: number;
      [key: string]: unknown;
    };

    type AfsReportRes = {
      data: AfsReportDoc[];
      totalCount: { count: number }[];
    };

    const typedDocs = docs as AfsReportRes[];

    for (const doc of typedDocs[0].data) {
      // console.log('doc---', doc);
      const ulbDigitizedFiles =
        doc.afsexcelfiles?.files && doc.afsexcelfiles.files.length !== 0 ? doc.afsexcelfiles.files[0] : null;
      const afsDigitizedFiles =
        doc.afsexcelfiles?.files && doc.afsexcelfiles.files.length === 2 ? doc.afsexcelfiles.files[1] : null;

      let ulbDigitizeLogMsg = '';
      if (ulbDigitizedFiles?.requestId) {
        // safe optional chaining and await inside an async function context is valid here
        const log = await this.digitizationModel.findOne({ RequestId: ulbDigitizedFiles.requestId }).exec();
        ulbDigitizeLogMsg = log ? log.Message : '';
      }

      let afsDigitizeLogMsg = '';
      if (afsDigitizedFiles?.requestId) {
        const afsDigitizeLog = await this.digitizationModel.findOne({ RequestId: afsDigitizedFiles.requestId }).exec();
        afsDigitizeLogMsg = afsDigitizeLog ? afsDigitizeLog.Message : '';
      }

      const ulbDigitizedStatus = ulbDigitizedFiles
        ? ulbDigitizedFiles.fileUrl === 'https://placeholder-link.com/none'
          ? 'Failed'
          : 'Success'
        : 'Not-Digitized';
      const afsDigitizedStatus = afsDigitizedFiles
        ? afsDigitizedFiles.fileUrl === 'https://placeholder-link.com/none'
          ? 'Failed'
          : 'Success'
        : null;

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
        afsUploaded: doc.afsfiles ? s3UrlPrefix + '/' + doc.afsfiles?.s3Key : null,
        formUploadedOn: doc.createdAt ?? null,
        ulbDigitizedStatus,
        ulbDigitizedFile: ulbDigitizedFiles ? s3UrlPrefix + '/' + ulbDigitizedFiles?.s3Key : null,
        ulbDigitizedOn: ulbDigitizedFiles?.uploadedAt ?? null,
        ulbRequestId: ulbDigitizedFiles?.requestId ?? null,
        ulbDigitizeLogMsg,

        afsDigitizedStatus,
        afsDigitizedFile: afsDigitizedFiles ? s3UrlPrefix + '/' + afsDigitizedFiles?.s3Key : null,
        afsDigitizedOn: afsDigitizedFiles?.uploadedAt ?? null,
        afsRequestId: afsDigitizedFiles?.requestId ?? null,
        afsDigitizeLogMsg,
      });
    }

    const excelBuffer = await workbook.xlsx.writeBuffer();
    // return buffer as Buffer;
    return Buffer.from(excelBuffer as ArrayBuffer); // convert to Node Buffer
  }

  async getAnnualWithAfsExcel(query: DigitizationReportQueryDto): Promise<any[]> {
    mongoose.set('debug', true);
    // const auditedYearObjectId = new Types.ObjectId(query.yearId);
    // const ulbObjectId = new Types.ObjectId(query.ulbId);
    return await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    // return await this.annualAccountModel
    //   .aggregate([
    //     {
    //       $match: {
    //         'audited.year': query.yearId,
    //         ...(query.ulbId && { ulb: query.ulbId }), // optional ulb filter
    //       },
    //     },
    //     {
    //       $lookup: {
    //         from: 'afsexcelfiles',
    //         let: {
    //           fyId: '$audited.year', // annualaccountdatas.audited.year
    //           ulbId: '$ulb', // annualaccountdatas.ulb
    //         },
    //         pipeline: [
    //           {
    //             $match: {
    //               $expr: {
    //                 $and: [
    //                   { $eq: ['$financialYearId', '$$fyId'] }, // match year
    //                   { $eq: ['$ulb', '$$ulbId'] }, // match ulb
    //                   { $eq: ['$docType', DOC_TYPES[`${query.docType}`]] }, // match docType
    //                 ],
    //               },
    //             },
    //           },
    //         ],
    //         as: 'afsexcelfiles',
    //       },
    //     },
    //     // { $unwind: '$afsexcelfiles' },
    //     {
    //       $unwind: {
    //         path: '$afsexcelfiles',
    //         preserveNullAndEmptyArrays: true,
    //       },
    //     },
    //     {
    //       $lookup: {
    //         from: 'afsfiles',
    //         let: {
    //           fyId: '$afsexcelfiles.financialYear', // afsexcelfiles.financialYear
    //           ulbIds: '$afsexcelfiles.ulbId', // afsexcelfiles.ulb
    //           docType: '$afsexcelfiles.docType', // afsexcelfiles.docType
    //         },
    //         pipeline: [
    //           {
    //             $match: {
    //               $expr: {
    //                 $and: [
    //                   {
    //                     $eq: ['$financialYear', '$$fyId'],
    //                   }, // match year
    //                   {
    //                     $eq: ['$ulbId', '$$ulbIds'],
    //                   }, // match ulb
    //                   {
    //                     $eq: ['$docType', '$$docType'],
    //                   }, // match docType
    //                 ],
    //               },
    //             },
    //           },
    //         ],
    //         as: 'afsfiles',
    //       },
    //     },
    //     {
    //       $unwind: {
    //         path: '$afsfiles',
    //         preserveNullAndEmptyArrays: true,
    //       },
    //     },
    //     // Join ULB collection to get ULB name / code / state id
    //     {
    //       $lookup: {
    //         from: 'ulbs', // <-- or "ulbs" if that's your collection name
    //         localField: 'ulb',
    //         foreignField: '_id',
    //         as: 'ulbDoc',
    //       },
    //     },
    //     { $unwind: '$ulbDoc' },
    //     //   Join State collection to get State name
    //     {
    //       $lookup: {
    //         from: 'states',
    //         localField: 'ulbDoc.state',
    //         foreignField: '_id',
    //         as: 'stateDoc',
    //       },
    //     },
    //     { $unwind: '$stateDoc' },

    //     // Shape the main document
    //     {
    //       $project: {
    //         _id: 1,
    //         ulb: 1,
    //         year: '$audited.year',
    //         [`${query.docType}`]: `$audited.provisional_data.${query.docType}.pdf`,
    //         // bal_sheet: '$audited.provisional_data.bal_sheet.pdf',
    //         // inc_exp: '$audited.provisional_data.inc_exp.pdf',
    //         afsexcelfiles: 1,
    //         afsfiles: 1,
    //         createdAt: 1,
    //         // 'afsexcelfiles.files.data': 0,

    //         ulbPopulation: '$ulbDoc.population',
    //         ulbName: '$ulbDoc.name',
    //         ulbCode: '$ulbDoc.code',
    //         stateId: '$ulbDoc.state',
    //         stateName: '$stateDoc.name',
    //       },
    //     },
    //     // Unwind afsexcelfiles to have a single object instead of array
    //     // {
    //     //   $addFields: {
    //     //     afsexcelfiles: {
    //     //       $ifNull: [
    //     //         {
    //     //           $arrayElemAt: ['$afsexcelfiles', 0],
    //     //         },
    //     //         {},
    //     //       ],
    //     //     },
    //     //   },
    //     // },
    //     {
    //       $project: {
    //         'afsexcelfiles.files.data': 0,
    //       },
    //     },
    //   ])
    //   .exec();
  }
}
