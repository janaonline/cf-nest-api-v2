import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  EulbPostSubmissionUpdateService,
  buildEligibleRowCondition,
} from './elected-urban-local-bodies-post-submission-update.service';
import { ElectedUrbanLocalBodiesValidator } from './elected-urban-local-bodies.validator';
import { ElectedUrbanLocalBodiesForm } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  POST_SUBMISSION_UPDATE_ALLOWED_STATUSES,
  canViewPostSubmissionUpdate,
} from '../../common/utils/xvi-fc-form-status-access.util';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit', 'populate']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  chain['then'] = (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(onFulfilled, onRejected);
  chain['catch'] = (onRejected: (e: unknown) => unknown) => Promise.resolve(value).catch(onRejected);
  chain['finally'] = (onFinally: () => void) => Promise.resolve(value).finally(onFinally);
  return chain;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const formOid = new Types.ObjectId();
const userOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: userOid.toString(),
  scope: Scope.ADMIN,
  state: null,
} as unknown as AuthUser;

const stateUser = (state: Types.ObjectId): AuthUser =>
  ({
    _id: userOid.toString(),
    scope: Scope.STATE,
    state,
  }) as unknown as AuthUser;

function makeForm(status: number) {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: status,
    activeDatasetVersion: 1,
    isDeleted: false,
  };
}

const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

function makeRow(overrides: Record<string, unknown> = {}) {
  const futureExpiry = new Date(TODAY);
  futureExpiry.setDate(futureExpiry.getDate() + 30);
  return {
    _id: new Types.ObjectId(),
    form: formOid,
    rowNumber: 1,
    censusCode: '1234567',
    ulbName: 'Test City',
    electedBodyStatus: 'Not Constituted',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: null,
    rowType: 'DB_ULB',
    datasetVersion: 1,
    validationStatus: 'VALID',
    errors: [],
    isActive: true,
    ...overrides,
  };
}

// ─── canViewPostSubmissionUpdate ──────────────────────────────────────────────

describe('canViewPostSubmissionUpdate', () => {
  it('returns true for UNDER_REVIEW_BY_MOHUA (5)', () => {
    expect(canViewPostSubmissionUpdate(FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).toBe(true);
  });

  it('returns true for SUBMISSION_ACKNOWLEDGED_BY_MOHUA (7)', () => {
    expect(canViewPostSubmissionUpdate(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA)).toBe(true);
  });

  it.each([
    FORM_STATUS.NO_STATUS,
    FORM_STATUS.NOT_STARTED,
    FORM_STATUS.IN_PROGRESS,
    FORM_STATUS.UNDER_REVIEW_BY_STATE,
    FORM_STATUS.RETURNED_BY_STATE,
    FORM_STATUS.RETURNED_BY_MOHUA,
  ])('returns false for status %i', (status) => {
    expect(canViewPostSubmissionUpdate(status)).toBe(false);
  });
});

// ─── buildEligibleRowCondition ────────────────────────────────────────────────

describe('buildEligibleRowCondition', () => {
  it('includes Not Constituted rows without a date check', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    expect(orClauses).toContainEqual({ electedBodyStatus: 'Not Constituted' });
  });

  it('includes Constituted rows with dateOfExpiry strictly after today', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    expect(orClauses).toContainEqual({
      electedBodyStatus: 'Constituted',
      dateOfExpiry: { $gt: TODAY },
    });
  });

  it('uses $gt (strict greater-than) so rows expiring exactly today are excluded', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    const constitutedClause = orClauses.find(
      (c) => c['electedBodyStatus'] === 'Constituted',
    ) as Record<string, unknown> | undefined;
    expect(constitutedClause?.['dateOfExpiry']).toEqual({ $gt: TODAY });
  });

  it('does not include Exempt rows', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    const hasExempt = orClauses.some((c) => c['electedBodyStatus'] === 'Exempt');
    expect(hasExempt).toBe(false);
  });

  it('POST_SUBMISSION_UPDATE_ALLOWED_STATUSES contains exactly status 5 and 7', () => {
    expect([...POST_SUBMISSION_UPDATE_ALLOWED_STATUSES]).toEqual(
      expect.arrayContaining([FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]),
    );
    expect(POST_SUBMISSION_UPDATE_ALLOWED_STATUSES).toHaveLength(2);
  });
});

