import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { ElectedUrbanLocalBodiesExcelService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/excel/elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { S3Service } from 'src/core/s3/s3.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { ValidateElectedUrbanLocalBodiesExcelDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/validate-elected-urban-local-bodies-excel.dto';
import type {
  EulbRevalidateExcelResponseData,
  EulbRowValidationError,
  EulbValidateExcelResponseData,
  EulbValidationSummary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXCEL_HEADERS = ['censusCode', 'ulbName', 'electedBodyStatus', 'dateOfConstitution', 'dateOfExpiry', 'remarks'];

/**
 * Convert a calendar date to an Excel serial integer (timezone-independent).
 * With cellDates:false (xlsx default), date cells are read back as integer serials.
 */
function calendarDateToSerial(year: number, month: number, day: number): number {
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  return (Date.UTC(year, month - 1, day) - EXCEL_EPOCH_MS) / 86400000;
}

/** Build a real xlsx buffer from an array of row objects (camelCase header keys). */
function makeXlsxBuffer(dataRows: Record<string, unknown>[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, ...dataRows.map((r) => EXCEL_HEADERS.map((h) => r[h] ?? ''))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Catches a BadRequestException thrown by the service; rethrows any other type. */
async function catchBadRequest(
  fn: () => Promise<unknown>,
): Promise<{ response: { errors?: Record<string, unknown[]>; data?: unknown }; exception: BadRequestException }> {
  try {
    await fn();
    throw new Error('Expected BadRequestException but the call resolved successfully');
  } catch (e: unknown) {
    if (!(e instanceof BadRequestException)) throw e;
    return { response: e.getResponse() as { errors?: Record<string, unknown[]>; data?: unknown }, exception: e };
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const formOid = new Types.ObjectId();
const userOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: userOid.toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: null,
};

const mockExcelTypedFields: EulbTypedFieldConfig[] = [
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
];

const mockEulbFormJsonConfigService = {
  loadFields: jest.fn().mockResolvedValue(mockExcelTypedFields),
};

/** Registry ULB 1 — census code DBCODE1 */
const DB_ULB_1 = { _id: new Types.ObjectId(), name: 'DB City One', censusCode: 'DBCODE1' };
/** Registry ULB 2 — census code DBCODE2 */
const DB_ULB_2 = { _id: new Types.ObjectId(), name: 'DB City Two', censusCode: 'DBCODE2' };

function makeDto(): ValidateElectedUrbanLocalBodiesExcelDto {
  return {
    stateId: stateOid.toString(),
    yearId: yearOid.toString(),
    electedBodyExcelFile: {
      fileName: 'test.xlsx',
      fileUrl: 'state/test.xlsx',
      fileSize: 1024,
    },
  } as ValidateElectedUrbanLocalBodiesExcelDto;
}

// ─── validateExcel ────────────────────────────────────────────────────────────

describe('ElectedUrbanLocalBodiesExcelService — validateExcel', () => {
  let service: ElectedUrbanLocalBodiesExcelService;
  let rowModel: {
    insertMany: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
    find: jest.Mock;
    bulkWrite: jest.Mock;
  };
  let formModel: { findOne: jest.Mock; create: jest.Mock; findByIdAndUpdate: jest.Mock };
  let ulbModel: { find: jest.Mock };
  let s3Service: { getBuffer: jest.Mock; uploadPrivate: jest.Mock };

  function buildUlbFindMock(ulbs: unknown[]) {
    return jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(ulbs) }),
      }),
    });
  }

  beforeEach(async () => {
    rowModel = {
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
      }),
      bulkWrite: jest.fn().mockResolvedValue({}),
    };

    formModel = {
      findOne: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      }),
      create: jest.fn().mockResolvedValue({}),
      findByIdAndUpdate: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({}) }),
      }),
    };

    // Default: 1 registry ULB (DBCODE1).
    ulbModel = { find: buildUlbFindMock([DB_ULB_1]) };

    s3Service = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
      uploadPrivate: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesExcelService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: S3Service, useValue: s3Service },
        { provide: ExcelService, useValue: { generateExcel: jest.fn().mockResolvedValue(new ArrayBuffer(8)) } },
        { provide: FileTokenService, useValue: { parseToken: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesExcelService);
  });

  // ─── Clean upload (DB_ULB path) ───────────────────────────────────────────

  describe('clean upload — all rows match registry and count equals', () => {
    it('returns 200 with VALID status when all rows match active registry and count matches', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const result = await service.validateExcel(makeDto(), adminUser);
      const data = result.data as EulbValidateExcelResponseData;

      expect(data.validationStatus).toBe('VALID');
      expect(data.errors).toHaveLength(0);
    });

    it('stores DB_ULB row with VALID validationStatus', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ validationStatus: 'VALID', rowType: 'DB_ULB' });
    });

    it('ignores client-submitted ulbCount and derives count from active registry', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      // Passing a tampered ulbCount — service should ignore it and use registry count (1).
      const dto = { ...makeDto(), ulbCount: 999 };
      const result = await service.validateExcel(dto, adminUser);
      const data = result.data as EulbValidateExcelResponseData;

      expect(data.summary?.dbUlbCount).toBe(1);
      expect(data.validationStatus).toBe('VALID');
    });

    it('accepts electedBodyExcelFile.pageCount: null and persists it on the form', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const dto = makeDto();
      dto.electedBodyExcelFile.pageCount = null;
      await service.validateExcel(dto, adminUser);

      // New form path (findOne → null): form is created with the normalized file metadata
      const createArg = (formModel.create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect((createArg['electedBodyExcelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
    });
  });

  // ─── Count mismatch (DB_ULB row, fewer rows than registry) ───────────────

  describe('count mismatch — Excel has fewer rows than active registry', () => {
    it('returns 200 with INVALID status when excelRowCount < activeUlbCount', async () => {
      // Registry: DB_ULB_1 and DB_ULB_2; Excel only has DB_ULB_1.
      ulbModel.find = buildUlbFindMock([DB_ULB_1, DB_ULB_2]);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const result = await service.validateExcel(makeDto(), adminUser);
      const data = result.data as EulbValidateExcelResponseData;

      expect(data.validationStatus).toBe('INVALID');
    });

    it('records missingDbUlbCount for DB ULBs absent from the Excel', async () => {
      ulbModel.find = buildUlbFindMock([DB_ULB_1, DB_ULB_2]);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const result = await service.validateExcel(makeDto(), adminUser);
      const data = result.data as EulbValidateExcelResponseData;

      expect(data.summary?.missingDbUlbCount).toBe(1);
    });
  });

  // ─── EXTRA_ULB rows — unknownUlb error + newUlbsAdded 400 ────────────────

  describe('EXTRA_ULB row — census code not in active registry', () => {
    it('throws 400 with electedBodyExcelFile.newUlbsAdded when any row is EXTRA_ULB', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOT_IN_DB',
            ulbName: 'Some New City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      const errors = response.errors as Record<string, Array<{ code: string; field: string }>>;

      expect(errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'newUlbsAdded' })]),
      );
    });

    it('includes unknownUlb error in the data errors for the EXTRA_ULB row', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOT_IN_DB',
            ulbName: 'Some New City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      const dataErrors = (response.data as { errors?: EulbRowValidationError[] } | undefined)?.errors ?? [];

      expect(dataErrors.some((e) => e.field === 'censusCode' && e.code === 'unknownUlb')).toBe(true);
    });

    it('stores EXTRA_ULB row with INVALID validationStatus and unknownUlb in errors', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOT_IN_DB',
            ulbName: 'Some New City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const rowDoc = docs[0];

      expect(rowDoc['validationStatus']).toBe('INVALID');
      expect(rowDoc['rowType']).toBe('EXTRA_ULB');
      expect((rowDoc['errors'] as Array<{ code: string }>).some((e) => e.code === 'unknownUlb')).toBe(true);
    });

    it('generated errorExcelFile metadata has pageCount: null', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOT_IN_DB',
            ulbName: 'Some New City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      const updateCalls = formModel.findByIdAndUpdate.mock.calls as unknown[][];
      const errorFileSet = updateCalls
        .map((c) => (c[1] as Record<string, unknown>)?.['$set'] as Record<string, unknown> | undefined)
        .find((s) => s?.['errorExcelFile'] !== undefined);
      expect(errorFileSet).toBeDefined();
      expect((errorFileSet?.['errorExcelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
    });

    it('insertMany is still called before throwing newUlbsAdded (rows are written to DB)', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOT_IN_DB',
            ulbName: 'Some New City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
    });
  });

  // ─── EXTRA_ULB with blank ulbName ─────────────────────────────────────────

  describe('EXTRA_ULB row with blank ulbName', () => {
    beforeEach(() => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOTIN_DB',
            ulbName: '',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );
    });

    it('throws 400 with newUlbsAdded (EXTRA_ULB rows always block)', async () => {
      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      const errors = response.errors as Record<string, Array<{ code: string }>>;
      expect(errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'newUlbsAdded' })]),
      );
    });

    it('calls insertMany and stores ulbName as empty string', async () => {
      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs, opts] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[], unknown];
      expect(opts).toEqual({ lean: true, ordered: false });
      expect(docs[0]).toMatchObject({ ulbName: '', validationStatus: 'INVALID' });
    });

    it('includes unknownUlb and ulbName required errors in exception data', async () => {
      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      const dataErrors = (response.data as { errors?: EulbRowValidationError[] } | undefined)?.errors ?? [];

      expect(dataErrors.some((e) => e.field === 'censusCode' && e.code === 'unknownUlb')).toBe(true);
      expect(dataErrors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
    });
  });

  // ─── EXTRA_ULB with blank censusCode AND blank ulbName ───────────────────

  describe('EXTRA_ULB row with blank censusCode and blank ulbName', () => {
    beforeEach(() => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: '',
            ulbName: '',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );
    });

    it('throws 400 with newUlbsAdded', async () => {
      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      const errors = response.errors as Record<string, Array<{ code: string }>>;
      expect(errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'newUlbsAdded' })]),
      );
    });

    it('includes required errors for both censusCode and ulbName in exception data', async () => {
      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      const dataErrors = (response.data as { errors?: EulbRowValidationError[] } | undefined)?.errors ?? [];

      expect(dataErrors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
      expect(dataErrors.some((e) => e.field === 'censusCode' && e.code === 'required')).toBe(true);
    });

    it("persists inserted document with censusCode: '' and ulbName: ''", async () => {
      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ censusCode: '', ulbName: '' });
    });
  });

  // ─── date normalization: UTC midnight (DB_ULB path) ──────────────────────
  //
  // Using DBCODE1 (DB_ULB) to avoid the EXTRA_ULB newUlbsAdded throw.
  // With cellDates:false (xlsx default), date cells are raw serial integers.
  // excelSerialToUtcDate() converts directly to UTC midnight — no timezone shift.

  describe('Constituted DB_ULB row — date cells stored as UTC midnight', () => {
    const DOC_SERIAL = calendarDateToSerial(2022, 6, 24); // June 24, 2022 (past, in range)
    const DOE_SERIAL = calendarDateToSerial(2028, 6, 24); // June 24, 2028 (future, in range)

    beforeEach(() => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Constituted',
            dateOfConstitution: DOC_SERIAL,
            dateOfExpiry: DOE_SERIAL,
            remarks: '',
          },
        ]),
      );
    });

    it('stores dateOfConstitution as UTC midnight with no time drift', async () => {
      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const stored = docs[0]['dateOfConstitution'] as Date;
      expect(stored).toBeInstanceOf(Date);
      expect(stored.getUTCHours()).toBe(0);
      expect(stored.getUTCMinutes()).toBe(0);
      expect(stored.getUTCSeconds()).toBe(0);
      expect(stored.toISOString()).toBe('2022-06-24T00:00:00.000Z');
    });

    it('stores dateOfExpiry as UTC midnight with no time drift', async () => {
      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const stored = docs[0]['dateOfExpiry'] as Date;
      expect(stored).toBeInstanceOf(Date);
      expect(stored.toISOString()).toBe('2028-06-24T00:00:00.000Z');
    });

    it('row is VALID when dates are in range and electedBodyStatus is Constituted', async () => {
      const result = await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]['validationStatus']).toBe('VALID');
      const errors = (result.data as EulbValidateExcelResponseData).errors;
      expect(errors.some((e) => e.field === 'dateOfConstitution')).toBe(false);
      expect(errors.some((e) => e.field === 'dateOfExpiry')).toBe(false);
    });

    it('dateOfConstitution before 2021-05-31 produces minDate error; still stored as UTC midnight', async () => {
      const tooEarlySerial = calendarDateToSerial(2020, 1, 1);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Constituted',
            dateOfConstitution: tooEarlySerial,
            dateOfExpiry: DOE_SERIAL,
            remarks: '',
          },
        ]),
      );

      // Row has a date error (minDate) but no EXTRA_ULB → no newUlbsAdded → returns 200.
      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const stored = docs[0]['dateOfConstitution'] as Date;
      expect(stored.toISOString()).toBe('2020-01-01T00:00:00.000Z');
      expect(docs[0]['validationStatus']).toBe('INVALID');
    });

    it('regression: Excel "24-Jun-26" serial stores as 2026-06-24T00:00:00.000Z not the previous day', async () => {
      // IST timezone bug: without UTC fix, Excel Jun 24 2026 serial → 2026-06-23T18:29:59.999Z
      // → local getters return Jun 23. The fix uses raw serial with no timezone arithmetic.
      const jun24_2026_serial = calendarDateToSerial(2026, 6, 24);
      const futureExpiry = calendarDateToSerial(2028, 6, 24);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Constituted',
            dateOfConstitution: jun24_2026_serial,
            dateOfExpiry: futureExpiry,
            remarks: '',
          },
        ]),
      );

      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const stored = docs[0]['dateOfConstitution'] as Date;
      expect(stored.toISOString()).toBe('2026-06-24T00:00:00.000Z');
    });
  });

  // ─── intra-batch duplicate census code ───────────────────────────────────

  describe('intra-batch duplicate EULB census code', () => {
    it('marks the second DB ULB census-code occurrence invalid and clears ulbId before insert', async () => {
      ulbModel.find = buildUlbFindMock([DB_ULB_1, DB_ULB_2]);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      // 2 DB ULBs, 2 rows, excelRowCount (2) === activeUlbCount (2), no extra rows → INVALID due to dup.
      const result = await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ censusCode: 'DBCODE1', validationStatus: 'VALID', rowType: 'DB_ULB' });
      expect(docs[1]).toMatchObject({ censusCode: '', validationStatus: 'INVALID', rowType: 'DB_ULB' });
      expect(docs[1]['ulbId']).toBeUndefined();

      const errors = (result.data as EulbValidateExcelResponseData).errors;
      const dupError = errors.find((e) => e.field === 'censusCode' && e.code === 'duplicate');
      expect(dupError).toBeDefined();
      expect(dupError!.rowNumber).toBe(2);
    });

    it('marks both EXTRA_ULB duplicate rows INVALID, second gets duplicate error additionally', async () => {
      // DUP001 is not in registry → EXTRA_ULB rows → newUlbsAdded thrown
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DUP001',
            ulbName: 'Extra City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
          {
            censusCode: 'DUP001',
            ulbName: 'Extra City Two',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      // First row: EXTRA_ULB → unknownUlb → INVALID
      expect(docs[0]).toMatchObject({ validationStatus: 'INVALID', rowType: 'EXTRA_ULB' });
      expect((docs[0]['errors'] as Array<{ code: string }>).some((e) => e.code === 'unknownUlb')).toBe(true);
      // Second row: EXTRA_ULB + duplicate → censusCode cleared
      expect(docs[1]).toMatchObject({ censusCode: '', validationStatus: 'INVALID', rowType: 'EXTRA_ULB' });
      expect((docs[1]['errors'] as Array<{ code: string }>).some((e) => e.code === 'duplicate')).toBe(true);
    });

    it('leaves two DB_ULB rows with different census codes both VALID', async () => {
      ulbModel.find = buildUlbFindMock([DB_ULB_1, DB_ULB_2]);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
          {
            censusCode: 'DBCODE2',
            ulbName: 'DB City Two',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ censusCode: 'DBCODE1', validationStatus: 'VALID', rowType: 'DB_ULB' });
      expect(docs[1]).toMatchObject({ censusCode: 'DBCODE2', validationStatus: 'VALID', rowType: 'DB_ULB' });
    });
  });

  // ─── existing dataset replacement ─────────────────────────────────────────

  describe('existing dataset replacement', () => {
    it('deactivates previous active rows before inserting the new active dataset', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ _id: formOid, activeDatasetVersion: 3, currentFormStatus: 1 }) }),
      });
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City One',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await service.validateExcel(makeDto(), adminUser);

      expect(rowModel.updateMany).toHaveBeenCalledWith(
        { form: formOid, datasetVersion: 3 },
        { $set: { isActive: false } },
      );
      expect(rowModel.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        rowModel.insertMany.mock.invocationCallOrder[0],
      );
    });
  });
});

