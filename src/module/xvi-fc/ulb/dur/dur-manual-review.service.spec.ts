import { ConflictException } from '@nestjs/common';
import { DurManualReviewService } from './dur-manual-review.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

/** Mimics a Mongoose query chain — `.select()`/`.lean()` are no-ops that return the same
 *  chain object, `.exec()` resolves to the given value, regardless of call order. */
function mockQuery<T>(result: T) {
  const query: Record<string, unknown> = { exec: () => Promise.resolve(result) };
  query.select = () => query;
  query.lean = () => query;
  return query;
}

describe('DurManualReviewService.getManualReviewQueue', () => {
  let service: DurManualReviewService;
  let mockDurModel: { aggregate: jest.Mock };
  let mockFileTokenService: { signFileUrl: jest.Mock };

  const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

  beforeEach(() => {
    mockDurModel = { aggregate: jest.fn().mockReturnValue(mockQuery([{ data: [], totalCount: [] }])) };
    mockFileTokenService = { signFileUrl: jest.fn().mockReturnValue('https://signed.example.com/s3/path.pdf') };

    service = new DurManualReviewService(
      mockDurModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockFileTokenService as any,
    );
  });

  it('rejects non-ADMIN users', async () => {
    const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

    await expect(service.getManualReviewQueue({ page: 1, pageSize: 20 }, stateUser)).rejects.toThrow(
      'Only ADMIN users may view the manual-review queue',
    );
  });

  it('returns the paginated shape from the aggregation result, signing filePath into a fileUrl', async () => {
    const row = { durId: 'dur-1', ulbName: 'Test ULB', docId: 'tiedGrant', filePath: 's3/path.pdf' };
    mockDurModel.aggregate.mockReturnValue(mockQuery([{ data: [row], totalCount: [{ count: 1 }] }]));

    const result = await service.getManualReviewQueue({ page: 1, pageSize: 20 }, adminUser);

    expect(result).toEqual({
      total: 1,
      page: 1,
      pageSize: 20,
      rows: [{ durId: 'dur-1', ulbName: 'Test ULB', docId: 'tiedGrant', fileUrl: 'https://signed.example.com/s3/path.pdf' }],
    });
  });

  it('returns an empty page when nothing is pending', async () => {
    const result = await service.getManualReviewQueue({ page: 1, pageSize: 20 }, adminUser);

    expect(result).toEqual({ total: 0, page: 1, pageSize: 20, rows: [] });
  });
});

describe('DurManualReviewService.decideManualReview', () => {
  let service: DurManualReviewService;
  let mockDurModel: { findById: jest.Mock; updateOne: jest.Mock };
  let mockUserModel: { findById: jest.Mock };
  let mockManualReviewRequestModel: { findOneAndUpdate: jest.Mock; create: jest.Mock };
  let mockDurService: { getProcessingStatus: jest.Mock };

  const adminUser: AuthUser = { _id: '507f1f77bcf86cd799439099', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;

  const DUR_ID = '507f1f77bcf86cd799439014';

  const durWithDocSlot = (docSlotOverrides: Record<string, unknown> = {}) => ({
    _id: DUR_ID,
    ulb: '507f1f77bcf86cd799439011',
    design_year: '507f1f77bcf86cd799439013',
    documents: [
      {
        docId: 'tiedGrant',
        currentUpload: { ocrInfo: { isManualReviewRequested: true }, uploadId: 'upload-1' },
        manualReviewDecision: null,
        manualReviewRejectionCount: 0,
        ...docSlotOverrides,
      },
    ],
  });

  beforeEach(() => {
    mockDurModel = { findById: jest.fn(), updateOne: jest.fn() };
    mockUserModel = { findById: jest.fn().mockReturnValue(mockQuery({ name: 'Admin User' })) };
    mockManualReviewRequestModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'request-1' }),
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockDurService = { getProcessingStatus: jest.fn().mockResolvedValue({}) };

    service = new DurManualReviewService(
      mockDurModel as any,
      {} as any,
      mockUserModel as any,
      mockManualReviewRequestModel as any,
      mockDurService as any,
      {} as any,
    );
  });

  it('rejects a second decision on a document that has already been decided', async () => {
    mockDurModel.findById.mockReturnValue(mockQuery(durWithDocSlot({ manualReviewDecision: { status: 'APPROVED' } })));

    await expect(
      service.decideManualReview(DUR_ID, 'tiedGrant' as any, { decision: 'RETURNED' } as any, adminUser),
    ).rejects.toThrow('This manual review request has already been decided.');

    expect(mockDurModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects with a conflict when a concurrent decision already landed between the read and the write', async () => {
    mockDurModel.findById.mockReturnValue(mockQuery(durWithDocSlot()));
    mockDurModel.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(
      service.decideManualReview(DUR_ID, 'tiedGrant' as any, { decision: 'APPROVED' } as any, adminUser),
    ).rejects.toThrow(ConflictException);
  });

  it('applies the decision when the document is still undecided', async () => {
    mockDurModel.findById.mockReturnValue(mockQuery(durWithDocSlot()));
    mockDurModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await service.decideManualReview(DUR_ID, 'tiedGrant' as any, { decision: 'APPROVED' } as any, adminUser);

    expect(mockDurModel.updateOne).toHaveBeenCalledWith(
      { _id: DUR_ID, documents: { $elemMatch: { docId: 'tiedGrant', manualReviewDecision: null } } },
      expect.objectContaining({ $set: expect.objectContaining({ 'documents.$.processingStatus': 'PASSED' }) }),
    );
  });
});
