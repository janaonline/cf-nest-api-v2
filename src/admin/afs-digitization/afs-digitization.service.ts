import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as XLSX from 'xlsx';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { YearLabelToId } from 'src/core/constants/years';
import { buildPopulationMatch } from 'src/core/helpers/populationCategory.helper';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsAuditorsReport, AfsAuditorsReportDocument } from 'src/schemas/afs/afs-auditors-report.schema';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric, AfsMetricDocument } from 'src/schemas/afs/afs-metrics.schema';
import { AuditType, DigitizationStatuses } from 'src/schemas/afs/enums';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { documentTypes } from './constants/docTypes';
import { AuditorReportDto } from './dto/auditor-report.dto';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { AfsFile, AfsFileList, AfsFileReport, AuditorReport, IAfsExcelFile } from './dto/interface';
import { ResourcesSectionExcelListDto } from './dto/resources-section-excel-list.dto';
import { ResourcesSectionExcelReportDto } from './dto/resources-section-excel-report.dto';
import { SubmitARDecisionDto } from './dto/submit-ar-decision.dto';
import { AfsMetricsDataPipeline } from './queries/afs-metrics-data.query';
import {
  afsCountQuery,
  afsQuery,
  getAfsListPipeline,
  getAfsReportPipeline,
  getAuditorReportUrlPipeline,
} from './queries/afs-excel-files.query';

const ANNUAL_ACCOUNT_AUDIT_TYPES = ['audited', 'unAudited'] as const;
const ANNUAL_ACCOUNT_PDF_FIELDS = [
  'bal_sheet',
  'bal_sheet_schedules',
  'inc_exp',
  'inc_exp_schedules',
  'cash_flow',
  'auditor_report',
] as const;

type AnnualAccountAuditType = (typeof ANNUAL_ACCOUNT_AUDIT_TYPES)[number];
type AnnualAccountPdfField = (typeof ANNUAL_ACCOUNT_PDF_FIELDS)[number];

interface AnnualAccountPdfFile {
  name?: string;
  url?: string;
  pageCount?: number;
  fileSizeKb?: number;
}

type AnnualAccountProvisionalData = Partial<Record<AnnualAccountPdfField, { pdf?: AnnualAccountPdfFile }>>;

type AnnualAccountDataLean = Partial<
  Record<AnnualAccountAuditType, { provisional_data?: AnnualAccountProvisionalData }>
>;

interface AnnualAccountPdfMetadata {
  pageCount: number;
  fileSizeKb: number;
}

export interface AnnualAccountPdfMetadataSummary {
  totalPdfsFound: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface AnnualAccountPdfMetadataBackfillOptions {
  batchSize?: number;
  limit?: number;
  onlyMissing?: boolean;
}

export interface AnnualAccountPdfMetadataBackfillSummary extends AnnualAccountPdfMetadataSummary {
  documentsMatched: number;
  documentsProcessed: number;
  documentsSucceeded: number;
  documentsFailed: number;
  elapsedMs: number;
  averageMsPerDocument: number;
  estimatedRemainingMs: number;
  estimatedCompletionAt: Date | null;
}

export interface AnnualAccountPdfMetadataBackfillStatus {
  total: number;
  completed: number;
  remaining: number;
}

@Injectable()
export class AfsDigitizationService {
  private readonly logger = new Logger(AfsDigitizationService.name);

  constructor(
    @InjectModel(State.name)
    private stateModel: Model<StateDocument>,

    @InjectModel(Ulb.name)
    private ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private yearModel: Model<YearDocument>,

    @InjectModel(AnnualAccountData.name)
    private readonly annualAccountModel: Model<AnnualAccountDataDocument>,

    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,

    @InjectModel(AfsMetric.name)
    private readonly afsMetricModel: Model<AfsMetricDocument>,

    @InjectModel(AfsAuditorsReport.name)
    private readonly afsAuditorsReportModel: Model<AfsAuditorsReportDocument>,

    @InjectModel(DigitizationLog.name, 'digitization_db')
    private readonly digitizationModel: Model<DigitizationLogDocument>,

    // @InjectQueue(AFS_DIGITIZATION_QUEUE)
    // private readonly digitizationQueue: Queue<DigitizationJobDto>,

    private readonly fileTokenService: FileTokenService,
    private readonly configService: ConfigService,
    private readonly s3Service: S3Service,
  ) {}

