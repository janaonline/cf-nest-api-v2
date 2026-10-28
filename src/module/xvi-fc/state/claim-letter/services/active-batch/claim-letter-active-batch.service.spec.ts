import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CLAIM_LETTER_BATCH_BLOCKED, ClaimLetterActiveBatchService } from './claim-letter-active-batch.service';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'select', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('ClaimLetterActiveBatchService', () => {
  const state = new Types.ObjectId();
  const year = new Types.ObjectId();
  const batch1 = { _id: new Types.ObjectId(), batchNumber: 1 };
  const batch2Id = new Types.ObjectId();
  let findOne: jest.Mock;
  let service: ClaimLetterActiveBatchService;

  beforeEach(() => {
    findOne = jest.fn(() => q(batch1));
    service = new ClaimLetterActiveBatchService({ findOne } as never);
  });

  it('looks up the earliest READY draft / under-review / returned batch, ignoring abandoned and superseded', async () => {
    const chain = q(batch1);
    findOne.mockReturnValue(chain);

    await expect(service.resolveActiveBatch({ state, year, installment: 1 })).resolves.toBe(batch1);
    expect(findOne).toHaveBeenCalledWith({
      state,
      year,
      installment: 1,
      currentFormStatus: { $in: [2, 5, 6] },
      isAbandoned: false,
      supersededBy: null,
      assemblyStatus: 'READY',
    });
    expect(chain['sort']).toHaveBeenCalledWith({ createdAt: 1 });
  });

  it('lets the active batch through and blocks a later one with a coded 409', async () => {
    await expect(service.assertActive({ _id: batch1._id, state, year, installment: 1 })).resolves.toBeUndefined();

    const err = (await service
      .assertActive({ _id: batch2Id, state, year, installment: 1 })
      .catch((e: unknown) => e)) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({
      message: 'Only one claim batch can be processed at a time. Batch 1 is still in progress or under MoHUA review.',
      code: CLAIM_LETTER_BATCH_BLOCKED,
    });
  });

  it('allows everything when no batch is active', async () => {
    findOne.mockReturnValue(q(null));
    await expect(service.assertActive({ _id: batch2Id, state, year, installment: 1 })).resolves.toBeUndefined();
    await expect(service.assertCanCreate({ state, year, installment: 1 })).resolves.toBeUndefined();
  });

  it('refuses a new batch while any batch is active', async () => {
    await expect(service.assertCanCreate({ state, year, installment: 1 })).rejects.toThrow(ConflictException);
  });

  it('reports blocking only for listed batches that are themselves active and not the active one', () => {
    const active = batch1;
    expect(service.blockingBatchNumberFor({ _id: batch2Id, currentFormStatus: 2, isAbandoned: false }, active)).toBe(1);
    expect(service.blockingBatchNumberFor({ _id: batch1._id, currentFormStatus: 2, isAbandoned: false }, active)).toBe(
      null,
    );
    expect(service.blockingBatchNumberFor({ _id: batch2Id, currentFormStatus: 7, isAbandoned: false }, active)).toBe(
      null,
    );
    expect(service.blockingBatchNumberFor({ _id: batch2Id, currentFormStatus: 2, isAbandoned: true }, active)).toBe(
      null,
    );
    expect(service.blockingBatchNumberFor({ _id: batch2Id, currentFormStatus: 2, isAbandoned: false }, null)).toBe(
      null,
    );
  });
});
