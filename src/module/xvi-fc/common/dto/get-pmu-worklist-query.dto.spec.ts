import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetPmuWorklistQueryDto } from './get-pmu-worklist-query.dto';

const errorsFor = async (query: Record<string, string>) =>
  (await validate(plainToInstance(GetPmuWorklistQueryDto, query))).map((e) => e.property);

describe('GetPmuWorklistQueryDto installment', () => {
  it('is optional', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['1', '2'])('accepts installment=%s', async (installment) => {
    expect(await errorsFor({ installment })).toEqual([]);
  });

  it.each(['0', '3', 'abc', '1.5'])('rejects installment=%s', async (installment) => {
    expect(await errorsFor({ installment })).toEqual(['installment']);
  });
});