  async updatePdfMetadataForAnnualAccount(annualAccountId: string): Promise<AnnualAccountPdfMetadataSummary> {
    const summary: AnnualAccountPdfMetadataSummary = {
      totalPdfsFound: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    if (!Types.ObjectId.isValid(annualAccountId)) {
      this.logger.warn(`Skipping annual account PDF metadata update for invalid id: ${annualAccountId}`);
      summary.skipped += 1;
      return summary;
    }

    const annualAccount = await this.annualAccountModel.findById(annualAccountId).lean<AnnualAccountDataLean>().exec();
    if (!annualAccount) {
      this.logger.warn(`Annual account not found for PDF metadata update: ${annualAccountId}`);
      summary.skipped += 1;
      return summary;
    }

    const setPayload: Record<string, number> = {};

    for (const auditType of ANNUAL_ACCOUNT_AUDIT_TYPES) {
      for (const pdfField of ANNUAL_ACCOUNT_PDF_FIELDS) {
        const pdfPath = `${auditType}.provisional_data.${pdfField}.pdf`;
        const pdf = annualAccount[auditType]?.provisional_data?.[pdfField]?.pdf;

        if (!pdf?.url?.trim()) {
          summary.skipped += 1;
          continue;
        }

        summary.totalPdfsFound += 1;

        try {
          const metadata = await this.getPdfMetadata(pdf.url);
          setPayload[`${pdfPath}.pageCount`] = metadata.pageCount;
          setPayload[`${pdfPath}.fileSizeKb`] = metadata.fileSizeKb;
          summary.updated += 1;
        } catch (error) {
          summary.failed += 1;
          this.logger.error(
            `Failed to update annual account PDF metadata for ${annualAccountId} at ${pdfPath}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }

    if (Object.keys(setPayload).length > 0) {
      await this.annualAccountModel.updateOne({ _id: new Types.ObjectId(annualAccountId) }, { $set: setPayload }).exec();
    }

    this.logger.log(`Annual account PDF metadata update completed for ${annualAccountId}`, summary);
    return summary;
  }

  async getPdfMetadataBackfillStatus(): Promise<AnnualAccountPdfMetadataBackfillStatus> {
    const [total, remaining] = await Promise.all([
      this.annualAccountModel.countDocuments(this.buildAnnualAccountPdfMetadataBackfillFilter(false)).exec(),
      this.annualAccountModel.countDocuments(this.buildAnnualAccountPdfMetadataBackfillFilter(true)).exec(),
    ]);

    return {
      total,
      completed: Math.max(total - remaining, 0),
      remaining,
    };
  }

  async backfillPdfMetadataForAnnualAccounts(
    options: AnnualAccountPdfMetadataBackfillOptions = {},
  ): Promise<AnnualAccountPdfMetadataBackfillSummary> {
    const batchSize = this.clampPositiveInteger(options.batchSize, 25, 1, 100);
    const limit = options.limit ? this.clampPositiveInteger(options.limit, 0, 1, 18_000) : undefined;
    const filter = this.buildAnnualAccountPdfMetadataBackfillFilter(options.onlyMissing ?? true);
    const matchedDocuments = await this.annualAccountModel.countDocuments(filter).exec();
    const documentsMatched = limit ? Math.min(matchedDocuments, limit) : matchedDocuments;
    const startedAt = Date.now();

    const summary: AnnualAccountPdfMetadataBackfillSummary = {
      documentsMatched,
      documentsProcessed: 0,
      documentsSucceeded: 0,
      documentsFailed: 0,
      totalPdfsFound: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      elapsedMs: 0,
      averageMsPerDocument: 0,
      estimatedRemainingMs: 0,
      estimatedCompletionAt: null,
    };

    let lastId: Types.ObjectId | undefined;

    while (!limit || summary.documentsProcessed < limit) {
      const remaining = limit ? limit - summary.documentsProcessed : batchSize;
      const currentBatchSize = Math.min(batchSize, remaining);
      const batchFilter: FilterQuery<AnnualAccountDataDocument> = {
        ...filter,
        ...(lastId ? { _id: { $gt: lastId } } : {}),
      };

      const docs = await this.annualAccountModel
        .find(batchFilter, { _id: 1 })
        .sort({ _id: 1 })
        .limit(currentBatchSize)
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      if (docs.length === 0) {
        break;
      }

      for (const doc of docs) {
        lastId = doc._id;
        summary.documentsProcessed += 1;

        try {
          const docSummary = await this.updatePdfMetadataForAnnualAccount(doc._id.toString());
          summary.totalPdfsFound += docSummary.totalPdfsFound;
          summary.updated += docSummary.updated;
          summary.skipped += docSummary.skipped;
          summary.failed += docSummary.failed;

          if (docSummary.failed > 0) {
            summary.documentsFailed += 1;
          } else {
            summary.documentsSucceeded += 1;
          }
        } catch (error) {
          summary.documentsFailed += 1;
          summary.failed += 1;
          this.logger.error(
            `Failed annual account PDF metadata backfill for ${doc._id.toString()}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      this.updateBackfillTimeEstimate(summary, startedAt);
      this.logger.log(`Annual account PDF metadata backfill progress`, {
        processed: summary.documentsProcessed,
        matched: summary.documentsMatched,
        updated: summary.updated,
        failed: summary.failed,
        elapsedMs: summary.elapsedMs,
        estimatedRemainingMs: summary.estimatedRemainingMs,
        estimatedCompletionAt: summary.estimatedCompletionAt,
      });
    }

    this.updateBackfillTimeEstimate(summary, startedAt);
    this.logger.log(`Annual account PDF metadata backfill completed`, summary);
    return summary;
  }

  private updateBackfillTimeEstimate(
    summary: AnnualAccountPdfMetadataBackfillSummary,
    startedAt: number,
  ): void {
    summary.elapsedMs = Date.now() - startedAt;

    if (summary.documentsProcessed === 0) {
      summary.averageMsPerDocument = 0;
      summary.estimatedRemainingMs = 0;
      summary.estimatedCompletionAt = null;
      return;
    }

    summary.averageMsPerDocument = Math.round(summary.elapsedMs / summary.documentsProcessed);
    const remainingDocuments = Math.max(summary.documentsMatched - summary.documentsProcessed, 0);
    summary.estimatedRemainingMs = Math.round(remainingDocuments * summary.averageMsPerDocument);
    summary.estimatedCompletionAt =
      summary.estimatedRemainingMs > 0 ? new Date(Date.now() + summary.estimatedRemainingMs) : null;
  }

  private buildAnnualAccountPdfMetadataBackfillFilter(
    onlyMissing: boolean,
  ): FilterQuery<AnnualAccountDataDocument> {
    const pdfUrlFilters = ANNUAL_ACCOUNT_AUDIT_TYPES.flatMap((auditType) =>
      ANNUAL_ACCOUNT_PDF_FIELDS.map((pdfField) => ({
        [`${auditType}.provisional_data.${pdfField}.pdf.url`]: { $exists: true, $ne: '' },
      })),
    );

    if (!onlyMissing) {
      return { $or: pdfUrlFilters };
    }

    const missingMetadataFilters = ANNUAL_ACCOUNT_AUDIT_TYPES.flatMap((auditType) =>
      ANNUAL_ACCOUNT_PDF_FIELDS.flatMap((pdfField) => [
        {
          [`${auditType}.provisional_data.${pdfField}.pdf.url`]: { $exists: true, $ne: '' },
          [`${auditType}.provisional_data.${pdfField}.pdf.pageCount`]: { $exists: false },
        },
        {
          [`${auditType}.provisional_data.${pdfField}.pdf.url`]: { $exists: true, $ne: '' },
          [`${auditType}.provisional_data.${pdfField}.pdf.fileSizeKb`]: { $exists: false },
        },
      ]),
    );

    return { $or: missingMetadataFilters };
  }

  private clampPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    if (!value || Number.isNaN(value)) {
      return fallback;
    }

    return Math.min(Math.max(Math.floor(value), min), max);
  }

  private async getPdfMetadata(url: string): Promise<AnnualAccountPdfMetadata> {
    const [buffer, contentLength] = await Promise.all([
      this.s3Service.getPdfBufferFromS3(url),
      this.s3Service.getObjectContentLength(url).catch((error) => {
        this.logger.warn(
          `Unable to read S3 ContentLength for annual account PDF ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      }),
    ]);

    const sizeInBytes = contentLength ?? buffer.length;
    return {
      pageCount: await this.s3Service.getPdfPageCountFromBuffer(buffer),
      fileSizeKb: Math.round((sizeInBytes / 1024) * 100) / 100,
    };
  }

  async getAfsFilters() {
    // const auditTypes = [
    //   { key: 'audited', name: 'Audited' },
    //   { key: 'unAudited', name: 'Unaudited' },
    // ];

    const auditTypes = Object.values(AuditType).map((type) => ({
      key: type,
      name: type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

    const digitizationStatuses = Object.values(DigitizationStatuses).map((status) => ({
      key: status,
      name: status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

    const populationCategories = ['All', '4M+', '1M-4M', '500K-1M', '100K-500K', '<100K'];
    const [states, ulbs, years] = await Promise.all([
      this.stateModel.find({ isActive: true, isPublish: true }, { _id: 1, name: 1 }).sort({ name: 1 }),
      this.ulbModel
        .find({ isActive: true, isPublish: true }, { _id: 1, name: 1, population: 1, state: 1, code: 1 })
        // .populate('state', 'name')
        .sort({ name: 1 }),
      // .limit(1000),
      this.yearModel.find({ isActive: true }, { _id: 1, year: 1 }).sort({ year: -1 }),
    ]);

    return {
      data: {
        states,
        ulbs,
        years,
        populationCategories,
        documentTypes,
        auditTypes,
        digitizationStatuses,
      },
    };
  }
  async getMetricsAfs(docType: string = 'all') {
    const result = await this.afsExcelFileModel.aggregate(AfsMetricsDataPipeline).exec();

    const finalMetrics = {
      digitizedFiles: result[0]?.filesDigitized ?? 0,
      digitizedPages: result[0]?.pagesDigitizedSuccessfully ?? 0,
      failedFiles: result[0]?.failedFiles ?? 0,
      failedPages: result[0]?.failedPages ?? 0,
      // queuedFiles: 0,
      // queuedPages: 0,
    };

    this.logger.log('Calculated AFS metrics from aggregation', finalMetrics);

    await this.afsMetricModel.updateOne({ docType }, { $set: finalMetrics }, { runValidators: true, upsert: true });

    return { data: result[0] ?? finalMetrics };
  }
  async getMetrics(docType: string = 'all') {
    const result = await this.afsMetricModel.findOne({ docType }).lean();
    const cards = [
      {
        icon: 'bi bi-folder-check',
        class: 'text-success',
        title: 'Files Digitized',
        value: result?.digitizedFiles || 0,
      },
      {
        icon: 'bi bi-file-earmark-text',
        class: 'text-success',
        title: 'Pages Digitized',
        value: result?.digitizedPages || 0,
      },
      {
        icon: 'bi bi-folder-x',
        class: 'text-danger',
        title: 'Files Failed',
        value: result?.failedFiles || 0,
      },
      {
        icon: 'bi bi-file-earmark-x',
        class: 'text-danger',
        title: 'Pages Failed',
        value: result?.failedPages || 0,
      },
      {
        icon: 'bi bi-file-earmark-x',
        class: 'text-info',
        title: 'Queued Files',
        value: result?.queuedFiles || 0,
      },
      {
        icon: 'bi bi-check-circle',
        class: 'text-success',
        title: 'Successful',
        value:
          result && result.digitizedFiles + result.failedFiles > 0
            ? `${Math.round((result.digitizedFiles / (result.digitizedFiles + result.failedFiles)) * 100)}%`
            : '0%',
      },
    ];
    return { data: { cards } };
  }

  async getUlbs(params: {
    populationCategory: string;
    stateId?: string[];
    limit?: number;
  }): Promise<{ data: UlbDocument[] }> {
    const populationRange = buildPopulationMatch(params.populationCategory || '');
    const stateObjectIds = params.stateId ? params.stateId.map((id) => new Types.ObjectId(id)) : undefined;

    const data = await this.ulbModel
      .find(
        {
          isActive: true,
          isPublish: true,
          ...(params.populationCategory && populationRange),
          ...(stateObjectIds && { state: { $in: stateObjectIds } }),
        },
        { _id: 1, name: 1, population: 1, state: 1, code: 1 },
      )
      .sort({ name: 1 })
      .limit(params.limit || 2000);
    return { data };
  }

  async getFile(id: string) {
    return this.afsExcelFileModel.findById(id);
  }

  async uploadUlbKeywords(file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Excel file is required.');
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('Excel file does not contain any sheets.');
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
      defval: '',
      raw: false,
    });

    if (!rows.length) {
      throw new BadRequestException('Excel file does not contain any rows.');
    }

    const normalizedRows = rows.map((row, index) => {
      const rowMap = this.normalizeExcelRow(row);
      return {
        rowNumber: index + 2,
        ulbName: rowMap.expected_ulb_name || rowMap.ulb_name || rowMap.name || '',
        keywords: rowMap.keywords || '',
      };
    });

    const validRows = normalizedRows.filter((row) => row.ulbName && row.keywords);
    if (!validRows.length) {
      throw new BadRequestException('Excel must include expected_ulb_name and Keywords values.');
    }

    const ulbs = await this.ulbModel.find({}, { name: 1, keywords: 1 }).lean();
    const ulbByName = new Map(ulbs.map((ulb) => [this.normalizeLookupValue(ulb.name), ulb]));
    const updates = new Map<string, { id: Types.ObjectId; keywords: string }>();
    const notFound: { rowNumber: number; expected_ulb_name: string }[] = [];
    let skipped = normalizedRows.length - validRows.length;

    for (const row of validRows) {
      const ulb = ulbByName.get(this.normalizeLookupValue(row.ulbName));
      if (!ulb) {
        notFound.push({ rowNumber: row.rowNumber, expected_ulb_name: row.ulbName });
        continue;
      }

      const existingUpdate = updates.get(ulb._id.toString());
      const currentKeywords = existingUpdate?.keywords ?? ulb.keywords ?? '';
      const mergedKeywords = this.mergeKeywords(currentKeywords, row.keywords);

      if (mergedKeywords === currentKeywords) {
        skipped += 1;
        continue;
      }

      updates.set(ulb._id.toString(), { id: ulb._id, keywords: mergedKeywords });
    }

    if (updates.size) {
      await this.ulbModel.bulkWrite(
        Array.from(updates.values()).map((update) => ({
          updateOne: {
            filter: { _id: update.id },
            update: { $set: { keywords: update.keywords } },
          },
        })),
      );
    }

    return {
      totalRows: rows.length,
      updated: updates.size,
      skipped,
      notFoundCount: notFound.length,
      notFound,
    };
  }

  async afsList(query: DigitizationReportQueryDto): Promise<any> {
    const [data, countResult] = await Promise.all([
      this.annualAccountModel.aggregate(afsQuery(query)).exec(),
      this.annualAccountModel.aggregate<{ count: number }>(afsCountQuery(query)).exec(),
    ]);

    const totalCount: number = countResult[0]?.count ?? 0;

    const signedData = data.map((item) => {
      const docField = item[query.docType];
      if (docField?.url) {
        docField.url_signed = this.fileTokenService.signFileUrl(docField.url);
      }
      if (item.afsFiles?.ulbFile?.pdfUrl) {
        item.afsFiles.ulbFile.pdfUrl_signed = this.fileTokenService.signFileUrl(item.afsFiles.ulbFile.pdfUrl);
      }
      if (item.afsFiles?.ulbFile?.excelUrl) {
        item.afsFiles.ulbFile.excelUrl_signed = this.fileTokenService.signFileUrl(item.afsFiles.ulbFile.excelUrl);
      }
      if (item.afsFiles?.ulbFile?.digitizedFileUrl) {
        item.afsFiles.ulbFile.digitizedFileUrl_signed = this.fileTokenService.signFileUrl(item.afsFiles.ulbFile.digitizedFileUrl);
      }
      if (item.afsFiles?.afsFile?.pdfUrl) {
        item.afsFiles.afsFile.pdfUrl_signed = this.fileTokenService.signFileUrl(item.afsFiles.afsFile.pdfUrl);
      }
      if (item.afsFiles?.afsFile?.excelUrl) {
        item.afsFiles.afsFile.excelUrl_signed = this.fileTokenService.signFileUrl(item.afsFiles.afsFile.excelUrl);
      }
      if (item.afsFiles?.afsFile?.digitizedFileUrl) {
        item.afsFiles.afsFile.digitizedFileUrl_signed = this.fileTokenService.signFileUrl(item.afsFiles.afsFile.digitizedFileUrl);
      }
      return item;
    });

    return { data: signedData, totalCount };
  }

  private normalizeExcelRow(row: Record<string, unknown>): Record<string, string> {
    return Object.entries(row).reduce<Record<string, string>>((acc, [key, value]) => {
      const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      acc[normalizedKey] = String(value ?? '').trim();
      return acc;
    }, {});
  }

  private normalizeLookupValue(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private mergeKeywords(existingKeywords: string, newKeywords: string): string {
    const keywords = [...this.splitKeywords(existingKeywords)];
    const seen = new Set(keywords.map((keyword) => keyword.toLowerCase()));

    for (const keyword of this.splitKeywords(newKeywords)) {
      const normalizedKeyword = keyword.toLowerCase();
      if (!seen.has(normalizedKeyword)) {
        keywords.push(keyword);
        seen.add(normalizedKeyword);
      }
    }

    return keywords.join(', ');
  }

  private splitKeywords(keywords: string): string[] {
    return String(keywords || '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }

  async getRequestLog(requestId: string): Promise<DigitizationLogDocument | null> {
    return this.digitizationModel.findOne({ RequestId: requestId }).exec();
  }

  // async enqueueDigitizationJob(data: DigitizationJobDto) {
  //   const job = await this.digitizationQueue.add('afsDigitization', data, {
  //     attempts: 3,
  //     backoff: { type: 'exponential', delay: 10_000 },
  //     removeOnComplete: 200,
  //     removeOnFail: 1000,
  //   });

  //   this.logger.log(`Enqueued digitization job ${job.id} for ULB ${data.ulb} (${data.uploadedBy})`);

  //   return { jobId: job.id };
  // }

  /**
   * Retrieves a list of ULBs with available digitized excel based on the provided query params.
   * Ensures that the year and yearId in the query are consistent before fetching the data.
   */
  async getAfsList(query: ResourcesSectionExcelListDto): Promise<AfsFileList> {
    // query.year is always correct (validation in dto)
    // validate if query.yearId and query.year matches.
    if (query.yearId !== YearLabelToId[query.year]) {
      // this.logger.warn(`YearId ${query.yearId} does not match year ${query.year}`);
      query.yearId = YearLabelToId[query.year];
    }

    try {
      const pipeline = getAfsListPipeline(query);
      const data = (await this.afsExcelFileModel.aggregate(pipeline).exec()) as AfsFile[];
      return { success: true, data };
    } catch (err) {
      this.logger.error('Failed to get afs digitized list', err instanceof Error ? err.stack : String(err));
      throw new InternalServerErrorException('Failed to fetch list.');
    }
  }

  /**
   * Retrieves excel urls of a given ULB.
   * Ensures that the year and yearId in the query are consistent before fetching the data.
   */
  async getAfsReport(query: ResourcesSectionExcelReportDto): Promise<AfsFileReport> {
    // query.year is always correct (validation in dto)
    // validate if query.yearId and query.year matches.
    if (query.yearId !== YearLabelToId[query.year]) {
      // this.logger.warn(`YearId ${query.yearId} does not match year ${query.year}`);
      query.yearId = YearLabelToId[query.year];
    }

    try {
      const pipeline = getAfsReportPipeline(query);
      const dbRes = (await this.afsExcelFileModel.aggregate(pipeline).exec()) as IAfsExcelFile[];

      const excel = dbRes.map((file) => ({ ...file, url: this.fileTokenService.signFileUrl(file.url) }));

      return {
        success: true,
        data: {
          type: query.auditType,
          excel,
          source: 'digitizedExcel',
        },
      };
    } catch (err) {
      this.logger.error('Failed to get afs digitized report', err instanceof Error ? err.stack : String(err));
      throw new InternalServerErrorException('Failed to fetch reports.');
    }
  }

  // Fetch digitized auditor's report for a given ULB id and Year id.
  async getAuditorsReport(query: AuditorReportDto): Promise<{ success: boolean; data: AuditorReport }> {
    if (!query.yearId && !query.year) {
      throw new BadRequestException('Year is mandatory.');
    }

    if (!query.yearId && query.year) {
      query.yearId = YearLabelToId[query.year];
    }

    const pipeline = getAuditorReportUrlPipeline(query);
    try {
      const auditorReport = (await this.afsAuditorsReportModel.aggregate(pipeline).exec()) as AuditorReport[];
      return { success: true, data: auditorReport[0] };
    } catch (err) {
      this.logger.error('Failed to get auditors report', err instanceof Error ? err.stack : String(err));
      throw new InternalServerErrorException('Failed to fetch reports.');
    }
  }

  getAuditorsReportItem(id: string) {
    return this.afsAuditorsReportModel.findById(id);
  }

  async submitARDecision(payload: SubmitARDecisionDto) {
    const filePath = payload.type === 'ULB' ? 'ulbFile' : 'afsFile';
    await this.afsAuditorsReportModel
      .findByIdAndUpdate(payload.id, {
        $set: {
          [`${filePath}.data.${payload.section}.decision`]: payload.decision,
          [`${filePath}.data.${payload.section}.decisionNote`]: payload.notes,
          [`${filePath}.data.${payload.section}.decisionAt`]: new Date(),
        },
      })
      .exec();
    // based on the decision, update the AfsAuditorsReport item with the correct status and if needed, requeue for digitization.
  }
}
