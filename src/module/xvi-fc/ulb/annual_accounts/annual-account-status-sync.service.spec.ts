import { Types } from 'mongoose';
import { AnnualAccountStatusSyncService } from './annual-account-status-sync.service';

describe('AnnualAccountStatusSyncService', () => {
  let service: AnnualAccountStatusSyncService;
  let annualAccountModel: { updateOne: jest.Mock };
  let uploadHistoryModel: { find: jest.Mock; updateOne: jest.Mock };
  let ocrApi: { getJobStatus: jest.Mock; getJobResult: jest.Mock };

  const findChain = (docs: any[]) => ({
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(docs),
  });

  const makeDoc = (overrides: Record<string, any> = {}) => ({
    uploadId: 'upload-1',
    annualAccountId: new Types.ObjectId().toString(),
    section: 'incomeExpenditure',
    docId: 'doc-1',
    ocrInfo: { jobId: 'ocr-job-1', progressStep: 'validating' },
    ...overrides,
  });

  beforeEach(() => {
    annualAccountModel = { updateOne: jest.fn().mockResolvedValue({}) };
    uploadHistoryModel = {
      find: jest.fn().mockReturnValue(findChain([])),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    ocrApi = { getJobStatus: jest.fn(), getJobResult: jest.fn() };

    service = new AnnualAccountStatusSyncService(annualAccountModel as any, uploadHistoryModel as any, ocrApi as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when no PROCESSING uploads are found', async () => {
    uploadHistoryModel.find.mockReturnValue(findChain([]));

    await service.syncPendingJobs();

    expect(ocrApi.getJobStatus).not.toHaveBeenCalled();
    expect(uploadHistoryModel.updateOne).not.toHaveBeenCalled();
  });

  it('skips a tick when a previous sync is still running', async () => {
    (service as any).isSyncing = true;

    await service.syncPendingJobs();

    expect(uploadHistoryModel.find).not.toHaveBeenCalled();
  });

  it('writes PASSED when a completed job has PASS validation', async () => {
    const doc = makeDoc();
    uploadHistoryModel.find.mockReturnValue(findChain([doc]));
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: { basic_validation: { validation_status: 'PASS' }, error_messages: [] },
    });

    await service.syncPendingJobs();

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'PASSED', 'ocrInfo.status': 'COMPLETED' }),
      }),
    );
    expect(annualAccountModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'incomeExpenditure.documents.docId': 'doc-1' }),
      expect.objectContaining({
        $set: expect.objectContaining({ 'incomeExpenditure.documents.$.processingStatus': 'PASSED' }),
      }),
    );
  });

  it('writes FAILED when a completed job has FAIL validation (mismatch)', async () => {
    const doc = makeDoc({ uploadId: 'upload-2', docId: 'doc-2' });
    uploadHistoryModel.find.mockReturnValue(findChain([doc]));
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'completed' });
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'ocr-job-1',
      status: 'completed',
      result: { basic_validation: { validation_status: 'FAIL', validation_details: 'mismatch' }, error_messages: ['bad'] },
    });

    await service.syncPendingJobs();

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-2' },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'FAILED', 'ocrInfo.validationStatus': 'FAIL' }),
      }),
    );
  });

  it('writes FAILED when the remote job reports a failure', async () => {
    const doc = makeDoc({ uploadId: 'upload-3', docId: 'doc-3' });
    uploadHistoryModel.find.mockReturnValue(findChain([doc]));
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'failed', message: 'engine error' });

    await service.syncPendingJobs();

    expect(ocrApi.getJobResult).not.toHaveBeenCalled();
    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-3' },
      expect.objectContaining({ $set: expect.objectContaining({ processingStatus: 'FAILED', error: 'engine error' }) }),
    );
  });

  it('records a progress-step change without settling the job', async () => {
    const doc = makeDoc({ uploadId: 'upload-4', docId: 'doc-4', ocrInfo: { jobId: 'ocr-job-1', progressStep: 'queued' } });
    uploadHistoryModel.find.mockReturnValue(findChain([doc]));
    ocrApi.getJobStatus.mockResolvedValue({ job_id: 'ocr-job-1', status: 'processing', progress_step: 'extracting' });

    await service.syncPendingJobs();

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-4' },
      expect.objectContaining({ $set: expect.objectContaining({ 'ocrInfo.progressStep': 'extracting' }) }),
    );
    expect(ocrApi.getJobResult).not.toHaveBeenCalled();
  });

  it('marks the upload FAILED when the remote job is gone (404)', async () => {
    const doc = makeDoc({ uploadId: 'upload-5', docId: 'doc-5' });
    uploadHistoryModel.find.mockReturnValue(findChain([doc]));
    ocrApi.getJobStatus.mockRejectedValue({ response: { status: 404 } });

    await service.syncPendingJobs();

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-5' },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'FAILED', error: 'OCR job not found on processing server (404)' }),
      }),
    );
  });

  it('leaves the upload untouched and logs when a non-404 error occurs', async () => {
    const doc = makeDoc({ uploadId: 'upload-6', docId: 'doc-6' });
    uploadHistoryModel.find.mockReturnValue(findChain([doc]));
    ocrApi.getJobStatus.mockRejectedValue(new Error('temporary network error'));

    await service.syncPendingJobs();

    expect(uploadHistoryModel.updateOne).not.toHaveBeenCalled();
  });

  it('resets isSyncing after an error while loading PROCESSING uploads, allowing the next tick to run', async () => {
    uploadHistoryModel.find
      .mockReturnValueOnce({ lean: jest.fn().mockReturnThis(), exec: jest.fn().mockRejectedValue(new Error('db down')) })
      .mockReturnValueOnce(findChain([]));

    await service.syncPendingJobs();
    expect((service as any).isSyncing).toBe(false);

    await service.syncPendingJobs();
    expect(uploadHistoryModel.find).toHaveBeenCalledTimes(2);
  });

  it('processes multiple PROCESSING uploads concurrently', async () => {
    const docA = makeDoc({ uploadId: 'upload-a', docId: 'doc-a', ocrInfo: { jobId: 'job-a', progressStep: null } });
    const docB = makeDoc({ uploadId: 'upload-b', docId: 'doc-b', ocrInfo: { jobId: 'job-b', progressStep: null } });
    uploadHistoryModel.find.mockReturnValue(findChain([docA, docB]));
    ocrApi.getJobStatus.mockImplementation((jobId: string) =>
      Promise.resolve(
        jobId === 'job-a' ? { job_id: 'job-a', status: 'completed' } : { job_id: 'job-b', status: 'processing' },
      ),
    );
    ocrApi.getJobResult.mockResolvedValue({
      job_id: 'job-a',
      status: 'completed',
      result: { basic_validation: { validation_status: 'PASS' } },
    });

    await service.syncPendingJobs();

    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId: 'upload-a' },
      expect.objectContaining({ $set: expect.objectContaining({ processingStatus: 'PASSED' }) }),
    );
    expect(uploadHistoryModel.updateOne).not.toHaveBeenCalledWith(
      { uploadId: 'upload-b' },
      expect.objectContaining({ $set: expect.objectContaining({ processingStatus: expect.anything() }) }),
    );
  });
});
