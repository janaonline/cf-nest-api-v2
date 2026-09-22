import { DurManualReviewService } from './dur-manual-review.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

/** Mimics a Mongoose query chain — `.exec()` resolves to the given value. */
function mockQuery<T>(result: T) {
  const query: Record<string, unknown> = { exec: () => Promise.resolve(result) };
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
