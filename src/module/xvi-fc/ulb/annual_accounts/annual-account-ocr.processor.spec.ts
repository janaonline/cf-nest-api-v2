import { Types } from 'mongoose';
import { AnnualAccountOcrProcessor } from './annual-account-ocr.processor';
import type { AnnualAccountOcrJobData } from './dto/annual-account-ocr-job.dto';

describe('AnnualAccountOcrProcessor', () => {
  let processor: AnnualAccountOcrProcessor;
  let annualAccountModel: { updateOne: jest.Mock; findById: jest.Mock; findOne: jest.Mock };
  let uploadHistoryModel: { updateOne: jest.Mock };
  let ulbModel: { findById: jest.Mock };
  let s3Service: { getPdfBufferFromS3: jest.Mock };
  let ocrApi: { submitJob: jest.Mock; getJobStatus: jest.Mock; getJobResult: jest.Mock };

  const ulbId = new Types.ObjectId().toString();
  const annualAccountId = new Types.ObjectId().toString();

  const makeJobData = (overrides: Partial<AnnualAccountOcrJobData> = {}): AnnualAccountOcrJobData => ({
    uploadId: 'upload-1',
    annualAccountId,
    ulbId,
    section: 'auditedData',
    docId: 'doc-1',
    s3Key: 'xvi-fc/annual-accounts/file.pdf',
    expectedDocType: 'income_expenditure',
    financialYear: '2024-25',
    ...overrides,
  });

  const makeJob = (overrides: Partial<AnnualAccountOcrJobData> = {}) =>
    ({
      id: 'bull-job-1',
      data: makeJobData(overrides),
    }) as any;

  const findByIdChain = (value: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    jest.useFakeTimers();

    annualAccountModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      findById: jest.fn(),
      findOne: jest.fn(),
    };
    uploadHistoryModel = { updateOne: jest.fn().mockResolvedValue({}) };
    ulbModel = {
      findById: jest.fn().mockReturnValue(findByIdChain({ name: 'Test ULB', slug: 'test-ulb', keywords: 'kw' })),
    };
    s3Service = { getPdfBufferFromS3: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    ocrApi = {
      submitJob: jest.fn().mockResolvedValue({ job_id: 'ocr-job-1', status: 'pending' }),
      getJobStatus: jest.fn(),
      getJobResult: jest.fn(),
    };

    processor = new AnnualAccountOcrProcessor(
      annualAccountModel as any,
      uploadHistoryModel as any,
      ulbModel as any,
      s3Service as any,
      ocrApi as any,
    );
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

  it('marks the upload history as active and submits the OCR job with the downloaded PDF', async () => {
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: { basic_validation: { validation_status: 'PASS' } },
    });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ 'queue.bullJobId': 'bull-job-1', 'queue.status': 'active' }),
      }),
    );
    expect(s3Service.getPdfBufferFromS3).toHaveBeenCalledWith('xvi-fc/annual-accounts/file.pdf');
    expect(ocrApi.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: 'income_expenditure',
        uploadId: 'upload-1',
        fileName: 'doc-1-upload-1.pdf',
        ulbName: 'Test ULB|test-ulb|kw',
      }),
    );
  });

  it('writes a PASSED processingStatus when the OCR job completes with PASS validation', async () => {
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: { basic_validation: { validation_status: 'PASS' }, error_messages: [] },
    });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'PASSED', 'ocrInfo.status': 'COMPLETED' }),
      }),
    );
    expect(annualAccountModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'documents.docId': 'doc-1' }),
      expect.objectContaining({
        $set: expect.objectContaining({ 'documents.$.processingStatus': 'PASSED' }),
      }),
    );
  });

  it('writes a FAILED processingStatus when the OCR job completes with FAIL validation (mismatch)', async () => {
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: {
        basic_validation: { validation_status: 'FAIL', validation_details: 'Document mismatch' },
        error_messages: ['expected income_expenditure but got balance_sheet'],
      },
    });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          processingStatus: 'FAILED',
          'ocrInfo.validationStatus': 'FAIL',
          'ocrInfo.validationDetails': 'Document mismatch',
          'ocrInfo.failedChecks': ['expected income_expenditure but got balance_sheet'],
        }),
      }),
    );
  });

  it("resolves the 'unauditedData' sibling document by {ulb, design_year, sectionType} and writes to its own _id, not the audited anchor's", async () => {
    const siblingId = new Types.ObjectId();
    const ulbObjId = new Types.ObjectId();
    const yearObjId = new Types.ObjectId();
    annualAccountModel.findById.mockReturnValue(findByIdChain({ ulb: ulbObjId, design_year: yearObjId }));
    annualAccountModel.findOne.mockReturnValue(findByIdChain({ _id: siblingId }));
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: { basic_validation: { validation_status: 'PASS' } },
    });

    const processPromise = processor.process(makeJob({ section: 'unauditedData' }));
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(annualAccountModel.findById).toHaveBeenCalled();
    expect(annualAccountModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ ulb: ulbObjId, design_year: yearObjId, sectionType: 'unaudited' }),
    );
    expect(annualAccountModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: siblingId, 'documents.docId': 'doc-1' }),
      expect.anything(),
    );
  });

  it('writes a FAILED status when the OCR job itself fails', async () => {
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'failed', message: 'OCR engine error' });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(ocrApi.getJobResult).not.toHaveBeenCalled();
    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'FAILED', error: 'OCR engine error', 'queue.status': 'failed' }),
      }),
    );
    expect(annualAccountModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'documents.docId': 'doc-1' }),
      expect.objectContaining({
        $set: expect.objectContaining({ 'documents.$.processingStatus': 'FAILED' }),
      }),
    );
  });

  it('records progress-step updates emitted while polling', async () => {
    ocrApi.getJobStatus
      .mockResolvedValueOnce({ job_id: 'ocr-job-1', status: 'processing', progress_step: 'extracting' })
      .mockResolvedValueOnce({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: { basic_validation: { validation_status: 'PASS' } },
    });

    const processPromise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    await processPromise;

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({ $set: expect.objectContaining({ 'ocrInfo.progressStep': 'extracting' }) }),
    );
    expect(ocrApi.getJobStatus).toHaveBeenCalledTimes(2);
  });

  it('leaves the job unsettled after exhausting all polls when the OCR job never completes', async () => {
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'processing' });

    const processPromise = processor.process(makeJob());
    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    await processPromise;

    expect(ocrApi.getJobStatus).toHaveBeenCalledTimes(10);
    expect(ocrApi.getJobResult).not.toHaveBeenCalled();
    // No terminal write — only the initial "active" update and the post-submit ocrInfo update happened
    // (no progress_step was ever returned, so the in-loop progress update never fired).
    expect(uploadHistoryModel.updateOne).toHaveBeenCalledTimes(2);
    expect(uploadHistoryModel.updateOne).not.toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({ $set: expect.objectContaining({ processingStatus: expect.anything() }) }),
    );
  });
});
