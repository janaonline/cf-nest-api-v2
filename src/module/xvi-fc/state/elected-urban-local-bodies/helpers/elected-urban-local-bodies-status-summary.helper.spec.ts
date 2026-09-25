import { Types } from 'mongoose';
import { computeEulbStatusSummary } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-status-summary.helper';

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const formOid = new Types.ObjectId();
const stateId = new Types.ObjectId().toString();
const yearId = new Types.ObjectId().toString();
const electedBodyStatuses = ['Constituted', 'Not Constituted', '6th Schedule'];

function makeRowModel(groups: Array<{ _id: string | null; count: number }>) {
  return { aggregate: jest.fn().mockReturnValue(q(groups)) } as unknown as Parameters<
    typeof computeEulbStatusSummary
  >[0];
}

describe('computeEulbStatusSummary', () => {
  it('maps aggregation groups onto the four named counts', async () => {
    const rowModel = makeRowModel([
      { _id: 'Constituted', count: 50 },
      { _id: 'Not Constituted', count: 60 },
      { _id: '6th Schedule', count: 13 },
    ]);

    const summary = await computeEulbStatusSummary(rowModel, formOid, stateId, yearId, 1, electedBodyStatuses);

    expect(summary).toEqual({
      totalUlbCount: 123,
      constitutedCount: 50,
      notConstitutedCount: 60,
      exemptCount: 13,
    });
  });

  it('folds an unknown/null status into totalUlbCount only', async () => {
    const rowModel = makeRowModel([
      { _id: 'Constituted', count: 10 },
      { _id: null, count: 3 },
    ]);

    const summary = await computeEulbStatusSummary(rowModel, formOid, stateId, yearId, 1, electedBodyStatuses);

    expect(summary).toEqual({
      totalUlbCount: 13,
      constitutedCount: 10,
      notConstitutedCount: 0,
      exemptCount: 0,
    });
  });

  it('returns an all-zero summary for an empty aggregation result', async () => {
    const rowModel = makeRowModel([]);

    const summary = await computeEulbStatusSummary(rowModel, formOid, stateId, yearId, 1, electedBodyStatuses);

    expect(summary).toEqual({
      totalUlbCount: 0,
      constitutedCount: 0,
      notConstitutedCount: 0,
      exemptCount: 0,
    });
  });

  it('matches on form, state, year, active datasetVersion, and isActive:true', async () => {
    const rowModel = makeRowModel([{ _id: 'Constituted', count: 1 }]);

    await computeEulbStatusSummary(rowModel, formOid, stateId, yearId, 7, electedBodyStatuses);

    const pipeline = (rowModel.aggregate as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
    const matchStage = pipeline[0]['$match'] as Record<string, unknown>;
    expect(matchStage).toMatchObject({
      form: formOid,
      state: new Types.ObjectId(stateId),
      year: new Types.ObjectId(yearId),
      datasetVersion: 7,
      isActive: true,
    });
  });
});
