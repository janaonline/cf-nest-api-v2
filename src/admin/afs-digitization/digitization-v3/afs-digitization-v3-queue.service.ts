import { HttpService } from '@nestjs/axios';
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Job, UnrecoverableError } from 'bullmq';
import FormData from 'form-data';
import { setTimeout as sleep } from 'timers/promises';
import { firstValueFrom } from 'rxjs';
import { YearIdToLabel } from 'src/core/constants/years';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsDigitizationV3Service } from './afs-digitization-v3.service';
import {
  AfsDigitizationV3JobData,
  DigitizationV3Result,
  FASTAPI_TO_NEST_DOC_TYPE,
  NEST_TO_FASTAPI_DOC_TYPE,
  UNKNOWN_DOC_TYPE,
} from './afs-digitization-v3.constants';

interface FastApiSegment {
  document_type: string;
  start_page: number;
  end_page: number;
  title?: string | null;
  is_duplicate?: boolean;
}

interface FastApiDocumentClassification {
  document_types?: string[];
  segments?: FastApiSegment[];
  page_count?: number;
  summary?: string | null;
}

interface FastApiJobCreated {
  job_id: string;
  status: string;
}

interface FastApiJobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress_step?: string | null;
  error_message?: string | null;
  // The rest is only used for the job log
  filename?: string;
  ocr_engine?: string;
  gemini_model?: string;
  page_count?: number | null;
  detected_document_type?: string | null;
  multiple_documents_detected?: boolean | null;
  ocr_cost_usd?: number | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  message?: string;
}

/** What the "view log" dialog shows for a FastAPI job. */
export interface AfsDigitizationJobLog {
  afsDigitizationJobId: string;
  status: string;
  progressStep: string | null;
  message: string | null;
  errorMessage: string | null;
  /** Non-fatal problems the job recorded (e.g. a skipped step, a failed Excel upload) */
  warnings: string[];
  filename: string | null;
  ocrEngine: string | null;
  geminiModel: string | null;
  pageCount: number | null;
  detectedDocumentType: string | null;
  multipleDocumentsDetected: boolean | null;
  ocrCostUsd: number | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** FastAPI job ids are uuid4 hex. Checked before the id is put into a URL. */
const AFS_DIGITIZATION_JOB_ID = /^[0-9a-f]{32}$/i;

interface FastApiJobResult {
  status: string;
  message?: string;
  error_message?: string | null;
  result?: {
    document_classification?: FastApiDocumentClassification | null;
    excel_s3_key?: string | null;
    excel_s3_bucket?: string | null;
    processing_time_seconds?: number | null;
    error_messages?: string[];
  } | null;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 20 * 60_000;

/**
 * Sends one PDF to FastAPI v3 `/afs-digitization/jobs`, waits for it, and stores a summary of the result
 * (status, doc types, page ranges, flags, Excel key) on the ULB's `ulbFile` in `afs_xl_files`.
 * The full extraction stays in FastAPI.
 */
@Injectable()
export class AfsDigitizationV3QueueService {
  private readonly logger = new Logger(AfsDigitizationV3QueueService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly s3Service: S3Service,
    private readonly digitizationV3Service: AfsDigitizationV3Service,
  ) {}

