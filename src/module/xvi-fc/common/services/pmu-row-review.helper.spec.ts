import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { PmuRowReviewHelper } from './pmu-row-review.helper';

describe('PmuRowReviewHelper.undoRows', () => {
  const formId = new Types.ObjectId();
  const stateOid = new Types.ObjectId();
  const yearOid = new Types.ObjectId();
  const userOid = new Types.ObjectId();
  const session = {} as never;

  const rowApproved = { _id: new Types.ObjectId(), rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null };
  const rowReturned = { _id: new Types.ObjectId(), rowStatus: FORM_STATUS.RETURNED_BY_PMU, rejectionRemark: 'Wrong date' };

  let rowModel: { bulkWrite: jest.Mock };
  let rowHistoryModel: { insertMany: jest.Mock };
  const helper = new PmuRowReviewHelper();

  const run = (rows: unknown[]) =>
    helper.undoRows({
      rowModel: rowModel as never,
      rowHistoryModel: rowHistoryModel as never,
      formId,
      stateOid,
      yearOid,
      rows: rows as never,
      userOid,
      ip: '1.1.1.1',
      userAgent: 'jest',
      session,
      buildSnapshot: (row, status, remark) => ({ id: String(row._id), status, remark }),
    });

  beforeEach(() => {
    rowModel = { bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 2 }) };
    rowHistoryModel = { insertMany: jest.fn().mockResolvedValue([]) };
  });

  it('reopens each row conditionally on its current status and clears its remark', async () => {
    const moved = await run([rowApproved, rowReturned]);

    expect(moved).toBe(2);
    const [ops, options] = rowModel.bulkWrite.mock.calls[0] as [Record<string, any>[], object];
    expect(options).toEqual({ session });
    expect(ops.map((o) => o['updateOne'].filter)).toEqual([
      { _id: rowApproved._id, rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
      { _id: rowReturned._id, rowStatus: FORM_STATUS.RETURNED_BY_PMU },
    ]);
    expect(ops[0]['updateOne'].update.$set).toMatchObject({
      rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
      rejectionRemark: null,
    });
  });

  it('writes two ordered history entries per row, 5|14 -> 10 -> 13, the first carrying the cleared remark', async () => {
    await run([rowReturned]);

    const [docs] = rowHistoryModel.insertMany.mock.calls[0] as [Record<string, any>[]];
    expect(docs.map((d) => [d['previousStatus'], d['currentStatus']])).toEqual([
      [FORM_STATUS.RETURNED_BY_PMU, FORM_STATUS.UNDO],
      [FORM_STATUS.UNDO, FORM_STATUS.UNDER_REVIEW_BY_PMU],
    ]);
    expect(docs[0]['snapshot']).toEqual({ id: String(rowReturned._id), status: FORM_STATUS.UNDO, remark: 'Wrong date' });
    expect(docs[1]['snapshot']).toEqual({ id: String(rowReturned._id), status: FORM_STATUS.UNDER_REVIEW_BY_PMU, remark: null });
    expect(docs[1]['createdAt'].getTime()).toBeGreaterThan(docs[0]['createdAt'].getTime());
  });

  it("returns the real modified count so the caller can abort when a row moved under it", async () => {
    rowModel.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
    await expect(run([rowApproved, rowReturned])).resolves.toBe(1);
  });

  it('does nothing for an empty row set', async () => {
    await expect(run([])).resolves.toBe(0);
    expect(rowModel.bulkWrite).not.toHaveBeenCalled();
    expect(rowHistoryModel.insertMany).not.toHaveBeenCalled();
  });
});
