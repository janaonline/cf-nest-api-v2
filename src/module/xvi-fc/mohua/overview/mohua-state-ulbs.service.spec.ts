import ExcelJS from 'exceljs';
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
  let unspentFormFind: jest.Mock;

  const build = () => {
    const formId = new Types.ObjectId();
    const service = new MohuaStateUlbsService(
      {
        exists: jest.fn().mockResolvedValue({ _id: stateId }),
        findById: jest.fn().mockReturnValue(chain({ name: 'Andhra Pradesh' })),
      } as never,
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
      // FC Unspent: Anantapur declared ₹1.25 cr; Chirala's draft row has no figure yet; the others have no row.
      { findOne: (unspentFormFind = jest.fn().mockReturnValue(chain({ _id: formId }))) } as never,
      {
        find: jest.fn().mockReturnValue(
          chain([
            { ulbId: new Types.ObjectId(a.ulbId), unspentAmount: 12_500_000 },
            { ulbId: new Types.ObjectId(b.ulbId), unspentAmount: null },
          ]),
        ),
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
      unspentAmount: 1.25,
      electedBody: 'Constituted',
      forms: { audited: true, unaudited: false, pfms: true, slb: false, dur: true },
    });
    expect(items.find((row) => row.name === 'Zoro')).toMatchObject({ allocation: null, electedBody: null });
  });

  it("reads each ULB's unspent balance from the state's FC Unspent declaration, null when it has no figure", async () => {
    const { items } = await build().list(stateId, yearId, {});
    const unspent = (name: string) => items.find((row) => row.name === name)!.unspentAmount;

    expect(unspent('Anantapur')).toBe(1.25); // ₹1,25,00,000 → 1.25 cr
    expect(unspent('Chirala')).toBeNull(); // a draft row whose figure is not entered yet
    expect(unspent('amalapuram')).toBeNull(); // no row at all
    // the form is found by state and year (not deleted), then its rows by ULB
    expect(unspentFormFind).toHaveBeenCalledWith(
      expect.objectContaining({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), isDeleted: false }),
    );
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

  describe('exportToExcel', () => {
    const readSheet = async (buffer: ExcelJS.Buffer) => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      return workbook.worksheets[0];
    };
    const cells = (sheet: ExcelJS.Worksheet, rowNumber: number) =>
      (sheet.getRow(rowNumber).values as ExcelJS.CellValue[]).slice(1);

    it('writes every ULB the table lists, with each form as Submitted / Not submitted', async () => {
      const { buffer, fileName } = await build().exportToExcel(stateId, yearId, {});
      const sheet = await readSheet(buffer);

      expect(cells(sheet, 1)).toEqual([
        'ULB Name',
        'Census Code',
        'Allocation (₹ cr)',
        'Unspent Balance (₹ cr)',
        'Elected Body',
        'Audited',
        'Provisional',
        'PFMS',
        'SLB',
        'DUR',
      ]);
      expect(sheet.rowCount).toBe(1 + 4); // header + all four ULBs, not just one table page
      expect(cells(sheet, 3)).toEqual([
        'Anantapur',
        '459813',
        2.5,
        1.25,
        'Constituted',
        'Submitted',
        'Not submitted',
        'Submitted',
        'Not submitted',
        'Submitted',
      ]);
      expect(fileName).toMatch(/^andhra-pradesh-ulb-progress_\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    it('uses the same search and sort as the table, but ignores paging', async () => {
      const sorted = await build().exportToExcel(stateId, yearId, {
        sortBy: 'allocation',
        sortDir: 'desc',
        limit: 1,
        page: 3,
      });
      // Column keys are not stored in the file, so read the ULB name column by position (values are 1-based; row 1 is the header).
      const names = (await readSheet(sorted.buffer)).getColumn(1).values.slice(2);
      expect(names).toEqual(['Chirala', 'Anantapur', 'amalapuram', 'Zoro']);

      const searched = await build().exportToExcel(stateId, yearId, { search: 'ANANT' });
      expect((await readSheet(searched.buffer)).rowCount).toBe(2);
    });
  });
});
