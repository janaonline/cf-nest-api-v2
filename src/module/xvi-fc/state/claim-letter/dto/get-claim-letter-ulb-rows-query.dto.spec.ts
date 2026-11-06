import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetClaimLetterUlbRowsQueryDto } from './get-claim-letter-ulb-rows-query.dto';

const errorsFor = async (query: Record<string, string>) =>
  (await validate(plainToInstance(GetClaimLetterUlbRowsQueryDto, query))).map((e) => e.property);

describe('GetClaimLetterUlbRowsQueryDto limit', () => {
  it.each(['1', '100', '1000'])(
    'accepts limit=%s, so the detail page can load a whole batch at once',
    async (limit) => {
      expect(await errorsFor({ limit })).toEqual([]);
    },
  );

  it.each(['0', '1001', 'abc'])('rejects limit=%s', async (limit) => {
    expect(await errorsFor({ limit })).toEqual(['limit']);
  });
});
