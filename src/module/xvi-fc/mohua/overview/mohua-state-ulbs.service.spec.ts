import { Types } from 'mongoose';
import { MohuaStateUlbsService } from './mohua-state-ulbs.service';

/** Mongoose-style chain: find()/findOne().select().lean().exec() resolving to `value`. */
const chain = <T>(value: T) => ({
  select: () => ({ lean: () => ({ exec: () => Promise.resolve(value) }) }),
});

describe('MohuaStateUlbsService.list', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();

  // A, B, C have an allocation (rupees); D has none. Allocation in crore: A 2.5, B 7, C 1.
  const ulb = (name: string, censusCode: string) => ({
    ulbId: new Types.ObjectId().toString(),
    name,
    censusCode,
    sbCode: null,
  });
  const a = ulb('Anantapur', '459813');
  const b = ulb('Chirala', '459816');
  const c = ulb('amalapuram', '459812');
  const d = ulb('Zoro', '459999');

  let loadSubmitted: jest.Mock;

  const build = () => {
    const formId = new Types.ObjectId();
    const service = new MohuaStateUlbsService(
      { exists: jest.fn().mockResolvedValue({ _id: stateId }) } as never,
      { findOne: jest.fn().mockReturnValue(chain({ _id: formId, activeDatasetVersion: 1 })) } as never,
      {
        find: jest.fn().mockReturnValue(
          chain([
            { ulbId: new Types.ObjectId(a.ulbId), totalGrantAllocation: 25_000_000 },
            { ulbId: new Types.ObjectId(b.ulbId), totalGrantAllocation: 70_000_000 },
            { ulbId: new Types.ObjectId(c.ulbId), totalGrantAllocation: 10_000_000 },
          ]),
        ),
      } as never,
      { findOne: jest.fn().mockReturnValue(chain({ _id: formId, activeDatasetVersion: 1 })) } as never,
      {
        find: jest
          .fn()
          .mockReturnValue(chain([{ ulbId: new Types.ObjectId(a.ulbId), electedBodyStatus: 'Constituted' }])),
      } as never,
      { resolve: jest.fn().mockResolvedValue([a, b, c, d]) } as never,
      {
        loadSubmittedUlbIdsByForm: (loadSubmitted = jest.fn().mockResolvedValue({
          audited: new Set([a.ulbId]),
          unaudited: new Set<string>(),
          pfms: new Set([a.ulbId, b.ulbId]),
          slb: new Set<string>(),
          dur: new Set([a.ulbId]),
          all: new Set<string>(),
        })),
      } as never,
    );
    return service;
  };

  it('defaults to ULB name ascending, ignoring case, and shapes each row', async () => {
    const { items, pagination } = await build().list(stateId, yearId, {});

    expect(items.map((row) => row.name)).toEqual(['amalapuram', 'Anantapur', 'Chirala', 'Zoro']);
    expect(pagination).toEqual({ page: 1, limit: 15, total: 4, totalPages: 1 });

    const anantapur = items.find((row) => row.name === 'Anantapur')!;
    expect(anantapur).toMatchObject({
      censusCode: '459813',
      allocation: 2.5,
      electedBody: 'Constituted',
      forms: { audited: true, unaudited: false, pfms: true, slb: false, dur: true },
    });
    expect(items.find((row) => row.name === 'Zoro')).toMatchObject({ allocation: null, electedBody: null });
  });

  it("reads form submissions only for this state's ULBs", async () => {
    await build().list(stateId, yearId, {});

    expect(loadSubmitted).toHaveBeenCalledWith(yearId, [a.ulbId, b.ulbId, c.ulbId, d.ulbId]);
  });

  it('sorts by allocation in both directions and always puts ULBs without one last', async () => {
    const desc = await build().list(stateId, yearId, { sortBy: 'allocation', sortDir: 'desc' });
    expect(desc.items.map((row) => row.name)).toEqual(['Chirala', 'Anantapur', 'amalapuram', 'Zoro']);

    const asc = await build().list(stateId, yearId, { sortBy: 'allocation', sortDir: 'asc' });
    expect(asc.items.map((row) => row.name)).toEqual(['amalapuram', 'Anantapur', 'Chirala', 'Zoro']);
  });

  it('pages the sorted list and clamps a page past the end', async () => {
    const second = await build().list(stateId, yearId, { limit: 2, page: 2 });
    expect(second.items.map((row) => row.name)).toEqual(['Chirala', 'Zoro']);
    expect(second.pagination).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });

    const past = await build().list(stateId, yearId, { limit: 2, page: 9 });
    expect(past.pagination.page).toBe(2);
  });

  it('searches by ULB name or census code', async () => {
    const byName = await build().list(stateId, yearId, { search: 'ANANT' });
    expect(byName.items.map((row) => row.name)).toEqual(['Anantapur']);

    const byCensus = await build().list(stateId, yearId, { search: '459816' });
    expect(byCensus.items.map((row) => row.name)).toEqual(['Chirala']);
    expect(byCensus.pagination.total).toBe(1);
  });
});
