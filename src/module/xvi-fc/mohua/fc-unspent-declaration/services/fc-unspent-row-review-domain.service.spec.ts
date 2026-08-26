import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FcUnspentRowReviewDomainService } from './fc-unspent-row-review-domain.service';
import { XviFcUnspentStateForm } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcUnspentStateFormHistory } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import { XviFcUnspentStateFormRow } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { XviFcUnspentStateFormRowHistory } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { FcUnspentMohuaFormLean, FcUnspentMohuaRowLean } from '../types/fc-unspent-mohua-review.types';

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
  auditRevision?: number;
  mohuaRemarks?: string | null;
}

function getFindOneAndUpdateSetArg(mockFn: jest.Mock): TestSetArg {
  const calls = mockFn.mock.calls as unknown as Array<[unknown, { $set: TestSetArg }]>;
  return calls[0][1].$set;
}

interface TestHistoryDoc {
  fromStatus: number;
  toStatus: number;
  auditRevision: number;
  unspentUlbData: Array<{ rowNumber: number; rowStatus: unknown; rejectionRemark: unknown }>;
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

function makeForm(overrides: Partial<FcUnspentMohuaFormLean> = {}): FcUnspentMohuaFormLean {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    isFcUnspent: true,
    fcDeclaration: null,
    checkboxConfirmation: true,
    auditRevision: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<FcUnspentMohuaRowLean> = {}): FcUnspentMohuaRowLean {
  return {
    _id: rowOid1,
    form: formOid,
    rowNumber: 1,
    ulbId: ulbOid1,
    censusCode: '111',
    sbCode: 'A1',
    ulbName: 'Alpha ULB',
    allocationAmount: 100,
    unspentAmount: 5,
    allocationPerc: 5,
    eligibility: true,
    rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    rejectionRemark: null,
    ...overrides,
  };
}

describe('FcUnspentRowReviewDomainService', () => {
  let service: FcUnspentRowReviewDomainService;
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
        FcUnspentRowReviewDomainService,
        { provide: getModelToken(XviFcUnspentStateForm.name), useValue: formModel },
        { provide: getModelToken(XviFcUnspentStateFormHistory.name), useValue: historyModel },
        { provide: getModelToken(XviFcUnspentStateFormRow.name), useValue: rowModel },
        { provide: getModelToken(XviFcUnspentStateFormRowHistory.name), useValue: rowHistoryModel },
      ],
    }).compile();

    service = module.get(FcUnspentRowReviewDomainService);
  });

  describe('findForm', () => {
    it('scopes the query by state, year, formType, and isDeleted:false', async () => {
      await service.findForm(stateOid.toString(), yearOid.toString());
      expect(formModel['findOne']).toHaveBeenCalledWith(
        expect.objectContaining({ formType: 'FC_UNSPENT_STATE', isDeleted: false }),
      );
    });
  });

  describe('loadActiveRowsByIds', () => {
    it('returns missingIds for requested rows not found on the form', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([makeRow()]));
      const otherId = new Types.ObjectId();

      const { rows, missingIds } = await service.loadActiveRowsByIds(formOid, [rowOid1, otherId]);

      expect(rows).toHaveLength(1);
      expect(missingIds).toEqual([otherId.toString()]);
    });
  });

  describe('filterNotInStatus', () => {
    it('returns rows whose rowStatus does not match the expected value', () => {
      const pending = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      const active = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA });

      const result = service.filterNotInStatus([pending, active], FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

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
        [{ row, newStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, rejectionRemark: null }],
        userOid,
        null,
        null,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.filter).toEqual({ _id: row._id });
      expect(ops[0].updateOne.update.$set).toMatchObject({ rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, rejectionRemark: null });
    });

    it('sets rejectionRemark on the row when rejecting', async () => {
      const row = makeRow();
      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [{ row, newStatus: FORM_STATUS.RETURNED_BY_MOHUA, rejectionRemark: 'Allocation mismatch.' }],
        userOid,
        null,
        null,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set['rejectionRemark']).toBe('Allocation mismatch.');
    });

    it('inserts one immutable row-history entry per transition with previous/current status and snapshot', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      await service.transitionRows(
        formOid,
        stateOid,
        yearOid,
        [{ row, newStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, rejectionRemark: null }],
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
        previousStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        currentStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        snapshot: expect.objectContaining({
          rowNumber: 1,
          rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
          rejectionRemark: null,
        }) as Record<string, unknown>,
      });
    });
  });

  describe('countActiveRowsNotYetActive', () => {
    it('counts active rows whose rowStatus is not ACTIVE', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(2));
      const count = await service.countActiveRowsNotYetActive(formOid);
      expect(rowModel['countDocuments']).toHaveBeenCalledWith({
        form: formOid,
        isActive: true,
        rowStatus: { $ne: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
      });
      expect(count).toBe(2);
    });
  });

  describe('getRowSummary', () => {
    it('tallies rows by status and eligibility', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(
        q([
          { rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, eligibility: true },
          { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, eligibility: false },
          { rowStatus: FORM_STATUS.RETURNED_BY_MOHUA, eligibility: true },
          { rowStatus: FORM_STATUS.ACTION_REQUIRED, eligibility: false },
          { rowStatus: null, eligibility: true },
        ]),
      );

      const summary = await service.getRowSummary(formOid);

      expect(summary).toEqual({
        total: 5,
        active: 1,
        updatePending: 1,
        rejected: 1,
        needsUpdate: 1,
        eligible: 3,
        ineligible: 2,
      });
    });
  });

  describe('transitionParent', () => {
    it('sets currentFormStatus and auditRevision explicitly', async () => {
      await service.transitionParent(
        formOid,
        FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        undefined,
        3,
        userOid,
        mockSession,
      );
      const setArg = getFindOneAndUpdateSetArg(formModel['findOneAndUpdate']);
      expect(setArg).toMatchObject({
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        auditRevision: 3,
      });
      expect(setArg.mohuaRemarks).toBeUndefined();
    });

    it('sets mohuaRemarks when provided', async () => {
      await service.transitionParent(
        formOid,
        FORM_STATUS.RETURNED_BY_MOHUA,
        'Please fix row 3.',
        2,
        userOid,
        mockSession,
      );
      const setArg = getFindOneAndUpdateSetArg(formModel['findOneAndUpdate']);
      expect(setArg.mohuaRemarks).toBe('Please fix row 3.');
    });
  });

  describe('insertParentHistory', () => {
    it('builds the unspentUlbData snapshot from current active rows, including rowStatus/rejectionRemark', async () => {
      rowModel['find'] = jest
        .fn()
        .mockReturnValue(q([{ ...makeRow(), rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, rejectionRemark: null }]));

      await service.insertParentHistory(
        makeForm(),
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        2,
        '14TH_FC',
        userOid,
        '127.0.0.1',
        'jest-agent',
        mockSession,
      );

      const historyArg = getHistoryCreateArg(historyModel['create']);
      expect(historyArg.fromStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      expect(historyArg.toStatus).toBe(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
      expect(historyArg.unspentUlbData[0]).toMatchObject({
        rowNumber: 1,
        rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        rejectionRemark: null,
      });
    });
  });

  describe('maybeAcknowledgeAfterBulkAction', () => {
    it('does not acknowledge when rows remain not-yet-ACTIVE', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.maybeAcknowledgeAfterBulkAction(
        makeForm(),
        '14TH_FC',
        userOid,
        null,
        null,
        mockSession,
      );

      expect(result.acknowledged).toBe(false);
      expect(formModel['findOneAndUpdate']).not.toHaveBeenCalled();
    });

    it('acknowledges and writes parent history when every active row is ACTIVE', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));
      rowModel['find'] = jest.fn().mockReturnValue(q([]));

      const result = await service.maybeAcknowledgeAfterBulkAction(
        makeForm(),
        '14TH_FC',
        userOid,
        null,
        null,
        mockSession,
      );

      expect(result.acknowledged).toBe(true);
      expect(result.currentFormStatus).toBe(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
      const setArg = getFindOneAndUpdateSetArg(formModel['findOneAndUpdate']);
      expect(setArg.currentFormStatus).toBe(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
      expect(historyModel['create']).toHaveBeenCalled();
    });
  });
});
