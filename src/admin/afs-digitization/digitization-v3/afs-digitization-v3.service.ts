import { randomBytes } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types, UpdateQuery } from 'mongoose';
import { AFS_DIGITIZATION_V3_QUEUE } from 'src/core/constants/queues';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { AfsExcelFile, AfsExcelFileDocument } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric, AfsMetricDocument } from 'src/schemas/afs/afs-metrics.schema';
import { DigitizationStatuses, DigitizationV3Statuses } from 'src/schemas/afs/enums';
import { QueueStatus } from 'src/schemas/queue.schema';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { YearIdToLabel } from 'src/core/constants/years';
import { DOC_TYPES } from '../constants/docTypes';
import { DUPLICATE_SLOT_ORDER, DuplicateCheckPdf, findDuplicateSlots } from '../helpers/afs-duplicate.helper';
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

/** `afs_metrics` row holding the overall v3 counters (the v2 flow uses 'all' / 'auditor_report') */
const V3_METRICS_DOC_TYPE = 'v3';

/**
 * `afs_metrics` row holding the baseline: how many unique files (and pages) v3 has to digitize. Kept apart from the
 * live row because that one moves by $inc and is overwritten by `rebuildMetrics`.
 */
const V3_UNIQUENESS_DOC_TYPE = 'v3-uniqueness';

/** Years the baseline covers */
const UNIQUENESS_YEARS = ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'];
const UNIQUENESS_AUDIT_TYPES = ['audited', 'unAudited'] as const;

const METRIC_FIELD: Partial<Record<DigitizationV3Statuses, string>> = {
  [DigitizationV3Statuses.QUEUED]: 'queuedFiles',
  [DigitizationV3Statuses.PROCESSING]: 'processingFiles',
  [DigitizationV3Statuses.DIGITIZED]: 'digitizedFiles',
  [DigitizationV3Statuses.FAILED]: 'failedFiles',
};

/** Unique files / pages (and duplicates skipped) for one year, doc type, state and audit type */
interface UniquenessCell {
  year: string;
  docType: string;
  state: string;
  auditType: string;
  files: number;
  pages: number;
  duplicates: number;
}

export interface DigitizationV3OverallMetrics {
  /** Unique files to digitize (the uniqueness baseline); falls back to files that entered the pipeline until it is built */
  total: number;
  /** Pages in those unique files; null until the baseline is built */
  totalPages: number | null;
  digitized: number;
  queued: number;
  processing: number;
  failed: number;
  updatedAt: Date | null;
}

@Injectable()
export class AfsDigitizationV3Service implements OnModuleInit {
  private readonly logger = new Logger(AfsDigitizationV3Service.name);

