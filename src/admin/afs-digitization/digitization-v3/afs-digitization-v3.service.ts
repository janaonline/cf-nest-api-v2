import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { AFS_DIGITIZATION_V3_QUEUE } from 'src/core/constants/queues';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { DigitizationStatuses, DigitizationV3Statuses } from 'src/schemas/afs/enums';
import { QueueStatus } from 'src/schemas/queue.schema';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { DOC_TYPES } from '../constants/docTypes';
import { AfsDigitizationV3QueryDto } from '../dto/afs-digitization-v3-query.dto';
import { getUlbsLookupPipeline } from '../queries/afs-excel-files.query';
import {
  AfsDigitizationV3JobData,
  DigitizationV3Result,
  V3_DOC_TYPES,
  MAX_ENQUEUE_BATCH,
} from './afs-digitization-v3.constants';

/** One ULB for the selected year / audit type / doc type, with its uploaded PDF (if any). */
interface UlbRow {
  _id: Types.ObjectId;
  ulb: Types.ObjectId;
  ulbName: string;
  ulbCode?: string;
  stateId: Types.ObjectId;
  stateName: string;
  pdfUrl: string | null;
  /** From the annual account's PDF metadata; null until that has been backfilled for the file */
  pdfPageCount: number | null;
  pdfSizeBytes: number | null;
  /** Same file as an earlier slot (set by the annual-account duplicates backfill): not queued, follows that slot */
  isDuplicate: boolean;
  duplicateOfDocType?: string;
}

/** What the page needs to know about a ULB's v3 digitization, derived from ulbFile (never the heavy data). */
interface V3View {
  status: DigitizationV3Statuses;
  detectedDocTypes: string[];
  segments: { docType: string; startPage: number; endPage: number; title?: string; isDuplicate?: boolean }[];
  isConsolidated: boolean;
  isMismatch: boolean;
  noOfPages?: number;
  /** Key of the digitized Excel in our bucket */
  excelUrl?: string;
  /** FastAPI job id (`job_id` from `POST /afs-digitization/jobs`) */
  jobId?: string;
  error?: string;
}

type V3Record = V3View | undefined;

/** Only these ulbFile fields are read for the list: small, and no data[]. */
const ULB_FILE_PROJECTION = {
  ulb: 1,
  'ulbFile.digitizationStatus': 1,
  'ulbFile.digitizationMsg': 1,
  'ulbFile.queue.status': 1,
  'ulbFile.detectedDocTypes': 1,
  'ulbFile.segments': 1,
  'ulbFile.isConsolidated': 1,
  'ulbFile.isMismatch': 1,
  'ulbFile.noOfPages': 1,
  'ulbFile.excelUrl': 1,
  'ulbFile.requestId': 1,
};

export interface DigitizationV3Metrics {
  total: number;
  withPdf: number;
  notDigitized: number;
  queued: number;
  processing: number;
  digitized: number;
  failed: number;
  consolidated: number;
  mismatch: number;
  /** Files that are the same PDF as an earlier slot (also counted under their original's status) */
  duplicate: number;
}

@Injectable()
export class AfsDigitizationV3Service {
  private readonly logger = new Logger(AfsDigitizationV3Service.name);

