import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Request, Response } from 'express';
import axios from 'axios';
import { RecaptchaMiddleware } from './recaptcha.middleware';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const buildReq = (body: Record<string, unknown> = {}, ip = '127.0.0.1'): Request =>
  ({ body, ip } as unknown as Request);

const mockRes = {} as Response;
const next = jest.fn();

describe('RecaptchaMiddleware', () => {
  let middleware: RecaptchaMiddleware;
  let configGet: jest.Mock;

  const buildConfig = (overrides: Record<string, string> = {}) => {
    const defaults: Record<string, string> = {
      NODE_ENV: 'production',
      RECAPTCHA_SKIP_DEV: 'false',
      RECAPTCHA_SECRET_KEY: 'test-secret',
      RECAPTCHA_MIN_SCORE: '0.5',
      ...overrides,
    };
    return defaults;
  };

  async function createMiddleware(envVars: Record<string, string>) {
    configGet = jest.fn((key: string) => envVars[key]);
    const module = await Test.createTestingModule({
      providers: [
        RecaptchaMiddleware,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    return module.get<RecaptchaMiddleware>(RecaptchaMiddleware);
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() in development with RECAPTCHA_SKIP_DEV=true', async () => {
    middleware = await createMiddleware(buildConfig({ NODE_ENV: 'development', RECAPTCHA_SKIP_DEV: 'true' }));
    await middleware.use(buildReq(), mockRes, next);
    expect(next).toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws 422 when token missing', async () => {
    middleware = await createMiddleware(buildConfig());
    await expect(middleware.use(buildReq({}), mockRes, next)).rejects.toThrow(
      new HttpException('reCAPTCHA token is required', 422),
    );
  });

  it('throws 401 when Google returns success: false', async () => {
    middleware = await createMiddleware(buildConfig());
    mockedAxios.post.mockResolvedValue({ data: { success: false, 'error-codes': ['invalid-input-response'] } });
    await expect(
      middleware.use(buildReq({ recaptchaToken: 'bad-token' }), mockRes, next),
    ).rejects.toThrow(new HttpException('reCAPTCHA verification failed', 401));
  });

  it('throws 401 when v3 score below threshold', async () => {
    middleware = await createMiddleware(buildConfig());
    mockedAxios.post.mockResolvedValue({ data: { success: true, score: 0.2 } });
    await expect(
      middleware.use(buildReq({ recaptchaToken: 'bot-token' }), mockRes, next),
    ).rejects.toThrow(new HttpException('reCAPTCHA score too low: possible bot', 401));
  });

  it('throws 503 when axios throws network error', async () => {
    middleware = await createMiddleware(buildConfig());
    mockedAxios.post.mockRejectedValue(new Error('Network Error'));
    await expect(
      middleware.use(buildReq({ recaptchaToken: 'any-token' }), mockRes, next),
    ).rejects.toThrow(new HttpException('reCAPTCHA service unavailable', 503));
  });

  it('attaches recaptchaResult to req on success', async () => {
    middleware = await createMiddleware(buildConfig());
    mockedAxios.post.mockResolvedValue({ data: { success: true, score: 0.9 } });
    const req = buildReq({ recaptchaToken: 'valid-token' });
    await middleware.use(req, mockRes, next);
    expect((req as unknown as Record<string, unknown>)['recaptchaResult']).toEqual({
      success: true,
      score: 0.9,
    });
    expect(next).toHaveBeenCalled();
  });
});
