import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesRowService } from './elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesForm } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { ElectedUrbanLocalBodiesValidator } from './elected-urban-local-bodies.validator';
import { ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { XviFcValidationErrorMap } from '../../common/response/xvi-fc-api-response';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit', 'populate']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  // Make thenable so it can be awaited without .exec() (e.g. findByIdAndUpdate, countDocuments)
  chain['then'] = (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(onFulfilled, onRejected);
  chain['catch'] = (onRejected: (e: unknown) => unknown) => Promise.resolve(value).catch(onRejected);
  chain['finally'] = (onFinally: () => void) => Promise.resolve(value).finally(onFinally);
  return chain;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const rowOid = new Types.ObjectId();
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

const mockForm = {
  _id: formOid,
  state: stateOid,
  year: yearOid,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  activeDatasetVersion: 1,
  dbUlbCount: 10,
  maxAllowedExcelRows: 20,
  excelRowCount: 10,
  matchedDbUlbCount: 10,
  missingDbUlbCount: 0,
  extraExcelRowCount: 0,
  errorRowCount: 0,
  validationStatus: 'VALID' as const,
};

const mockRow = {
  _id: rowOid,
  form: formOid,
  rowNumber: 1,
  censusCode: '1234567',
  ulbName: 'Test City',
  electedBodyStatus: 'Constituted',
  rowType: 'EXTRA_ULB' as const, // avoids ulbModel lookup
  datasetVersion: 1,
  errors: [],
};

const updatedRow = { ...mockRow, electedBodyStatus: 'Not Constituted', dateOfConstitution: null, dateOfExpiry: null };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ElectedUrbanLocalBodiesRowService', () => {
  let service: ElectedUrbanLocalBodiesRowService;
  let formModel: Record<string, jest.Mock>;
  let rowModel: Record<string, jest.Mock>;
  let validator: ElectedUrbanLocalBodiesValidator;

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(q(mockForm)),
      findById: jest.fn().mockReturnValue(q(mockForm)),
      findByIdAndUpdate: jest.fn().mockReturnValue(q(mockForm)),
    };
    rowModel = {
      findOne: jest.fn().mockReturnValue(q(mockRow)),
      findByIdAndUpdate: jest.fn().mockReturnValue(q(updatedRow)),
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      deleteMany: jest.fn().mockReturnValue(q({ deletedCount: 0 })),
    };
    const ulbModel = { findById: jest.fn().mockReturnValue(q(null)) };
    const mockValidator = {
      validatePortalUpdateFields: jest.fn().mockReturnValue([]),
      revalidateRow: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesRowService,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: ElectedUrbanLocalBodiesValidator, useValue: mockValidator },
        { provide: ExcelService, useValue: { generateExcel: jest.fn() } },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesRowService);
    validator = module.get(ElectedUrbanLocalBodiesValidator);
  });

  // ─── updateRow ───────────────────────────────────────────────────────────

  describe('updateRow', () => {
    it('returns success:true with row and validationSummary on valid update', async () => {
      const result = await service.updateRow(
        stateOid.toString(),
        yearOid.toString(),
        rowOid.toString(),
        { electedBodyStatus: 'Not Constituted' },
        adminUser,
      );
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
        data: {
          row: expect.anything(),
          validationSummary: expect.objectContaining({ validationStatus: expect.any(String) }),
        },
      });
    });

    it('throws ForbiddenException for a state user accessing a different state', async () => {
      const wrongStateUser = stateUser(new Types.ObjectId()); // different from stateOid
      await expect(
        service.updateRow(stateOid.toString(), yearOid.toString(), rowOid.toString(), {}, wrongStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the row does not exist', async () => {
      rowModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(
        service.updateRow(stateOid.toString(), yearOid.toString(), rowOid.toString(), {}, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException with errors as Record<string, XviFcValidationError[]> on validation failure', async () => {
      jest.spyOn(validator, 'validatePortalUpdateFields').mockReturnValue([
        { field: 'electedBodyStatus', code: 'invalid_enum', message: 'Status must be one of: Constituted, Not Constituted, Exempt.' },
      ]);

      let caught: unknown;
      try {
        await service.updateRow(stateOid.toString(), yearOid.toString(), rowOid.toString(), { electedBodyStatus: 'INVALID' }, adminUser);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      expect(typeof response['message']).toBe('string');
      expect((response['message'] as string).length).toBeGreaterThan(0);

      const errors = response['errors'];
      // errors must be a plain object keyed by field name, NOT an array
      expect(Array.isArray(errors)).toBe(false);
      expect(typeof errors).toBe('object');
      expect(errors).not.toBeNull();

      const errMap = errors as XviFcValidationErrorMap;
      expect(errMap).toHaveProperty('electedBodyStatus');
      expect(Array.isArray(errMap['electedBodyStatus'])).toBe(true);
      expect(errMap['electedBodyStatus'][0]).toMatchObject({ message: expect.any(String) });
    });

    it('preserves row context in data when validation fails', async () => {
      jest.spyOn(validator, 'validatePortalUpdateFields').mockReturnValue([
        { field: 'electedBodyStatus', code: 'invalid_enum', message: 'Invalid status' },
      ]);

      let caught: unknown;
      try {
        await service.updateRow(stateOid.toString(), yearOid.toString(), rowOid.toString(), { electedBodyStatus: 'INVALID' }, adminUser);
      } catch (e) {
        caught = e;
      }

      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const data = response['data'] as Record<string, unknown>;
      expect(data).toMatchObject({
        rowId: rowOid.toString(),
        rowNumber: mockRow.rowNumber,
        censusCode: mockRow.censusCode,
        ulbName: mockRow.ulbName,
      });
    });

    it('groups multiple field errors under their respective field keys', async () => {
      jest.spyOn(validator, 'validatePortalUpdateFields').mockReturnValue([
        { field: 'electedBodyStatus', code: 'invalid_enum', message: 'Invalid status' },
        { field: 'remarks', code: 'maxlength', message: 'Remarks too long' },
      ]);

      let caught: unknown;
      try {
        await service.updateRow(stateOid.toString(), yearOid.toString(), rowOid.toString(), {}, adminUser);
      } catch (e) {
        caught = e;
      }

      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errMap = response['errors'] as XviFcValidationErrorMap;
      expect(errMap).toHaveProperty('electedBodyStatus');
      expect(errMap).toHaveProperty('remarks');
    });
  });

  // ─── getRows ─────────────────────────────────────────────────────────────

  describe('getRows', () => {
    it('returns success:true with paginated rows', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([mockRow]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { page: 1, limit: 50 },
        adminUser,
      );
      expect(result).toMatchObject({
        success: true,
        data: { rows: expect.any(Array), total: 1, page: 1, limit: 50 },
      });
    });
  });
});
