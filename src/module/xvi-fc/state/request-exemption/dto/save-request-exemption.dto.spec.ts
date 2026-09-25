import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { SaveRequestExemptionDto } from './save-request-exemption.dto';

// Mirrors the global ValidationPipe options in src/main.ts. Regression coverage for a real 400
// reported from the field: the frontend's multi-select sends option ids as strings, and an
// unanswered select control round-trips as '' rather than undefined - neither is caught by the
// service/controller specs, which call the service directly with already-correctly-typed data.
const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

function buildPayload(
  dataOverrides: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stateId: '507f1f77bcf86cd799439011',
    yearId: '507f1f77bcf86cd799439012',
    data: {
      ulb: '507f1f77bcf86cd799439013',
      reasonForExemption: ['23', '30'],
      supportingDetails: 'The ULB has no elected body yet.',
      ...dataOverrides,
    },
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

const build = (dataOverrides: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  plainToInstance(SaveRequestExemptionDto, buildPayload(dataOverrides, overrides));

describe('SaveRequestExemptionDto', () => {
  it('accepts a fully populated payload with reasonForExemption ids sent as strings (as the frontend multi-select actually sends them)', async () => {
    const dto = build();
    expect(dto.data.reasonForExemption).toEqual([23, 30]);
    expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
  });

  describe('ulb', () => {
    it('normalizes an empty string to undefined (draft with the ULB question left blank)', async () => {
      const dto = build({ ulb: '' });
      expect(dto.data.ulb).toBeUndefined();
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('normalizes null to undefined', async () => {
      const dto = build({ ulb: null });
      expect(dto.data.ulb).toBeUndefined();
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts a well-formed ObjectId', async () => {
      expect(await validate(build({ ulb: '507f1f77bcf86cd799439013' }), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects a non-ObjectId string', async () => {
      const errors = await validate(build({ ulb: 'not-an-id' }), PIPE_OPTIONS);
      expect(allMessages(errors).join(' ')).toContain('mongodb id');
    });
  });

  describe('reasonForExemption', () => {
    it('coerces each string option id to a number', async () => {
      const dto = build({ reasonForExemption: ['23', '31'] });
      expect(dto.data.reasonForExemption).toEqual([23, 31]);
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('leaves an already-numeric array untouched', async () => {
      const dto = build({ reasonForExemption: [23, 31] });
      expect(dto.data.reasonForExemption).toEqual([23, 31]);
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts a missing reasonForExemption (draft)', async () => {
      const dto = build();
      delete (dto.data as unknown as Record<string, unknown>)['reasonForExemption'];
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects a non-numeric option id (coerces to NaN, which still fails @IsInt)', async () => {
      const errors = await validate(build({ reasonForExemption: ['abc'] }), PIPE_OPTIONS);
      expect(allMessages(errors).join(' ')).toContain('integer number');
    });
  });

  describe('exemptionFor', () => {
    it('is optional (absent = ULB default, applied server-side in validateAndSanitize)', async () => {
      const dto = build();
      expect(dto.data.exemptionFor).toBeUndefined();
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts "ULB" and "STATE"', async () => {
      expect(await validate(build({ exemptionFor: 'ULB' }), PIPE_OPTIONS)).toHaveLength(0);
      expect(await validate(build({ exemptionFor: 'STATE' }), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects any other value', async () => {
      const errors = await validate(build({ exemptionFor: 'ADMIN' }), PIPE_OPTIONS);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('reasonForExemptionState', () => {
    it('coerces each string option id to a number, same as reasonForExemption', async () => {
      const dto = build({ exemptionFor: 'STATE', reasonForExemptionState: ['22'] });
      expect(dto.data.reasonForExemptionState).toEqual([22]);
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('is optional at the DTO layer (enforced as required-when-STATE in the service, not here)', async () => {
      const dto = build();
      expect(dto.data.reasonForExemptionState).toBeUndefined();
      expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects a non-numeric option id', async () => {
      const errors = await validate(
        build({ exemptionFor: 'STATE', reasonForExemptionState: ['abc'] }),
        PIPE_OPTIONS,
      );
      expect(allMessages(errors).join(' ')).toContain('integer number');
    });
  });
});
