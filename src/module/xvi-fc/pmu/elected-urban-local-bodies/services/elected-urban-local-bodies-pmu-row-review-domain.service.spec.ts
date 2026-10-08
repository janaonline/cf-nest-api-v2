import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesPmuRowReviewDomainService } from './elected-urban-local-bodies-pmu-row-review-domain.service';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { PmuRowReviewHelper } from 'src/module/xvi-fc/common/services/pmu-row-review.helper';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesFormHistory } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { ElectedUrbanLocalBodiesRowHistory } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row-history.schema';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { EulbPmuFormLean, EulbPmuRowLean } from '../types/elected-urban-local-bodies-pmu-review.types';

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'session']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

interface TestBulkOp {
  updateOne: { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } };
}

function getBulkOps(mockFn: jest.Mock): TestBulkOp[] {
  const calls = mockFn.mock.calls as unknown as Array<[TestBulkOp[]]>;
  return calls[0][0];
}

interface TestRowHistoryDoc {
  row: Types.ObjectId;
  form: Types.ObjectId;
  previousStatus: unknown;
  currentStatus: unknown;
  snapshot: Record<string, unknown>;
}

function getInsertManyDocs(mockFn: jest.Mock): TestRowHistoryDoc[] {
  const calls = mockFn.mock.calls as unknown as Array<[TestRowHistoryDoc[]]>;
  return calls[0][0];
}

interface TestSetArg {
  currentFormStatus?: number;
  pmuRemarks?: string | null;
}

function getFindOneAndUpdateSetArg(mockFn: jest.Mock): TestSetArg {
  const calls = mockFn.mock.calls as unknown as Array<[unknown, { $set: TestSetArg }]>;
  return calls[0][1].$set;
}

interface TestHistoryDoc {
  action: FormHistoryAction;
  fromStatus: number;
  toStatus: number;
  snapshot: Array<{ rowNumber: number; rowStatus: unknown; rejectionRemark: unknown }>;
}

function getHistoryCreateArg(mockFn: jest.Mock): TestHistoryDoc {
  const calls = mockFn.mock.calls as unknown as Array<[[TestHistoryDoc]]>;
  return calls[0][0][0];
}

const formOid = new Types.ObjectId();
const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const userOid = new Types.ObjectId();
const ulbOid1 = new Types.ObjectId();
const rowOid1 = new Types.ObjectId();

const mockSession = { id: 'fake-session' } as never;

function makeForm(overrides: Partial<EulbPmuFormLean> = {}): EulbPmuFormLean {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    activeDatasetVersion: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<EulbPmuRowLean> = {}): EulbPmuRowLean {
  return {
    _id: rowOid1,
    form: formOid,
    datasetVersion: 1,
    rowNumber: 1,
    ulbId: ulbOid1,
    censusCode: '111',
    ulbName: 'Alpha ULB',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-01-01T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-01-01T00:00:00.000Z'),
    remarks: null,
    rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    rejectionRemark: null,
    ...overrides,
  };
}

