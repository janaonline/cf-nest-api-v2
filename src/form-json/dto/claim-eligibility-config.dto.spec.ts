import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { ClaimEligibilityConfigDto } from './claim-eligibility-config.dto';

// Mirrors the global ValidationPipe options in src/main.ts
const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

/** Matches the shape of the one Devolution-formId=24 seed config described in the plan §2. */
function buildDevolutionConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    ruleVersion: 1,
    ownerLevel: 'STATE',
    evaluationLevel: 'FORM',
    yearScope: 'CURRENT_DESIGN_YEAR',
    applicableInstallments: [1],
    acceptedFormStatuses: [5, 7],
    source: {
      collection: 'xvi_fc_devolution_formula_forms',
      fields: { designYear: 'year', state: 'state', currentFormStatus: 'currentFormStatus' },
    },
    evaluator: { type: 'FORM_STATUS', config: { installmentField: 'installment' } },
    exemption: { allowed: false },
    approval: { action: 'NO_ACTION' },
    rejection: { action: 'NO_ACTION' },
    ...overrides,
  };
}

const build = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(ClaimEligibilityConfigDto, buildDevolutionConfig(overrides));

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

describe('ClaimEligibilityConfigDto', () => {
  it('accepts the canonical Devolution FORM_STATUS config with zero errors', async () => {
    expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
  });

  it('rejects an evaluator.type outside the controlled vocabulary', async () => {
    const errors = await validate(build({ evaluator: { type: 'DROP TABLE forms;' } }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts every controlled evaluator.type', async () => {
    for (const type of [
      'FORM_STATUS',
      'FORM_AND_ROW_STATUS',
      'ROW_STATUS_AND_FIELDS',
      'BRANCH_WITH_OPTIONAL_ROWS',
      'ONE_TIME_FORM_STATUS',
    ]) {
      const errors = await validate(build({ evaluator: { type } }), PIPE_OPTIONS);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects an unrecognized ownerLevel', async () => {
    const errors = await validate(build({ ownerLevel: 'MOHUA' }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unrecognized evaluationLevel', async () => {
    const errors = await validate(build({ evaluationLevel: 'EVERYTHING' }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an installment outside [1, 2]', async () => {
    const errors = await validate(build({ applicableInstallments: [3] }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a workflow action outside the controlled allowlist', async () => {
    const errors = await validate(build({ approval: { action: 'RUN_ARBITRARY_CODE' } }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a config missing the required source object', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['source'];
    expect(allMessages(await validate(dto, PIPE_OPTIONS)).join(' ')).toContain('source');
  });

  it('rejects an unknown top-level key under forbidNonWhitelisted', async () => {
    const errors = await validate(build({ arbitraryMongoOperator: { $where: 'sleep(1000)' } }), PIPE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts optional dependentActions when provided as a valid array', async () => {
    const errors = await validate(
      build({ dependentActions: [{ action: 'MARK_DEPENDENT_ROWS_NEEDS_UPDATE' }] }),
      PIPE_OPTIONS,
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts a missing dependentActions (optional)', async () => {
    const dto = build();
    delete (dto as unknown as Record<string, unknown>)['dependentActions'];
    expect(await validate(dto, PIPE_OPTIONS)).toHaveLength(0);
  });
});