  constructor(
    @InjectQueue(AFS_DIGITIZATION_V3_QUEUE)
    private readonly digitizationV3Queue: Queue<AfsDigitizationV3JobData>,
    @InjectModel(AnnualAccountData.name)
    private readonly annualAccountModel: Model<AnnualAccountDataDocument>,
    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,
    @InjectModel(AfsMetric.name)
    private readonly afsMetricModel: Model<AfsMetricDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
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

    // One number per call, e.g. 20261029-153012-a1b2: groups this run's jobs in FastAPI
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const batchId = `${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex')}`;

    const summary = {
      batchId,
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
        batchId,
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
      const previous = await this.afsExcelFileModel
        .findOneAndUpdate(
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
              ...(data.batchId && { 'ulbFile.batchId': data.batchId }),
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
          // new: false returns the record as it was (null when inserted), so the counters know what it moved from
          { upsert: true, new: false, setDefaultsOnInsert: false, projection: ULB_FILE_PROJECTION },
        )
        .lean()
        .exec();
      await this.recordTransition(this.statusOf(previous), DigitizationV3Statuses.QUEUED);
      return true;
    } catch (error: any) {
      // Unique index {ulb, year, auditType, docType}: the record exists but does not match the filter above.
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  async markProcessing(data: AfsDigitizationV3JobData, bullJobId?: string) {
    await this.updateAndTrack(
      data,
      {
        $set: {
          'ulbFile.queue.status': QueueStatus.PROCESSING,
          'ulbFile.queue.processedOn': new Date(),
          ...(bullJobId && { 'ulbFile.queue.jobId': bullJobId }),
        },
        $unset: { 'ulbFile.digitizationMsg': '' },
      },
      DigitizationV3Statuses.PROCESSING,
    );
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
    await this.updateAndTrack(
      data,
      {
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
      },
      DigitizationV3Statuses.DIGITIZED,
    );
  }

  async markFailed(data: AfsDigitizationV3JobData, error: string) {
    const message = error.slice(0, 1000);
    await this.updateAndTrack(
      data,
      {
        $set: {
          'ulbFile.digitizationStatus': DigitizationStatuses.FAILED,
          'ulbFile.digitizationMsg': message,
          'ulbFile.queue.status': QueueStatus.FAILED,
          'ulbFile.queue.failedReason': message,
          'ulbFile.queue.finishedOn': new Date(),
        },
      },
      DigitizationV3Statuses.FAILED,
    );
  }

  /** Put the file back to `queued` between BullMQ retries so it is not shown as failed. */
  async markRetrying(data: AfsDigitizationV3JobData, error: string) {
    await this.updateAndTrack(
      data,
      {
        $set: {
          'ulbFile.digitizationStatus': DigitizationStatuses.QUEUED,
          'ulbFile.digitizationMsg': error.slice(0, 1000),
          'ulbFile.queue.status': QueueStatus.QUEUED,
        },
      },
      DigitizationV3Statuses.QUEUED,
    );
  }

  // ---------------------------------------------------------------------------
  // Overall counters (afs_metrics, docType 'v3')
  // ---------------------------------------------------------------------------

  /** Seeds the counters from the existing records the first time, so a deploy does not start at zero. */
  async onModuleInit() {
    try {
      if (!(await this.afsMetricModel.exists({ docType: V3_METRICS_DOC_TYPE }))) await this.rebuildMetrics();
    } catch (error) {
      this.logger.error(
        'Could not seed the digitization v3 counters',
        error instanceof Error ? error.stack : String(error),
      );
    }

    // Reads every annual account, so it runs in the background and never delays startup
    void this.afsMetricModel
      .exists({ docType: V3_UNIQUENESS_DOC_TYPE })
      .then((found) => (found ? undefined : this.rebuildUniqueness()))
      .catch((error) =>
        this.logger.error(
          'Could not seed the digitization v3 uniqueness baseline',
          error instanceof Error ? error.stack : String(error),
        ),
      );
  }

  /**
   * Counts the unique files (and their pages) v3 has to digitize: per ULB, year and audit type, the five statement PDFs
   * minus the ones that are the same file as an earlier slot (`findDuplicateSlots`). Auditor reports are left out.
   * Overwrites the `v3-uniqueness` row, so it can be re-run any time to refresh it.
   */
  async rebuildUniqueness() {
    const projection: Record<string, 1> = { ulb: 1 };
    for (const auditType of UNIQUENESS_AUDIT_TYPES) {
      projection[`${auditType}.year`] = 1;
      for (const slot of DUPLICATE_SLOT_ORDER) {
        for (const field of ['url', 'fileSizeBytes', 'pageCount']) {
          projection[`${auditType}.provisional_data.${slot}.pdf.${field}`] = 1;
        }
      }
    }

    const yearLabels = new Set(UNIQUENESS_YEARS);
    const tally = () => ({ files: 0, pages: 0 });
    const byYear: Record<string, { files: number; pages: number }> = {};
    const byAuditType: Record<string, { files: number; pages: number }> = {};
    const total = tally();
    let combos = 0;

    // ULB -> state name, so every file can be counted under its state
    const [ulbs, states] = await Promise.all([
      this.ulbModel.find({}, { state: 1 }).lean().exec(),
      this.stateModel.find({}, { name: 1 }).lean().exec(),
    ]);
    const stateNameById = new Map(states.map((s) => [s._id.toString(), s.name as string]));
    const stateByUlb = new Map(
      ulbs.map((u) => [u._id.toString(), stateNameById.get(u.state?.toString()) ?? 'Unknown']),
    );

    // year | docType | state | auditType -> counts. Only combinations that have at least one PDF are kept.
    const cells = new Map<string, UniquenessCell>();

    const cursor = this.annualAccountModel.find({}, projection).lean().cursor();
    for await (const account of cursor) {
      const state = stateByUlb.get((account as any).ulb?.toString()) ?? 'Unknown';
      for (const auditType of UNIQUENESS_AUDIT_TYPES) {
        const item = (account as any)[auditType];
        const yearLabel = YearIdToLabel[item?.year?.toString()];
        if (!yearLabel || !yearLabels.has(yearLabel)) continue;

        const pdfs: Record<string, DuplicateCheckPdf | undefined> = {};
        for (const slot of DUPLICATE_SLOT_ORDER) pdfs[slot] = item.provisional_data?.[slot]?.pdf;
        const duplicates = findDuplicateSlots(pdfs);

        let files = 0;
        let pages = 0;
        for (const slot of DUPLICATE_SLOT_ORDER) {
          if (!pdfs[slot]?.url?.trim()) continue;
          const key = `${yearLabel}|${slot}|${state}|${auditType}`;
          const cell = cells.get(key) ?? {
            year: yearLabel,
            docType: slot,
            state,
            auditType,
            files: 0,
            pages: 0,
            duplicates: 0,
          };
          cells.set(key, cell);

          if (duplicates.has(slot)) {
            cell.duplicates++;
            continue;
          }
          const slotPages = pdfs[slot]?.pageCount ?? 0;
          cell.files++;
          cell.pages += slotPages;
          files++;
          pages += slotPages;
        }
        if (!files) continue;

        combos++;
        total.files += files;
        total.pages += pages;
        const year = (byYear[yearLabel] ??= tally());
        year.files += files;
        year.pages += pages;
        const audit = (byAuditType[auditType] ??= tally());
        audit.files += files;
        audit.pages += pages;
      }
    }

    // Cells that only held duplicates still carry their duplicate count
    const breakdown = [...cells.values()].sort(
      (a, b) =>
        a.year.localeCompare(b.year) ||
        a.docType.localeCompare(b.docType) ||
        a.state.localeCompare(b.state) ||
        a.auditType.localeCompare(b.auditType),
    );

    await this.afsMetricModel.updateOne(
      { docType: V3_UNIQUENESS_DOC_TYPE },
      { $set: { totalFiles: total.files, totalPages: total.pages, byYear, byAuditType, breakdown } },
      { upsert: true, runValidators: true },
    );
    this.logger.log(
      `AFS digitization v3 uniqueness baseline: ${total.files} unique files, ${total.pages} pages ` +
        `across ${combos} ULB/year/audit-type combinations, ${breakdown.length} breakdown rows`,
    );
    return { ...total, combinations: combos, byYear, byAuditType, breakdown };
  }

  /** Overall cards: every file that has entered the v3 pipeline, across all years and doc types. */
  async getMetrics(): Promise<DigitizationV3OverallMetrics> {
    const [doc, baseline] = await Promise.all([
      this.afsMetricModel.findOne({ docType: V3_METRICS_DOC_TYPE }).lean().exec(),
      this.afsMetricModel.findOne({ docType: V3_UNIQUENESS_DOC_TYPE }).lean().exec(),
    ]);
    // $inc can dip below zero only if a counter drifted; never show that
    const n = (value?: number) => Math.max(value ?? 0, 0);
    return {
      total: n(baseline ? baseline.totalFiles : doc?.totalFiles),
      totalPages: baseline ? n(baseline.totalPages) : null,
      digitized: n(doc?.digitizedFiles),
      queued: n(doc?.queuedFiles),
      processing: n(doc?.processingFiles),
      failed: n(doc?.failedFiles),
      updatedAt: (doc as { updatedAt?: Date } | null)?.updatedAt ?? null,
    };
  }

  /** The year / doc type / state / audit type baseline rows, optionally narrowed by any of those four. */
  async getUniquenessBreakdown(filter: { year?: string; docType?: string; state?: string; auditType?: string }) {
    const row = await this.afsMetricModel.findOne({ docType: V3_UNIQUENESS_DOC_TYPE }, { breakdown: 1 }).lean().exec();
    const rows = (row?.breakdown ?? []).filter(
      (r) =>
        (!filter.year || r.year === filter.year) &&
        (!filter.docType || r.docType === filter.docType) &&
        (!filter.state || r.state === filter.state) &&
        (!filter.auditType || r.auditType === filter.auditType),
    );
    return {
      rows,
      files: rows.reduce((sum, r) => sum + r.files, 0),
      pages: rows.reduce((sum, r) => sum + r.pages, 0),
      duplicates: rows.reduce((sum, r) => sum + r.duplicates, 0),
    };
  }

  /** Recounts every record (same status rules as `toView`) and overwrites the counters. Fixes any drift. */
  async rebuildMetrics(): Promise<DigitizationV3OverallMetrics> {
    const status = '$ulbFile.digitizationStatus';
    const rows = await this.afsExcelFileModel
      .aggregate<{ _id: DigitizationV3Statuses; n: number }>([
        { $match: { 'ulbFile.digitizationStatus': { $in: Object.values(DigitizationStatuses) } } },
        {
          $project: {
            s: {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $eq: [status, DigitizationStatuses.QUEUED] },
                        { $eq: ['$ulbFile.queue.status', QueueStatus.PROCESSING] },
                      ],
                    },
                    then: DigitizationV3Statuses.PROCESSING,
                  },
                  { case: { $eq: [status, DigitizationStatuses.QUEUED] }, then: DigitizationV3Statuses.QUEUED },
                  {
                    case: {
                      $and: [
                        { $eq: [status, DigitizationStatuses.DIGITIZED] },
                        { $isArray: '$ulbFile.detectedDocTypes' },
                      ],
                    },
                    then: DigitizationV3Statuses.DIGITIZED,
                  },
                  { case: { $eq: [status, DigitizationStatuses.FAILED] }, then: DigitizationV3Statuses.FAILED },
                ],
                default: null,
              },
            },
          },
        },
        { $match: { s: { $ne: null } } },
        { $group: { _id: '$s', n: { $sum: 1 } } },
      ])
      .exec();

    const count = (s: DigitizationV3Statuses) => rows.find((r) => r._id === s)?.n ?? 0;
    const set = {
      queuedFiles: count(DigitizationV3Statuses.QUEUED),
      processingFiles: count(DigitizationV3Statuses.PROCESSING),
      digitizedFiles: count(DigitizationV3Statuses.DIGITIZED),
      failedFiles: count(DigitizationV3Statuses.FAILED),
      totalFiles: rows.reduce((sum, r) => sum + r.n, 0),
    };
    await this.afsMetricModel.updateOne(
      { docType: V3_METRICS_DOC_TYPE },
      { $set: set },
      { upsert: true, runValidators: true },
    );
    this.logger.log(`AFS digitization v3 counters rebuilt: ${JSON.stringify(set)}`);
    return this.getMetrics();
  }

  private statusOf(record?: { ulbFile?: any } | null) {
    return this.toView(record?.ulbFile)?.status ?? DigitizationV3Statuses.NOT_DIGITIZED;
  }

  /** Applies `update` and moves one count from the file's previous status to `next`. */
  private async updateAndTrack(
    data: AfsDigitizationV3JobData,
    update: UpdateQuery<AfsExcelFileDocument>,
    next: DigitizationV3Statuses,
  ) {
    const previous = await this.afsExcelFileModel
      .findOneAndUpdate(this.recordKey(data), update, { new: false, projection: ULB_FILE_PROJECTION })
      .lean()
      .exec();
    await this.recordTransition(this.statusOf(previous), next);
  }

  /** A counter problem must never fail or retry a digitization job, so it is logged and swallowed. */
  private async recordTransition(previous: DigitizationV3Statuses, next: DigitizationV3Statuses) {
    if (previous === next) return;
    try {
      const inc: Record<string, number> = {};
      const from = METRIC_FIELD[previous];
      if (from) inc[from] = -1;
      else inc.totalFiles = 1; // not tracked before: it has just entered the pipeline
      const to = METRIC_FIELD[next];
      if (to) inc[to] = 1;
      await this.afsMetricModel.updateOne({ docType: V3_METRICS_DOC_TYPE }, { $inc: inc }, { upsert: true });
    } catch (error) {
      this.logger.error(
        `Could not update the digitization v3 counters (${previous} -> ${next})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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
