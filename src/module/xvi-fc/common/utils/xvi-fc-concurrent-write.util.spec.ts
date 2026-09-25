import { BadRequestException } from '@nestjs/common';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  assertFreshFormStatus,
  isMongoDuplicateKeyError,
  throwXviFcConflictError,
} from './xvi-fc-concurrent-write.util';

describe('isMongoDuplicateKeyError', () => {
  it('returns true for a MongoDB E11000 error', () => {
    expect(isMongoDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('returns false for other errors, null, and non-objects', () => {
    expect(isMongoDuplicateKeyError({ code: 500 })).toBe(false);
    expect(isMongoDuplicateKeyError(new Error('boom'))).toBe(false);
    expect(isMongoDuplicateKeyError(null)).toBe(false);
    expect(isMongoDuplicateKeyError('boom')).toBe(false);
  });
});

describe('throwXviFcConflictError', () => {
  it('throws a BadRequestException with a _form conflict error', () => {
    let caught: unknown;
    try {
      throwXviFcConflictError();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as { errors: Record<string, unknown[]> };
    expect(response.errors['_form']?.[0]).toMatchObject({ code: 'conflict' });
  });

  it('accepts a custom message', () => {
    let caught: unknown;
    try {
      throwXviFcConflictError('custom message');
    } catch (e) {
      caught = e;
    }

    const response = (caught as BadRequestException).getResponse() as { errors: Record<string, { message: string }[]> };
    expect(response.errors['_form']?.[0]?.message).toBe('custom message');
  });
});

describe('assertFreshFormStatus', () => {
  it('throws the assertFn error when the fresh status is not valid', async () => {
    const assertFn = jest.fn((status: number) => {
      if (status !== FORM_STATUS.IN_PROGRESS) throw new Error('not editable');
    });

    await expect(
      assertFreshFormStatus(() => Promise.resolve(FORM_STATUS.UNDER_REVIEW_BY_MOHUA), assertFn),
    ).rejects.toThrow('not editable');
    expect(assertFn).toHaveBeenCalledWith(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
  });

  it('defaults to NOT_STARTED when the document has vanished', async () => {
    const assertFn = jest.fn();
    await expect(assertFreshFormStatus(() => Promise.resolve(undefined), assertFn)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(assertFn).toHaveBeenCalledWith(FORM_STATUS.NOT_STARTED);
  });

  it('falls back to a generic conflict when assertFn does not throw for the fresh status', async () => {
    const assertFn = jest.fn(); // never throws

    let caught: unknown;
    try {
      await assertFreshFormStatus(() => Promise.resolve(FORM_STATUS.IN_PROGRESS), assertFn);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as { errors: Record<string, unknown[]> };
    expect(response.errors['_form']?.[0]).toMatchObject({ code: 'conflict' });
  });
});
