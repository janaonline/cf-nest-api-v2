import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { FcUnspentUlbRowInputDto } from './fc-unspent-ulb-row.dto';

// Mirrors the global ValidationPipe options in src/main.ts.
const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

function buildPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ulbId: '507f1f77bcf86cd799439011',
    unspentAmount: 5,
    previousFcUnspentBalance: 3,
    ...overrides,
  };
}

function allMessages(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.flatMap((err) => Object.values(err.constraints ?? {}));
}

const build = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(FcUnspentUlbRowInputDto, buildPayload(overrides));

describe('FcUnspentUlbRowInputDto', () => {
  it('accepts a fully populated row', async () => {
    expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('rejects a missing previousFcUnspentBalance', async () => {
    const dto = build({ previousFcUnspentBalance: undefined });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(allMessages(errors).length).toBeGreaterThan(0);
  });

  it('rejects a zero previousFcUnspentBalance (must be at least 1)', async () => {
    const dto = build({ previousFcUnspentBalance: 0 });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(allMessages(errors).length).toBeGreaterThan(0);
  });

  it('rejects a negative previousFcUnspentBalance', async () => {
    const dto = build({ previousFcUnspentBalance: -5 });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(allMessages(errors).length).toBeGreaterThan(0);
  });

  it('rejects a decimal previousFcUnspentBalance (whole Rupees only)', async () => {
    const dto = build({ previousFcUnspentBalance: 5.5 });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(allMessages(errors).length).toBeGreaterThan(0);
  });

  it('rejects an unknown extra property (whitelisted to exactly ulbId/unspentAmount/previousFcUnspentBalance)', async () => {
    const dto = build({ eligibility: true });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });
});
