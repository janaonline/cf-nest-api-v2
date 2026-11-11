import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Buffer } from 'buffer';
import * as ExcelJS from 'exceljs';
import { Model, Types } from 'mongoose';
import { YearIdToLabel } from 'src/core/constants/years';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { getPopulationCategory } from 'src/core/helpers/populationCategory.helper';
import { AfsExcelFile, AfsExcelFileDocument, AfsExcelFileItem } from 'src/schemas/afs/afs-excel-file.schema';
import { AuditType } from 'src/schemas/afs/enums';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { DOC_TYPES } from './constants/docTypes';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { afsQuery } from './queries/afs-excel-files.query';

/** Annual account PDF slots in export column order. `checked` = compared by the duplicates backfill (not the auditor report). */
const DUMP_SLOTS = [
  { code: 'bs', docType: 'bal_sheet', checked: true },
  { code: 'bss', docType: 'bal_sheet_schedules', checked: true },
  { code: 'ie', docType: 'inc_exp', checked: true },
  { code: 'ies', docType: 'inc_exp_schedules', checked: true },
  { code: 'cf', docType: 'cash_flow', checked: true },
  { code: 'ar', docType: 'auditor_report', checked: false },
] as const;

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

    private readonly fileTokenService: FileTokenService,
  ) {}

  async exportAfsExcelFiles(query: DigitizationReportQueryDto): Promise<Buffer> {
    // const docs = await this.afsExcelFileModel.find().lean();
    // const docs = await this.getAnnualWithAfsExcel(query);

    // console.log('Generating AFS Excel Report for query:', afsQuery(query));
    // const docs = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    // mongoose.set('debug', true);
    // const docs = await this.annualAccountModel.aggregate(afsQueryDump(query)).exec();
    const docs = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
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
      afsFiles?: AfsExcelFiles | null;
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
      const ulbFile = doc.afsFiles?.ulbFile;
      const afsFile = doc.afsFiles?.afsFile;

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
        auditType: query.auditType ?? 'audited',
        docType: DOC_TYPES[`${query.docType}`],
        // ulbUploaded: doc.bal_sheet.url,
        ulbUploaded: pdfUrl ? this.fileTokenService.signFileUrl(pdfUrl) : null,
        afsUploaded: afsFile?.pdfUrl ? this.fileTokenService.signFileUrl(afsFile.pdfUrl) : null,
        formUploadedOn: doc.createdAt ?? null,
        ulbDigitizedStatus,
        ulbDigitizedFile: ulbFile?.excelUrl ? this.fileTokenService.signFileUrl(ulbFile.excelUrl) : null,
        ulbDigitizedOn: ulbFile?.createdAt ?? null,
        ulbRequestId: ulbFile?.requestId ?? null,
        ulbDigitizeLogMsg: ulbFile?.queue?.failedReason || '',

        afsDigitizedStatus,
        afsDigitizedFile: afsFile?.excelUrl ? this.fileTokenService.signFileUrl(afsFile.excelUrl) : null,
        afsDigitizedOn: afsFile?.createdAt ?? null,
        afsRequestId: afsFile?.requestId ?? null,
        afsDigitizeLogMsg: afsFile?.queue?.failedReason || '',
      });
    }

    const excelBuffer = await workbook.xlsx.writeBuffer();
    // return buffer as Buffer;
    return Buffer.from(excelBuffer as ArrayBuffer); // convert to Node Buffer
  }

  /**
   * One row per annual account and audit type, with each slot's PDF as `pageCount_fileSizeBytes` and the stored
   * `isDuplicate` / `duplicateOfDocType` flags (set by the duplicates backfill; blank = not checked yet).
   * `yearId` and `auditType` are optional filters; without them every year and both audit types are exported.
   */
  async exportAnnualAccountDuplicates(options: { yearId?: string; auditType?: string }): Promise<Buffer> {
    const auditTypes = options.auditType ? [options.auditType] : (Object.values(AuditType) as string[]);
    if (!auditTypes.every((t) => (Object.values(AuditType) as string[]).includes(t))) {
      throw new BadRequestException(`auditType must be one of: ${Object.values(AuditType).join(', ')}`);
    }
    if (options.yearId && !Types.ObjectId.isValid(options.yearId)) {
      throw new BadRequestException('yearId must be a valid id');
    }
    const yearId = options.yearId ? new Types.ObjectId(options.yearId) : undefined;

    const [ulbs, states] = await Promise.all([
      this.ulbModel.find({}, { name: 1, population: 1, state: 1 }).lean().exec(),
      this.stateModel.find({}, { name: 1 }).lean().exec(),
    ]);
    const stateNames = new Map(states.map((s) => [s._id.toString(), s.name as string]));
    const ulbById = new Map(
      ulbs.map((u) => [
        u._id.toString(),
        { name: u.name as string, population: u.population as number, stateName: stateNames.get(String(u.state)) },
      ]),
    );

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Annual Accounts');
    ws.columns = [
      { header: 'annualAccountId', key: 'annualAccountId', width: 26 },
      { header: 'ulbId', key: 'ulbId', width: 26 },
      { header: 'ulbName', key: 'ulbName', width: 30 },
      { header: 'year', key: 'year', width: 10 },
      { header: 'StateName', key: 'stateName', width: 22 },
      { header: 'pop', key: 'pop', width: 10 },
      { header: 'popCat', key: 'popCat', width: 12 },
      { header: 'auditType', key: 'auditType', width: 12 },
      ...DUMP_SLOTS.map((s) => ({ header: `${s.code} (pageCount_size)`, key: s.code, width: 18 })),
      ...DUMP_SLOTS.filter((s) => s.checked).flatMap((s) => [
        { header: `${s.code} isDuplicate`, key: `${s.code}IsDuplicate`, width: 14 },
        { header: `${s.code} duplicateOf`, key: `${s.code}DuplicateOf`, width: 22 },
      ]),
      { header: 'Match found', key: 'matchFound', width: 14 },
      { header: 'Unique docs', key: 'uniqueDocs', width: 12 },
      { header: 'Unique docs (without AR)', key: 'uniqueDocsNoAr', width: 14 },
      { header: 'Unique page count (without AR)', key: 'uniquePagesNoAr', width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const auditType of auditTypes) {
      const projection: Record<string, 1> = { ulb: 1, [`${auditType}.year`]: 1 };
      for (const s of DUMP_SLOTS) projection[`${auditType}.provisional_data.${s.docType}.pdf`] = 1;

      const cursor = this.annualAccountModel
        .find({ [`${auditType}.year`]: yearId ?? { $exists: true, $ne: null } }, projection)
        .sort({ _id: 1 })
        .lean()
        .cursor({ batchSize: 500 });

      for await (const doc of cursor as AsyncIterable<any>) {
        const year: Types.ObjectId | undefined = doc[auditType]?.year;
        if (!year) continue;
        const ulb = ulbById.get(String(doc.ulb));

        const row: Record<string, string | number | boolean | null> = {
          annualAccountId: String(doc._id),
          ulbId: String(doc.ulb),
          ulbName: ulb?.name ?? null,
          year: YearIdToLabel[year.toString()] ?? year.toString(),
          stateName: ulb?.stateName ?? null,
          pop: ulb?.population ?? null,
          popCat: getPopulationCategory(ulb?.population),
          auditType,
        };

        // A slot is identified by pageCount_size; slots without a url or without metadata have no identity
        const identities = new Map<string, { code: string; pageCount: number }[]>();
        let matchFound = false;
        for (const s of DUMP_SLOTS) {
          const pdf = doc[auditType]?.provisional_data?.[s.docType]?.pdf;
          const hasMeta = pdf?.url && Number.isFinite(pdf.pageCount) && Number.isFinite(pdf.fileSizeBytes);
          const identity = hasMeta ? `${pdf.pageCount}_${pdf.fileSizeBytes}` : null;
          row[s.code] = identity ?? (pdf?.url ? 'n/a' : null);
          if (identity) {
            identities.set(identity, [...(identities.get(identity) ?? []), { code: s.code, pageCount: pdf.pageCount }]);
          }

          if (s.checked) {
            row[`${s.code}IsDuplicate`] = typeof pdf?.isDuplicate === 'boolean' ? pdf.isDuplicate : null;
            row[`${s.code}DuplicateOf`] = pdf?.duplicateOfDocType ?? null;
            if (pdf?.isDuplicate === true) matchFound = true;
          }
        }

        const withoutAr = [...identities.values()].filter((slots) => slots.some((x) => x.code !== 'ar'));
        row.matchFound = matchFound ? 'Match found' : 'No match';
        row.uniqueDocs = identities.size;
        row.uniqueDocsNoAr = withoutAr.length;
        row.uniquePagesNoAr = withoutAr.reduce((sum, slots) => sum + slots[0].pageCount, 0);
        ws.addRow(row);
      }
    }

    return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  }

  async getAnnualWithAfsExcel(query: DigitizationReportQueryDto): Promise<any[]> {
    // const auditedYearObjectId = new Types.ObjectId(query.yearId);
    // const ulbObjectId = new Types.ObjectId(query.ulbId);
    return await this.annualAccountModel.aggregate(afsQuery(query)).exec();
  }
}