describe('ElectedUrbanLocalBodiesPmuRowReviewDomainService', () => {
  let service: ElectedUrbanLocalBodiesPmuRowReviewDomainService;
  let formModel: Record<string, jest.Mock>;
  let historyModel: Record<string, jest.Mock>;
  let rowModel: Record<string, jest.Mock>;
  let rowHistoryModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(q(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(q(makeForm())),
    };
    historyModel = {
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    };
    rowModel = {
      find: jest.fn().mockReturnValue(q([])),
      bulkWrite: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockReturnValue(q(0)),
    };
    rowHistoryModel = {
      insertMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesPmuRowReviewDomainService,
        StateFormPmuReviewHelper,
        PmuRowReviewHelper,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesFormHistory.name), useValue: historyModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRowHistory.name), useValue: rowHistoryModel },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesPmuRowReviewDomainService);
  });

  describe('findForm', () => {
    it('scopes the query by state, year, and formType', async () => {
      await service.findForm(stateOid.toString(), yearOid.toString());
      expect(formModel['findOne']).toHaveBeenCalledWith(
        expect.objectContaining({ formType: 'ELECTED_URBAN_LOCAL_BODIES' }),
      );
    });
  });

  describe('loadActiveRowsByIds', () => {
    it('scopes by form and datasetVersion, returning missingIds for requested rows not found', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([makeRow()]));
      const otherId = new Types.ObjectId();

      const { rows, missingIds } = await service.loadActiveRowsByIds(formOid, 1, [rowOid1, otherId]);

      expect(rows).toHaveLength(1);
      expect(missingIds).toEqual([otherId.toString()]);
    });
  });

  describe('filterNotInStatus', () => {
    it('returns rows whose rowStatus does not match the expected value', () => {
      const pending = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      const active = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });

      const result = service.filterNotInStatus([pending, active], FORM_STATUS.UNDER_REVIEW_BY_PMU);

      expect(result).toEqual([active]);
    });
  });

  describe('transitionRows', () => {
    it('is a no-op when there are no transitions', async () => {
      await service.transitionRows(formOid, stateOid, yearOid, [], userOid, null, null, mockSession);
      expect(rowModel['bulkWrite']).not.toHaveBeenCalled();
      expect(rowHistoryModel['insertMany']).not.toHaveBeenCalled();
    });

    it('bulkWrites a $set update per row targeted by _id', async () => {
      const row = makeRow();
      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [{ row, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null }],
        userOid,
        null,
        null,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.filter).toEqual({ _id: row._id });
      expect(ops[0].updateOne.update.$set).toMatchObject({
        rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        rejectionRemark: null,
      });
    });

    it('sets rejectionRemark on the row when rejecting', async () => {
      const row = makeRow();
      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [{ row, newStatus: FORM_STATUS.RETURNED_BY_PMU, rejectionRemark: 'Dates inconsistent with registry.' }],
        userOid,
        null,
        null,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set['rejectionRemark']).toBe('Dates inconsistent with registry.');
    });

    it('inserts one immutable row-history entry per transition with previous/current status and a full snapshot', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [{ row, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null }],
        userOid,
        '127.0.0.1',
        'jest-agent',
        mockSession,
      );

      const docs = getInsertManyDocs(rowHistoryModel['insertMany']);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        row: row._id,
        form: formOid,
        previousStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
        currentStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        snapshot: expect.objectContaining({
          rowNumber: 1,
          datasetVersion: 1,
          rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          rejectionRemark: null,
        }) as Record<string, unknown>,
      });
    });

    it('filters out a transition whose row is already at the target status — no bulk update, no history entry for it', async () => {
      const alreadyApprovedRow = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      const pendingRow = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });

      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [
          { row: alreadyApprovedRow, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null },
          { row: pendingRow, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null },
        ],
        userOid,
        null,
        null,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops).toHaveLength(1);
      expect(ops[0].updateOne.filter).toEqual({ _id: pendingRow._id });

      const docs = getInsertManyDocs(rowHistoryModel['insertMany']);
      expect(docs).toHaveLength(1);
      expect(docs[0].row).toEqual(pendingRow._id);
    });

    it('is a no-op when every transition is already at its target status', async () => {
      const alreadyApprovedRow = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });

      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [{ row: alreadyApprovedRow, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null }],
        userOid,
        null,
        null,
        mockSession,
      );

      expect(rowModel['bulkWrite']).not.toHaveBeenCalled();
      expect(rowHistoryModel['insertMany']).not.toHaveBeenCalled();
    });
  });

  describe('countActiveRowsNotYetApproved', () => {
    it('counts active rows in the given dataset version whose rowStatus is not UNDER_REVIEW_BY_MOHUA', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(2));
      const count = await service.countActiveRowsNotYetApproved(formOid, 1);
      expect(rowModel['countDocuments']).toHaveBeenCalledWith({
        form: formOid,
        datasetVersion: 1,
        isActive: true,
        rowStatus: { $ne: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
      });
      expect(count).toBe(2);
    });
  });

  describe('getRowSummary', () => {
    it('tallies rows by status — no eligible/ineligible split, unlike FC Unspent (EULB rows have no eligibility field)', async () => {
      rowModel['find'] = jest
        .fn()
        .mockReturnValue(
          q([
            { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
            { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU },
            { rowStatus: FORM_STATUS.RETURNED_BY_PMU },
            { rowStatus: FORM_STATUS.ACTION_REQUIRED },
            { rowStatus: null },
          ]),
        );

      const summary = await service.getRowSummary(formOid, 1);

      expect(summary).toEqual({
        total: 5,
        active: 1,
        updatePending: 1,
        rejected: 1,
        needsUpdate: 1,
      });
    });
  });

  describe('transitionParent', () => {
    it('sets currentFormStatus via the shared StateFormPmuReviewHelper', async () => {
      await service.transitionParent(formOid, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, undefined, userOid, mockSession);
      const setArg = getFindOneAndUpdateSetArg(formModel['findOneAndUpdate']);
      expect(setArg).toMatchObject({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      expect(setArg.pmuRemarks).toBeUndefined();
    });

    it('sets pmuRemarks when provided', async () => {
      await service.transitionParent(formOid, FORM_STATUS.RETURNED_BY_PMU, 'Please fix row 3.', userOid, mockSession);
      const setArg = getFindOneAndUpdateSetArg(formModel['findOneAndUpdate']);
      expect(setArg.pmuRemarks).toBe('Please fix row 3.');
    });
  });

  describe('insertParentHistory', () => {
    it('builds the snapshot from the active dataset version’s active rows, including rowStatus/rejectionRemark', async () => {
      rowModel['find'] = jest
        .fn()
        .mockReturnValue(q([{ ...makeRow(), rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null }]));

      await service.insertParentHistory(
        makeForm(),
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        FormHistoryAction.PMU_APPROVE,
        userOid,
        '127.0.0.1',
        'jest-agent',
        mockSession,
      );

      const historyArg = getHistoryCreateArg(historyModel['create']);
      expect(historyArg.action).toBe(FormHistoryAction.PMU_APPROVE);
      expect(historyArg.fromStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_PMU);
      expect(historyArg.toStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      expect(historyArg.snapshot[0]).toMatchObject({
        rowNumber: 1,
        rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        rejectionRemark: null,
      });
    });

    it('is a no-op when fromStatus equals toStatus — the row snapshot fetch never runs', async () => {
      await service.insertParentHistory(
        makeForm(),
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        FormHistoryAction.PMU_APPROVE,
        userOid,
        '127.0.0.1',
        'jest-agent',
        mockSession,
      );

      expect(historyModel['create']).not.toHaveBeenCalled();
      expect(rowModel['find']).not.toHaveBeenCalled();
    });
  });

  describe('maybeApproveAfterBulkAction', () => {
    it('does not approve when rows remain not-yet-approved', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.maybeApproveAfterBulkAction(makeForm(), userOid, null, null, mockSession);

      expect(result.approved).toBe(false);
      expect(formModel['findOneAndUpdate']).not.toHaveBeenCalled();
    });

    it('approves and writes parent history (PMU_APPROVE) when every active row is approved', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));
      rowModel['find'] = jest.fn().mockReturnValue(q([]));

      const result = await service.maybeApproveAfterBulkAction(makeForm(), userOid, null, null, mockSession);

      expect(result.approved).toBe(true);
      expect(result.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      const setArg = getFindOneAndUpdateSetArg(formModel['findOneAndUpdate']);
      expect(setArg.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      const historyArg = getHistoryCreateArg(historyModel['create']);
      expect(historyArg.action).toBe(FormHistoryAction.PMU_APPROVE);
    });
  });
});