// ─── EulbPostSubmissionUpdateService ─────────────────────────────────────────

function makeFormSummary(overrides: Record<string, unknown> = {}) {
  return {
    _id: formOid,
    dbUlbCount: 10,
    maxAllowedExcelRows: 20,
    excelRowCount: 10,
    matchedDbUlbCount: 10,
    missingDbUlbCount: 0,
    extraExcelRowCount: 0,
    errorRowCount: 0,
    validationStatus: 'VALID',
    activeDatasetVersion: 1,
    ...overrides,
  };
}

describe('EulbPostSubmissionUpdateService', () => {
  let service: EulbPostSubmissionUpdateService;
  let formModel: Record<string, jest.Mock | Record<string, jest.Mock>>;
  let rowModel: Record<string, jest.Mock>;
  let mockSession: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    formModel = {
      findOne: jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA))),
      findByIdAndUpdate: jest.fn().mockReturnValue(q(null)),
      findById: jest.fn().mockReturnValue(q(makeFormSummary())),
      db: { startSession: jest.fn().mockResolvedValue(mockSession) } as unknown as Record<string, jest.Mock>,
    };
    rowModel = {
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      findByIdAndUpdate: jest.fn().mockReturnValue(q(null)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EulbPostSubmissionUpdateService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
      ],
    }).compile();

    service = module.get(EulbPostSubmissionUpdateService);
  });

  // ─── getMetadata ───────────────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('returns canUpdate:true when form status is 5 (UNDER_REVIEW_BY_MOHUA)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA)));
      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result.success).toBe(true);
      expect(result.data!.canUpdate).toBe(true);
    });

    it('returns canUpdate:true when form status is 7 (SUBMISSION_ACKNOWLEDGED_BY_MOHUA)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA)));
      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result.success).toBe(true);
      expect(result.data!.canUpdate).toBe(true);
    });

    it('returns canUpdate:false for form status IN_PROGRESS (2)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result.success).toBe(true);
      expect(result.data!.canUpdate).toBe(false);
    });

    it('returns canUpdate:false when no form exists', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result.success).toBe(true);
      expect(result.data!.canUpdate).toBe(false);
    });

    it('returns success:true envelope with message and timestamp', async () => {
      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
        timestamp: expect.any(String),
        data: expect.objectContaining({ formStatus: expect.any(Number) }),
      });
    });

    it('includes rowEditFields in the response', async () => {
      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(Array.isArray(result.data!.rowEditFields)).toBe(true);
      expect(result.data!.rowEditFields.length).toBeGreaterThan(0);
    });

    it('skips eligible-row count when canUpdate is false', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);
      expect(rowModel['countDocuments']).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongStateUser = stateUser(new Types.ObjectId());
      await expect(
        service.getMetadata(stateOid.toString(), yearOid.toString(), wrongStateUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── getEligibleRows ───────────────────────────────────────────────────────

  describe('getEligibleRows', () => {
    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongStateUser = stateUser(new Types.ObjectId());
      await expect(
        service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, wrongStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when no form exists', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(
        service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when form status is not in the allowed set', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      await expect(
        service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns success:true with rows, total, pagination, and eligibleRule when status is 5', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([makeRow()]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
        timestamp: expect.any(String),
        data: {
          rows: expect.any(Array),
          total: 1,
          page: 1,
          limit: 50,
          eligibleRule: {
            allowedFormStatuses: expect.arrayContaining([
              FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
              FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
            ]),
            today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          },
        },
      });
    });

    it('also succeeds when form status is 7 (SUBMISSION_ACKNOWLEDGED_BY_MOHUA)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA)));
      rowModel['find'] = jest.fn().mockReturnValue(q([]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
      expect(result.success).toBe(true);
    });

    it('maps Not Constituted rows with null dates', async () => {
      const row = makeRow({ electedBodyStatus: 'Not Constituted', dateOfConstitution: null, dateOfExpiry: null });
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
      const mapped = result.data!.rows[0];
      expect(mapped.electedBodyStatus).toBe('Not Constituted');
      expect(mapped.dateOfConstitution).toBeNull();
      expect(mapped.dateOfExpiry).toBeNull();
    });

    it('maps Constituted rows with Date objects to ISO date strings', async () => {
      const constitutionDate = new Date('2022-01-01');
      const futureExpiry = new Date('2027-03-31');
      const row = makeRow({
        electedBodyStatus: 'Constituted',
        dateOfConstitution: constitutionDate,
        dateOfExpiry: futureExpiry,
      });
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
      const mapped = result.data!.rows[0];
      expect(mapped.electedBodyStatus).toBe('Constituted');
      expect(mapped.dateOfConstitution).toBe('2022-01-01');
      expect(mapped.dateOfExpiry).toBe('2027-03-31');
    });

    it('passes isActive:true in the row model filter to exclude inactive rows', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));

      await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);

      const findFilter = rowModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(findFilter).toMatchObject({ isActive: true });
    });

    it('includes the eligible-row $and condition in the filter', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));

      await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);

      const findFilter = rowModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(Array.isArray(findFilter['$and'])).toBe(true);
      const firstAnd = (findFilter['$and'] as Array<Record<string, unknown>>)[0];
      expect(firstAnd['$or']).toBeDefined();
    });

    it('respects page and limit query params', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { page: 3, limit: 20 },
        adminUser,
      );
      expect(result.data!.page).toBe(3);
      expect(result.data!.limit).toBe(20);
    });

    it('caps limit at 200', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0));

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { limit: 9999 },
        adminUser,
      );
      expect(result.data!.limit).toBe(200);
    });

    it('maps row _id to string', async () => {
      const rowOid = new Types.ObjectId();
      rowModel['find'] = jest.fn().mockReturnValue(q([makeRow({ _id: rowOid })]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
      expect(result.data!.rows[0]._id).toBe(rowOid.toString());
    });

    it('includes errors array on each row', async () => {
      const row = makeRow({
        errors: [{ field: 'dateOfExpiry', code: 'required', message: 'Date of Expiry is required.' }],
        validationStatus: 'INVALID',
      });
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
      expect(result.data!.rows[0].errors).toEqual([
        { field: 'dateOfExpiry', code: 'required', message: 'Date of Expiry is required.' },
      ]);
    });
  });

  // ─── validateBatch ────────────────────────────────────────────────────────────

  describe('validateBatch', () => {
    const rowOid = new Types.ObjectId();

    function makeEligibleRow(overrides: Record<string, unknown> = {}) {
      return makeRow({ _id: rowOid, electedBodyStatus: 'Not Constituted', ...overrides });
    }

    it('returns success:true with VALID when all proposed rows pass business validation', async () => {
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      const result = await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
        adminUser,
      );

      expect(result.success).toBe(true);
      expect(result.data!.validationStatus).toBe('VALID');
      expect(result.data!.errorRowCount).toBe(0);
      expect(result.data!.validRowCount).toBe(1);
      expect(result.data!.totalRowCount).toBe(1);
      expect(result.data!.rows[0].validationStatus).toBe('VALID');
      expect(result.data!.rows[0].errors).toHaveLength(0);
    });

    it('returns success:true with INVALID and row-level errors when Constituted row is missing required dates', async () => {
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      const result = await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Constituted' }] },
        adminUser,
      );

      expect(result.success).toBe(true);
      expect(result.data!.validationStatus).toBe('INVALID');
      expect(result.data!.rows[0].validationStatus).toBe('INVALID');
      const errorFields = result.data!.rows[0].errors.map((e) => e.field);
      expect(errorFields).toContain('dateOfConstitution');
      expect(errorFields).toContain('dateOfExpiry');
    });

    it('returns success:true with INVALID when dateOfExpiry is in the past', async () => {
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      const result = await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        {
          rows: [
            {
              rowId: rowOid.toString(),
              electedBodyStatus: 'Constituted',
              dateOfConstitution: '2022-01-01',
              dateOfExpiry: '2020-01-01',
            },
          ],
        },
        adminUser,
      );

      expect(result.success).toBe(true);
      expect(result.data!.validationStatus).toBe('INVALID');
      const expiryError = result.data!.rows[0].errors.find((e) => e.field === 'dateOfExpiry');
      expect(expiryError?.code).toBe('minDate');
    });

    it('returns success:true with VALID for Constituted with valid future dates', async () => {
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));
      const futureDate = new Date(TODAY);
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const result = await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        {
          rows: [
            {
              rowId: rowOid.toString(),
              electedBodyStatus: 'Constituted',
              dateOfConstitution: '2022-06-01',
              dateOfExpiry: futureDateStr,
            },
          ],
        },
        adminUser,
      );

      expect(result.success).toBe(true);
      expect(result.data!.validationStatus).toBe('VALID');
    });

    it('does not call any write operations on rowModel', async () => {
      const row = makeEligibleRow();
      const writeMethods = ['updateOne', 'updateMany', 'findOneAndUpdate', 'insertMany'];
      for (const m of writeMethods) {
        rowModel[m] = jest.fn();
      }
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
        adminUser,
      );

      for (const m of writeMethods) {
        expect(rowModel[m]).not.toHaveBeenCalled();
      }
    });

    it('throws ForbiddenException when form status is not in the allowed set', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
          adminUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when form is missing', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
          adminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongStateUser = stateUser(new Types.ObjectId());

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
          wrongStateUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for duplicate row IDs in the request', async () => {
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));
      const id = rowOid.toString();

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: id, electedBodyStatus: 'Not Constituted' }, { rowId: id, electedBodyStatus: 'Not Constituted' }] },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when row IDs are not found in the DB (wrong form / inactive)', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([]));

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a submitted row is Exempt (not eligible)', async () => {
      const exemptRow = makeEligibleRow({ electedBodyStatus: 'Exempt' });
      rowModel['find'] = jest.fn().mockReturnValue(q([exemptRow]));

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when Constituted row has expired dateOfExpiry (not eligible)', async () => {
      const expiredRow = makeEligibleRow({
        electedBodyStatus: 'Constituted',
        dateOfExpiry: new Date('2020-01-01'),
      });
      rowModel['find'] = jest.fn().mockReturnValue(q([expiredRow]));

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Constituted', dateOfConstitution: '2022-01-01', dateOfExpiry: '2027-01-01' }] },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes isActive:true in the row model filter', async () => {
      const row = makeEligibleRow();
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
        adminUser,
      );

      const findFilter = rowModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(findFilter).toMatchObject({ isActive: true });
    });

    it('maps rowId, rowNumber, censusCode, ulbName from the DB row into the result', async () => {
      const row = makeEligibleRow({ rowNumber: 42, censusCode: '9876543', ulbName: 'Test City' });
      rowModel['find'] = jest.fn().mockReturnValue(q([row]));

      const result = await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
        adminUser,
      );

      expect(result.data!.rows[0].rowId).toBe(rowOid.toString());
      expect(result.data!.rows[0].rowNumber).toBe(42);
      expect(result.data!.rows[0].censusCode).toBe('9876543');
      expect(result.data!.rows[0].ulbName).toBe('Test City');
    });

    it('sets errorRowCount, validRowCount, totalRowCount correctly for mixed results', async () => {
      const rowOid2 = new Types.ObjectId();
      const validRow = makeEligibleRow({ _id: rowOid, rowNumber: 1 });
      const invalidRow = makeRow({ _id: rowOid2, electedBodyStatus: 'Not Constituted', rowNumber: 2 });
      rowModel['find'] = jest.fn().mockReturnValue(q([validRow, invalidRow]));

      const result = await service.validateBatch(
        stateOid.toString(),
        yearOid.toString(),
        {
          rows: [
            { rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' },
            { rowId: rowOid2.toString(), electedBodyStatus: 'Constituted' },
          ],
        },
        adminUser,
      );

      expect(result.data!.totalRowCount).toBe(2);
      expect(result.data!.errorRowCount).toBe(1);
      expect(result.data!.validRowCount).toBe(1);
      expect(result.data!.validationStatus).toBe('INVALID');
    });
  });

  // ─── submitBatch ──────────────────────────────────────────────────────────────

  describe('submitBatch', () => {
    const rowOid = new Types.ObjectId();

    function eligibleRow(overrides: Record<string, unknown> = {}) {
      return makeRow({ _id: rowOid, electedBodyStatus: 'Not Constituted', ...overrides });
    }

    const validDocument = {
      fileName: 'combined.pdf',
      fileUrl: 'https://bucket.s3.example.com/combined.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
    };

    function makeDto(
      docOverride: Record<string, unknown> = {},
      rowsOverride?: Array<{ rowId: string; electedBodyStatus: string }>,
    ) {
      return {
        rows: rowsOverride ?? [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }],
        document: { ...validDocument, ...docOverride },
      };
    }

    beforeEach(() => {
      rowModel['find'] = jest.fn().mockReturnValue(q([eligibleRow()]));
    });

    // ─── Document validation ───────────────────────────────────────────────────

    it('throws BadRequestException when mimeType is provided but is not application/pdf', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ mimeType: 'image/png' }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when mimeType is omitted and fileName does not end in .pdf', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ fileName: 'report.docx', mimeType: undefined }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid PDF when mimeType is application/pdf', async () => {
      const result = await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);
      expect(result.success).toBe(true);
    });

    it('accepts PDF by fileName extension when mimeType is omitted', async () => {
      const result = await service.submitBatch(
        stateOid.toString(),
        yearOid.toString(),
        makeDto({ fileName: 'report.pdf', mimeType: undefined }),
        adminUser,
      );
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException when fileSize exceeds 20 MB', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ fileSize: 21 * 1024 * 1024 }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when fileSize is zero', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ fileSize: 0 }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when fileName is empty', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ fileName: '  ' }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when fileUrl is empty', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ fileUrl: '' }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    // ─── Structural / auth checks ──────────────────────────────────────────────

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongUser = stateUser(new Types.ObjectId());
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), wrongUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the form does not exist', async () => {
      (formModel['findOne'] as jest.Mock).mockReturnValue(q(null));
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when form status is not in the allowed set', async () => {
      (formModel['findOne'] as jest.Mock).mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for duplicate rowIds', async () => {
      const id = rowOid.toString();
      await expect(
        service.submitBatch(
          stateOid.toString(),
          yearOid.toString(),
          makeDto({}, [
            { rowId: id, electedBodyStatus: 'Not Constituted' },
            { rowId: id, electedBodyStatus: 'Not Constituted' },
          ]),
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when row IDs are not found in the DB', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([]));
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a row is not eligible (Exempt)', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([eligibleRow({ electedBodyStatus: 'Exempt' })]));
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with rowErrors when Constituted row is missing required dates', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([eligibleRow()]));

      let caught: unknown;
      try {
        await service.submitBatch(
          stateOid.toString(),
          yearOid.toString(),
          makeDto({}, [{ rowId: rowOid.toString(), electedBodyStatus: 'Constituted' }]),
          adminUser,
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const data = response['data'] as Record<string, unknown> | undefined;
      expect(Array.isArray(data?.['rowErrors'])).toBe(true);
      const rowErrors = data?.['rowErrors'] as Array<Record<string, unknown>>;
      expect(rowErrors[0]['rowId']).toBe(rowOid.toString());
    });

    // ─── S3 not called ────────────────────────────────────────────────────────

    it('does not call any S3 methods because the file is already uploaded before submit', async () => {
      // S3Service is not provided in this test module at all — its absence is proof.
      // The assertion here is that the service reaches success without touching S3.
      const result = await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);
      expect(result.success).toBe(true);
    });

    // ─── Success path ──────────────────────────────────────────────────────────

    it('returns success:true with batchId, updatedRowCount, document, and validationSummary', async () => {
      const result = await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        batchId: expect.any(String),
        updatedRowCount: 1,
        document: expect.objectContaining({
          fileName: 'combined.pdf',
          fileUrl: 'https://bucket.s3.example.com/combined.pdf',
          mimeType: 'application/pdf',
        }),
        validationSummary: expect.objectContaining({ validationStatus: expect.any(String) }),
      });
    });

    it('document.fileUrl in response matches dto.document.fileUrl exactly without presigned regeneration', async () => {
      const customUrl = 'https://custom.cdn.example.com/upload/batch.pdf';
      const result = await service.submitBatch(
        stateOid.toString(),
        yearOid.toString(),
        makeDto({ fileUrl: customUrl }),
        adminUser,
      );
      expect(result.data!.document.fileUrl).toBe(customUrl);
    });

    it('defaults document.mimeType to application/pdf in stored batch when omitted', async () => {
      await service.submitBatch(
        stateOid.toString(),
        yearOid.toString(),
        makeDto({ fileName: 'report.pdf', mimeType: undefined }),
        adminUser,
      );

      const updateCall = (formModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const push = (updateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const batch = push['postSubmissionUpdates'] as Record<string, unknown>;
      const doc = batch['document'] as Record<string, unknown>;
      expect(doc['mimeType']).toBe('application/pdf');
    });

    it('commits the MongoDB transaction on success', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);
      expect(mockSession['commitTransaction']).toHaveBeenCalled();
      expect(mockSession['abortTransaction']).not.toHaveBeenCalled();
    });

    it('calls endSession in finally regardless of outcome', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);
      expect(mockSession['endSession']).toHaveBeenCalled();
    });

    // ─── Transaction failure ───────────────────────────────────────────────────

    it('aborts transaction on DB write failure and rethrows without S3 cleanup', async () => {
      const dbError = new Error('DB write failed');
      (formModel['findByIdAndUpdate'] as jest.Mock).mockReturnValue({
        exec: jest.fn().mockRejectedValue(dbError),
      });

      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser),
      ).rejects.toThrow('DB write failed');

      expect(mockSession['abortTransaction']).toHaveBeenCalled();
      expect(mockSession['commitTransaction']).not.toHaveBeenCalled();
    });

    // ─── DB writes ────────────────────────────────────────────────────────────

    it('pushes a batch entry to the form document with APPLIED status and document metadata', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      const updateCall = (formModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const push = (updateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const batch = push['postSubmissionUpdates'] as Record<string, unknown>;
      expect(batch['status']).toBe('APPLIED');
      expect(batch['rowIds']).toHaveLength(1);
      const doc = batch['document'] as Record<string, unknown>;
      expect(doc['fileName']).toBe('combined.pdf');
      expect(doc['fileUrl']).toBe('https://bucket.s3.example.com/combined.pdf');
    });

    it('does not store document reference on row updates (only batchId reference)', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      const rowUpdateCall = (rowModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const rowSet = (rowUpdateCall[1] as Record<string, unknown>)['$set'] as Record<string, unknown>;
      expect(rowSet).not.toHaveProperty('document');
      expect(rowSet).toHaveProperty('lastUpdateBatchId');
      expect(rowSet).toHaveProperty('lastUpdatedSource', 'POST_SUBMISSION_UPDATE');
    });

    it('pushes an updateHistory entry on each affected row', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      const rowUpdateCall = (rowModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const rowPush = (rowUpdateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const entry = rowPush['updateHistory'] as Record<string, unknown>;
      expect(entry['source']).toBe('POST_SUBMISSION_UPDATE');
      expect(entry['updatedBy']).toBeInstanceOf(Types.ObjectId);
    });
  });
});
