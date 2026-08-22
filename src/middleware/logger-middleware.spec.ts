import { EventEmitter } from 'events';
import { NextFunction, Request, Response } from 'express';
import { LoggerMiddleware } from './logger-middleware';

/** Minimal Response mock that supports `res.on('finish', ...)` and exposes statusCode. */
class MockResponse extends EventEmitter {
  statusCode = 200;
}

const buildReq = (method = 'GET', originalUrl = '/api/test'): Request =>
  ({ method, originalUrl } as unknown as Request);

describe('LoggerMiddleware', () => {
  let middleware: LoggerMiddleware;
  let next: NextFunction;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    middleware = new LoggerMiddleware();
    next = jest.fn();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('calls next() synchronously', () => {
    const res = new MockResponse() as unknown as Response;
    middleware.use(buildReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('logs method, endpoint, status and time once the response finishes', () => {
    const res = new MockResponse();
    res.statusCode = 201;
    middleware.use(buildReq('POST', '/api/widgets'), res as unknown as Response, next);

    expect(logSpy).not.toHaveBeenCalled();

    res.emit('finish');

    const output = logSpy.mock.calls.map((call) => call[0] as string).join('\n');
    expect(output).toContain('Method: POST');
    expect(output).toContain('Endpoint: /api/widgets');
    expect(output).toContain('Status: 201');
    expect(output).toMatch(/Time:\s+[\d.]+ ms/);
  });

  it('does not log anything if the response never finishes', () => {
    const res = new MockResponse() as unknown as Response;
    middleware.use(buildReq(), res, next);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('handles multiple finish-eligible requests independently', () => {
    const res1 = new MockResponse();
    res1.statusCode = 200;
    const res2 = new MockResponse();
    res2.statusCode = 404;

    middleware.use(buildReq('GET', '/one'), res1 as unknown as Response, next);
    middleware.use(buildReq('DELETE', '/two'), res2 as unknown as Response, next);

    res1.emit('finish');
    res2.emit('finish');

    const output = logSpy.mock.calls.map((call) => call[0] as string).join('\n');
    expect(output).toContain('Method: GET');
    expect(output).toContain('Endpoint: /one');
    expect(output).toContain('Status: 200');
    expect(output).toContain('Method: DELETE');
    expect(output).toContain('Endpoint: /two');
    expect(output).toContain('Status: 404');
    expect(next).toHaveBeenCalledTimes(2);
  });
});
