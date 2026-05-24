import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  };
  return { host, status, json };
}

function captureResponse(filter: ApiExceptionFilter, exception: unknown) {
  const { host, json } = makeHost();
  filter.catch(exception, host as never);
  return (json.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
}

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter;

  beforeEach(() => {
    filter = new ApiExceptionFilter();
  });

  it('should be defined', () => expect(filter).toBeDefined());

  describe('BadRequestException — class-validator string array', () => {
    it('returns VALIDATION_FAILED code', () => {
      const err = new BadRequestException({ message: ['ulbCode should not be empty'], error: 'Bad Request' });
      const body = captureResponse(filter, err);
      expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_FAILED');
    });

    it('returns "Validation failed." message', () => {
      const err = new BadRequestException({ message: ['ulbCode should not be empty'], error: 'Bad Request' });
      const body = captureResponse(filter, err);
      expect(body['message']).toBe('Validation failed.');
    });

    it('puts validation array in details', () => {
      const messages = ['field is required', 'field must be string'];
      const err = new BadRequestException({ message: messages, error: 'Bad Request' });
      const body = captureResponse(filter, err);
      expect((body['error'] as Record<string, unknown>)['details']).toEqual(messages);
    });

    it('does not include requestId', () => {
      const err = new BadRequestException({ message: ['x'], error: 'Bad Request' });
      const body = captureResponse(filter, err);
      expect(body).not.toHaveProperty('requestId');
    });
  });

  describe('BadRequestException — data collection validation failure', () => {
    const dcErr = new BadRequestException({
      ulbCode: 'C001',
      yearCode: '2021-22',
      templateVersion: '2026.1',
      success: false,
      errors: [{ lineItemCode: '110', severity: 'ERROR', message: 'must be finite' }],
      lineItems: { '110': null },
    });

    it('returns VALIDATION_FAILED code', () => {
      const body = captureResponse(filter, dcErr);
      expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_FAILED');
    });

    it('returns "Financial data validation failed." message', () => {
      const body = captureResponse(filter, dcErr);
      expect(body['message']).toBe('Financial data validation failed.');
    });

    it('includes ulbCode, yearCode, templateVersion, errors, lineItems in details', () => {
      const body = captureResponse(filter, dcErr);
      const details = (body['error'] as Record<string, unknown>)['details'] as Record<string, unknown>;
      expect(details).toHaveProperty('ulbCode', 'C001');
      expect(details).toHaveProperty('yearCode', '2021-22');
      expect(details).toHaveProperty('templateVersion', '2026.1');
      expect(details).toHaveProperty('errors');
      expect(details).toHaveProperty('lineItems');
    });

    it('does not include success key in details', () => {
      const body = captureResponse(filter, dcErr);
      const details = (body['error'] as Record<string, unknown>)['details'] as Record<string, unknown>;
      expect(details).not.toHaveProperty('success');
    });
  });

  describe('ConflictException', () => {
    it('returns CONFLICT code', () => {
      const body = captureResponse(filter, new ConflictException('Already exists.'));
      expect((body['error'] as Record<string, unknown>)['code']).toBe('CONFLICT');
    });

    it('returns statusCode 409', () => {
      const body = captureResponse(filter, new ConflictException('Already exists.'));
      expect((body['error'] as Record<string, unknown>)['statusCode']).toBe(HttpStatus.CONFLICT);
    });

    it('preserves message', () => {
      const body = captureResponse(filter, new ConflictException('Already exists.'));
      expect(body['message']).toBe('Already exists.');
    });
  });

  describe('NotFoundException', () => {
    it('returns NOT_FOUND code', () => {
      const body = captureResponse(filter, new NotFoundException('Resource not found.'));
      expect((body['error'] as Record<string, unknown>)['code']).toBe('NOT_FOUND');
    });
  });

  describe('UnauthorizedException', () => {
    it('returns UNAUTHORIZED code', () => {
      const body = captureResponse(filter, new UnauthorizedException('Invalid credentials'));
      expect((body['error'] as Record<string, unknown>)['code']).toBe('UNAUTHORIZED');
    });
  });

  describe('ForbiddenException', () => {
    it('returns FORBIDDEN code', () => {
      const body = captureResponse(filter, new ForbiddenException());
      expect((body['error'] as Record<string, unknown>)['code']).toBe('FORBIDDEN');
    });
  });

  describe('Unknown error (non-HttpException)', () => {
    it('returns INTERNAL_SERVER_ERROR code', () => {
      const body = captureResponse(filter, new Error('db crash'));
      expect((body['error'] as Record<string, unknown>)['code']).toBe('INTERNAL_SERVER_ERROR');
    });

    it('returns statusCode 500', () => {
      const body = captureResponse(filter, new Error('db crash'));
      expect((body['error'] as Record<string, unknown>)['statusCode']).toBe(500);
    });

    it('returns generic message — does not expose stack', () => {
      const body = captureResponse(filter, new Error('raw internal detail'));
      expect(body['message']).toBe('Internal server error.');
      expect(JSON.stringify(body)).not.toContain('raw internal detail');
    });

    it('does not include requestId', () => {
      const body = captureResponse(filter, new Error('x'));
      expect(body).not.toHaveProperty('requestId');
    });

    it('success is false', () => {
      const body = captureResponse(filter, new Error('x'));
      expect(body['success']).toBe(false);
    });
  });

  describe('response shape', () => {
    it('always returns success: false', () => {
      const body = captureResponse(filter, new NotFoundException());
      expect(body['success']).toBe(false);
    });

    it('error object has code and statusCode', () => {
      const body = captureResponse(filter, new NotFoundException());
      const error = body['error'] as Record<string, unknown>;
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('statusCode');
    });
  });
});
