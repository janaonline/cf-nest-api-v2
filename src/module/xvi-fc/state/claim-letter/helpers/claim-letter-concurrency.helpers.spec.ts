import { ConflictException } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import {
  abortIfActive,
  CLAIM_LETTER_BUSY_MESSAGE,
  toClaimLetterBusyConflict,
} from './claim-letter-concurrency.helpers';

function sessionWith(active: boolean, abort = jest.fn().mockResolvedValue(undefined)) {
  return { inTransaction: jest.fn().mockReturnValue(active), abortTransaction: abort } as unknown as ClientSession & {
    abortTransaction: jest.Mock;
  };
}

describe('abortIfActive', () => {
  it('aborts a transaction that is still open', async () => {
    const session = sessionWith(true);
    await abortIfActive(session);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  });

  it('leaves a transaction alone once a commit was attempted', async () => {
    const session = sessionWith(false);
    await abortIfActive(session);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it('drops an error from the abort itself', async () => {
    const session = sessionWith(true, jest.fn().mockRejectedValue(new Error('network')));
    await expect(abortIfActive(session)).resolves.toBeUndefined();
  });
});

describe('toClaimLetterBusyConflict', () => {
  it('turns a write conflict into the retryable 409', () => {
    const mapped = toClaimLetterBusyConflict({ code: 112 });
    expect(mapped).toBeInstanceOf(ConflictException);
    expect((mapped as ConflictException).message).toBe(CLAIM_LETTER_BUSY_MESSAGE);
  });

  it('returns any other error unchanged', () => {
    const err = new Error('boom');
    expect(toClaimLetterBusyConflict(err)).toBe(err);
  });
});