  constructor(
    @InjectQueue(AFS_DIGITIZATION_V3_QUEUE)
    private readonly digitizationV3Queue: Queue<AfsDigitizationV3JobData>,
    @InjectModel(AnnualAccountData.name)
    private readonly annualAccountModel: Model<AnnualAccountDataDocument>,
    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    private readonly fileTokenService: FileTokenService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  /**
   * One page of ULBs plus the card counts. Cards cover the whole selection; the page honours the
   * digitization filters.
   */
  async list(query: AfsDigitizationV3QueryDto) {
    this.assertSupported(query);
    const page = query.page > 0 ? query.page : 1;
    const limit = query.limit > 0 ? query.limit : 100;

    const { rows, records } = await this.loadSelection(query);
    const metrics = this.computeMetrics(rows, records);

    const matching = rows.filter((row) => this.matchesFilters(records.get(row.ulb.toString()), query));
    const data = matching
      .slice((page - 1) * limit, page * limit)
      .map((row) => this.shapeRow(row, query.docType, records.get(row.ulb.toString())));

    return { success: true, data, totalCount: matching.length, metrics };
  }

  // ---------------------------------------------------------------------------
  // Queueing
  // ---------------------------------------------------------------------------

  /**
   * Applies the filter once on the server and queues every matching file.
   * Files with no PDF, or already queued / processing / digitized, are skipped.
   */
  async enqueueByFilter(query: AfsDigitizationV3QueryDto) {
    this.assertSupported(query);

    const { rows, records } = await this.loadSelection(query);
    const matching = rows
      .filter((row) => this.matchesFilters(records.get(row.ulb.toString()), query))
      .slice(0, MAX_ENQUEUE_BATCH);

    const summary = {
      matched: matching.length,
      queued: 0,
      skippedNoPdf: 0,
      skippedDuplicate: 0,
      skippedAlreadyQueued: 0,
      skippedAlreadyDigitized: 0,
      failedToQueue: 0,
    };
    if (matching.length === MAX_ENQUEUE_BATCH) {
      this.logger.warn(`Enqueue-by-filter hit the ${MAX_ENQUEUE_BATCH} row cap; narrow the filter and run again`);
    }

    // Dry run (load testing): keep failed jobs in Redis so they show in the queue; they are removed with the variable
    const dryRun = Number(this.config.get('AFS_DIGITIZATION_V3_DRY_RUN_DELAY_MS')) > 0;

    for (const row of matching) {
      if (!row.pdfUrl) {
        summary.skippedNoPdf++;
        continue;
      }

      // Same PDF as an earlier slot: that slot is digitized once and this one follows its result
      if (row.isDuplicate) {
        summary.skippedDuplicate++;
        continue;
      }

      const current = records.get(row.ulb.toString())?.status;
      if (current === DigitizationV3Statuses.DIGITIZED) {
        summary.skippedAlreadyDigitized++;
        continue;
      }
      if (current === DigitizationV3Statuses.QUEUED || current === DigitizationV3Statuses.PROCESSING) {
        summary.skippedAlreadyQueued++;
        continue;
      }

      const data: AfsDigitizationV3JobData = {
        annualAccountsId: row._id.toString(),
        ulb: row.ulb.toString(),
        year: query.yearId,
        auditType: query.auditType as string,
        docType: query.docType,
        pdfUrl: row.pdfUrl,
        ulbName: row.ulbName,
      };

      const claimed = await this.claim(data);
      if (!claimed) {
        // Another request queued it between our read and this write.
        summary.skippedAlreadyQueued++;
        continue;
      }

      try {
        const jobId = `digitize-v3-${data.ulb}-${data.year}-${data.auditType}-${data.docType}`;
        // A finished job kept in Redis would make `add` a silent no-op for this id and leave the file stuck as queued
        const finished = await this.digitizationV3Queue.getJob(jobId);
        if (finished && ['completed', 'failed'].includes(await finished.getState())) await finished.remove();

        await this.digitizationV3Queue.add(`digitize-v3-${data.ulb}-${data.year}-${data.docType}`, data, {
          // Same file can never be in the queue twice; a finished job with this id is removed above so it can be retried.
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          // Kept for a while so they can be inspected; age is in seconds
          removeOnComplete: { age: 2 * 24 * 60 * 60 },
          removeOnFail: { age: 20 * 24 * 60 * 60 },
        });
        summary.queued++;
      } catch (error) {
        summary.failedToQueue++;
        this.logger.error(
          `Failed to add digitization v3 job for ulb ${data.ulb}`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.markFailed(data, 'Could not add the job to the queue');
      }
    }

    this.logger.log(`AFS digitization v3 enqueue-by-filter: ${JSON.stringify(summary)}`);
    return { success: true, ...summary };
  }

  // ---------------------------------------------------------------------------
  // Writes used by the queue service
  // ---------------------------------------------------------------------------

  private recordKey(data: AfsDigitizationV3JobData) {
    return {
      ulb: new Types.ObjectId(data.ulb),
      year: new Types.ObjectId(data.year),
      auditType: data.auditType,
      docType: data.docType,
    };
  }

  /**
   * Atomically moves the ULB's file to `queued`. Returns false if it is already queued, or already digitized by v3.
   * Upserts so ULBs that were never digitized (no afs_xl_files record yet) can be queued too.
   *
   * Only dotted `ulbFile.*` paths are written, so nothing else in the item is overwritten, and without
   * defaults no empty `data[]` is created.
   */
  private async claim(data: AfsDigitizationV3JobData): Promise<boolean> {
    const key = this.recordKey(data);
    try {
      await this.afsExcelFileModel.findOneAndUpdate(
        {
          ...key,
          $nor: [
            { 'ulbFile.digitizationStatus': DigitizationStatuses.QUEUED },
            // `detectedDocTypes` exists only on items v3 has digitized
            {
              'ulbFile.digitizationStatus': DigitizationStatuses.DIGITIZED,
              'ulbFile.detectedDocTypes': { $exists: true },
            },
          ],
        },
        {
          $setOnInsert: {
            ...key,
            ...(data.annualAccountsId && { annualAccountsId: new Types.ObjectId(data.annualAccountsId) }),
          },
          $set: {
            'ulbFile.digitizationStatus': DigitizationStatuses.QUEUED,
            'ulbFile.uploadedBy': 'ULB',
            'ulbFile.pdfUrl': data.pdfUrl,
            'ulbFile.queue': { status: QueueStatus.QUEUED, progress: 0, createdAt: new Date(), attemptsMade: 0 },
          },
          // A re-run starts clean
          $unset: {
            'ulbFile.digitizationMsg': '',
            'ulbFile.detectedDocTypes': '',
            'ulbFile.segments': '',
            'ulbFile.isConsolidated': '',
            'ulbFile.isMismatch': '',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: false },
      );
      return true;
    } catch (error: any) {
      // Unique index {ulb, year, auditType, docType}: the record exists but does not match the filter above.
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  async markProcessing(data: AfsDigitizationV3JobData, bullJobId?: string) {
    await this.afsExcelFileModel.updateOne(this.recordKey(data), {
      $set: {
        'ulbFile.queue.status': QueueStatus.PROCESSING,
        'ulbFile.queue.processedOn': new Date(),
        ...(bullJobId && { 'ulbFile.queue.jobId': bullJobId }),
      },
      $unset: { 'ulbFile.digitizationMsg': '' },
    });
  }

  /**
   * Saves the FastAPI job id (`job_id` from `POST /afs-digitization/jobs`) as soon as FastAPI accepts the job,
   * so a running or failed job can still be traced in FastAPI.
   */
  async markSubmitted(data: AfsDigitizationV3JobData, afsDigitizationJobId: string) {
    await this.afsExcelFileModel.updateOne(this.recordKey(data), {
      $set: { 'ulbFile.requestId': afsDigitizationJobId },
    });
  }

  async markDigitized(data: AfsDigitizationV3JobData, result: DigitizationV3Result) {
    await this.afsExcelFileModel.updateOne(this.recordKey(data), {
      $set: {
        'ulbFile.digitizationStatus': DigitizationStatuses.DIGITIZED,
        // FastAPI job id; the full extraction and the Excel stay in FastAPI and are fetched by this id
        'ulbFile.requestId': result.jobId,
        'ulbFile.detectedDocTypes': result.detectedDocTypes,
        'ulbFile.segments': result.segments,
        'ulbFile.isConsolidated': result.isConsolidated,
        'ulbFile.isMismatch': result.isMismatch,
        'ulbFile.queue.status': QueueStatus.COMPLETED,
        'ulbFile.queue.progress': 100,
        'ulbFile.queue.finishedOn': new Date(),
        ...(result.excelKey && { 'ulbFile.excelUrl': result.excelKey }),
        ...(result.noOfPages != null && { 'ulbFile.noOfPages': result.noOfPages }),
        ...(result.processingMs != null && { 'ulbFile.totalProcessingTimeMs': result.processingMs }),
        // Non-fatal problem (e.g. Excel copy failed): shown on the row, status stays digitized
        ...(result.warning && { 'ulbFile.digitizationMsg': result.warning }),
      },
      ...(!result.warning && { $unset: { 'ulbFile.digitizationMsg': '' } }),
    });
  }

  async markFailed(data: AfsDigitizationV3JobData, error: string) {
    const message = error.slice(0, 1000);
    await this.afsExcelFileModel.updateOne(this.recordKey(data), {
      $set: {
        'ulbFile.digitizationStatus': DigitizationStatuses.FAILED,
        'ulbFile.digitizationMsg': message,
        'ulbFile.queue.status': QueueStatus.FAILED,
        'ulbFile.queue.failedReason': message,
        'ulbFile.queue.finishedOn': new Date(),
      },
    });
  }

  /** Put the file back to `queued` between BullMQ retries so it is not shown as failed. */
  async markRetrying(data: AfsDigitizationV3JobData, error: string) {
    await this.afsExcelFileModel.updateOne(this.recordKey(data), {
      $set: {
        'ulbFile.digitizationStatus': DigitizationStatuses.QUEUED,
        'ulbFile.digitizationMsg': error.slice(0, 1000),
        'ulbFile.queue.status': QueueStatus.QUEUED,
      },
    });
  }
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertSupported(query: AfsDigitizationV3QueryDto) {
    if (!query.auditType) throw new BadRequestException('auditType is required');
    if (!V3_DOC_TYPES.includes(query.docType)) {
      throw new BadRequestException(`docType must be one of: ${V3_DOC_TYPES.join(', ')}`);
    }
  }

  /**
   * Loads every ULB in the selection plus its existing digitization v3 record, with three cheap reads
   * (ULBs with their PDF, the matching states, the existing records) and no per-ULB join into afs_xl_files.
   */
  private async loadSelection(query: AfsDigitizationV3QueryDto) {
    const yearId = new Types.ObjectId(query.yearId);
    const ulbIds = query.ulbId?.length ? query.ulbId.map((id) => new Types.ObjectId(id)) : undefined;
    const auditType = query.auditType as string;

    // docType and auditType are validated enums, so they are safe to use in a field path.
    const ulbs = await this.annualAccountModel
      .aggregate<
        Omit<UlbRow, 'stateName' | 'isDuplicate' | 'duplicateOfDocType'> & {
          pdfIsDuplicate?: boolean;
          pdfDuplicateOf?: string;
        }
      >([
        { $match: { [`${auditType}.year`]: yearId, ...(ulbIds && { ulb: { $in: ulbIds } }) } },
        {
          $project: {
            _id: 1,
            ulb: 1,
            pdfUrl: `$${auditType}.provisional_data.${query.docType}.pdf.url`,
            pdfPageCount: `$${auditType}.provisional_data.${query.docType}.pdf.pageCount`,
            pdfSizeBytes: `$${auditType}.provisional_data.${query.docType}.pdf.fileSizeBytes`,
            pdfIsDuplicate: `$${auditType}.provisional_data.${query.docType}.pdf.isDuplicate`,
            pdfDuplicateOf: `$${auditType}.provisional_data.${query.docType}.pdf.duplicateOfDocType`,
          },
        },
        // State / population filters, same as the AFS dashboard
        ...getUlbsLookupPipeline(query),
        {
          $project: {
            ulb: 1,
            pdfUrl: 1,
            pdfPageCount: 1,
            pdfSizeBytes: 1,
            pdfIsDuplicate: 1,
            pdfDuplicateOf: 1,
            ulbName: '$ulbDoc.name',
            ulbCode: '$ulbDoc.code',
            stateId: '$ulbDoc.state',
          },
        },
        { $sort: { ulbName: 1 } },
      ])
      .exec();

    // The dashboard only lists ULBs whose state is active and published
    const stateIds = [...new Set(ulbs.map((u) => u.stateId?.toString()).filter(Boolean))].map(
      (id) => new Types.ObjectId(id),
    );
    const states = await this.stateModel
      .find({ _id: { $in: stateIds }, isActive: true, isPublish: true }, { name: 1 })
      .lean()
      .exec();
    const stateNames = new Map(states.map((s) => [s._id.toString(), s.name as string]));

    const rows: UlbRow[] = ulbs
      .filter((u) => u.stateId && stateNames.has(u.stateId.toString()))
      .map(({ pdfIsDuplicate, pdfDuplicateOf, ...u }) => ({
        ...u,
        isDuplicate: pdfIsDuplicate === true && !!u.pdfUrl,
        duplicateOfDocType: pdfIsDuplicate === true && u.pdfUrl ? pdfDuplicateOf : undefined,
        stateName: stateNames.get(u.stateId.toString()) as string,
        pdfUrl: u.pdfUrl || null,
        pdfPageCount: u.pdfPageCount ?? null,
        pdfSizeBytes: u.pdfSizeBytes ?? null,
      }));

    // Only a few small ulbFile fields are read (see ULB_FILE_PROJECTION), never the big `data`.
    const existing = await this.afsExcelFileModel
      .find(
        { ulb: { $in: rows.map((r) => r.ulb) }, year: yearId, auditType, docType: query.docType },
        ULB_FILE_PROJECTION,
      )
      .lean()
      .exec();
    const records = new Map<string, V3Record>(existing.map((r) => [r.ulb.toString(), this.toView(r.ulbFile)]));
    await this.followOriginals(rows, records, yearId, auditType);

    return { rows, records };
  }

  /**
   * A duplicate is never digitized itself, so its status and results follow its original's record (same ULB, year and
   * audit type, in the slot named by `duplicateOfDocType`).
   */
  private async followOriginals(
    rows: UlbRow[],
    records: Map<string, V3Record>,
    yearId: Types.ObjectId,
    auditType: string,
  ) {
    const duplicates = rows.filter((row) => row.isDuplicate && row.duplicateOfDocType);
    if (!duplicates.length) return;

    const originals = await this.afsExcelFileModel
      .find(
        {
          ulb: { $in: duplicates.map((row) => row.ulb) },
          year: yearId,
          auditType,
          docType: { $in: [...new Set(duplicates.map((row) => row.duplicateOfDocType as string))] },
        },
        { ...ULB_FILE_PROJECTION, docType: 1 },
      )
      .lean()
      .exec();
    const originalViews = new Map(originals.map((r) => [`${r.ulb}|${r.docType}`, this.toView(r.ulbFile)]));

    for (const row of duplicates) {
      const original = originalViews.get(`${row.ulb}|${row.duplicateOfDocType}`);
      records.set(row.ulb.toString(), original ?? ({ status: DigitizationV3Statuses.NOT_DIGITIZED } as V3View));
    }
  }

  private computeMetrics(rows: UlbRow[], records: Map<string, V3Record>): DigitizationV3Metrics {
    const metrics: DigitizationV3Metrics = {
      total: rows.length,
      withPdf: 0,
      notDigitized: 0,
      queued: 0,
      processing: 0,
      digitized: 0,
      failed: 0,
      consolidated: 0,
      mismatch: 0,
      duplicate: 0,
    };
    const byStatus: Record<DigitizationV3Statuses, keyof DigitizationV3Metrics> = {
      [DigitizationV3Statuses.NOT_DIGITIZED]: 'notDigitized',
      [DigitizationV3Statuses.QUEUED]: 'queued',
      [DigitizationV3Statuses.PROCESSING]: 'processing',
      [DigitizationV3Statuses.DIGITIZED]: 'digitized',
      [DigitizationV3Statuses.FAILED]: 'failed',
    };

    for (const row of rows) {
      if (row.pdfUrl) metrics.withPdf++;
      const record = records.get(row.ulb.toString());
      metrics[byStatus[record?.status ?? DigitizationV3Statuses.NOT_DIGITIZED]]++;
      if (record?.isConsolidated) metrics.consolidated++;
      if (record?.isMismatch) metrics.mismatch++;
      if (row.isDuplicate) metrics.duplicate++;
    }
    return metrics;
  }

  /** "Single type" and "matches" only make sense once a file has been digitized, so they require that. */
  private matchesFilters(record: V3Record, query: AfsDigitizationV3QueryDto): boolean {
    const status = record?.status ?? DigitizationV3Statuses.NOT_DIGITIZED;
    const isDigitized = status === DigitizationV3Statuses.DIGITIZED;

    if (query.digitizationV3Status && status !== query.digitizationV3Status) return false;
    if (query.isConsolidated === true && !record?.isConsolidated) return false;
    if (query.isConsolidated === false && !(isDigitized && !record?.isConsolidated)) return false;
    if (query.isMismatch === true && !record?.isMismatch) return false;
    if (query.isMismatch === false && !(isDigitized && !record?.isMismatch)) return false;
    return true;
  }

  /**
   * Maps a stored `ulbFile` to what the page shows. A file the old flow digitized has no `detectedDocTypes`,
   * so its contents are unknown and it counts as not digitized for v3 (it can be queued).
   */
  private toView(item?: {
    digitizationStatus?: string;
    digitizationMsg?: string;
    queue?: { status?: string };
    detectedDocTypes?: string[];
    segments?: V3View['segments'];
    isConsolidated?: boolean;
    isMismatch?: boolean;
    noOfPages?: number;
    excelUrl?: string;
    requestId?: string;
  }): V3Record {
    if (!item) return undefined;

    let status = DigitizationV3Statuses.NOT_DIGITIZED;
    if (item.digitizationStatus === DigitizationStatuses.QUEUED) {
      status =
        item.queue?.status === QueueStatus.PROCESSING
          ? DigitizationV3Statuses.PROCESSING
          : DigitizationV3Statuses.QUEUED;
    } else if (item.digitizationStatus === DigitizationStatuses.DIGITIZED && Array.isArray(item.detectedDocTypes)) {
      status = DigitizationV3Statuses.DIGITIZED;
    } else if (item.digitizationStatus === DigitizationStatuses.FAILED) {
      status = DigitizationV3Statuses.FAILED;
    }

    return {
      status,
      detectedDocTypes: item.detectedDocTypes ?? [],
      segments: item.segments ?? [],
      isConsolidated: !!item.isConsolidated,
      isMismatch: !!item.isMismatch,
      noOfPages: item.noOfPages,
      excelUrl: item.excelUrl || undefined,
      jobId: item.requestId || undefined,
      error: item.digitizationMsg,
    };
  }

  private shapeRow(row: UlbRow, docType: string, record: V3Record) {
    const excelUrl = record?.status === DigitizationV3Statuses.DIGITIZED ? record.excelUrl : undefined;
    return {
      _id: row._id,
      ulb: row.ulb,
      ulbName: row.ulbName,
      ulbCode: row.ulbCode,
      stateId: row.stateId,
      stateName: row.stateName,
      docType,
      docTypeLabel: DOC_TYPES[docType as keyof typeof DOC_TYPES],
      pdfUrl: row.pdfUrl,
      pdfPageCount: row.pdfPageCount,
      pdfSizeBytes: row.pdfSizeBytes,
      isDuplicate: row.isDuplicate,
      duplicateOfDocType: row.duplicateOfDocType ?? null,
      pdfUrlSigned: row.pdfUrl ? this.fileTokenService.signFileUrl(row.pdfUrl) : null,
      // Same as the PDF: a signed link served by this API. Only for files v3 has digitized.
      excelUrl: excelUrl ?? null,
      excelUrlSigned: excelUrl ? this.fileTokenService.signFileUrl(excelUrl) : null,
      digitization: record ?? { status: DigitizationV3Statuses.NOT_DIGITIZED },
    };
  }
}
