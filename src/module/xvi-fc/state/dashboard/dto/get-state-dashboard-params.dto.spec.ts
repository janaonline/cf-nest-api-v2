import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { GetStateDashboardParamsDto } from './get-state-dashboard-params.dto';

function makeDto(overrides: Partial<GetStateDashboardParamsDto> = {}): GetStateDashboardParamsDto {
  return Object.assign(new GetStateDashboardParamsDto(), {
    stateId: new Types.ObjectId().toHexString(),
    yearId: new Types.ObjectId().toHexString(),
    ...overrides,
  });
}

describe('GetStateDashboardParamsDto', () => {
  it('accepts valid State and year ObjectIds', async () => {
    await expect(validate(makeDto())).resolves.toHaveLength(0);
  });

  it('rejects an invalid State ObjectId', async () => {
    const errors = await validate(makeDto({ stateId: 'invalid-state' }));
    expect(errors.some((error) => error.property === 'stateId')).toBe(true);
  });

  it('rejects an invalid year ObjectId', async () => {
    const errors = await validate(makeDto({ yearId: 'invalid-year' }));
    expect(errors.some((error) => error.property === 'yearId')).toBe(true);
  });

  it('rejects an empty State ID', async () => {
    const errors = await validate(makeDto({ stateId: '' }));
    expect(errors.some((error) => error.property === 'stateId')).toBe(true);
  });

  it('rejects an empty year ID', async () => {
    const errors = await validate(makeDto({ yearId: '' }));
    expect(errors.some((error) => error.property === 'yearId')).toBe(true);
  });
});
