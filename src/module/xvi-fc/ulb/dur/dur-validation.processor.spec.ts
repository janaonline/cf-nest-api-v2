import { Types } from 'mongoose';
import { DurValidationProcessor } from './dur-validation.processor';
import type { DurValidationJobData } from './dto/dur-validation-job.dto';

describe('DurValidationProcessor', () => {
  let processor: DurValidationProcessor;
  let durModel: { updateOne: jest.Mock };
  let ulbModel: { findById: jest.Mock };
  let s3Service: { getPdfBufferFromS3: jest.Mock };
  let durApi: { submitJob: jest.Mock; getJobStatus: jest.Mock; getJobResult: jest.Mock };
  let resultWriter: { writeCompleted: jest.Mock; writeFailed: jest.Mock };

  const ulbId = new Types.ObjectId().toString();
  const durId = new Types.ObjectId().toString();

  const makeJobData = (overrides: Partial<DurValidationJobData> = {}): DurValidationJobData => ({
    uploadId: 'upload-1',
    durId,
    ulbId,
    docId: 'tiedGrant',
    s3Key: 'xvi-fc/dur/file.pdf',
    financialYear: '2026-27',
    ...overrides,
  });

  const makeJob = (overrides: Partial<DurValidationJobData> = {}) => ({ id: 'bull-job-1', data: makeJobData(overrides) }) as any;

  const findByIdChain = (value: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    jest.useFakeTimers();

    durModel = { updateOne: jest.fn().mockResolvedValue({}) };
    ulbModel = { findById: jest.fn().mockReturnValue(findByIdChain({ name: 'Banga Municipality', slug: 'banga-municipality' })) };
    s3Service = { getPdfBufferFromS3: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    durApi = {
      submitJob: jest.fn().mockResolvedValue({ job_id: 'dur-job-1', status: 'queued' }),
      getJobStatus: jest.fn(),
      getJobResult: jest.fn(),
    };
    resultWriter = { writeCompleted: jest.fn().mockResolvedValue(undefined), writeFailed: jest.fn().mockResolvedValue(undefined) };

    processor = new DurValidationProcessor(durModel as any, ulbModel as any, s3Service as any, durApi as any, resultWriter as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('throws when the ULB cannot be found', async () => {
    ulbModel.findById.mockReturnValue(findByIdChain(null));

    await expect(processor.process(makeJob())).rejects.toThrow(`ULB not found: ${ulbId}`);
    expect(s3Service.getPdfBufferFromS3).not.toHaveBeenCalled();
  });

  it('submits the job with ulb_name/financial_year/grant_type, no doc_type/upload_id/audit_type fields', async () => {
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed' });
    durApi.getJobResult.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed', result: { checks: { overall_valid: true } as any } });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(durApi.submitJob).toHaveBeenCalledWith({
      pdfBuffer: expect.any(Buffer),
      fileName: 'tiedGrant-upload-1.pdf',
      ulbName: 'Banga Municipality|banga-municipality',
      financialYear: '2026-27',
      grantType: 'tied',
    });
  });

  it('derives grant_type from docId — untiedGrant maps to "untied"', async () => {
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed' });
    durApi.getJobResult.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed', result: { checks: { overall_valid: true } as any } });

    const processPromise = processor.process(makeJob({ docId: 'untiedGrant' }));
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(durApi.submitJob).toHaveBeenCalledWith(expect.objectContaining({ grantType: 'untied' }));
  });

  it('delegates a completed job to DurValidationResultWriter.writeCompleted', async () => {
    const resultResponse = { job_id: 'dur-job-1', status: 'completed', result: { checks: { overall_valid: true } as any } };
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed' });
    durApi.getJobResult.mockResolvedValue(resultResponse);

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(resultWriter.writeCompleted).toHaveBeenCalledWith(durId, 'tiedGrant', resultResponse);
    expect(resultWriter.writeFailed).not.toHaveBeenCalled();
  });

  it('delegates a failed job to DurValidationResultWriter.writeFailed without fetching /result', async () => {
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'failed', error_message: 'Gemini upload timed out' });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(durApi.getJobResult).not.toHaveBeenCalled();
    expect(resultWriter.writeFailed).toHaveBeenCalledWith(durId, 'tiedGrant', 'Gemini upload timed out');
    expect(resultWriter.writeCompleted).not.toHaveBeenCalled();
  });

  it('writes FAILED via the result writer when submitJob times out — the real observed hang case', async () => {
    durApi.submitJob.mockRejectedValue(Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }));

    await processor.process(makeJob());

    expect(resultWriter.writeFailed).toHaveBeenCalledWith(
      durId,
      'tiedGrant',
      'The validation service did not respond in time. Please try again.',
    );
    expect(resultWriter.writeCompleted).not.toHaveBeenCalled();
  });

  it('writes FAILED via the result writer for any other validation-call error, without retrying', async () => {
    durApi.submitJob.mockRejectedValue(new Error('502 Bad Gateway'));

    await processor.process(makeJob());

    expect(resultWriter.writeFailed).toHaveBeenCalledWith(durId, 'tiedGrant', 'Failed to validate this document. Please try again.');
  });

  it('leaves the job unsettled (neither writeCompleted nor writeFailed called) after exhausting all polls', async () => {
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'processing' });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000 * 10);
    await processPromise;

    expect(resultWriter.writeCompleted).not.toHaveBeenCalled();
    expect(resultWriter.writeFailed).not.toHaveBeenCalled();
  });

  it('stamps ocrInfo.jobId/status/submittedAt on the document as soon as the job is submitted', async () => {
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed' });
    durApi.getJobResult.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed', result: { checks: { overall_valid: true } as any } });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(durModel.updateOne).toHaveBeenCalledWith(
      { _id: expect.anything(), 'documents.docId': 'tiedGrant' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.currentUpload.ocrInfo.jobId': 'dur-job-1',
          'documents.$.currentUpload.ocrInfo.status': 'queued',
        }),
      }),
    );
  });
});
