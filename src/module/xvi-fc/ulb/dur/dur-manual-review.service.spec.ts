import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
      {} as any,
      mockFileTokenService as any,
      {} as any,
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
      {} as any,
      mockDurService as any,
      {} as any,
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

describe('DurManualReviewService.getDocumentDownload', () => {
  let service: DurManualReviewService;
  let mockDurModel: { findById: jest.Mock };
  let mockUploadHistoryModel: { findOne: jest.Mock };
  let mockS3Service: { getObjectStream: jest.Mock };

  const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;
  const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

  const DUR_ID = '507f1f77bcf86cd799439014';
  const fakeStream = { on: jest.fn(), pipe: jest.fn() };

  const uploadRecord = {
    file: { path: 's3/key/tiedGrant.pdf', originalName: 'tiedGrant.pdf', mimeType: 'application/pdf' },
  };

  const durWithDocSlot = (docSlotOverrides: Record<string, unknown> = {}) => ({
    _id: DUR_ID,
    documents: [{ docId: 'tiedGrant', currentUpload: { uploadId: 'upload-1' }, ...docSlotOverrides }],
  });

  beforeEach(() => {
    mockDurModel = { findById: jest.fn() };
    mockUploadHistoryModel = { findOne: jest.fn().mockReturnValue(mockQuery(uploadRecord)) };
    mockS3Service = { getObjectStream: jest.fn().mockResolvedValue(fakeStream) };

    service = new DurManualReviewService(
      mockDurModel as any,
      {} as any,
      {} as any,
      {} as any,
      mockUploadHistoryModel as any,
      {} as any,
      {} as any,
      mockS3Service as any,
    );
  });

  it('rejects non-ADMIN users', async () => {
    await expect(service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, 'upload-1', stateUser)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockUploadHistoryModel.findOne).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the DUR form does not exist and no uploadId is supplied', async () => {
    mockDurModel.findById.mockReturnValue(mockQuery(null));

    await expect(service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, undefined, adminUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the document slot has no upload and no uploadId is supplied', async () => {
    mockDurModel.findById.mockReturnValue(mockQuery(durWithDocSlot({ currentUpload: null })));

    await expect(service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, undefined, adminUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when no upload-history row matches and the live document is on a different upload too', async () => {
    mockUploadHistoryModel.findOne.mockReturnValue(mockQuery(null));
    mockDurModel.findById.mockReturnValue(mockQuery(durWithDocSlot())); // currentUpload.uploadId is 'upload-1'

    await expect(service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, 'stale-upload', adminUser)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockS3Service.getObjectStream).not.toHaveBeenCalled();
  });

  it('falls back to the live document when no history row exists yet but the uploadId is still the current one (pre-migration upload)', async () => {
    mockUploadHistoryModel.findOne.mockReturnValue(mockQuery(null));
    mockDurModel.findById.mockReturnValue(
      mockQuery(
        durWithDocSlot({
          currentUpload: {
            uploadId: 'upload-1',
            file: { path: 's3/key/live-fallback.pdf', originalName: 'live-fallback.pdf', mimeType: 'application/pdf' },
          },
        }),
      ),
    );

    const result = await service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, 'upload-1', adminUser);

    expect(mockS3Service.getObjectStream).toHaveBeenCalledWith('s3/key/live-fallback.pdf');
    expect(result.key).toBe('s3/key/live-fallback.pdf');
  });

  it('resolves a past (superseded) upload directly by uploadId, without touching the live DUR document', async () => {
    const result = await service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, 'old-upload-id', adminUser);

    expect(mockUploadHistoryModel.findOne).toHaveBeenCalledWith({
      durId: expect.anything(),
      docId: 'tiedGrant',
      uploadId: 'old-upload-id',
    });
    expect(mockDurModel.findById).not.toHaveBeenCalled();
    expect(mockS3Service.getObjectStream).toHaveBeenCalledWith('s3/key/tiedGrant.pdf');
    expect(result.key).toBe('s3/key/tiedGrant.pdf');
    expect(result.stream).toBe(fakeStream);
    expect(result.headers.contentType).toBe('application/pdf');
    expect(result.headers.contentDisposition).toContain('filename="tiedGrant.pdf"');
  });

  it('falls back to the document current upload when no uploadId is supplied', async () => {
    mockDurModel.findById.mockReturnValue(mockQuery(durWithDocSlot()));

    const result = await service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, undefined, adminUser);

    expect(mockDurModel.findById).toHaveBeenCalled();
    expect(mockUploadHistoryModel.findOne).toHaveBeenCalledWith({
      durId: expect.anything(),
      docId: 'tiedGrant',
      uploadId: 'upload-1',
    });
    expect(result.key).toBe('s3/key/tiedGrant.pdf');
  });

  it('wraps an S3 "not found" error as NotFoundException', async () => {
    mockS3Service.getObjectStream.mockRejectedValue({ name: 'NoSuchKey' });

    await expect(service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, 'upload-1', adminUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('wraps any other S3 error as a 500', async () => {
    mockS3Service.getObjectStream.mockRejectedValue(new Error('connection reset'));

    await expect(service.getDocumentDownload(DUR_ID, 'tiedGrant' as any, 'upload-1', adminUser)).rejects.toThrow(
      'Failed to initiate file download',
    );
  });
});

describe('DurManualReviewService manual-review history', () => {
  let service: DurManualReviewService;
  let mockManualReviewRequestModel: { aggregate: jest.Mock };
  let mockExcelService: { generateExcel: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockFileTokenService: { signFileUrl: jest.Mock };

  const adminUser: AuthUser = { _id: 'admin-1', role: 'ADMIN', scope: 'ADMIN' } as AuthUser;
  const stateUser: AuthUser = { _id: 'user-2', role: 'STATE', scope: 'STATE' } as AuthUser;

  beforeEach(() => {
    mockManualReviewRequestModel = { aggregate: jest.fn().mockReturnValue(mockQuery([{ data: [], totalCount: [] }])) };
    mockExcelService = { generateExcel: jest.fn().mockResolvedValue(Buffer.from('excel')) };
    mockConfigService = { get: jest.fn() };
    mockFileTokenService = { signFileUrl: jest.fn((path: string) => `https://signed.example.com/${path}`) };

    service = new DurManualReviewService(
      {} as any,
      {} as any,
      {} as any,
      mockManualReviewRequestModel as any,
      {} as any,
      {} as any,
      mockFileTokenService as any,
      {} as any,
      mockExcelService as any,
      mockConfigService as any,
    );
  });

  describe('listManualReviewRequestHistory', () => {
    it('rejects non-ADMIN users', async () => {
      await expect(
        service.listManualReviewRequestHistory({ page: 1, pageSize: 20 } as any, stateUser),
      ).rejects.toThrow('Only ADMIN users may view the manual-review history');
    });

    it('returns the paginated shape, signing filePath into a fileUrl', async () => {
      const row = { durId: 'dur-1', ulbName: 'Test ULB', docId: 'tiedGrant', filePath: 's3/path.pdf' };
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([{ data: [row], totalCount: [{ count: 1 }] }]));

      const result = await service.listManualReviewRequestHistory({ page: 1, pageSize: 20 } as any, adminUser);

      expect(result).toEqual({
        total: 1,
        page: 1,
        pageSize: 20,
        rows: [
          { durId: 'dur-1', ulbName: 'Test ULB', docId: 'tiedGrant', fileUrl: 'https://signed.example.com/s3/path.pdf' },
        ],
      });
    });
  });

  describe('getManualReviewHistoryStats', () => {
    it('rejects non-ADMIN users', async () => {
      await expect(service.getManualReviewHistoryStats({ range: 'all' } as any, stateUser)).rejects.toThrow(
        'Only ADMIN users may view the manual-review history',
      );
    });

    it('computes the overturn rate once enough requests are decided', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(
        mockQuery([{ received: 10, pending: 2, approved: 2, rejected: 6, over48hCount: 1, avgResponseHours: 12.345 }]),
      );

      const result = await service.getManualReviewHistoryStats({ range: 'all' } as any, adminUser);

      expect(result).toEqual({
        range: 'all',
        received: 10,
        pending: 2,
        approved: 2,
        rejected: 6,
        over48hCount: 1,
        avgResponseHours: 12.3,
        overturnRatePercent: 25,
        overturnRateWarning: false,
      });
    });

    it('returns zeroed/null stats when nothing matches', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([undefined]));

      const result = await service.getManualReviewHistoryStats({ range: 'today' } as any, adminUser);

      expect(result).toEqual({
        range: 'today',
        received: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        over48hCount: 0,
        avgResponseHours: null,
        overturnRatePercent: null,
        overturnRateWarning: false,
      });
    });
  });

  describe('dumpManualReviewHistoryToExcel', () => {
    it('rejects non-ADMIN users', async () => {
      await expect(
        service.dumpManualReviewHistoryToExcel({ page: 1, pageSize: 20 } as any, stateUser),
      ).rejects.toThrow('Only ADMIN users may view the manual-review history');
    });

    it('builds the workbook with a signed file link and a portal OCR-log link', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(
        mockQuery([
          {
            ulbName: 'Test ULB',
            docId: 'tiedGrant',
            fileName: 'report.pdf',
            filePath: 's3/path.pdf',
            ocrJobId: 'job-42',
            status: 'APPROVED',
            requestedAt: '2024-01-01T00:00:00.000Z',
            dueAt: '2024-01-02T00:00:00.000Z',
            isBreached: false,
            decidedAt: '2024-01-01T12:00:00.000Z',
            decidedBy: { name: 'Admin User' },
            decisionNote: 'Looks fine',
          },
        ]),
      );

      await service.dumpManualReviewHistoryToExcel({ page: 1, pageSize: 20 } as any, adminUser);

      const [, rows] = mockExcelService.generateExcel.mock.calls[0];
      expect(rows).toEqual([
        expect.objectContaining({
          ulbName: 'Test ULB',
          docId: 'tiedGrant',
          fileUrl: 'https://signed.example.com/s3/path.pdf',
          ocrLogUrl: 'https://www.cityfinance.in/fc/ocr/dur?jobId=job-42',
          status: 'APPROVED',
          decidedBy: 'Admin User',
          decisionNote: 'Looks fine',
        }),
      ]);
    });

    it('leaves fileUrl/ocrLogUrl blank when there is no file path or OCR job', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(
        mockQuery([{ ulbName: 'Test ULB', docId: 'tiedGrant', status: 'PENDING' }]),
      );

      await service.dumpManualReviewHistoryToExcel({ page: 1, pageSize: 20 } as any, adminUser);

      const [, rows] = mockExcelService.generateExcel.mock.calls[0];
      expect(rows[0]).toEqual(expect.objectContaining({ fileUrl: '', ocrLogUrl: '' }));
    });
  });

  describe('getManualReviewRequestDetail', () => {
    it('rejects non-ADMIN users', async () => {
      await expect(service.getManualReviewRequestDetail('req-1', stateUser)).rejects.toThrow(
        'Only ADMIN users may view manual-review request details',
      );
    });

    it('returns the single request, signing filePath into a fileUrl', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(
        mockQuery([{ durId: 'dur-1', docId: 'tiedGrant', filePath: 's3/path.pdf', status: 'APPROVED' }]),
      );

      const result = await service.getManualReviewRequestDetail('507f1f77bcf86cd799439014', adminUser);

      expect(result).toEqual({
        durId: 'dur-1',
        docId: 'tiedGrant',
        status: 'APPROVED',
        fileUrl: 'https://signed.example.com/s3/path.pdf',
      });
    });

    it('throws NotFoundException when the request does not exist', async () => {
      mockManualReviewRequestModel.aggregate.mockReturnValue(mockQuery([]));

      await expect(service.getManualReviewRequestDetail('507f1f77bcf86cd799439014', adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
