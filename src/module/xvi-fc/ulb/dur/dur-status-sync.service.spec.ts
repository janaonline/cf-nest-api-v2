import { Types } from 'mongoose';
import { DurStatusSyncService } from './dur-status-sync.service';

describe('DurStatusSyncService', () => {
  let service: DurStatusSyncService;
  let durModel: { find: jest.Mock };
  let durApi: { getJobStatus: jest.Mock; getJobResult: jest.Mock };
  let resultWriter: { writeCompleted: jest.Mock; writeFailed: jest.Mock };

  const durId = new Types.ObjectId();

  const findChain = (value: unknown) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  const staleSubmittedAt = new Date(Date.now() - 10 * 60 * 1000);

  beforeEach(() => {
    durModel = { find: jest.fn().mockReturnValue(findChain([])) };
    durApi = { getJobStatus: jest.fn(), getJobResult: jest.fn() };
    resultWriter = { writeCompleted: jest.fn().mockResolvedValue(undefined), writeFailed: jest.fn().mockResolvedValue(undefined) };
    service = new DurStatusSyncService(durModel as any, durApi as any, resultWriter as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when no document is stuck PROCESSING past the stale threshold', async () => {
    await service.syncPendingJobs();

    expect(durApi.getJobStatus).not.toHaveBeenCalled();
  });

  it('re-checks a stuck document and writes PASSED via the shared result writer once its job has completed', async () => {
    durModel.find.mockReturnValue(
      findChain([
        {
          _id: durId,
          documents: [
            {
              docId: 'tiedGrant',
              processingStatus: 'PROCESSING',
              currentUpload: { uploadId: 'upload-1', ocrInfo: { jobId: 'dur-job-1', submittedAt: staleSubmittedAt } },
            },
            { docId: 'untiedGrant', processingStatus: 'NOT_STARTED', currentUpload: null },
          ],
        },
      ]),
    );
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed' });
    durApi.getJobResult.mockResolvedValue({ job_id: 'dur-job-1', status: 'completed', result: { checks: { overall_valid: true } as any } });

    await service.syncPendingJobs();

    expect(durApi.getJobStatus).toHaveBeenCalledWith('dur-job-1');
    expect(resultWriter.writeCompleted).toHaveBeenCalledWith(
      durId.toString(),
      'tiedGrant',
      'upload-1',
      expect.objectContaining({ job_id: 'dur-job-1' }),
    );
  });

  it('writes FAILED when the re-checked job comes back failed', async () => {
    durModel.find.mockReturnValue(
      findChain([
        {
          _id: durId,
          documents: [
            {
              docId: 'tiedGrant',
              processingStatus: 'PROCESSING',
              currentUpload: { uploadId: 'upload-1', ocrInfo: { jobId: 'dur-job-1', submittedAt: staleSubmittedAt } },
            },
          ],
        },
      ]),
    );
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'failed', error_message: 'timed out' });

    await service.syncPendingJobs();

    expect(resultWriter.writeFailed).toHaveBeenCalledWith(durId.toString(), 'tiedGrant', 'upload-1', 'timed out');
  });

  it('marks the document FAILED when the validation job is gone (404) on the processing server', async () => {
    durModel.find.mockReturnValue(
      findChain([
        {
          _id: durId,
          documents: [
            {
              docId: 'tiedGrant',
              processingStatus: 'PROCESSING',
              currentUpload: { uploadId: 'upload-1', ocrInfo: { jobId: 'dur-job-1', submittedAt: staleSubmittedAt } },
            },
          ],
        },
      ]),
    );
    durApi.getJobStatus.mockRejectedValue({ status: 404 });

    await service.syncPendingJobs();

    expect(resultWriter.writeFailed).toHaveBeenCalledWith(
      durId.toString(),
      'tiedGrant',
      'upload-1',
      'Validation job not found on processing server (404)',
    );
  });

  it('leaves a still-processing job untouched (no write) and does not throw', async () => {
    durModel.find.mockReturnValue(
      findChain([
        {
          _id: durId,
          documents: [
            {
              docId: 'tiedGrant',
              processingStatus: 'PROCESSING',
              currentUpload: { uploadId: 'upload-1', ocrInfo: { jobId: 'dur-job-1', submittedAt: staleSubmittedAt } },
            },
          ],
        },
      ]),
    );
    durApi.getJobStatus.mockResolvedValue({ job_id: 'dur-job-1', status: 'processing' });

    await service.syncPendingJobs();

    expect(resultWriter.writeCompleted).not.toHaveBeenCalled();
    expect(resultWriter.writeFailed).not.toHaveBeenCalled();
  });

  it('skips a run that overlaps with one still in progress', async () => {
    let resolveFirstGetStatus!: (v: unknown) => void;
    durModel.find.mockReturnValue(
      findChain([
        {
          _id: durId,
          documents: [
            {
              docId: 'tiedGrant',
              processingStatus: 'PROCESSING',
              currentUpload: { uploadId: 'upload-1', ocrInfo: { jobId: 'dur-job-1', submittedAt: staleSubmittedAt } },
            },
          ],
        },
      ]),
    );
    durApi.getJobStatus.mockReturnValue(new Promise((resolve) => (resolveFirstGetStatus = resolve)));

    const firstRun = service.syncPendingJobs();
    const secondRun = service.syncPendingJobs();

    expect(durModel.find).toHaveBeenCalledTimes(1);

    resolveFirstGetStatus({ job_id: 'dur-job-1', status: 'processing' });
    await Promise.all([firstRun, secondRun]);
  });
});
