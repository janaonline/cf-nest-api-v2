import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesRowService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/row/elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import { ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';

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
  rowType: 'EXTRA_ULB' as const,
  datasetVersion: 1,
  errors: [],
};

const mockDbUlbRow = {
  ...mockRow,
  rowType: 'DB_ULB' as const,
  censusCode: 'DB_CODE',
  ulbName: 'DB City',
  ulbId: new Types.ObjectId(),
};

const updatedRow = { ...mockRow, electedBodyStatus: 'Not Constituted', dateOfConstitution: null, dateOfExpiry: null };

const mockRowTypedFields: EulbTypedFieldConfig[] = [
  {
    key: 'dateOfConstitution',
    label: 'Date of Constitution',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    validations: [
      { name: 'minDate', validator: '2021-05-31', message: 'Date of Constitution cannot be before 31 May 2021.' },
      { name: 'maxDate', validator: 'TODAY', message: 'Date of Constitution cannot be a future date.' },
    ],
  },
  {
    key: 'dateOfExpiry',
    label: 'Date of Expiry',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    validations: [
      { name: 'minDate', validator: 'TODAY', message: 'Date of Expiry cannot be before today.' },
      { name: 'maxDate', validator: '2030-03-31', message: 'Date of Expiry cannot be after 31 March 2030.' },
    ],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    formFieldType: 'text',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
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
      { id: 'Exempt', label: 'Exempt' },
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
];

const mockEulbFormJsonConfigService = {
  loadFields: jest.fn().mockResolvedValue(mockRowTypedFields),
};

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
        { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
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
        {
          field: 'electedBodyStatus',
          code: 'invalid_enum',
          message: 'Status must be one of: Constituted, Not Constituted, Exempt.',
        },
      ]);

      let caught: unknown;
      try {
        await service.updateRow(
          stateOid.toString(),
          yearOid.toString(),
          rowOid.toString(),
          { electedBodyStatus: 'INVALID' },
          adminUser,
        );
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
      jest
        .spyOn(validator, 'validatePortalUpdateFields')
        .mockReturnValue([{ field: 'electedBodyStatus', code: 'invalid_enum', message: 'Invalid status' }]);

      let caught: unknown;
      try {
        await service.updateRow(
          stateOid.toString(),
          yearOid.toString(),
          rowOid.toString(),
          { electedBodyStatus: 'INVALID' },
          adminUser,
        );
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

    it('updates censusCode and ulbName in updateFields for EXTRA_ULB rows', async () => {
      rowModel['findOne'] = jest.fn().mockReturnValueOnce(q(mockRow)).mockReturnValueOnce(q(null));

      await service.updateRow(
        stateOid.toString(),
        yearOid.toString(),
        rowOid.toString(),
        { censusCode: 'NEW_CODE', ulbName: 'New City' },
        adminUser,
      );
      const setArg = rowModel['findByIdAndUpdate'].mock.calls[0][1].$set as Record<string, unknown>;
      expect(setArg['censusCode']).toBe('NEW_CODE');
      expect(setArg['ulbName']).toBe('New City');
    });

    it('ignores censusCode and ulbName from DTO for DB_ULB rows and preserves stored values', async () => {
      rowModel['findOne'] = jest.fn().mockReturnValue(q(mockDbUlbRow));
      const updatedDbRow = { ...mockDbUlbRow };
      rowModel['findByIdAndUpdate'] = jest.fn().mockReturnValue(q(updatedDbRow));

      await service.updateRow(
        stateOid.toString(),
        yearOid.toString(),
        rowOid.toString(),
        { censusCode: 'IGNORED', ulbName: 'Ignored Name', electedBodyStatus: 'Not Constituted' },
        adminUser,
      );
      const setArg = rowModel['findByIdAndUpdate'].mock.calls[0][1].$set as Record<string, unknown>;
      expect(setArg).not.toHaveProperty('censusCode');
      expect(setArg).not.toHaveProperty('ulbName');
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

    // ─── census code duplicate enforcement ───────────────────────────────────

    it('rejects a censusCode update that duplicates an existing active row in the same design year', async () => {
      const existingDuplicate = { ...mockRow, _id: new Types.ObjectId(), censusCode: 'DUP_CODE' };
      rowModel['findOne'] = jest.fn().mockReturnValueOnce(q(mockRow)).mockReturnValueOnce(q(existingDuplicate));

      let caught: unknown;
      try {
        await service.updateRow(
          stateOid.toString(),
          yearOid.toString(),
          rowOid.toString(),
          { censusCode: 'DUP_CODE' },
          adminUser,
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errMap = response['errors'] as XviFcValidationErrorMap;
      expect(errMap).toHaveProperty('censusCode');
      expect(errMap['censusCode'][0]).toMatchObject({ field: 'censusCode', code: 'duplicate' });

      expect(rowModel['findOne']).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          year: yearOid,
          censusCode: 'DUP_CODE',
          isActive: true,
          _id: { $ne: rowOid },
        }),
      );
      const duplicateQuery = rowModel['findOne'].mock.calls[1][0] as Record<string, unknown>;
      expect(duplicateQuery).not.toHaveProperty('datasetVersion');
      expect(duplicateQuery).not.toHaveProperty('rowType');
    });

    it('allows updating censusCode when no other active row in the same design year matches', async () => {
      rowModel['findOne'] = jest.fn().mockReturnValueOnce(q(mockRow)).mockReturnValueOnce(q(null));

      const result = await service.updateRow(
        stateOid.toString(),
        yearOid.toString(),
        rowOid.toString(),
        { censusCode: mockRow.censusCode ?? 'SAME_CODE' },
        adminUser,
      );
      expect(result).toMatchObject({ success: true });
      expect(rowModel['findOne']).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          year: yearOid,
          censusCode: mockRow.censusCode,
          isActive: true,
          _id: { $ne: rowOid },
        }),
      );
    });

    it('trims censusCode before duplicate validation and persistence', async () => {
      rowModel['findOne'] = jest.fn().mockReturnValueOnce(q(mockRow)).mockReturnValueOnce(q(null));

      await service.updateRow(
        stateOid.toString(),
        yearOid.toString(),
        rowOid.toString(),
        { censusCode: '  TRIMMED_CODE  ' },
        adminUser,
      );

      expect(rowModel['findOne']).toHaveBeenNthCalledWith(2, expect.objectContaining({ censusCode: 'TRIMMED_CODE' }));
      const setArg = rowModel['findByIdAndUpdate'].mock.calls[0][1].$set as Record<string, unknown>;
      expect(setArg['censusCode']).toBe('TRIMMED_CODE');
    });

    it('converts a Mongo 11000 duplicate-key error to a clean censusCode validation error', async () => {
      // Duplicate check passes (no pre-existing row), but DB fires 11000 at write time.
      rowModel['findOne'] = jest.fn().mockReturnValueOnce(q(mockRow)).mockReturnValueOnce(q(null));
      rowModel['findByIdAndUpdate'] = jest.fn().mockReturnValue({
        lean: () => ({
          exec: () => Promise.reject(Object.assign(new Error('E11000'), { code: 11000 })),
        }),
      });

      let caught: unknown;
      try {
        await service.updateRow(
          stateOid.toString(),
          yearOid.toString(),
          rowOid.toString(),
          { censusCode: 'RACE_CODE' },
          adminUser,
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errMap = response['errors'] as XviFcValidationErrorMap;
      expect(errMap).toHaveProperty('censusCode');
      expect(errMap['censusCode'][0]).toMatchObject({ code: 'duplicate' });
    });
  });

  // ─── getRows ─────────────────────────────────────────────────────────────

  describe('getRows', () => {
    it('returns success:true with paginated rows', async () => {
      rowModel['find'] = jest.fn().mockReturnValue(q([mockRow]));
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(1));

      const result = await service.getRows(stateOid.toString(), yearOid.toString(), { page: 1, limit: 50 }, adminUser);
      expect(result).toMatchObject({
        success: true,
        data: { rows: expect.any(Array), total: 1, page: 1, limit: 50 },
      });
    });
  });
});
