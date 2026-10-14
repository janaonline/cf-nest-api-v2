import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetStateFormHistoryQueryDto } from './get-state-form-history-query.dto';

const errorsFor = async (query: Record<string, string>) =>
  (await validate(plainToInstance(GetStateFormHistoryQueryDto, query))).map((e) => e.property);

describe('GetStateFormHistoryQueryDto', () => {
  it('accepts no paging params at all', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts a page size up to the 50 ceiling', async () => {
    expect(await errorsFor({ limit: '50' })).toEqual([]);
  });

  it.each(['51', '1000', '0', '-5', 'abc'])('rejects limit=%s', async (limit) => {
    expect(await errorsFor({ limit })).toEqual(['limit']);
  });

  it('rejects a malformed cursor', async () => {
    expect(await errorsFor({ cursor: 'not-a-cursor' })).toEqual(['cursor']);
  });

  it('accepts a well-formed cursor', async () => {
    expect(await errorsFor({ cursor: '2026-09-16T05:35:00.000Z_507f1f77bcf86cd799439011' })).toEqual([]);
  });
});
