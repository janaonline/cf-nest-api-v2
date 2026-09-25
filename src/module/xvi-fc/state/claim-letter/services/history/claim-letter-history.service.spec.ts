import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterHistoryService } from './claim-letter-history.service';
import { ClaimLetterBatchHistory } from 'src/schemas/xvi-fc/state/claim-letter-batch-history.schema';

describe('ClaimLetterHistoryService', () => {
  let service: ClaimLetterHistoryService;
  let historyModel: { create: jest.Mock };

  const baseInput = {
    claimLetter: new Types.ObjectId(),
    state: new Types.ObjectId(),
    year: new Types.ObjectId(),
    installment: 1 as const,
    batchNumber: 1 as const,
    version: 1,
    fromStatus: null,
    toStatus: 2,
    actionSource: 'DIRECT_STATE_REVIEW' as const,
    changedBy: new Types.ObjectId(),
    requestId: 'req-1',
  };

  beforeEach(async () => {
    historyModel = { create: jest.fn().mockResolvedValue([{}]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterHistoryService,
        { provide: getModelToken(ClaimLetterBatchHistory.name), useValue: historyModel },
      ],
    }).compile();

    service = module.get<ClaimLetterHistoryService>(ClaimLetterHistoryService);
  });

  it('creates exactly one history document with the given fields', async () => {
    await service.recordTransition(baseInput);

    expect(historyModel.create).toHaveBeenCalledTimes(1);
    const [docs] = historyModel.create.mock.calls[0] as [Record<string, unknown>[]];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      fromStatus: null,
      toStatus: 2,
      actionSource: 'DIRECT_STATE_REVIEW',
      requestId: 'req-1',
    });
  });

  it('passes the session through when provided', async () => {
    const session = {} as never;
    await service.recordTransition(baseInput, session);

    const [, options] = historyModel.create.mock.calls[0] as [unknown, { session: unknown }];
    expect(options.session).toBe(session);
  });

  it('defaults optional fields (reason, ipAddress, userAgent) to null', async () => {
    await service.recordTransition(baseInput);

    const [docs] = historyModel.create.mock.calls[0] as [Record<string, unknown>[]];
    expect(docs[0]).toMatchObject({ reason: null, ipAddress: null, userAgent: null });
  });
});