// ─── revalidateExcel ─────────────────────────────────────────────────────────

describe('ElectedUrbanLocalBodiesExcelService — revalidateExcel', () => {
  let service: ElectedUrbanLocalBodiesExcelService;
  let rowModel: {
    find: jest.Mock;
    bulkWrite: jest.Mock;
    insertMany: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
  };
  let formModel: { findOne: jest.Mock; findByIdAndUpdate: jest.Mock; create: jest.Mock };
  let ulbModel: { find: jest.Mock };
  let s3Service: { getBuffer: jest.Mock; uploadPrivate: jest.Mock };

  function buildUlbFindMock(ulbs: unknown[]) {
    return jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(ulbs) }),
      }),
    });
  }

  function buildRowFindMock(rows: unknown[]) {
    return jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(rows) }),
      }),
    });
  }

  beforeEach(async () => {
    rowModel = {
      find: buildRowFindMock([]),
      bulkWrite: jest.fn().mockResolvedValue({}),
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
    };

    formModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
      findByIdAndUpdate: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({}) }) }),
      create: jest.fn().mockResolvedValue({}),
    };

    ulbModel = { find: buildUlbFindMock([DB_ULB_1]) };

    s3Service = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
      uploadPrivate: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesExcelService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: S3Service, useValue: s3Service },
        { provide: ExcelService, useValue: { generateExcel: jest.fn().mockResolvedValue(new ArrayBuffer(8)) } },
        { provide: FileTokenService, useValue: { parseToken: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesExcelService);
  });

  const baseFormDoc = {
    _id: formOid,
    currentFormStatus: 1, // IN_PROGRESS
    activeDatasetVersion: 1,
    electedBodyExcelFile: { fileUrl: 'state/test.xlsx', fileName: 'test.xlsx' },
  };

  // ─── Case A: active rows exist — in-place revalidation ───────────────────

  describe('Case A — in-place revalidation of existing rows', () => {
    it('returns 200 VALID when all stored rows are DB_ULB and fully match active registry', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      rowModel.find = buildRowFindMock([
        {
          _id: new Types.ObjectId(),
          rowNumber: 1,
          censusCode: 'DBCODE1',
          ulbName: 'DB City One',
          electedBodyStatus: 'Not Constituted',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          rowType: 'DB_ULB',
          ulbId: DB_ULB_1._id,
          isActive: true,
        },
      ]);

      const result = await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as EulbRevalidateExcelResponseData;

      expect(data.validationSummary?.validationStatus).toBe('VALID');
      expect(data.errors).toHaveLength(0);
    });

    it('throws 400 with newUlbsAdded when stored rows contain EXTRA_ULB entries', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      rowModel.find = buildRowFindMock([
        {
          _id: new Types.ObjectId(),
          rowNumber: 1,
          censusCode: 'DBCODE1',
          ulbName: 'DB City One',
          electedBodyStatus: 'Not Constituted',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          rowType: 'DB_ULB',
          ulbId: DB_ULB_1._id,
          isActive: true,
        },
        {
          _id: new Types.ObjectId(),
          rowNumber: 2,
          censusCode: 'EXTRA01',
          ulbName: 'Extra ULB',
          electedBodyStatus: 'Exempt',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          rowType: 'EXTRA_ULB',
          ulbId: undefined,
          isActive: true,
        },
      ]);

      const { response } = await catchBadRequest(() =>
        service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser),
      );

      const errors = response.errors as Record<string, Array<{ code: string }>>;
      expect(errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'newUlbsAdded' })]),
      );
    });

    it('includes unknownUlb error in revalidation data for each EXTRA_ULB row', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      rowModel.find = buildRowFindMock([
        {
          _id: new Types.ObjectId(),
          rowNumber: 1,
          censusCode: 'EXTRA01',
          ulbName: 'Extra ULB',
          electedBodyStatus: 'Exempt',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          rowType: 'EXTRA_ULB',
          ulbId: undefined,
          isActive: true,
        },
      ]);

      const { response } = await catchBadRequest(() =>
        service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser),
      );

      const dataErrors = (response.data as { errors?: EulbRowValidationError[] } | undefined)?.errors ?? [];
      expect(dataErrors.some((e) => e.field === 'censusCode' && e.code === 'unknownUlb')).toBe(true);
    });

    it('still calls bulkWrite to persist updated row errors before throwing newUlbsAdded', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      rowModel.find = buildRowFindMock([
        {
          _id: new Types.ObjectId(),
          rowNumber: 1,
          censusCode: 'EXTRA01',
          ulbName: 'Extra ULB',
          electedBodyStatus: 'Exempt',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          rowType: 'EXTRA_ULB',
          ulbId: undefined,
          isActive: true,
        },
      ]);

      await catchBadRequest(() => service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser));

      expect(rowModel.bulkWrite).toHaveBeenCalledTimes(1);
    });

    it('returns INVALID when a DB_ULB row has row-level validation errors', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      rowModel.find = buildRowFindMock([
        {
          _id: new Types.ObjectId(),
          rowNumber: 1,
          censusCode: 'DBCODE1',
          ulbName: 'DB City One',
          // Constituted but missing dates → validation error
          electedBodyStatus: 'Constituted',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          rowType: 'DB_ULB',
          ulbId: DB_ULB_1._id,
          isActive: true,
        },
      ]);

      const result = await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as EulbRevalidateExcelResponseData;

      expect(data.validationSummary?.validationStatus).toBe('INVALID');
      expect(data.errors.length).toBeGreaterThan(0);
    });
  });
});
