import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FcUnspentDeclarationRowService } from './fc-unspent-declaration-row.service';
import { XviFcUnspentStateFormRow } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { XviFcUnspentStateFormRowHistory } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { FcUnspentDevolutionFormLean, FcUnspentResolvedRow } from '../../types/fc-unspent-declaration.types';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import type { FcUnspentPolicy } from '../../helpers/fc-unspent-policy.helpers';

/** Devolution-linked, percent-of-allocation policy with the given threshold: the original behaviour. */
const linkedPolicy = (thresholdPercent: number): FcUnspentPolicy => ({
  devolutionLinked: true,
  eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent },
});

/** 14th FC years: independent of Devolution; any unspent balance makes a ULB ineligible. */
const INDEPENDENT_POLICY: FcUnspentPolicy = {
  devolutionLinked: false,
  eligibilityRule: { type: 'NO_UNSPENT_ALLOWED' },
};

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
  updateOne: {
    filter: Record<string, unknown>;
    update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> };
    upsert: boolean;
  };
}

/** Reads the bulkWrite ops array from the first `bulkWrite()` call, typed for assertions. */
function getBulkOps(mockFn: jest.Mock): TestBulkOp[] {
  const calls = mockFn.mock.calls as unknown as Array<[TestBulkOp[]]>;
  return calls[0][0];
}

/** Reads the [filter, update] args from the first `updateMany()` call, typed for assertions. */
function getUpdateManyArgs(mockFn: jest.Mock): [Record<string, unknown>, { $set: Record<string, unknown> }] {
  const calls = mockFn.mock.calls as unknown as Array<[Record<string, unknown>, { $set: Record<string, unknown> }]>;
  return calls[0];
}

interface TestRowHistoryDoc {
  row: Types.ObjectId;
  form: Types.ObjectId;
  previousStatus: unknown;
  currentStatus: unknown;
  snapshot: Record<string, unknown>;
  ipAddress: unknown;
  userAgent: unknown;
}

/** Reads the docs array from the first `insertMany()` call, typed for assertions. */
function getInsertManyDocs(mockFn: jest.Mock): TestRowHistoryDoc[] {
  const calls = mockFn.mock.calls as unknown as Array<[TestRowHistoryDoc[]]>;
  return calls[0][0];
}

const formOid = new Types.ObjectId();
const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const userOid = new Types.ObjectId();
const ulbOid1 = new Types.ObjectId();
const ulbOid2 = new Types.ObjectId();
const devolutionFormOid = new Types.ObjectId();
const devolutionRowOid = new Types.ObjectId();

const devolutionForm: FcUnspentDevolutionFormLean = {
  _id: devolutionFormOid,
  currentFormStatus: 5,
  activeDatasetVersion: 1,
};

const sampleAllocationSource = {
  devolutionFormId: devolutionFormOid,
  devolutionRowId: devolutionRowOid,
  datasetVersion: 1,
  installment: 1 as const,
  allocationAmount: 100,
};

const mockSession = { id: 'fake-session' } as never;

