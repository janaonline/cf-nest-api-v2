import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { XviFcFileRefDto } from './xvi-fc-file-ref.dto';

// Mirrors the global ValidationPipe options in src/main.ts
const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

function buildFileRef(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    originalName: 'devolution.xlsx',
    path: 'state/devolution/devolution.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeKb: 34.5,
    createdAt: '2026-07-11T14:10:00.245Z',
    ...overrides,
  };
}

/** Flattens nested validation errors into their constraint messages. */
function allMessages(errors: Awaited<ReturnType<typeof validate>>): string[] {
  const messages: string[] = [];
  const walk = (errs: typeof errors): void => {
    for (const err of errs) {
      if (err.constraints) messages.push(...Object.values(err.constraints));
      if (err.children?.length) walk(err.children);
    }
  };
  walk(errors);
  return messages;
}

const build = (overrides: Record<string, unknown> = {}) => plainToInstance(XviFcFileRefDto, buildFileRef(overrides));

describe('XviFcFileRefDto', () => {
  it('accepts a fully populated canonical file object with zero errors', async () => {
    expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
  });

  // ─── updatedAt: accepted but never validated ──────────────────────────────

  it('accepts a client-sent updatedAt (string) without throwing "should not exist"', async () => {
    const errors = await validate(build({ updatedAt: '2026-07-11T14:12:00.000Z' }), PIPE_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts a client-sent updatedAt of any type (number) without validation failure', async () => {
    const errors = await validate(build({ updatedAt: 12345 }), PIPE_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts a client-sent updatedAt of any type (object) without validation failure', async () => {
    const errors = await validate(build({ updatedAt: { foo: 'bar' } }), PIPE_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts a missing updatedAt (optional)', async () => {
    const dto = build();

    delete (dto as unknown as Record<string, unknown>)['updatedAt'];
    expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
  });

  it('does not report "property updatedAt should not exist"', async () => {
    const errors = await validate(build({ updatedAt: '2026-07-11T14:12:00.000Z' }), PIPE_OPTIONS);
    expect(allMessages(errors).join(' ')).not.toContain('property updatedAt should not exist');
  });

  // ─── Required fields ───────────────────────────────────────────────────────

  it('rejects a missing originalName', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['originalName'];
    expect(allMessages(await validate(dto, PIPE_OPTIONS)).join(' ')).toContain('originalName');
  });

  it('rejects an empty originalName', async () => {
    expect(allMessages(await validate(build({ originalName: '' }), PIPE_OPTIONS)).join(' ')).toContain('originalName');
  });

  it('rejects a missing path', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['path'];
    expect(allMessages(await validate(dto, PIPE_OPTIONS)).join(' ')).toContain('path');
  });

  it('rejects an empty path', async () => {
    expect(allMessages(await validate(build({ path: '' }), PIPE_OPTIONS)).join(' ')).toContain('path');
  });

  it('rejects a missing mimeType', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['mimeType'];
    expect(allMessages(await validate(dto, PIPE_OPTIONS)).join(' ')).toContain('mimeType');
  });

  // ─── sizeKb ────────────────────────────────────────────────────────────────

  it('accepts sizeKb: 0', async () => {
    expect(await validate(build({ sizeKb: 0 }), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('rejects a negative sizeKb', async () => {
    expect(allMessages(await validate(build({ sizeKb: -1 }), PIPE_OPTIONS)).join(' ')).toContain('sizeKb');
  });

  it('rejects a missing sizeKb', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['sizeKb'];
    expect(allMessages(await validate(dto, PIPE_OPTIONS)).join(' ')).toContain('sizeKb');
  });

  // ─── createdAt: backend-owned (Mongoose-managed), accepted but never validated ────

  it('accepts a missing createdAt (client no longer supplies it — backend owns it)', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['createdAt'];
    expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
  });

  it('tolerates a client echoing back a non-ISO8601 createdAt without erroring', async () => {
    expect(await validate(build({ createdAt: 'not-a-date' }), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('does not report "property createdAt should not exist"', async () => {
    const errors = await validate(build({ createdAt: 'not-a-date' }), PIPE_OPTIONS);
    expect(allMessages(errors).join(' ')).not.toContain('property createdAt should not exist');
  });

  // ─── pageCount ─────────────────────────────────────────────────────────────

  it('accepts pageCount: null', async () => {
    expect(await validate(build({ pageCount: null }), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('accepts pageCount: 3', async () => {
    expect(await validate(build({ pageCount: 3 }), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('accepts a missing pageCount', async () => {
    expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('does not report "property pageCount should not exist"', async () => {
    const errors = await validate(build({ pageCount: null }), PIPE_OPTIONS);
    expect(allMessages(errors).join(' ')).not.toContain('property pageCount should not exist');
  });

  it('rejects pageCount as a string', async () => {
    expect(allMessages(await validate(build({ pageCount: '3' }), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
  });

  it('rejects a negative pageCount', async () => {
    expect(allMessages(await validate(build({ pageCount: -1 }), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
  });

  it('rejects a non-integer pageCount', async () => {
    expect(allMessages(await validate(build({ pageCount: 2.5 }), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
  });

  // ─── Legacy / disallowed keys ──────────────────────────────────────────────

  it('rejects legacy fileName/fileUrl/fileSize/s3Key keys under forbidNonWhitelisted', async () => {
    const dto = build({ fileName: 'x.xlsx', fileUrl: 'x', fileSize: 100, s3Key: 'x' });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a client-provided extension key under forbidNonWhitelisted', async () => {
    const errors = await validate(build({ extension: 'xlsx' }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a client-provided sha256 key under forbidNonWhitelisted', async () => {
    const errors = await validate(build({ sha256: 'a'.repeat(64) }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });
});
