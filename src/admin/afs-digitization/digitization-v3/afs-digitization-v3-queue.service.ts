import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Job, UnrecoverableError } from 'bullmq';
import FormData from 'form-data';
import { setTimeout as sleep } from 'timers/promises';
import { firstValueFrom } from 'rxjs';
import { YearIdToLabel } from 'src/core/constants/years';
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
}

interface FastApiJobResult {
  status: string;
  message?: string;
  error_message?: string | null;
  result?: {
    document_classification?: FastApiDocumentClassification | null;
    excel_s3_key?: string | null;
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
    private readonly digitizationV3Service: AfsDigitizationV3Service,
  ) {}

  async handleJob(job: Job<AfsDigitizationV3JobData>): Promise<void> {
    const data = job.data;
    try {
      await this.digitizationV3Service.markProcessing(data, job.id);

      const fastApiJobId = await this.submit(data);
      this.logger.log(`AFS digitization v3 job ${job.id} submitted to FastAPI as ${fastApiJobId}`);
      await this.waitForCompletion(fastApiJobId);
      const result = await this.fetchResult(fastApiJobId);

      const summary = this.buildResult(data, fastApiJobId, result);
      await this.digitizationV3Service.markDigitized(data, summary);
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

  // ---------------------------------------------------------------------------
  // FastAPI calls
  // ---------------------------------------------------------------------------

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
    // Keep the classification; skip the validation and arithmetic cross-checks to save Gemini cost.
    form.append('enable_document_classification', 'true');
    form.append('enable_validation', 'false');
    form.append('enable_arithmetic_validation', 'false');

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

  private async waitForCompletion(fastApiJobId: string): Promise<void> {
    const pollMs = Number(this.config.get('AFS_DIGITIZATION_V3_POLL_INTERVAL_MS')) || DEFAULT_POLL_INTERVAL_MS;
    const maxWaitMs = Number(this.config.get('AFS_DIGITIZATION_V3_MAX_WAIT_MS')) || DEFAULT_MAX_WAIT_MS;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      await sleep(pollMs);
      const status = await this.request<FastApiJobStatus>(() =>
        firstValueFrom(
          this.http.get<FastApiJobStatus>(`${this.baseUrl()}/jobs/${fastApiJobId}/status`, {
            timeout: this.requestTimeout(),
          }),
        ),
      );
      if (status.status === 'completed') return;
      if (status.status === 'failed') {
        throw new Error(`FastAPI job ${fastApiJobId} failed: ${status.error_message ?? 'unknown error'}`);
      }
    }
    throw new Error(`FastAPI job ${fastApiJobId} did not finish within ${Math.round(maxWaitMs / 1000)}s`);
  }

  private fetchResult(fastApiJobId: string): Promise<FastApiJobResult> {
    return this.request<FastApiJobResult>(() =>
      firstValueFrom(
        this.http.get<FastApiJobResult>(`${this.baseUrl()}/jobs/${fastApiJobId}/result`, {
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
