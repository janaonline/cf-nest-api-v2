import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { GetRequestExemptionListQueryDto } from './get-request-exemption-list-query.dto';

const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

function validateQuery(query: Record<string, unknown>) {
  const instance = plainToInstance(GetRequestExemptionListQueryDto, query);
  return validate(instance, PIPE_OPTIONS);
}

describe('GetRequestExemptionListQueryDto', () => {
  it('passes with no params, defaulting page/limit', async () => {
    const instance = plainToInstance(GetRequestExemptionListQueryDto, {});
    const errors = await validate(instance, PIPE_OPTIONS);

    expect(errors).toHaveLength(0);
    expect(instance.page).toBe(1);
    expect(instance.limit).toBe(10);
  });

  // reasonForExemption is deliberately NOT restricted to a fixed allow-list here - the real set of
  // valid reasons is per-year data (RequestExemptionFormJsonConfigService.loadReasonOptions), which
  // a class-validator decorator can't check. Any positive integer is structurally valid; a formId
  // outside the current year's real set just matches nothing in list()'s in-memory filter.
  it('accepts any positive integer reasonForExemption, not just 23/30/31', async () => {
    const errors = await validateQuery({ reasonForExemption: '99' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-integer reasonForExemption', async () => {
    const errors = await validateQuery({ reasonForExemption: 'not-a-number' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a zero/negative reasonForExemption', async () => {
    const errors = await validateQuery({ reasonForExemption: '0' });
    expect(errors.length).toBeGreaterThan(0);
  });

  // status stays a fixed allow-list - the FORM_STATUS enum is stable code, not year-data.
  it('accepts the 3 reachable status values', async () => {
    for (const status of [
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      FORM_STATUS.RETURNED_BY_MOHUA,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    ]) {
      const errors = await validateQuery({ status: String(status) });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects a status outside the 3 reachable values', async () => {
    const errors = await validateQuery({ status: String(FORM_STATUS.IN_PROGRESS) });
    expect(errors.length).toBeGreaterThan(0);
  });
});
