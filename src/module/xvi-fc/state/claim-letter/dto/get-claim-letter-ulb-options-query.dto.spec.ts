import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetClaimLetterUlbOptionsQueryDto } from './get-claim-letter-ulb-options-query.dto';

const errorsFor = async (query: Record<string, string>) =>
  (await validate(plainToInstance(GetClaimLetterUlbOptionsQueryDto, query))).map((e) => e.property);

describe('GetClaimLetterUlbOptionsQueryDto limit', () => {
  it.each(['1', '100', '1000'])('accepts limit=%s, so the picker can load every ULB at once', async (limit) => {
    expect(await errorsFor({ limit })).toEqual([]);
  });

  it.each(['0', '1001', 'abc'])('rejects limit=%s', async (limit) => {
    expect(await errorsFor({ limit })).toEqual(['limit']);
  });
});
