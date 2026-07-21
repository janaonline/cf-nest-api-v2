import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AnnualAccountOcrApiService, OcrSubmitJobDto } from './annual-account-ocr-api.service';

describe('AnnualAccountOcrApiService', () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let config: { get: jest.Mock };

  const makeSubmitDto = (overrides: Partial<OcrSubmitJobDto> = {}): OcrSubmitJobDto => ({
    pdfBuffer: Buffer.from('pdf-content'),
    fileName: 'income.pdf',
    docType: 'income_expenditure',
    ulbName: 'Test ULB|test-ulb|keyword',
    uploadId: 'upload-42',
    financialYear: '2024-25',
    ...overrides,
  });

  const makeService = (baseUrl = 'https://dev.cityfinance.in/api/v2/') => {
    config = { get: jest.fn().mockReturnValue(baseUrl) };
    http = { post: jest.fn(), get: jest.fn() };
    return new AnnualAccountOcrApiService(http as unknown as HttpService, config as unknown as ConfigService);
  };

  afterEach(() => jest.clearAllMocks());

  it('derives the OCR job API URL from BASE_URL origin, swapping the API version segment', async () => {
    const service = makeService('https://dev.cityfinance.in/api/v2/');
    http.post.mockReturnValue(of({ data: { job_id: 'job-1', status: 'pending' } }));

    await service.submitJob(makeSubmitDto());

    expect(http.post).toHaveBeenCalledWith(
      'https://dev.cityfinance.in/api/v3/ocr-validation/jobs',
      expect.anything(),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('falls back to a relative path when BASE_URL is not configured', async () => {
    const service = makeService('');
    http.post.mockReturnValue(of({ data: { job_id: 'job-1', status: 'pending' } }));

    await service.submitJob(makeSubmitDto());

    expect(http.post).toHaveBeenCalledWith('/api/v3/ocr-validation/jobs', expect.anything(), expect.anything());
  });

  it('submits the OCR job as multipart form data and returns the mapped response', async () => {
    const service = makeService();
    http.post.mockReturnValue(of({ data: { job_id: 'job-42', status: 'pending' } }));

    const result = await service.submitJob(makeSubmitDto());

    expect(result).toEqual({ job_id: 'job-42', status: 'pending' });
    const [, formArg] = http.post.mock.calls[0];
    expect(formArg.getHeaders).toBeDefined();
  });

  it('fetches job status by id', async () => {
    const service = makeService();
    http.get.mockReturnValue(of({ data: { job_id: 'job-1', status: 'processing', progress_step: 'ocr' } }));

    const result = await service.getJobStatus('job-1');

    expect(http.get).toHaveBeenCalledWith('https://dev.cityfinance.in/api/v3/ocr-validation/jobs/job-1/status');
    expect(result.status).toBe('processing');
    expect(result.progress_step).toBe('ocr');
  });

  it('fetches job result by id', async () => {
    const service = makeService();
    http.get.mockReturnValue(
      of({
        data: {
          job_id: 'job-1',
          status: 'completed',
          result: { basic_validation: { validation_status: 'PASS' } },
        },
      }),
    );

    const result = await service.getJobResult('job-1');

    expect(http.get).toHaveBeenCalledWith('https://dev.cityfinance.in/api/v3/ocr-validation/jobs/job-1/result');
    expect(result.result?.basic_validation?.validation_status).toBe('PASS');
  });

  it('propagates errors raised by the underlying HTTP client', async () => {
    const service = makeService();
    http.get.mockReturnValue(throwError(() => new Error('network error')));

    await expect(service.getJobStatus('job-1')).rejects.toThrow('network error');
  });
});
