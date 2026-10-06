import { DurValidationResultWriter } from './dur-validation-result-writer.service';

describe('DurValidationResultWriter', () => {
  let writer: DurValidationResultWriter;
  let durModel: { updateOne: jest.Mock; findOne: jest.Mock };
  let uploadHistoryModel: { updateOne: jest.Mock };

  const durId = '6ab0f9267e9a30b72fae8d4c';
  const docId = 'tiedGrant';
  const uploadId = 'upload-1';
  const elemMatchFilter = expect.objectContaining({
    documents: { $elemMatch: { docId, 'currentUpload.uploadId': uploadId } },
  });

  const findByIdChain = (value: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    durModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockReturnValue(findByIdChain(null)),
    };
    uploadHistoryModel = { updateOne: jest.fn().mockResolvedValue({}) };
    writer = new DurValidationResultWriter(durModel as any, uploadHistoryModel as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('writes PASSED when checks.overall_valid is true', async () => {
    await writer.writeCompleted(durId, docId, uploadId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: { checks: { overall_valid: true } as any },
    });

    expect(durModel.updateOne).toHaveBeenCalledWith(
      elemMatchFilter,
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.processingStatus': 'PASSED',
          'documents.$.currentUpload.ocrInfo.validationStatus': 'PASS',
        }),
      }),
    );
    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'PASSED', 'ocrInfo.validationStatus': 'PASS' }),
      }),
    );
  });

  it('writes FAILED with failed_checks and extraction notes when checks.overall_valid is false — real API shape', async () => {
    await writer.writeCompleted(durId, docId, uploadId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: {
        checks: {
          ulb_name_match: false,
          financial_year_match: false,
          format_valid: false,
          signature_present: true,
          seal_present: true,
          overall_valid: false,
        },
        failed_checks: [
          "ulb_name_mismatch: expected 'Banga Municipality|banga-municipality', extracted 'Muncipal Council- Shri Naina Devi Ji'",
          "financial_year_mismatch: expected '2026-27', extracted 'None'",
          'format_invalid: Missing DUR title and subtitle',
        ],
        extraction: { is_dur_format: false, extraction_notes: 'The document is an Audit Report, not a DUR.' },
      },
    });

    expect(durModel.updateOne).toHaveBeenCalledWith(
      elemMatchFilter,
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.processingStatus': 'FAILED',
          'documents.$.currentUpload.ocrInfo.validationStatus': 'FAIL',
          'documents.$.currentUpload.ocrInfo.validationDetails': 'The document is an Audit Report, not a DUR.',
          'documents.$.currentUpload.ocrInfo.failedChecks': expect.arrayContaining([
            expect.stringContaining('ulb_name_mismatch'),
          ]),
        }),
      }),
    );
  });

  it('writeFailed records a job-level failure reason, distinct from a content-validation failure', async () => {
    await writer.writeFailed(durId, docId, uploadId, 'Gemini upload timed out');

    expect(durModel.updateOne).toHaveBeenCalledWith(
      elemMatchFilter,
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.processingStatus': 'FAILED',
          'documents.$.currentUpload.ocrInfo.validationDetails': 'Gemini upload timed out',
        }),
      }),
    );
    expect(uploadHistoryModel.updateOne).toHaveBeenCalledWith(
      { uploadId },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: 'FAILED', 'ocrInfo.validationDetails': 'Gemini upload timed out' }),
      }),
    );
  });

  it('sets uploadBlockedUntil once attempts are exhausted for a document already in a rejection cycle', async () => {
    durModel.findOne.mockReturnValue(
      findByIdChain({ documents: [{ manualReviewDecision: { status: 'RETURNED' }, postRejectionAttemptsUsed: 2 }] }),
    );

    await writer.writeCompleted(durId, docId, uploadId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: { checks: { overall_valid: false } as any, failed_checks: [] },
    });

    const call = durModel.updateOne.mock.calls.find(
      ([, update]: [unknown, { $set?: Record<string, unknown> }]) => update?.$set?.['documents.$.processingStatus'] !== undefined,
    );
    const set = call?.[1]?.$set as Record<string, unknown>;
    expect(set['documents.$.postRejectionAttemptsUsed']).toBe(3);
    expect(set['documents.$.uploadBlockedUntil']).toBeInstanceOf(Date);
  });

  it('starts a fresh batch of attempts once a previous cooldown has already run its course', async () => {
    // uploadBlockedUntil in the past means the ULB already served out a full lock before this
    // retry was ever allowed to start — this failure should count as attempt 1 of a new batch,
    // not attempt 4 of the exhausted one, and the stale lock timestamp should clear.
    durModel.findOne.mockReturnValue(
      findByIdChain({
        documents: [
          {
            manualReviewDecision: { status: 'RETURNED' },
            postRejectionAttemptsUsed: 3,
            uploadBlockedUntil: new Date(Date.now() - 60_000),
          },
        ],
      }),
    );

    await writer.writeCompleted(durId, docId, uploadId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: { checks: { overall_valid: false } as any, failed_checks: [] },
    });

    const call = durModel.updateOne.mock.calls.find(
      ([, update]: [unknown, { $set?: Record<string, unknown> }]) => update?.$set?.['documents.$.processingStatus'] !== undefined,
    );
    const set = call?.[1]?.$set as Record<string, unknown>;
    expect(set['documents.$.postRejectionAttemptsUsed']).toBe(1);
    expect(set['documents.$.uploadBlockedUntil']).toBeNull();
  });

  it('re-locks only after a full fresh batch of 3 failures, not after the first one post-cooldown', async () => {
    // Simulates the real sequence: a cooldown already expired (postRejectionAttemptsUsed=3,
    // uploadBlockedUntil in the past), then three fresh failures in a row — each write's resulting
    // docSlot state feeds the next findOne, just like reading it back from Mongo would.
    let docSlot: Record<string, unknown> = {
      manualReviewDecision: { status: 'RETURNED' },
      postRejectionAttemptsUsed: 3,
      uploadBlockedUntil: new Date(Date.now() - 60_000),
    };
    const latestSet = () => {
      const call = durModel.updateOne.mock.calls.at(-1);
      return (call?.[1] as { $set?: Record<string, unknown> })?.$set as Record<string, unknown>;
    };
    const runFailure = async () => {
      durModel.findOne.mockReturnValue(findByIdChain({ documents: [docSlot] }));
      await writer.writeCompleted(durId, docId, uploadId, {
        job_id: 'dur-job-1',
        status: 'completed',
        result: { checks: { overall_valid: false } as any, failed_checks: [] },
      });
      const set = latestSet();
      docSlot = {
        ...docSlot,
        postRejectionAttemptsUsed: set['documents.$.postRejectionAttemptsUsed'],
        uploadBlockedUntil: set['documents.$.uploadBlockedUntil'] ?? null,
      };
      return set;
    };

    const first = await runFailure();
    expect(first['documents.$.postRejectionAttemptsUsed']).toBe(1);
    expect(first['documents.$.uploadBlockedUntil']).toBeNull();

    const second = await runFailure();
    expect(second['documents.$.postRejectionAttemptsUsed']).toBe(2);
    expect(second['documents.$.uploadBlockedUntil']).toBeUndefined(); // not set yet, not cleared again

    const third = await runFailure();
    expect(third['documents.$.postRejectionAttemptsUsed']).toBe(3);
    expect(third['documents.$.uploadBlockedUntil']).toBeInstanceOf(Date); // re-locked
  });

  it('clears manual-review/cooldown state entirely once a document passes', async () => {
    await writer.writeCompleted(durId, docId, uploadId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: { checks: { overall_valid: true } as any },
    });

    expect(durModel.updateOne).toHaveBeenCalledWith(
      elemMatchFilter,
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.manualReviewDecision': null,
          'documents.$.postRejectionAttemptsUsed': 0,
          'documents.$.manualReviewRejectionCount': 0,
          'documents.$.uploadBlockedUntil': null,
        }),
      }),
    );
  });
});
