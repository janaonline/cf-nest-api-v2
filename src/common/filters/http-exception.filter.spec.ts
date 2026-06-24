import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function buildHost(url = '/test'): { host: ArgumentsHost; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('adds success:false to a 400 BadRequestException response', () => {
    const { host, json } = buildHost();
    filter.catch(new BadRequestException('Bad input'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, statusCode: 400, message: 'Bad input' }),
    );
  });

  it('adds success:false to a 403 ForbiddenException response', () => {
    const { host, json } = buildHost();
    filter.catch(new ForbiddenException('Access denied'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, statusCode: 403, message: 'Access denied' }),
    );
  });

  it('adds success:false to a 404 NotFoundException response', () => {
    const { host, json } = buildHost();
    filter.catch(new NotFoundException('Not found'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, statusCode: 404 }));
  });

  it('adds success:false for an unexpected Error (500)', () => {
    const { host, json } = buildHost();
    filter.catch(new Error('Unexpected boom'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, statusCode: 500 }));
  });

  it('forwards errors map from a structured BadRequestException body', () => {
    const { host, json } = buildHost();
    const errors = { fieldName: [{ field: 'fieldName', message: 'required', code: 'required' }] };
    filter.catch(new BadRequestException({ message: 'Validation failed.', errors }), host);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['success']).toBe(false);
    expect(body['message']).toBe('Validation failed.');
    expect(body['errors']).toEqual(errors);
  });

  it('includes timestamp (ISO string) and path in every error response', () => {
    const { host, json } = buildHost('/xvi-fc/state/sfc-status/save-draft');
    filter.catch(new HttpException('Error', 400), host);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof body['timestamp']).toBe('string');
    expect(new Date(body['timestamp'] as string).toISOString()).toBe(body['timestamp']);
    expect(body['path']).toBe('/xvi-fc/state/sfc-status/save-draft');
  });

  it('forwards optional data payload from a structured exception body', () => {
    const { host, json } = buildHost();
    const errors = { ulbCount: [{ field: 'ulbCount', message: 'Mismatch', code: 'mismatch' }] };
    const data = { validationSummary: { excelRowCount: 12 } };
    filter.catch(new BadRequestException({ message: 'Validation failed.', errors, data }), host);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['data']).toEqual(data);
  });

  it('message is always a non-empty string', () => {
    const { host, json } = buildHost();
    filter.catch(new BadRequestException('Must not be empty'), host);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof body['message']).toBe('string');
    expect((body['message'] as string).length).toBeGreaterThan(0);
  });

  it('does not include success:true in error responses', () => {
    const { host, json } = buildHost();
    filter.catch(new BadRequestException('err'), host);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['success']).not.toBe(true);
  });
});
