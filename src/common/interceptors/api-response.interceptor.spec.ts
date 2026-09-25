import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ApiResponseInterceptor } from './api-response.interceptor';

const mockCtx = {} as ExecutionContext;

function makeCallHandler(result: unknown) {
  return { handle: () => of(result) };
}

describe('ApiResponseInterceptor', () => {
  let interceptor: ApiResponseInterceptor;

  beforeEach(() => {
    interceptor = new ApiResponseInterceptor();
  });

  it('should be defined', () => expect(interceptor).toBeDefined());

  describe('array result', () => {
    it('wraps array with meta.count', async () => {
      const result = [{ code: '802992', name: 'Gudur Municipality' }];
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).toEqual({
        success: true,
        message: 'Request completed successfully.',
        data: result,
        meta: { count: 1 },
      });
    });

    it('wraps empty array with meta.count 0', async () => {
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler([]) as never));
      expect(output).toMatchObject({ success: true, data: [], meta: { count: 0 } });
    });

    it('does not include requestId', async () => {
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler([]) as never));
      expect(output).not.toHaveProperty('requestId');
    });
  });

  describe('plain object result', () => {
    it('wraps plain object as data', async () => {
      const obj = { accessToken: 'abc', tokenType: 'Bearer', expiresIn: 900 };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(obj) as never));
      expect(output).toEqual({
        success: true,
        message: 'Request completed successfully.',
        data: obj,
      });
    });

    it('does not include requestId', async () => {
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler({ x: 1 }) as never));
      expect(output).not.toHaveProperty('requestId');
    });
  });

  describe('object with data/meta/message fields', () => {
    it('preserves data, meta, and message from result', async () => {
      const result = { data: [1, 2], meta: { page: 1, total: 2 }, message: 'Custom message.' };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).toEqual({
        success: true,
        message: 'Custom message.',
        data: [1, 2],
        meta: { page: 1, total: 2 },
      });
    });

    it('uses default message when result.message is absent', async () => {
      const result = { data: { id: 1 } };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output?.message).toBe('Request completed successfully.');
    });

    it('extracts data from result.data', async () => {
      const inner = { id: 42 };
      const result = { data: inner };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output?.data).toBe(inner);
    });

    it('omits meta when result.meta is absent', async () => {
      const result = { data: { id: 1 } };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).not.toHaveProperty('meta');
    });

    it('wraps object that has only a message field', async () => {
      const result = { message: 'Done.' };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).toMatchObject({ success: true, message: 'Done.' });
    });
  });

  describe('already-wrapped result', () => {
    it('avoids double wrapping when result already has success + data + message', async () => {
      const result = { success: true as const, message: 'Done.', data: { id: 1 } };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).toBe(result);
    });

    it('does not double-wrap when meta is also present', async () => {
      const result = { success: true as const, message: 'Done.', data: [], meta: { count: 0 } };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).toBe(result);
    });

    it('wraps object with success+data but missing message (not considered fully wrapped)', async () => {
      const result = { success: true, validationStatus: 'VALID', data: { _id: 'x' } };
      const output = await lastValueFrom(interceptor.intercept(mockCtx, makeCallHandler(result) as never));
      expect(output).toMatchObject({ success: true, message: 'Request completed successfully.' });
      expect(output?.data).toEqual({ _id: 'x' });
    });
  });
});
