import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import { firstValueFrom, map } from 'rxjs';

export type DurGrantType = 'tied' | 'untied';

/**
 * DUR's validation API is a distinct, simpler contract from Annual Account's ocr-validation
 * (no doc_type/upload_id/audit_type — just the file plus who/when it's for, and which Gemini
 * model to run) and no auth header (server-to-server, same as AnnualAccountOcrApiService).
 * Confirmed against the real API 2026-09-21 (network capture), not guessed.
 *
 * `grant_type` ('tied'/'untied') added 2026-09-22 — the API's payload contract changed to require
 * it alongside financial_year (confirmed via a fresh network capture), so the extracted document
 * can be checked against the grant type it was uploaded for, not just the year.
 */
export interface DurSubmitJobDto {
  pdfBuffer: Buffer;
  fileName: string;
  ulbName: string;
  financialYear: string;
  grantType: DurGrantType;
}

export interface DurSubmitResponse {
  job_id: string;
  status: string;
  message?: string;
}

export interface DurJobStatusResponse {
  job_id: string;
  status: string; // "queued" | "processing" | "completed" | "failed"
  filename?: string;
  model?: string;
  expected?: { ulb_name: string; financial_year: string };
  progress_step?: string | null;
  error_message?: string | null;
  checks?: DurResultChecks | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  message?: string;
}

export interface DurResultExtraction {
  state_name?: string | null;
  ulb_name?: string | null;
  financial_year?: string | null;
  grant_financial_year?: string | null;
  is_dur_format?: boolean;
  format_issues?: string[];
  signature_present?: boolean;
  seal_present?: boolean;
  extraction_notes?: string | null;
}

export interface DurResultChecks {
  ulb_name_match: boolean;
  financial_year_match: boolean;
  format_valid: boolean;
  signature_present: boolean;
  seal_present: boolean;
  overall_valid: boolean;
}

export interface DurJobResult {
  filename?: string;
  doc_id?: string;
  model?: string;
  processing_time_seconds?: number;
  expected?: { ulb_name: string; financial_year: string };
  extraction?: DurResultExtraction;
  checks?: DurResultChecks;
  failed_checks?: string[];
}

export interface DurJobResultResponse {
  job_id: string;
  status: string;
  filename?: string;
  expected?: { ulb_name: string; financial_year: string };
  progress_step?: string;
  error_message?: string | null;
  result?: DurJobResult;
  message?: string;
}

/** The Gemini model DUR validation runs against — env-configurable since model identifiers change
 *  over time; falls back to the model version confirmed working at integration time. */
const DEFAULT_DUR_VALIDATION_MODEL = 'gemini-3.1-pro-preview';

/** Without an explicit timeout, a hung request to the external validation service (observed:
 *  submitJob never resolving, no error, no response) leaves the document PROCESSING forever with
 *  no way to recover — not even the cron fallback can rescue it (it requires a jobId, which never
 *  gets written if submitJob itself never returns). Every call here fails fast instead. */
const DUR_VALIDATION_API_TIMEOUT_MS = 60_000;

@Injectable()
export class DurValidationApiService {
  private readonly logger = new Logger(DurValidationApiService.name);
  private durJobApiUrl!: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.setDurJobApiUrl();
  }

  // Same derivation as AnnualAccountOcrApiService.setOcrJobApiUrl — one shared API_BASE_URL_V3,
  // different path segment (dur-validation vs ocr-validation).
  setDurJobApiUrl() {
    let base = '';
    if (this.config.get<string>('API_BASE_URL_V3')) {
      base = this.config.get<string>('API_BASE_URL_V3', '');
    } else {
      const configuredBaseUrl = this.config.get<string>('BASE_URL', '');
      const origin = configuredBaseUrl ? new URL(configuredBaseUrl).origin : '';
      base = `${origin}/api/v3/`;
    }
    this.logger.log(`DUR validation API base URL set to: ${base}`);
    this.durJobApiUrl = `${base}dur-validation/jobs`;
  }

  async submitJob(dto: DurSubmitJobDto): Promise<DurSubmitResponse> {
    const { pdfBuffer, fileName, ulbName, financialYear, grantType } = dto;
    const model = this.config.get<string>('DUR_VALIDATION_MODEL', DEFAULT_DUR_VALIDATION_MODEL);

    const form = new FormData();
    form.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
    form.append('ulb_name', ulbName);
    form.append('financial_year', financialYear);
    form.append('grant_type', grantType);
    form.append('model', model);

    this.logger.log(`Submitting DUR validation job — fileName=${fileName} model=${model}`);

    return firstValueFrom(
      this.http
        .post<DurSubmitResponse>(this.durJobApiUrl, form, {
          headers: form.getHeaders(),
          timeout: DUR_VALIDATION_API_TIMEOUT_MS,
        })
        .pipe(map((r) => r.data)),
    );
  }

  async getJobStatus(jobId: string): Promise<DurJobStatusResponse> {
    return firstValueFrom(
      this.http
        .get<DurJobStatusResponse>(`${this.durJobApiUrl}/${jobId}/status`, { timeout: DUR_VALIDATION_API_TIMEOUT_MS })
        .pipe(map((r) => r.data)),
    );
  }

  async getJobResult(jobId: string): Promise<DurJobResultResponse> {
    return firstValueFrom(
      this.http
        .get<DurJobResultResponse>(`${this.durJobApiUrl}/${jobId}/result`, { timeout: DUR_VALIDATION_API_TIMEOUT_MS })
        .pipe(map((r) => r.data)),
    );
  }
}
