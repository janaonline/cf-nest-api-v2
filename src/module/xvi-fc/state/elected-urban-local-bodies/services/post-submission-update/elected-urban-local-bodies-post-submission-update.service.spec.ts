import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  EulbPostSubmissionUpdateService,
  buildEligibleRowCondition,
  buildPostSubmissionEligibleRowsFilter,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  POST_SUBMISSION_UPDATE_ALLOWED_STATUSES,
  canViewPostSubmissionUpdate,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import type {
  SubmitEulbPostSubmissionUpdateDto,
  SubmitEulbPostSubmissionUpdateRowDto,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/submit-eulb-post-submission-update.dto';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';

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
const yearOid = new Types.ObjectId('67d7d136d3d038946a5239e9'); // 2026-27
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

// Fixtures with `role` explicitly set so `getEffectivePermissions` resolves a real subrole
// permission set (the plain `stateUser`/`adminUser` fixtures above omit `role`, so they
// resolve to no permissions at all under `getEffectivePermissions` — fine for tests that only
// exercise `hasStateAccess`, but not for asserting on `permissions.canView`/`canSubmitUpdate`).
const stateUserWithSubrole = (state: Types.ObjectId, xviFcSubrole: 'admin' | 'reviewer' | 'viewer'): AuthUser =>
  ({
    _id: userOid.toString(),
    role: UserRole.STATE,
    scope: Scope.STATE,
    state,
    xviFcSubrole,
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

interface TestEulbRowError {
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

interface TestEulbRow {
  _id: Types.ObjectId;
  form: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  rowNumber: number;
  censusCode: string | null;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: Date | string | null;
  dateOfExpiry: Date | string | null;
  remarks: string | null;
  rowType: 'DB_ULB' | 'EXTRA_ULB';
  datasetVersion: number;
  validationStatus: 'VALID' | 'INVALID';
  errors: TestEulbRowError[];
  isActive: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectIdEquals(actual: Types.ObjectId, expected: unknown): boolean {
  return expected instanceof Types.ObjectId && actual.equals(expected);
}

function getAndConditions(filter: Record<string, unknown>): Record<string, unknown>[] {
  const andConditions = filter['$and'];
  return Array.isArray(andConditions) ? andConditions.filter(isRecord) : [];
}

function getOrClauses(condition: Record<string, unknown>): Record<string, unknown>[] {
  const orClauses = condition['$or'];
  return Array.isArray(orClauses) ? orClauses.filter(isRecord) : [];
}

function dateValue(value: Date | string | null): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return null;
}

function matchesCondition(row: TestEulbRow, condition: Record<string, unknown>): boolean {
  const orClauses = getOrClauses(condition);
  if (orClauses.length > 0) return orClauses.some((clause) => matchesCondition(row, clause));

  const censusCode = condition['censusCode'];
  if (censusCode instanceof RegExp) return censusCode.test(row.censusCode ?? '');

  const ulbName = condition['ulbName'];
  if (ulbName instanceof RegExp) return ulbName.test(row.ulbName);

  const electedBodyStatus = condition['electedBodyStatus'];
  if (electedBodyStatus === 'Not Constituted') return row.electedBodyStatus === 'Not Constituted';

  if (electedBodyStatus === 'Constituted') {
    const expiryCondition = condition['dateOfExpiry'];
    const expiry = dateValue(row.dateOfExpiry);
    if (!expiry || !isRecord(expiryCondition) || !(expiryCondition['$lt'] instanceof Date)) return false;
    return row.electedBodyStatus === 'Constituted' && expiry.getTime() < expiryCondition['$lt'].getTime();
  }

  return true;
}

function rowMatchesFilter(row: TestEulbRow, filter: Record<string, unknown>): boolean {
  if (!objectIdEquals(row.form, filter['form'])) return false;
  if (!objectIdEquals(row.state, filter['state'])) return false;
  if (!objectIdEquals(row.year, filter['year'])) return false;
  if (filter['datasetVersion'] !== row.datasetVersion) return false;
  if (filter['isActive'] !== row.isActive) return false;

  const validationStatus = filter['validationStatus'];
  if (typeof validationStatus === 'string' && validationStatus !== row.validationStatus) return false;

  const electedBodyStatus = filter['electedBodyStatus'];
  if (typeof electedBodyStatus === 'string' && electedBodyStatus !== row.electedBodyStatus) return false;

  return getAndConditions(filter).every((condition) => matchesCondition(row, condition));
}

function makeRow(overrides: Partial<TestEulbRow> = {}): TestEulbRow {
  const futureExpiry = new Date(TODAY);
  futureExpiry.setDate(futureExpiry.getDate() + 30);
  return {
    _id: new Types.ObjectId(),
    form: formOid,
    state: stateOid,
    year: yearOid,
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
  it('returns the exact candidate-row condition used by the post-submission update page', () => {
    expect(buildEligibleRowCondition(TODAY)).toEqual({
      $or: [
        { electedBodyStatus: 'Not Constituted' },
        {
          electedBodyStatus: 'Constituted',
          dateOfExpiry: { $lt: TODAY },
        },
      ],
    });
  });

  it('includes Not Constituted rows without a date check', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    expect(orClauses).toContainEqual({ electedBodyStatus: 'Not Constituted' });
  });

  it('includes Constituted rows with dateOfExpiry strictly before today', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    expect(orClauses).toContainEqual({
      electedBodyStatus: 'Constituted',
      dateOfExpiry: { $lt: TODAY },
    });
  });

  it('uses $lt (strict less-than) so rows expiring exactly today or in the future are excluded', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    const constitutedClause = orClauses.find((c) => c['electedBodyStatus'] === 'Constituted');
    expect(constitutedClause?.['dateOfExpiry']).toEqual({ $lt: TODAY });
  });

  it('does not include 6th Schedule rows', () => {
    const condition = buildEligibleRowCondition(TODAY);
    const orClauses = condition['$or'] as Array<Record<string, unknown>>;
    const hasExempt = orClauses.some((c) => c['electedBodyStatus'] === '6th Schedule');
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

describe('buildPostSubmissionEligibleRowsFilter', () => {
  it('builds the mandatory base filter for post-submission candidate rows', () => {
    expect(buildPostSubmissionEligibleRowsFilter(formOid, stateOid.toString(), yearOid.toString(), 1, TODAY)).toEqual({
      form: formOid,
      state: stateOid,
      year: yearOid,
      datasetVersion: 1,
      isActive: true,
      $and: [buildEligibleRowCondition(TODAY)],
    });
  });
});

const mockPostSubmitTypedFields: EulbTypedFieldConfig[] = [
  {
    key: 'dateOfConstitution',
    label: 'Date on which the elected body is in place.',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS', 'EULB_POST_SUBMIT_UPDATE_FIELDS'],
    validations: [
      { name: 'minDate', validator: '2021-05-31', message: 'Date on which the elected body is in place cannot be before 31 May 2021.' },
      { name: 'maxDate', validator: 'TODAY', message: 'Date on which the elected body is in place cannot be a future date.' },
    ],
  },
  {
    key: 'dateOfExpiry',
    label: 'Date of Expiry',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS', 'EULB_POST_SUBMIT_UPDATE_FIELDS'],
    validations: [
      { name: 'minDate', validator: 'TODAY', message: 'Date of Expiry cannot be before today.' },
      { name: 'maxDate', validator: '2030-03-31', message: 'Date of Expiry cannot be after 31 March 2030.' },
    ],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    formFieldType: 'text',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS', 'EULB_POST_SUBMIT_UPDATE_FIELDS'],
    validations: [{ name: 'maxlength', validator: 250, message: 'Remarks must not exceed 250 characters.' }],
  },
  {
    key: 'electedBodyStatus',
    label: 'Elected Body Status',
    formFieldType: 'select',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    options: [
      { id: 'Constituted', label: 'Constituted' },
      { id: 'Not Constituted', label: 'Not Constituted' },
      { id: '6th Schedule', label: '6th Schedule' },
    ],
    validations: [{ name: 'required', validator: null, message: 'Elected Body Status is required.' }],
  },
  {
    key: 'censusCode',
    label: 'Census Code',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [
      { name: 'required', validator: null, message: 'Census code is required.' },
      { name: 'maxlength', validator: 10, message: 'Census code must not exceed 10 characters.' },
    ],
  },
  {
    key: 'ulbName',
    label: 'ULB Name',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [
      { name: 'required', validator: null, message: 'ULB name is required.' },
      { name: 'maxlength', validator: 250, message: 'ULB name must not exceed 250 characters.' },
    ],
  },
  {
    key: 'proofOfElection',
    label: 'Proof of Election',
    formFieldType: 'file',
    fieldTypes: ['EULB_POST_SUBMIT_UPDATE_FIELDS'],
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
  },
];

const mockEulbFormJsonConfigService = {
  loadFields: jest.fn().mockResolvedValue(mockPostSubmitTypedFields),
};

function makeFormSummary(overrides: Record<string, unknown> = {}) {
  return {
    _id: formOid,
    dbUlbCount: 10,
    maxAllowedExcelRows: 20,
    excelRowCount: 10,
    matchedDbUlbCount: 10,
    missingDbUlbCount: 0,
    extraExcelRowCount: 0,
    duplicateUlbCount: 0,
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
      aggregate: jest.fn().mockReturnValue(q([])), // default: empty summary (all counts 0)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EulbPostSubmissionUpdateService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        FileInfoNormalizerService,
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        { provide: FileTokenService, useValue: { signFileUrl: jest.fn((p: string) => `signed::${p}`) } },
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

    it('counts only rows matching the same mandatory post-submission eligibility filter', async () => {
      const pastExpiry = new Date(TODAY);
      pastExpiry.setDate(pastExpiry.getDate() - 1);
      const futureExpiry = new Date(TODAY);
      futureExpiry.setDate(futureExpiry.getDate() + 1);
      const rows = [
        makeRow({ rowNumber: 1, electedBodyStatus: 'Not Constituted' }),
        makeRow({ rowNumber: 2, electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
        makeRow({ rowNumber: 3, electedBodyStatus: 'Constituted', dateOfExpiry: TODAY }),
        makeRow({ rowNumber: 4, electedBodyStatus: 'Constituted', dateOfExpiry: futureExpiry }),
        makeRow({ rowNumber: 5, electedBodyStatus: '6th Schedule' }),
        makeRow({ rowNumber: 6, electedBodyStatus: 'Not Constituted', isActive: false }),
      ];
      rowModel['countDocuments'] = jest.fn((filter: Record<string, unknown>) =>
        q(rows.filter((row) => rowMatchesFilter(row, filter)).length),
      );

      const result = await service.getMetadata(stateOid.toString(), yearOid.toString(), adminUser);

      expect(result.data!.summary.eligibleRowCount).toBe(2);
      expect(rowModel['countDocuments']).toHaveBeenCalledWith(
        buildPostSubmissionEligibleRowsFilter(formOid, stateOid.toString(), yearOid.toString(), 1, expect.any(Date)),
      );
    });

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongStateUser = stateUser(new Types.ObjectId());
      await expect(service.getMetadata(stateOid.toString(), yearOid.toString(), wrongStateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns canSubmitUpdate:false for a view-only state subrole even though canView is true (viewer holds VIEW_STATE_FORMS but not FINAL_SUBMIT_STATE_FORMS)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA)));
      const result = await service.getMetadata(
        stateOid.toString(),
        yearOid.toString(),
        stateUserWithSubrole(stateOid, 'viewer'),
      );
      expect(result.data!.permissions.canView).toBe(true);
      expect(result.data!.permissions.canSubmitUpdate).toBe(false);
    });

    it('returns canSubmitUpdate:true for a state admin subrole (holds FINAL_SUBMIT_STATE_FORMS)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA)));
      const result = await service.getMetadata(
        stateOid.toString(),
        yearOid.toString(),
        stateUserWithSubrole(stateOid, 'admin'),
      );
      expect(result.data!.permissions.canView).toBe(true);
      expect(result.data!.permissions.canSubmitUpdate).toBe(true);
    });

    it('returns canSubmitUpdate:false for a reviewer subrole (holds EDIT_STATE_FORMS but not FINAL_SUBMIT_STATE_FORMS)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA)));
      const result = await service.getMetadata(
        stateOid.toString(),
        yearOid.toString(),
        stateUserWithSubrole(stateOid, 'reviewer'),
      );
      expect(result.data!.permissions.canView).toBe(true);
      expect(result.data!.permissions.canSubmitUpdate).toBe(false);
    });
  });

  // ─── getEligibleRows ───────────────────────────────────────────────────────

  describe('getEligibleRows', () => {
    function installFilteredRows(rows: TestEulbRow[]): void {
      rowModel['find'] = jest.fn((filter: Record<string, unknown>) =>
        q(rows.filter((row) => rowMatchesFilter(row, filter))),
      );
      rowModel['countDocuments'] = jest.fn((filter: Record<string, unknown>) =>
        q(rows.filter((row) => rowMatchesFilter(row, filter)).length),
      );
    }

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongStateUser = stateUser(new Types.ObjectId());
      await expect(
        service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, wrongStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when no form exists', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when form status is not in the allowed set', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      await expect(service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser)).rejects.toThrow(
        ForbiddenException,
      );
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
      expect(findFilter).toMatchObject({
        form: formOid,
        state: stateOid,
        year: yearOid,
        datasetVersion: 1,
        isActive: true,
      });
      expect(getAndConditions(findFilter)[0]).toEqual(buildEligibleRowCondition(expect.any(Date)));
    });

    it('returns only Not Constituted and past-expiry Constituted candidate rows when no filters are provided', async () => {
      const pastExpiry = new Date(TODAY);
      pastExpiry.setDate(pastExpiry.getDate() - 1);
      const futureExpiry = new Date(TODAY);
      futureExpiry.setDate(futureExpiry.getDate() + 1);
      installFilteredRows([
        makeRow({ rowNumber: 1, electedBodyStatus: 'Not Constituted', dateOfExpiry: null }),
        makeRow({ rowNumber: 2, electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
        makeRow({ rowNumber: 3, electedBodyStatus: 'Constituted', dateOfExpiry: TODAY }),
        makeRow({ rowNumber: 4, electedBodyStatus: 'Constituted', dateOfExpiry: futureExpiry }),
        makeRow({ rowNumber: 5, electedBodyStatus: 'Constituted', dateOfExpiry: null }),
        makeRow({ rowNumber: 6, electedBodyStatus: '6th Schedule' }),
        makeRow({ rowNumber: 7, electedBodyStatus: 'Not Constituted', isActive: false }),
        makeRow({ rowNumber: 8, electedBodyStatus: 'Not Constituted', datasetVersion: 2 }),
        makeRow({ rowNumber: 9, electedBodyStatus: 'Not Constituted', form: new Types.ObjectId() }),
      ]);

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);

      expect(result.data!.rows.map((row) => row.rowNumber)).toEqual([1, 2]);
      expect(result.data!.total).toBe(2);
    });

    it('keeps the mandatory candidate condition when search is provided', async () => {
      const pastExpiry = new Date(TODAY);
      pastExpiry.setDate(pastExpiry.getDate() - 1);
      const futureExpiry = new Date(TODAY);
      futureExpiry.setDate(futureExpiry.getDate() + 1);
      installFilteredRows([
        makeRow({ rowNumber: 1, ulbName: 'Alpha City', electedBodyStatus: 'Not Constituted' }),
        makeRow({ rowNumber: 2, ulbName: 'Alpha Exempt', electedBodyStatus: '6th Schedule' }),
        makeRow({
          rowNumber: 3,
          ulbName: 'Alpha Future',
          electedBodyStatus: 'Constituted',
          dateOfExpiry: futureExpiry,
        }),
        makeRow({ rowNumber: 4, ulbName: 'Alpha Past', electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
        makeRow({ rowNumber: 5, ulbName: 'Beta City', electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
      ]);

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { search: 'Alpha' },
        adminUser,
      );

      expect(result.data!.rows.map((row) => row.rowNumber)).toEqual([1, 4]);
      const findFilter = rowModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(getAndConditions(findFilter)).toHaveLength(2);
      expect(getAndConditions(findFilter)[0]).toEqual(buildEligibleRowCondition(expect.any(Date)));
      expect(getOrClauses(getAndConditions(findFilter)[1])).toHaveLength(2);
    });

    it('filters Constituted rows to return only past-expiry constituted rows', async () => {
      const pastExpiry = new Date(TODAY);
      pastExpiry.setDate(pastExpiry.getDate() - 1);
      const futureExpiry = new Date(TODAY);
      futureExpiry.setDate(futureExpiry.getDate() + 1);
      installFilteredRows([
        makeRow({ rowNumber: 1, electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
        makeRow({ rowNumber: 2, electedBodyStatus: 'Constituted', dateOfExpiry: TODAY }),
        makeRow({ rowNumber: 3, electedBodyStatus: 'Constituted', dateOfExpiry: futureExpiry }),
        makeRow({ rowNumber: 4, electedBodyStatus: 'Not Constituted' }),
      ]);

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { electedBodyStatus: 'Constituted' },
        adminUser,
      );

      expect(result.data!.rows.map((row) => row.rowNumber)).toEqual([1]);
      expect(result.data!.total).toBe(1);
    });

    it('filters Not Constituted rows without broadening the candidate rule', async () => {
      const pastExpiry = new Date(TODAY);
      pastExpiry.setDate(pastExpiry.getDate() - 1);
      installFilteredRows([
        makeRow({ rowNumber: 1, electedBodyStatus: 'Not Constituted' }),
        makeRow({ rowNumber: 2, electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
        makeRow({ rowNumber: 3, electedBodyStatus: '6th Schedule' }),
      ]);

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { electedBodyStatus: 'Not Constituted' },
        adminUser,
      );

      expect(result.data!.rows.map((row) => row.rowNumber)).toEqual([1]);
      expect(result.data!.total).toBe(1);
    });

    it('returns empty for 6th Schedule filter because 6th Schedule is not a post-submission candidate row', async () => {
      installFilteredRows([
        makeRow({ rowNumber: 1, electedBodyStatus: 'Not Constituted' }),
        makeRow({ rowNumber: 2, electedBodyStatus: '6th Schedule' }),
      ]);

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { electedBodyStatus: '6th Schedule' },
        adminUser,
      );

      expect(result.data!.rows).toEqual([]);
      expect(result.data!.total).toBe(0);
    });

    it('uses the same mandatory candidate filter for pagination total', async () => {
      const pastExpiry = new Date(TODAY);
      pastExpiry.setDate(pastExpiry.getDate() - 1);
      installFilteredRows([
        makeRow({ rowNumber: 1, electedBodyStatus: 'Not Constituted' }),
        makeRow({ rowNumber: 2, electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
        makeRow({ rowNumber: 3, electedBodyStatus: '6th Schedule' }),
      ]);

      const result = await service.getEligibleRows(
        stateOid.toString(),
        yearOid.toString(),
        { page: 1, limit: 1 },
        adminUser,
      );
      const findFilter = rowModel['find'].mock.calls[0][0];
      const countFilter = rowModel['countDocuments'].mock.calls[0][0];

      expect(result.data!.total).toBe(2);
      expect(countFilter).toEqual(findFilter);
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

      const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), { limit: 9999 }, adminUser);
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

    // ─── statusSummary ────────────────────────────────────────────────────────

    describe('statusSummary', () => {
      function installSummaryGroups(groups: Array<{ _id: string | null; count: number }>): void {
        rowModel['aggregate'] = jest.fn().mockReturnValue(q(groups));
      }

      it('response includes statusSummary with the four expected keys', async () => {
        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
        expect(result.data!.statusSummary).toMatchObject({
          totalUlbCount: expect.any(Number),
          constitutedCount: expect.any(Number),
          notConstitutedCount: expect.any(Number),
          exemptCount: expect.any(Number),
        });
      });

      it('totalUlbCount is the sum of all group counts including unknown statuses', async () => {
        installSummaryGroups([
          { _id: 'Constituted', count: 50 },
          { _id: 'Not Constituted', count: 60 },
          { _id: '6th Schedule', count: 13 },
          { _id: null, count: 3 }, // unknown/null status rows
        ]);

        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
        expect(result.data!.statusSummary.totalUlbCount).toBe(126); // 50+60+13+3
      });

      it('constitutedCount counts only electedBodyStatus === Constituted', async () => {
        installSummaryGroups([
          { _id: 'Constituted', count: 117 },
          { _id: 'Not Constituted', count: 4 },
          { _id: '6th Schedule', count: 2 },
        ]);

        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
        expect(result.data!.statusSummary.constitutedCount).toBe(117);
      });

      it('notConstitutedCount counts only electedBodyStatus === Not Constituted', async () => {
        installSummaryGroups([
          { _id: 'Constituted', count: 117 },
          { _id: 'Not Constituted', count: 4 },
          { _id: '6th Schedule', count: 2 },
        ]);

        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
        expect(result.data!.statusSummary.notConstitutedCount).toBe(4);
      });

      it("exemptCount counts only electedBodyStatus === '6th Schedule'", async () => {
        installSummaryGroups([
          { _id: 'Constituted', count: 117 },
          { _id: 'Not Constituted', count: 4 },
          { _id: '6th Schedule', count: 2 },
        ]);

        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
        expect(result.data!.statusSummary.exemptCount).toBe(2);
      });

      it('aggregate match uses isActive:true and the active datasetVersion so inactive and stale-version rows are excluded', async () => {
        installSummaryGroups([{ _id: 'Constituted', count: 5 }]);

        await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);

        const pipeline = rowModel['aggregate'].mock.calls[0][0] as Array<Record<string, unknown>>;
        const matchStage = pipeline[0]['$match'] as Record<string, unknown>;
        expect(matchStage).toMatchObject({ isActive: true, datasetVersion: 1 });
      });

      it('aggregate is NOT called with search, electedBodyStatus, validationStatus, or eligibility conditions', async () => {
        installSummaryGroups([
          { _id: 'Constituted', count: 50 },
          { _id: 'Not Constituted', count: 60 },
          { _id: '6th Schedule', count: 13 },
        ]);

        await service.getEligibleRows(
          stateOid.toString(),
          yearOid.toString(),
          { search: 'Alpha', electedBodyStatus: 'Constituted', validationStatus: 'VALID', page: 2, limit: 5 },
          adminUser,
        );

        const pipeline = rowModel['aggregate'].mock.calls[0][0] as Array<Record<string, unknown>>;
        const matchStage = pipeline[0]['$match'] as Record<string, unknown>;
        expect(matchStage).not.toHaveProperty('$and');
        expect(matchStage).not.toHaveProperty('$or');
        expect(matchStage).not.toHaveProperty('validationStatus');
        expect(matchStage).not.toHaveProperty('electedBodyStatus');
      });

      it('statusSummary counts reflect the full dataset regardless of search/filter/pagination on rows', async () => {
        installSummaryGroups([
          { _id: 'Constituted', count: 50 },
          { _id: 'Not Constituted', count: 60 },
          { _id: '6th Schedule', count: 13 },
        ]);
        rowModel['find'] = jest.fn().mockReturnValue(q([]));
        rowModel['countDocuments'] = jest.fn().mockReturnValue(q(0)); // eligible rows = 0 after filter

        const result = await service.getEligibleRows(
          stateOid.toString(),
          yearOid.toString(),
          { electedBodyStatus: '6th Schedule' }, // 6th Schedule never shows in eligible rows
          adminUser,
        );

        expect(result.data!.rows).toHaveLength(0);
        expect(result.data!.total).toBe(0);
        // Summary is still the full dataset
        expect(result.data!.statusSummary).toEqual({
          totalUlbCount: 123,
          constitutedCount: 50,
          notConstitutedCount: 60,
          exemptCount: 13,
        });
      });

      it('zero-row dataset returns all statusSummary counts as 0', async () => {
        installSummaryGroups([]); // no active rows at all

        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);
        expect(result.data!.statusSummary).toEqual({
          totalUlbCount: 0,
          constitutedCount: 0,
          notConstitutedCount: 0,
          exemptCount: 0,
        });
      });

      it('existing eligible rows response is unchanged by the addition of statusSummary', async () => {
        const pastExpiry = new Date(TODAY);
        pastExpiry.setDate(pastExpiry.getDate() - 1);
        installFilteredRows([
          makeRow({ rowNumber: 1, electedBodyStatus: 'Not Constituted' }),
          makeRow({ rowNumber: 2, electedBodyStatus: 'Constituted', dateOfExpiry: pastExpiry }),
          makeRow({ rowNumber: 3, electedBodyStatus: '6th Schedule' }),
        ]);

        const result = await service.getEligibleRows(stateOid.toString(), yearOid.toString(), {}, adminUser);

        expect(result.data!.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
        expect(result.data!.total).toBe(2);
        expect(result.data!.page).toBe(1);
        expect(result.data!.limit).toBe(50);
        expect(result.data!.eligibleRule.allowedFormStatuses).toBeDefined();
      });
    });
  });

  // ─── validateBatch ────────────────────────────────────────────────────────────

  describe('validateBatch', () => {
    const rowOid = new Types.ObjectId();

    function makeEligibleRow(overrides: Partial<TestEulbRow> = {}) {
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
          {
            rows: [
              { rowId: id, electedBodyStatus: 'Not Constituted' },
              { rowId: id, electedBodyStatus: 'Not Constituted' },
            ],
          },
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

    it('throws BadRequestException when a submitted row is 6th Schedule (not eligible)', async () => {
      const exemptRow = makeEligibleRow({ electedBodyStatus: '6th Schedule' });
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

    it('throws BadRequestException when Constituted row has future dateOfExpiry (not yet expired, not eligible for update)', async () => {
      const futureExpiry = new Date(TODAY);
      futureExpiry.setFullYear(futureExpiry.getFullYear() + 5);
      const futureRow = makeEligibleRow({
        electedBodyStatus: 'Constituted',
        dateOfExpiry: futureExpiry,
      });
      rowModel['find'] = jest.fn().mockReturnValue(q([futureRow]));

      await expect(
        service.validateBatch(
          stateOid.toString(),
          yearOid.toString(),
          { rows: [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }] },
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

    function eligibleRow(overrides: Partial<TestEulbRow> = {}) {
      return makeRow({ _id: rowOid, electedBodyStatus: 'Not Constituted', ...overrides });
    }

    const validDocument = {
      originalName: 'combined.pdf',
      path: 'https://bucket.s3.example.com/combined.pdf',
      sizeKb: 1,
      mimeType: 'application/pdf',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    function makeDto(
      docOverride: Partial<XviFcFileRefDto> = {},
      rowsOverride?: SubmitEulbPostSubmissionUpdateRowDto[],
    ): SubmitEulbPostSubmissionUpdateDto {
      return {
        rows: rowsOverride ?? [{ rowId: rowOid.toString(), electedBodyStatus: 'Not Constituted' }],
        document: { ...validDocument, ...docOverride } as XviFcFileRefDto,
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

    // Canonical contract requires mimeType always (no more filename-extension fallback for a
    // missing mimeType) — omitting it now fails on the required-field check instead.
    it('throws BadRequestException when mimeType is omitted', async () => {
      await expect(
        service.submitBatch(
          stateOid.toString(),
          yearOid.toString(),
          makeDto({ originalName: 'report.docx', mimeType: undefined }),
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid PDF when mimeType is application/pdf', async () => {
      const result = await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException when sizeKb exceeds 20 MB', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ sizeKb: 21 * 1024 }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    // Canonical contract allows sizeKb: 0 (non-negative) — the old ">0" business rule is
    // superseded; a negative size is what is now rejected.
    it('throws BadRequestException when sizeKb is negative', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ sizeKb: -1 }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when originalName is empty', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ originalName: '  ' }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when path is empty', async () => {
      await expect(
        service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ path: '' }), adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    // ─── Structural / auth checks ──────────────────────────────────────────────

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongUser = stateUser(new Types.ObjectId());
      await expect(service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), wrongUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the form does not exist', async () => {
      (formModel['findOne'] as jest.Mock).mockReturnValue(q(null));
      await expect(service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when form status is not in the allowed set', async () => {
      (formModel['findOne'] as jest.Mock).mockReturnValue(q(makeForm(FORM_STATUS.IN_PROGRESS)));
      await expect(service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser)).rejects.toThrow(
        ForbiddenException,
      );
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
      await expect(service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when a row is not eligible (6th Schedule)', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([eligibleRow({ electedBodyStatus: '6th Schedule' })]));
      await expect(service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser)).rejects.toThrow(
        BadRequestException,
      );
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
          originalName: 'combined.pdf',
          mimeType: 'application/pdf',
        }),
        validationSummary: expect.objectContaining({ validationStatus: expect.any(String) }),
      });
    });

    // The persisted DB path is the client's normalized raw path verbatim; the RESPONSE path is
    // always signed (never the raw path) per the canonical GET/response contract.
    it('persists the normalized raw path but signs document.path in the response', async () => {
      const customPath = 'https://custom.cdn.example.com/upload/batch.pdf';
      const result = await service.submitBatch(
        stateOid.toString(),
        yearOid.toString(),
        makeDto({ path: customPath }),
        adminUser,
      );

      const updateCall = (formModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const push = (updateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const batch = push['postSubmissionUpdates'] as Record<string, unknown>;
      const storedDoc = batch['document'] as Record<string, unknown>;
      expect(storedDoc['path']).toBe(customPath);

      expect(result.data!.document.path).not.toBe(customPath);
      expect(result.data!.document.path).toContain('signed::');
    });

    it('stores document.pageCount in the batch when the frontend sends a PDF page count', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto({ pageCount: 12 }), adminUser);

      const updateCall = (formModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const push = (updateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const batch = push['postSubmissionUpdates'] as Record<string, unknown>;
      const doc = batch['document'] as Record<string, unknown>;
      expect(doc['pageCount']).toBe(12);
    });

    it('defaults document.pageCount to null in the stored batch when omitted (backward compatible)', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      const updateCall = (formModel['findByIdAndUpdate'] as jest.Mock).mock.calls[0];
      const push = (updateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const batch = push['postSubmissionUpdates'] as Record<string, unknown>;
      const doc = batch['document'] as Record<string, unknown>;
      expect(doc['pageCount']).toBeNull();
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

      await expect(service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser)).rejects.toThrow(
        'DB write failed',
      );

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
      expect(doc['originalName']).toBe('combined.pdf');
      expect(doc['path']).toBe('https://bucket.s3.example.com/combined.pdf');
    });

    it('does not store document reference on row updates (only batchId reference)', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      const rowUpdateCall = rowModel['findByIdAndUpdate'].mock.calls[0];
      const rowSet = (rowUpdateCall[1] as Record<string, unknown>)['$set'] as Record<string, unknown>;
      expect(rowSet).not.toHaveProperty('document');
      expect(rowSet).toHaveProperty('lastUpdateBatchId');
      expect(rowSet).toHaveProperty('lastUpdatedSource', 'POST_SUBMISSION_UPDATE');
    });

    it('pushes an updateHistory entry on each affected row', async () => {
      await service.submitBatch(stateOid.toString(), yearOid.toString(), makeDto(), adminUser);

      const rowUpdateCall = rowModel['findByIdAndUpdate'].mock.calls[0];
      const rowPush = (rowUpdateCall[1] as Record<string, unknown>)['$push'] as Record<string, unknown>;
      const entry = rowPush['updateHistory'] as Record<string, unknown>;
      expect(entry['source']).toBe('POST_SUBMISSION_UPDATE');
      expect(entry['updatedBy']).toBeInstanceOf(Types.ObjectId);
    });
  });
});
