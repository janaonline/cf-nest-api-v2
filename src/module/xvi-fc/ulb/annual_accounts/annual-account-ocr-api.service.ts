import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import { firstValueFrom, map } from 'rxjs';

export interface OcrSubmitJobDto {
  pdfBuffer: Buffer;
  fileName: string;
  docType: string;
  ulbName: string;
  uploadId: string;
  financialYear: string;
}

export interface OcrSubmitResponse {
  job_id: string;
  status: string;
  message?: string;
}

export interface OcrStatusResponse {
  job_id: string;
  status: string; // pending | processing | completed | failed (Python returns lowercase)
  progress_step?: string;
  message?: string;
}

export interface OcrBasicValidation {
  validation_status: string; // "PASS" | "FAIL" (Python uses short form)
  validation_details?: string;
  failed_checks?: string[];
  pdf_readability_status?: string;
  readability_score?: number;
  pdf_quality_status?: string;
  overall_assessment?: string;
}

export interface OcrJobResult {
  basic_validation?: OcrBasicValidation;
  error_messages?: string[];
  overall_assessment?: string;
  summary?: string;
}

export interface OcrResultResponse {
  job_id: string;
  status: string;
  progress_step?: string;
  result?: OcrJobResult;
  message?: string;
}

@Injectable()
export class AnnualAccountOcrApiService {
  private readonly logger = new Logger(AnnualAccountOcrApiService.name);
  private readonly ocrJobApiUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    // Derive the OCR API host from the current app's own BASE_URL
    // (e.g. BASE_URL=https://dev.cityfinance.in/api/v2/ -> https://dev.cityfinance.in/api/v3/)
    const configuredBaseUrl = this.config.get<string>('BASE_URL', '');
    const origin = configuredBaseUrl ? new URL(configuredBaseUrl).origin : '';
    const baseUrl = `${origin}/api/v3/`;
    this.ocrJobApiUrl = `${baseUrl}ocr-validation/jobs`;
  }

  async submitJob(dto: OcrSubmitJobDto): Promise<OcrSubmitResponse> {
    const { pdfBuffer, fileName, docType, ulbName, uploadId, financialYear } = dto;

    const form = new FormData();
    form.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
    form.append('doc_type', docType);
    form.append('ulb_name', ulbName);
    form.append('upload_id', uploadId);
    form.append('financial_year', financialYear);

    this.logger.log(`API URL for OCR job submission: ${this.ocrJobApiUrl}`);
    this.logger.log(`Submitting OCR job — uploadId=${uploadId} docType=${docType}`);

    return firstValueFrom(
      this.http
        .post<OcrSubmitResponse>(this.ocrJobApiUrl, form, { headers: form.getHeaders() })
        .pipe(map((r) => r.data)),
    );
  }

  async getJobStatus(jobId: string): Promise<OcrStatusResponse> {
    return firstValueFrom(
      this.http.get<OcrStatusResponse>(`${this.ocrJobApiUrl}/${jobId}/status`).pipe(map((r) => r.data)),
    );
  }

  async getJobResult(jobId: string): Promise<OcrResultResponse> {
    return firstValueFrom(
      this.http.get<OcrResultResponse>(`${this.ocrJobApiUrl}/${jobId}/result`).pipe(map((r) => r.data)),
    );
  }
}
