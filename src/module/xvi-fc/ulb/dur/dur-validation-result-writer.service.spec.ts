import { DurValidationResultWriter } from './dur-validation-result-writer.service';

describe('DurValidationResultWriter', () => {
  let writer: DurValidationResultWriter;
  let durModel: { updateOne: jest.Mock; findOne: jest.Mock };

  const durId = '6ab0f9267e9a30b72fae8d4c';
  const docId = 'tiedGrant';

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
    writer = new DurValidationResultWriter(durModel as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('writes PASSED when checks.overall_valid is true', async () => {
    await writer.writeCompleted(durId, docId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: { checks: { overall_valid: true } as any },
    });

    expect(durModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'documents.docId': docId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.processingStatus': 'PASSED',
          'documents.$.currentUpload.ocrInfo.validationStatus': 'PASS',
        }),
      }),
    );
  });

  it('writes FAILED with failed_checks and extraction notes when checks.overall_valid is false — real API shape', async () => {
    await writer.writeCompleted(durId, docId, {
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
      expect.objectContaining({ 'documents.docId': docId }),
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
    await writer.writeFailed(durId, docId, 'Gemini upload timed out');

    expect(durModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'documents.docId': docId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'documents.$.processingStatus': 'FAILED',
          'documents.$.currentUpload.ocrInfo.validationDetails': 'Gemini upload timed out',
        }),
      }),
    );
  });

  it('sets uploadBlockedUntil once attempts are exhausted for a document already in a rejection cycle', async () => {
    durModel.findOne.mockReturnValue(
      findByIdChain({ documents: [{ manualReviewDecision: { status: 'RETURNED' }, postRejectionAttemptsUsed: 2 }] }),
    );

    await writer.writeCompleted(durId, docId, {
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

  it('clears manual-review/cooldown state entirely once a document passes', async () => {
    await writer.writeCompleted(durId, docId, {
      job_id: 'dur-job-1',
      status: 'completed',
      result: { checks: { overall_valid: true } as any },
    });

    expect(durModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'documents.docId': docId }),
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
