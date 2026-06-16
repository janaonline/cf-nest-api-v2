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
  status: string; // PENDING | PROCESSING | COMPLETED | FAILED
  progress_step?: string;
  message?: string;
}

export interface OcrResultResponse {
  job_id: string;
  validation_status: string; // PASSED | FAILED
  validation_details?: string;
  failed_checks?: string[];
}

@Injectable()
export class AnnualAccountOcrApiService {
  private readonly logger = new Logger(AnnualAccountOcrApiService.name);
  private readonly ocrJobApiUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    const baseUrl = this.config.get<string | undefined>('DIGITIZATION_API_URL') || '';
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

    this.logger.log(`Submitting OCR job — uploadId=${uploadId} docType=${docType}`);

    return firstValueFrom(
      this.http
        .post<OcrSubmitResponse>(this.ocrJobApiUrl, form, { headers: form.getHeaders() })
        .pipe(map((r) => r.data)),
    );
  }

  async getJobStatus(jobId: string): Promise<OcrStatusResponse> {
    return firstValueFrom(this.http.get<OcrStatusResponse>(`${this.ocrJobApiUrl}/${jobId}`).pipe(map((r) => r.data)));
  }

  async getJobResult(jobId: string): Promise<OcrResultResponse> {
    return firstValueFrom(
      this.http.get<OcrResultResponse>(`${this.ocrJobApiUrl}/${jobId}/result`).pipe(map((r) => r.data)),
    );
  }
}