describe('FcUnspentDeclarationRowService', () => {
  let service: FcUnspentDeclarationRowService;
  let rowModel: Record<string, jest.Mock>;
  let rowHistoryModel: Record<string, jest.Mock>;
  let devolutionRowModel: Record<string, jest.Mock>;
  let ulbModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    rowModel = {
      find: jest.fn().mockReturnValue(q([])),
      bulkWrite: jest.fn().mockResolvedValue({ upsertedIds: {} }),
      updateMany: jest.fn().mockReturnValue(q(undefined)),
    };
    rowHistoryModel = {
      insertMany: jest.fn().mockResolvedValue([]),
    };
    devolutionRowModel = {
      find: jest
        .fn()
        .mockReturnValue(q([{ _id: devolutionRowOid, ulbId: ulbOid1, totalGrantAllocation: 100, installment: 1 }])),
    };
    ulbModel = {
      find: jest.fn().mockReturnValue(q([{ _id: ulbOid1, name: 'Alpha ULB', censusCode: '111', sbCode: 'A1' }])),
    };
    const ulbEligibilityService = {
      getEligibleUlbFilter: jest
        .fn()
        .mockImplementation((stateOid: unknown) => Promise.resolve({ state: stateOid, isActive: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentDeclarationRowService,
        { provide: getModelToken(XviFcUnspentStateFormRow.name), useValue: rowModel },
        { provide: getModelToken(XviFcUnspentStateFormRowHistory.name), useValue: rowHistoryModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: devolutionRowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: UlbEligibilityService, useValue: ulbEligibilityService },
      ],
    }).compile();

    service = module.get(FcUnspentDeclarationRowService);
  });

  describe('resolveAndValidateRows', () => {
    it('requires at least one row when requireAtLeastOne is true', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [], devolutionForm, {
        requireAtLeastOne: true,
        policy: linkedPolicy(10),
      });
      expect(result.errors['unspentUlbData']).toBeDefined();
    });

    it('allows zero rows when requireAtLeastOne is false', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [], devolutionForm, {
        requireAtLeastOne: false,
        policy: linkedPolicy(10),
      });
      expect(result.rows).toEqual([]);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('rejects duplicate ULB rows', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [
          { ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 3 },
          { ulbId: ulbOid1.toString(), unspentAmount: 7, previousFcUnspentBalance: 3 },
        ],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.errors['unspentUlbData']?.[0].code).toBe('duplicateUlb');
    });

    it('rejects a ULB not found or inactive in the state', async () => {
      ulbModel['find'] = jest.fn().mockReturnValue(q([]));
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 3 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.errors['unspentUlbData.0.ulbId']?.[0].code).toBe('ulbNotFound');
    });

    it('rejects a ULB with no positive Devolution allocation', async () => {
      devolutionRowModel['find'] = jest.fn().mockReturnValue(q([]));
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 3 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.errors['unspentUlbData.0.ulbId']?.[0].code).toBe('noAllocation');
    });

    it('rejects a non-positive unspent amount', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 0, previousFcUnspentBalance: 3 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.errors['unspentUlbData.0.unspentAmount']?.[0].code).toBe('invalidAmount');
    });

    it('computes allocationPerc/eligibility at full precision for a valid row', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 3 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.rows[0]).toMatchObject({ allocationAmount: 100, allocationPerc: 5, eligibility: true });
    });

    it('passes previousFcUnspentBalance through untouched, with no effect on allocationPerc/eligibility', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 999 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.rows[0]).toMatchObject({
        previousFcUnspentBalance: 999,
        allocationPerc: 5,
        eligibility: true,
      });
    });

    it('populates allocationSource from the resolved Devolution row (devolutionFormId, devolutionRowId, datasetVersion, installment, allocationAmount)', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 3 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.rows[0].allocationSource).toEqual({
        devolutionFormId: devolutionFormOid,
        devolutionRowId: devolutionRowOid,
        datasetVersion: devolutionForm.activeDatasetVersion,
        installment: 1,
        allocationAmount: 100,
      });
    });

    it('computes eligibility at exactly the threshold boundary as eligible', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 10, previousFcUnspentBalance: 3 }], // 10/100 = 10% == threshold
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.rows[0].allocationPerc).toBe(10);
      expect(result.rows[0].eligibility).toBe(true);
    });

    it('computes eligibility just above the threshold as not eligible (full precision, no rounding)', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 10.000001, previousFcUnspentBalance: 3 }], // 10.000001% > 10%
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(result.rows[0].allocationPerc).toBeCloseTo(10.000001, 6);
      expect(result.rows[0].eligibility).toBe(false);
    });

    it('with thresholdPercent 0, marks a row with any positive unspentAmount as not eligible', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 0.01, previousFcUnspentBalance: 3 }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(0) },
      );
      expect(result.rows[0].allocationPerc).toBeGreaterThan(0);
      expect(result.rows[0].eligibility).toBe(false);
    });

    it('ignores client-supplied server-owned fields on a row (allocationAmount, ulbName, etc.)', async () => {
      const pollutedRow = {
        ulbId: ulbOid1.toString(),
        unspentAmount: 5,
        previousFcUnspentBalance: 3,
        allocationAmount: 999999,
        allocationPerc: 0.001,
        eligibility: false,
        ulbName: 'Fake Name',
        censusCode: 'FAKE',
      };
      const result = await service.resolveAndValidateRows(
        stateOid,
        [pollutedRow as unknown as { ulbId: string; unspentAmount: number; previousFcUnspentBalance: number }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      const row = result.rows[0];
      expect(row.allocationAmount).toBe(100); // from DevolutionFormulaRow, not the client
      expect(row.ulbName).toBe('Alpha ULB'); // from Ulb registry, not the client
      expect(row.censusCode).toBe('111');
      expect(row.allocationPerc).toBe(5);
      expect(row.eligibility).toBe(true);
    });
  });

  describe('resolveAndValidateRows - independent of Devolution (14th FC policy)', () => {
    const row = (unspentAmount: number, previousFcUnspentBalance: number) => ({
      ulbId: ulbOid1.toString(),
      unspentAmount,
      previousFcUnspentBalance,
    });

    it('needs no Devolution form and never looks up an allocation', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [row(5, 3)], null, {
        requireAtLeastOne: true,
        policy: INDEPENDENT_POLICY,
      });

      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(devolutionRowModel['find']).not.toHaveBeenCalled();
      expect(result.rows).toHaveLength(1);
    });

    it('does not reject a ULB for having no Devolution allocation, and leaves the allocation fields null', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [row(5, 3)], devolutionForm, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });

      expect(result.errors['unspentUlbData.0.ulbId']).toBeUndefined();
      expect(result.rows[0]).toMatchObject({
        ulbName: 'Alpha ULB',
        unspentAmount: 5,
        previousFcUnspentBalance: 3,
        allocationAmount: null,
        allocationPerc: null,
        allocationSource: null,
      });
    });

    it('marks any ULB reporting unspent balance as ineligible', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [row(5, 3)], null, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });
      expect(result.rows[0].eligibility).toBe(false);
    });

    it('stays ineligible for a tiny unspent amount (no percentage threshold is involved)', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [row(1, 1)], null, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });
      expect(result.rows[0].eligibility).toBe(false);
    });

    it('still validates the ULB itself (unknown or inactive ULB) and the unspent amount', async () => {
      ulbModel['find'] = jest.fn().mockReturnValue(q([]));
      const unknownUlb = await service.resolveAndValidateRows(stateOid, [row(5, 3)], null, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });
      expect(unknownUlb.errors['unspentUlbData.0.ulbId']?.[0].code).toBe('ulbNotFound');

      ulbModel['find'] = jest
        .fn()
        .mockReturnValue(q([{ _id: ulbOid1, name: 'Alpha ULB', censusCode: '111', sbCode: 'A1' }]));
      const zeroUnspent = await service.resolveAndValidateRows(stateOid, [row(0, 3)], null, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });
      expect(zeroUnspent.errors['unspentUlbData.0.unspentAmount']?.[0].code).toBe('invalidAmount');
    });

    it('still rejects duplicate ULB rows and still enforces requireAtLeastOne', async () => {
      const duplicate = await service.resolveAndValidateRows(stateOid, [row(5, 3), row(7, 3)], null, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });
      expect(duplicate.errors['unspentUlbData']?.[0].code).toBe('duplicateUlb');

      const none = await service.resolveAndValidateRows(stateOid, [], null, {
        requireAtLeastOne: true,
        policy: INDEPENDENT_POLICY,
      });
      expect(none.errors['unspentUlbData']).toBeDefined();
    });
  });

  describe('resolveAndValidateRows - draft keeps ULBs without amounts; final submit requires them', () => {
    const ulbOnly = { ulbId: ulbOid1.toString(), unspentAmount: null, previousFcUnspentBalance: null };

    it('keeps a ULB-only row on a draft: amounts stay null, never eligible, no allocation percent, no error', async () => {
      for (const policy of [INDEPENDENT_POLICY, linkedPolicy(10)]) {
        const result = await service.resolveAndValidateRows(stateOid, [ulbOnly], devolutionForm, {
          requireAtLeastOne: false,
          requireCompleteRows: false,
          policy,
        });

        expect(Object.keys(result.errors)).toHaveLength(0);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
          ulbName: 'Alpha ULB',
          unspentAmount: null,
          previousFcUnspentBalance: null,
          allocationPerc: null,
          eligibility: false,
        });
      }
    });

    it('treats omitted amounts like null, and keeps a partially filled row (one amount only)', async () => {
      const omitted = await service.resolveAndValidateRows(stateOid, [{ ulbId: ulbOid1.toString() }], null, {
        requireAtLeastOne: false,
        policy: INDEPENDENT_POLICY,
      });
      expect(omitted.rows[0]).toMatchObject({ unspentAmount: null, previousFcUnspentBalance: null });

      const partial = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: null }],
        devolutionForm,
        { requireAtLeastOne: false, policy: linkedPolicy(10) },
      );
      expect(partial.rows[0]).toMatchObject({ unspentAmount: 5, previousFcUnspentBalance: null, eligibility: false });
      // The percent is still shown for an entered unspent amount; eligibility waits for the full row.
      expect(partial.rows[0].allocationPerc).toBe(5);
    });

    it('rejects a ULB-only row on final submit with a required error on each missing field of that row', async () => {
      const result = await service.resolveAndValidateRows(stateOid, [ulbOnly], devolutionForm, {
        requireAtLeastOne: true,
        requireCompleteRows: true,
        policy: INDEPENDENT_POLICY,
      });

      expect(result.rows).toHaveLength(0);
      expect(result.errors['unspentUlbData.0.unspentAmount']?.[0]).toMatchObject({
        code: 'required',
        message: 'Unspent amount is required.',
      });
      expect(result.errors['unspentUlbData.0.previousFcUnspentBalance']?.[0]).toMatchObject({
        code: 'required',
        message: 'Previous FC unspent balance is required.',
      });
    });

    it('on final submit only flags the field that is missing, and accepts a complete row', async () => {
      const missingPrevious = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: null }],
        null,
        { requireAtLeastOne: true, requireCompleteRows: true, policy: INDEPENDENT_POLICY },
      );
      expect(Object.keys(missingPrevious.errors)).toEqual(['unspentUlbData.0.previousFcUnspentBalance']);

      const complete = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 5, previousFcUnspentBalance: 3 }],
        null,
        { requireAtLeastOne: true, requireCompleteRows: true, policy: INDEPENDENT_POLICY },
      );
      expect(Object.keys(complete.errors)).toHaveLength(0);
      expect(complete.rows[0]).toMatchObject({ unspentAmount: 5, previousFcUnspentBalance: 3 });
    });

    it('still rejects a non-positive amount that IS provided, even on a draft', async () => {
      const result = await service.resolveAndValidateRows(
        stateOid,
        [{ ulbId: ulbOid1.toString(), unspentAmount: 0, previousFcUnspentBalance: null }],
        null,
        { requireAtLeastOne: false, policy: INDEPENDENT_POLICY },
      );
      expect(result.errors['unspentUlbData.0.unspentAmount']?.[0].code).toBe('invalidAmount');
    });
  });

  describe('resolveAndValidateRows - only valid ULBs are saved (census/SB code on record)', () => {
    const draft = { requireAtLeastOne: false, policy: INDEPENDENT_POLICY };
    const row = { ulbId: ulbOid1.toString(), unspentAmount: null, previousFcUnspentBalance: null };

    it.each([
      ['no census code and no SB code', { censusCode: '', sbCode: '' }],
      ['codes missing entirely', {}],
      ['codes that are only whitespace', { censusCode: '  ', sbCode: ' ' }],
    ])('rejects a ULB with %s, on that row ulbId, and saves nothing from the request', async (_label, codes) => {
      ulbModel['find'] = jest.fn().mockReturnValue(q([{ _id: ulbOid1, name: 'Alpha ULB', ...codes }]));

      const result = await service.resolveAndValidateRows(stateOid, [row], null, draft);

      expect(result.errors['unspentUlbData.0.ulbId']?.[0]).toMatchObject({ code: 'ulbCodeMissing' });
      expect(result.rows).toHaveLength(0);
    });

    it('accepts a ULB that has only a census code, or only an SB code', async () => {
      for (const codes of [
        { censusCode: '111', sbCode: '' },
        { censusCode: '', sbCode: 'A1' },
      ]) {
        ulbModel['find'] = jest.fn().mockReturnValue(q([{ _id: ulbOid1, name: 'Alpha ULB', ...codes }]));
        const result = await service.resolveAndValidateRows(stateOid, [row], null, draft);
        expect(Object.keys(result.errors)).toHaveLength(0);
        expect(result.rows).toHaveLength(1);
      }
    });

    it('still reports a ULB that is not in the registry at all as ulbNotFound (not as missing code)', async () => {
      ulbModel['find'] = jest.fn().mockReturnValue(q([]));
      const result = await service.resolveAndValidateRows(stateOid, [row], null, draft);
      expect(result.errors['unspentUlbData.0.ulbId']?.[0].code).toBe('ulbNotFound');
    });

    it('reports every invalid row by its own index when valid and invalid ULBs are mixed', async () => {
      ulbModel['find'] = jest.fn().mockReturnValue(
        q([
          { _id: ulbOid1, name: 'Alpha ULB', censusCode: '111', sbCode: 'A1' },
          { _id: ulbOid2, name: 'No Code ULB', censusCode: '', sbCode: '' },
        ]),
      );
      const result = await service.resolveAndValidateRows(
        stateOid,
        [row, { ulbId: ulbOid2.toString(), unspentAmount: null, previousFcUnspentBalance: null }],
        null,
        draft,
      );
      expect(result.errors['unspentUlbData.0.ulbId']).toBeUndefined();
      expect(result.errors['unspentUlbData.1.ulbId']?.[0].code).toBe('ulbCodeMissing');
    });
  });

  describe('applyRows — draft mode (targetRowStatus undefined)', () => {
    const resolvedRow: FcUnspentResolvedRow = {
      ulbId: ulbOid1,
      censusCode: '111',
      sbCode: 'A1',
      ulbName: 'Alpha ULB',
      allocationAmount: 100,
      unspentAmount: 5,
      previousFcUnspentBalance: 3,
      allocationPerc: 5,
      eligibility: true,
      allocationSource: sampleAllocationSource,
    };

    it('reactivates a previously-removed row by unconditionally setting isActive:true on every submitted row', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set.isActive).toBe(true);
    });

    it('upserts rows via bulkWrite with rowStatus:null only in $setOnInsert (never $set)', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set.rowStatus).toBeUndefined();
      expect(ops[0].updateOne.update.$setOnInsert.rowStatus).toBeNull();
      expect(ops[0].updateOne.filter).toEqual({ form: formOid, ulbId: ulbOid1 });
      expect(ops[0].updateOne.upsert).toBe(true);
    });

    it('still pre-fetches existing rowStatus on draft save — the row-lock check applies to saveDraft too, not just finalSubmit', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);
      expect(rowModel['find']).toHaveBeenCalledWith({ form: formOid, ulbId: { $in: [ulbOid1] } });
    });

    it('persists allocationSource in $set on every upsert', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set.allocationSource).toEqual(sampleAllocationSource);
    });

    it('deactivates rows omitted from the submission', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);
      const [filter, update] = getUpdateManyArgs(rowModel['updateMany']);
      expect(filter).toEqual({
        form: formOid,
        isActive: true,
        ulbId: { $nin: [ulbOid1] },
        rowStatus: { $nin: [FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA] },
      });
      expect(update.$set).toMatchObject({ isActive: false });
    });

    it('returns no transitions', async () => {
      const result = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow],
        userOid,
        undefined,
        mockSession,
      );
      expect(result.transitions).toEqual([]);
    });

    it('explicitly stamps rejectionRemark:null in $setOnInsert (bulkWrite upserts do not reliably apply schema defaults)', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$setOnInsert.rejectionRemark).toBeNull();
      expect(ops[0].updateOne.update.$set.rejectionRemark).toBeUndefined();
    });

    it('explicitly stamps createdBy in $setOnInsert', async () => {
      await service.applyRows(formOid, stateOid, yearOid, [resolvedRow], userOid, undefined, mockSession);
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$setOnInsert.createdBy).toBe(userOid);
    });
  });

  describe('applyRows — final-submit mode (targetRowStatus provided)', () => {
    const resolvedRow: FcUnspentResolvedRow = {
      ulbId: ulbOid1,
      censusCode: '111',
      sbCode: 'A1',
      ulbName: 'Alpha ULB',
      allocationAmount: 100,
      unspentAmount: 5,
      previousFcUnspentBalance: 3,
      allocationPerc: 5,
      eligibility: true,
      allocationSource: sampleAllocationSource,
    };

    it('forces rowStatus in $set for every submitted row', async () => {
      await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mockSession,
      );
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set.rowStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('still explicitly stamps rejectionRemark:null in $setOnInsert for a brand-new row inserted at final submit', async () => {
      await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mockSession,
      );
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$setOnInsert.rejectionRemark).toBeNull();
      expect(ops[0].updateOne.update.$setOnInsert.rowStatus).toBeUndefined();
    });

    it('assigns deterministic rowNumber from submitted order', async () => {
      const rowB: FcUnspentResolvedRow = { ...resolvedRow, ulbId: ulbOid2 };
      await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow, rowB],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mockSession,
      );
      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops[0].updateOne.update.$set.rowNumber).toBe(1);
      expect(ops[1].updateOne.update.$set.rowNumber).toBe(2);
    });

    it('records a transition for a brand-new row (previousStatus null -> UPDATE_PENDING)', async () => {
      const newRowId = new Types.ObjectId();
      rowModel['find'] = jest.fn().mockReturnValue(q([])); // no existing row
      rowModel['bulkWrite'] = jest.fn().mockResolvedValue({ upsertedIds: { 0: newRowId } });

      const { transitions } = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mockSession,
      );

      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toMatchObject({
        rowId: newRowId,
        previousStatus: null,
        currentStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      });
    });

    it('records a transition for an existing row moving from null to UPDATE_PENDING', async () => {
      const existingRowId = new Types.ObjectId();
      rowModel['find'] = jest.fn().mockReturnValue(q([{ _id: existingRowId, ulbId: ulbOid1, rowStatus: null }]));

      const { transitions } = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mockSession,
      );

      expect(transitions).toHaveLength(1);
      expect(transitions[0].rowId).toEqual(existingRowId);
      expect(transitions[0].previousStatus).toBeNull();
    });

    it('does not record a transition when the row is already at the target status (no duplicate history)', async () => {
      const existingRowId = new Types.ObjectId();
      rowModel['find'] = jest
        .fn()
        .mockReturnValue(q([{ _id: existingRowId, ulbId: ulbOid1, rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }]));

      const { transitions } = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [resolvedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mockSession,
      );

      expect(transitions).toEqual([]);
    });
  });

  describe('applyRows — row-level edit lock (mixed-approval deadlock fix)', () => {
    const lockedRowId = new Types.ObjectId();
    const unlockedRowId = new Types.ObjectId();

    const lockedRow: FcUnspentResolvedRow = {
      ulbId: ulbOid1,
      censusCode: '111',
      sbCode: 'A1',
      ulbName: 'Alpha ULB (locked, approved by PMU)',
      allocationAmount: 999,
      unspentAmount: 999,
      previousFcUnspentBalance: 999,
      allocationPerc: 99,
      eligibility: true,
      allocationSource: sampleAllocationSource,
    };
    const unlockedRow: FcUnspentResolvedRow = {
      ulbId: ulbOid2,
      censusCode: '222',
      sbCode: 'B2',
      ulbName: 'Beta ULB (rejected, editable)',
      allocationAmount: 50,
      unspentAmount: 10,
      previousFcUnspentBalance: 2,
      allocationPerc: 20,
      eligibility: true,
      allocationSource: sampleAllocationSource,
    };

    function setExistingRows(): void {
      rowModel['find'] = jest.fn().mockReturnValue(
        q([
          { _id: lockedRowId, ulbId: ulbOid1, rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
          { _id: unlockedRowId, ulbId: ulbOid2, rowStatus: FORM_STATUS.RETURNED_BY_PMU },
        ]),
      );
    }

    it('drops an already-approved row from the bulk write entirely, regardless of what the client resubmitted, and reports it as preserved', async () => {
      setExistingRows();

      const { preservedLockedRows } = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [lockedRow, unlockedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops).toHaveLength(1);
      expect(ops[0].updateOne.filter).toEqual({ form: formOid, ulbId: ulbOid2 });
      expect(preservedLockedRows).toEqual([String(ulbOid1)]);
    });

    it('never records a transition or history entry for a locked row that was skipped', async () => {
      setExistingRows();

      const { transitions } = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [lockedRow, unlockedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        mockSession,
      );

      expect(transitions).toHaveLength(1);
      expect(transitions[0].rowId).toEqual(unlockedRowId);
    });

    it('still deactivates omitted rows and respects the lock there too (deactivateOmittedRows filter)', async () => {
      setExistingRows();

      await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [lockedRow, unlockedRow],
        userOid,
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        mockSession,
      );

      const [filter] = getUpdateManyArgs(rowModel['updateMany']);
      expect(filter).toMatchObject({
        rowStatus: { $nin: [FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA] },
      });
    });

    it('applies the same lock protection on draft save (targetRowStatus undefined), not just final submit', async () => {
      setExistingRows();

      const { preservedLockedRows } = await service.applyRows(
        formOid,
        stateOid,
        yearOid,
        [lockedRow, unlockedRow],
        userOid,
        undefined,
        mockSession,
      );

      const ops = getBulkOps(rowModel['bulkWrite']);
      expect(ops).toHaveLength(1);
      expect(ops[0].updateOne.filter).toEqual({ form: formOid, ulbId: ulbOid2 });
      expect(preservedLockedRows).toEqual([String(ulbOid1)]);
    });
  });

  describe('deactivateAllRows', () => {
    it('deactivates every active row for the form', async () => {
      await service.deactivateAllRows(formOid, userOid, mockSession);
      const [filter, update] = getUpdateManyArgs(rowModel['updateMany']);
      expect(filter).toEqual({ form: formOid, isActive: true });
      expect(update.$set).toMatchObject({ isActive: false, updatedBy: userOid });
    });
  });

  describe('insertRowHistory', () => {
    it('is a no-op when there are no transitions', async () => {
      await service.insertRowHistory(formOid, stateOid, yearOid, [], userOid, null, null, mockSession);
      expect(rowHistoryModel['insertMany']).not.toHaveBeenCalled();
    });

    it('inserts one history document per transition with the correct snapshot shape', async () => {
      const rowId = new Types.ObjectId();
      await service.insertRowHistory(
        formOid,
        stateOid,
        yearOid,
        [
          {
            rowId,
            previousStatus: null,
            currentStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
            row: {
              ulbId: ulbOid1,
              censusCode: '111',
              sbCode: 'A1',
              ulbName: 'Alpha ULB',
              allocationAmount: 100,
              unspentAmount: 5,
              previousFcUnspentBalance: 3,
              allocationPerc: 5,
              eligibility: true,
              allocationSource: sampleAllocationSource,
              rowNumber: 1,
            },
          },
        ],
        userOid,
        '127.0.0.1',
        'jest-agent',
        mockSession,
      );

      const docs = getInsertManyDocs(rowHistoryModel['insertMany']);
      expect(docs[0]).toMatchObject({
        row: rowId,
        form: formOid,
        previousStatus: null,
        currentStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        snapshot: { rowNumber: 1, ulbId: ulbOid1, allocationAmount: 100, allocationSource: sampleAllocationSource },
        ipAddress: '127.0.0.1',
        userAgent: 'jest-agent',
      });
    });
  });

  describe('getActiveRows', () => {
    it('finds active rows for the form sorted deterministically by rowNumber, then _id', async () => {
      const chain = q([{ rowNumber: 1, ulbId: ulbOid1 }]);
      rowModel['find'] = jest.fn().mockReturnValue(chain);

      const result = await service.getActiveRows(formOid);

      expect(rowModel['find']).toHaveBeenCalledWith({ form: formOid, isActive: true });
      expect(chain['sort']).toHaveBeenCalledWith({ rowNumber: 1, _id: 1 });
      expect(chain['select']).toHaveBeenCalledWith(expect.stringContaining('allocationSource'));
      expect(result).toEqual([{ rowNumber: 1, ulbId: ulbOid1 }]);
    });

    it('applies the given session when called from within a transaction', async () => {
      const chain = q([]);
      rowModel['find'] = jest.fn().mockReturnValue(chain);

      await service.getActiveRows(formOid, mockSession);

      expect(chain['session']).toHaveBeenCalledWith(mockSession);
    });
  });
});