  async handleJob(job: Job<AfsDigitizationV3JobData>): Promise<void> {
    const data = job.data;
    try {
      await this.digitizationV3Service.markProcessing(data, job.id);

      // Load-testing switch: skip FastAPI and Textract / Gemini cost, but still mark the file failed with a clear message
      const dryRunDelayMs = this.dryRunDelayMs();
      if (dryRunDelayMs > 0) await this.simulateDryRun(dryRunDelayMs);

      const afsDigitizationJobId = await this.submit(data);
      await this.digitizationV3Service.markSubmitted(data, afsDigitizationJobId);
      this.logger.log(`AFS digitization v3 job ${job.id} submitted to FastAPI as ${afsDigitizationJobId}`);
      await this.waitForCompletion(afsDigitizationJobId);
      const result = await this.fetchResult(afsDigitizationJobId);

      const summary = this.buildResult(data, afsDigitizationJobId, result);
      // Keep FastAPI's Excel key only if it is in the bucket this API serves files from
      const { excelKey, warning } = this.resolveExcel(data, summary.excelKey, result.result?.excel_s3_bucket);
      await this.digitizationV3Service.markDigitized(data, { ...summary, excelKey, warning });
      this.logger.log(
        `Digitized ulb ${data.ulb} ${data.docType}: detected=[${summary.detectedDocTypes}] ` +
          `consolidated=${summary.isConsolidated} mismatch=${summary.isMismatch}`,
      );
    } catch (error) {
      const message = this.describeError(error);
      this.logger.error(
        `AFS digitization v3 job ${job.id} failed for ulb ${data.ulb} ${data.docType}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      const isLastAttempt = error instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLastAttempt) await this.digitizationV3Service.markFailed(data, message);
      else await this.digitizationV3Service.markRetrying(data, message);
      throw error;
    }
  }

  /** The FastAPI side of one job, for the page's "view log" dialog. */
  async getJobLog(afsDigitizationJobId: string): Promise<AfsDigitizationJobLog> {
    if (!AFS_DIGITIZATION_JOB_ID.test(afsDigitizationJobId)) {
      throw new BadRequestException('afsDigitizationJobId must be a 32 character hex id');
    }

    const timeout = this.requestTimeout();
    try {
      const [status, result] = await Promise.all([
        firstValueFrom(
          this.http.get<FastApiJobStatus>(`${this.baseUrl()}/jobs/${afsDigitizationJobId}/status`, { timeout }),
        ),
        // The result only adds the warnings; a log without them is still useful, so its failure is ignored
        firstValueFrom(
          this.http.get<FastApiJobResult>(`${this.baseUrl()}/jobs/${afsDigitizationJobId}/result`, { timeout }),
        ).catch(() => null),
      ]);

      const s = status.data;
      return {
        afsDigitizationJobId: s.job_id,
        status: s.status,
        progressStep: s.progress_step ?? null,
        message: s.message ?? null,
        errorMessage: s.error_message ?? null,
        warnings: result?.data?.result?.error_messages ?? [],
        filename: s.filename ?? null,
        ocrEngine: s.ocr_engine ?? null,
        geminiModel: s.gemini_model ?? null,
        pageCount: s.page_count ?? null,
        detectedDocumentType: s.detected_document_type ?? null,
        multipleDocumentsDetected: s.multiple_documents_detected ?? null,
        ocrCostUsd: s.ocr_cost_usd ?? null,
        createdAt: s.created_at ?? null,
        startedAt: s.started_at ?? null,
        completedAt: s.completed_at ?? null,
      };
    } catch (error) {
      if ((error as AxiosError)?.response?.status === 404) {
        throw new NotFoundException(`No FastAPI job ${afsDigitizationJobId}`);
      }
      this.logger.error(`Could not read the log of FastAPI job ${afsDigitizationJobId}: ${this.describeError(error)}`);
      throw new BadGatewayException(`Could not read the job log from FastAPI: ${this.describeError(error)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // FastAPI calls
  // ---------------------------------------------------------------------------

  /** Load-testing switch: dry run is on only when AFS_DIGITIZATION_V3_DRY_RUN_DELAY_MS is set and greater than 0. */
  private dryRunDelayMs(): number {
    const delay = Number(this.config.get('AFS_DIGITIZATION_V3_DRY_RUN_DELAY_MS'));
    return Number.isFinite(delay) && delay > 0 ? delay : 0;
  }

  /**
   * Skips FastAPI (no Textract / Gemini cost) after a fake delay, then fails the job without retries. handleJob's
   * catch marks the file failed with this message, so no fake result is stored and it can be queued again once
   * the variable is removed.
   */
  private async simulateDryRun(delayMs: number): Promise<never> {
    await sleep(delayMs);
    throw new UnrecoverableError('Dry run: digitization is disabled (AFS_DIGITIZATION_V3_DRY_RUN_DELAY_MS)');
  }

  private baseUrl(): string {
    const url = this.config.get<string>('AFS_DIGITIZATION_V3_URL');
    if (!url) throw new UnrecoverableError('AFS_DIGITIZATION_V3_URL is not configured');
    return url.replace(/\/+$/, '') + '/afs-digitization';
  }

  private requestTimeout(): number {
    return Number(this.config.get('AFS_DIGITIZATION_V3_TIMEOUT_MS')) || DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async submit(data: AfsDigitizationV3JobData): Promise<string> {
    const fastApiDocType = NEST_TO_FASTAPI_DOC_TYPE[data.docType];
    if (!fastApiDocType) throw new UnrecoverableError(`Unsupported docType ${data.docType}`);

    // FastAPI reads the PDF from the CityFinance bucket itself, so nothing is downloaded or uploaded here.
    const form = new FormData();
    form.append('s3_path', data.pdfUrl);
    form.append('doc_type', fastApiDocType);
    const yearLabel = YearIdToLabel[data.year];
    if (yearLabel) form.append('financial_year', yearLabel);
    if (data.ulbName) form.append('ulb_name', data.ulbName);
    // Run classification plus the Gemini accuracy (cross-check) and arithmetic validations.
    form.append('enable_document_classification', 'true');
    form.append('enable_validation', 'true');
    form.append('enable_arithmetic_validation', 'true');

    const created = await this.request<FastApiJobCreated>(() =>
      firstValueFrom(
        this.http.post<FastApiJobCreated>(`${this.baseUrl()}/jobs`, form, {
          headers: form.getHeaders(),
          timeout: this.requestTimeout(),
        }),
      ),
    );
    if (!created?.job_id) throw new Error('FastAPI did not return a job_id');
    return created.job_id;
  }

  private async waitForCompletion(afsDigitizationJobId: string): Promise<void> {
    const pollMs = Number(this.config.get('AFS_DIGITIZATION_V3_POLL_INTERVAL_MS')) || DEFAULT_POLL_INTERVAL_MS;
    const maxWaitMs = Number(this.config.get('AFS_DIGITIZATION_V3_MAX_WAIT_MS')) || DEFAULT_MAX_WAIT_MS;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      await sleep(pollMs);
      const status = await this.request<FastApiJobStatus>(() =>
        firstValueFrom(
          this.http.get<FastApiJobStatus>(`${this.baseUrl()}/jobs/${afsDigitizationJobId}/status`, {
            timeout: this.requestTimeout(),
          }),
        ),
      );
      if (status.status === 'completed') return;
      if (status.status === 'failed') {
        throw new Error(`FastAPI job ${afsDigitizationJobId} failed: ${status.error_message ?? 'unknown error'}`);
      }
    }
    throw new Error(`FastAPI job ${afsDigitizationJobId} did not finish within ${Math.round(maxWaitMs / 1000)}s`);
  }

  private fetchResult(afsDigitizationJobId: string): Promise<FastApiJobResult> {
    return this.request<FastApiJobResult>(() =>
      firstValueFrom(
        this.http.get<FastApiJobResult>(`${this.baseUrl()}/jobs/${afsDigitizationJobId}/result`, {
          timeout: this.requestTimeout(),
        }),
      ),
    );
  }

  /** Runs an axios call and unwraps `data`. 4xx responses are not worth retrying. */
  private async request<T>(call: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await call()).data;
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw new UnrecoverableError(this.describeError(error));
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  private buildResult(data: AfsDigitizationV3JobData, jobId: string, result: FastApiJobResult): DigitizationV3Result {
    const cls = result.result?.document_classification;
    if (!cls) {
      const reason = result.result?.error_messages?.join('; ') || result.error_message || 'no document_classification';
      throw new Error(`FastAPI returned no document classification: ${reason}`);
    }

    const toNest = (t: string) => FASTAPI_TO_NEST_DOC_TYPE[t] ?? UNKNOWN_DOC_TYPE;
    const segments = (cls.segments ?? []).map((s) => ({
      docType: toNest(s.document_type),
      startPage: s.start_page,
      endPage: s.end_page,
      title: s.title ?? undefined,
      isDuplicate: !!s.is_duplicate,
    }));

    // Distinct types actually present; "unknown" is not a type, so it neither counts as present nor as consolidated.
    const source = cls.document_types?.length ? cls.document_types.map(toNest) : segments.map((s) => s.docType);
    const detectedDocTypes = [...new Set(source)].filter((t) => t !== UNKNOWN_DOC_TYPE);

    const seconds = result.result?.processing_time_seconds;
    return {
      jobId,
      excelKey: result.result?.excel_s3_key ?? undefined,
      noOfPages: cls.page_count || undefined,
      processingMs: seconds != null ? Math.round(seconds * 1000) : undefined,
      detectedDocTypes,
      segments,
      isConsolidated: detectedDocTypes.length > 1,
      isMismatch: !detectedDocTypes.includes(data.docType),
    };
  }

  /**
   * FastAPI stores the workbook in the CityFinance bucket (`S3_BUCKET_CF`), which is the bucket this API
   * serves signed links from, so the key can be used as it is. Nothing is copied. If FastAPI reports a
   * different bucket (or none, i.e. an older FastAPI), the key would not resolve here, so it is not stored.
   * The job itself still succeeds: re-running it would repeat the paid Gemini work.
   */
  private resolveExcel(
    data: AfsDigitizationV3JobData,
    key?: string,
    bucket?: string | null,
  ): { excelKey?: string; warning?: string } {
    if (!key) return {};
    if (bucket && bucket === this.s3Service.bucket) return { excelKey: key };

    const reason = bucket
      ? `FastAPI stored the Excel in bucket "${bucket}", but this API serves "${this.s3Service.bucket}"`
      : 'FastAPI did not report which bucket holds the Excel';
    this.logger.error(`Excel not linked for ulb ${data.ulb} ${data.docType}: ${reason} (key ${key})`);
    return { warning: `Digitized, but the Excel is not available: ${reason}.` };
  }

  private describeError(error: unknown): string {
    const ax = error as AxiosError<any>;
    if (ax?.isAxiosError) {
      const detail = ax.response?.data?.detail ?? ax.response?.data?.message;
      const text = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : ax.message;
      return `FastAPI ${ax.response?.status ?? 'request'} error: ${text}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
