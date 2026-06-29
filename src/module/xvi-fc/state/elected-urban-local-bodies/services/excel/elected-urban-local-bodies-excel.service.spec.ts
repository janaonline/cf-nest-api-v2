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
import type { EulbValidateExcelResponseData } from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXCEL_HEADERS = ['censusCode', 'ulbName', 'electedBodyStatus', 'dateOfConstitution', 'dateOfExpiry', 'remarks'];

/**
 * Convert a calendar date to an Excel serial integer (timezone-independent).
 * Used to pass integer serials into XLSX cells so read-back (cellDates:false) returns
 * exact integer serials rather than timezone-shifted floats.
 */
function calendarDateToSerial(year: number, month: number, day: number): number {
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  return (Date.UTC(year, month - 1, day) - EXCEL_EPOCH_MS) / 86400000;
}

/** Build a real xlsx buffer from an array of row objects (uses camelCase header keys). */
function makeXlsxBuffer(dataRows: Record<string, unknown>[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, ...dataRows.map((r) => EXCEL_HEADERS.map((h) => r[h] ?? ''))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
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

/** One DB ULB present in state so maxAllowedExcelRows >= 1. Its censusCode will NOT match test rows. */
const DB_ULB = { _id: new Types.ObjectId(), name: 'DB City', censusCode: 'DBCODE1' };

function makeDto(ulbCount = 1): ValidateElectedUrbanLocalBodiesExcelDto {
  return {
    stateId: stateOid.toString(),
    yearId: yearOid.toString(),
    ulbCount,
    electedBodyExcelFile: {
      fileName: 'test.xlsx',
      fileUrl: 'state/test.xlsx',
      fileSize: 1024,
    },
  } as ValidateElectedUrbanLocalBodiesExcelDto;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ElectedUrbanLocalBodiesExcelService — validateExcel blank-field normalization', () => {
  let service: ElectedUrbanLocalBodiesExcelService;
  let rowModel: { insertMany: jest.Mock; deleteMany: jest.Mock; updateMany: jest.Mock };
  let formModel: { findOne: jest.Mock; create: jest.Mock; findByIdAndUpdate: jest.Mock };
  let s3Service: { getBuffer: jest.Mock; uploadPublic: jest.Mock };

  beforeEach(async () => {
    rowModel = {
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
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

    const ulbModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve([DB_ULB]) }) }),
      }),
    };

    s3Service = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
      uploadPublic: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesExcelService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: S3Service, useValue: s3Service },
        {
          provide: ExcelService,
          useValue: { generateExcel: jest.fn().mockResolvedValue(new ArrayBuffer(8)) },
        },
        { provide: FileTokenService, useValue: { parseToken: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesExcelService);
  });

  // ─── blank ulbName ────────────────────────────────────────────────────────

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

    it('resolves without throwing (no 500)', async () => {
      await expect(service.validateExcel(makeDto(), adminUser)).resolves.toMatchObject({ success: true });
    });

    it('calls insertMany with { lean: true } and stores ulbName as empty string', async () => {
      await service.validateExcel(makeDto(), adminUser);

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs, opts] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[], unknown];
      expect(opts).toEqual({ lean: true, ordered: false });
      expect(docs[0]).toMatchObject({ ulbName: '', validationStatus: 'INVALID' });
    });

    it('includes ulbName required error in the response errors array', async () => {
      const result = await service.validateExcel(makeDto(), adminUser);
      const errors = (result.data as EulbValidateExcelResponseData).errors;
      expect(errors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
    });
  });

  // ─── blank censusCode AND blank ulbName ───────────────────────────────────

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

    it('resolves without throwing (no 500)', async () => {
      await expect(service.validateExcel(makeDto(), adminUser)).resolves.toMatchObject({ success: true });
    });

    it('includes required errors for both censusCode and ulbName in the response', async () => {
      const result = await service.validateExcel(makeDto(), adminUser);
      const errors = (result.data as EulbValidateExcelResponseData).errors;
      expect(errors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
      expect(errors.some((e) => e.field === 'censusCode' && e.code === 'required')).toBe(true);
    });

    it("persists inserted document with censusCode: '' and ulbName: ''", async () => {
      await service.validateExcel(makeDto(), adminUser);
      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ censusCode: '', ulbName: '' });
    });
  });

  // ─── valid EXTRA_ULB row (regression guard) ───────────────────────────────

  describe('EXTRA_ULB row with valid censusCode and ulbName', () => {
    it('resolves with no row-level errors in the response', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'VALID01',
            ulbName: 'Some City Council',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const result = await service.validateExcel(makeDto(), adminUser);
      const errors = (result.data as EulbValidateExcelResponseData).errors;
      expect(errors).toHaveLength(0);
      expect(rowModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ validationStatus: 'VALID' })]),
        { lean: true, ordered: false },
      );
    });
  });

  // ─── date normalization: UTC midnight (timezone bug fix) ──────────────────
  //
  // With cellDates:false (the default), xlsx returns date-formatted cells as raw
  // Excel serial integers. excelSerialToUtcDate() converts the integer directly to
  // UTC midnight without any timezone arithmetic, so the stored value is always
  // 2026-06-24T00:00:00.000Z regardless of server timezone.
  //
  // We pass integer serials (via calendarDateToSerial) into the test buffer so that
  // the write→read round-trip returns exact integer serials rather than floats.

  describe('Constituted row — date cells stored as UTC midnight', () => {
    // Use dates well outside boundary to avoid test time-dependency:
    //   dateOfConstitution: 2022-06-24 (past, >= 2021-05-31 min)
    //   dateOfExpiry:       2028-06-24 (future, <= 2030-03-31 max)
    const DOC_SERIAL = calendarDateToSerial(2022, 6, 24); // June 24, 2022
    const DOE_SERIAL = calendarDateToSerial(2028, 6, 24); // June 24, 2028

    beforeEach(() => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOTIN_DB',
            ulbName: 'Test City',
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
      expect(stored.getUTCMilliseconds()).toBe(0);
      expect(stored.toISOString()).toBe('2022-06-24T00:00:00.000Z');
    });

    it('stores dateOfExpiry as UTC midnight with no time drift', async () => {
      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const stored = docs[0]['dateOfExpiry'] as Date;
      expect(stored).toBeInstanceOf(Date);
      expect(stored.getUTCHours()).toBe(0);
      expect(stored.getUTCMinutes()).toBe(0);
      expect(stored.getUTCSeconds()).toBe(0);
      expect(stored.getUTCMilliseconds()).toBe(0);
      expect(stored.toISOString()).toBe('2028-06-24T00:00:00.000Z');
    });

    it('row is VALID and date validation min/max rules are still enforced', async () => {
      const result = await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]['validationStatus']).toBe('VALID');
      const errors = (result.data as EulbValidateExcelResponseData).errors;
      expect(errors.some((e) => e.field === 'dateOfConstitution')).toBe(false);
      expect(errors.some((e) => e.field === 'dateOfExpiry')).toBe(false);
    });

    it('dateOfConstitution before 2021-05-31 produces minDate error and stores as UTC midnight', async () => {
      // A date before the minimum should still be normalised to UTC midnight and flagged.
      const tooEarlySerial = calendarDateToSerial(2020, 1, 1); // Jan 1, 2020 — before 2021-05-31 min
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOTIN_DB',
            ulbName: 'Test City',
            electedBodyStatus: 'Constituted',
            dateOfConstitution: tooEarlySerial,
            dateOfExpiry: DOE_SERIAL,
            remarks: '',
          },
        ]),
      );

      await service.validateExcel(makeDto(), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      const stored = docs[0]['dateOfConstitution'] as Date;
      expect(stored.toISOString()).toBe('2020-01-01T00:00:00.000Z');
      expect(docs[0]['validationStatus']).toBe('INVALID');
    });

    it('regression: Excel "24-Jun-26" serial stores as 2026-06-24T00:00:00.000Z not the previous day', async () => {
      // This is the exact bug: IST server converts Excel June 24 2026 → 2026-06-23T18:29:59.999Z,
      // then local getters return June 23. The fix uses the raw serial → no timezone shift.
      const jun24_2026_serial = calendarDateToSerial(2026, 6, 24);
      const futureExpiry = calendarDateToSerial(2028, 6, 24);
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'NOTIN_DB',
            ulbName: 'Test City',
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

  // ─── intra-batch EXTRA_ULB census code duplicate detection ───────────────

  describe('intra-batch duplicate EULB census code', () => {
    it('marks the second occurrence as INVALID with a duplicate error and stores censusCode as empty string', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DUP001',
            ulbName: 'First City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
          {
            censusCode: 'DUP001',
            ulbName: 'Second City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      const dto = { ...makeDto(), ulbCount: 2 };
      const result = await service.validateExcel(dto, adminUser);

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];

      // First occurrence is unaffected.
      expect(docs[0]).toMatchObject({ censusCode: 'DUP001', validationStatus: 'VALID' });
      // Second occurrence: censusCode cleared to '' so the unique index is not violated.
      expect(docs[1]).toMatchObject({ censusCode: '', validationStatus: 'INVALID' });

      // The duplicate error appears in the response errors list.
      const errors = (result.data as EulbValidateExcelResponseData).errors;
      const dupError = errors.find((e) => e.field === 'censusCode' && e.code === 'duplicate');
      expect(dupError).toBeDefined();
      expect(dupError!.rowNumber).toBe(2);
    });

    it('leaves two rows with different census codes both VALID', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'UNIQ_A',
            ulbName: 'City A',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
          {
            censusCode: 'UNIQ_B',
            ulbName: 'City B',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await service.validateExcel(makeDto(2), adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ censusCode: 'UNIQ_A', validationStatus: 'VALID' });
      expect(docs[1]).toMatchObject({ censusCode: 'UNIQ_B', validationStatus: 'VALID' });
    });

    it('marks the second DB ULB census-code occurrence invalid and clears ulbId before insert', async () => {
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
          {
            censusCode: 'DBCODE1',
            ulbName: 'DB City',
            electedBodyStatus: 'Not Constituted',
            dateOfConstitution: '',
            dateOfExpiry: '',
            remarks: '',
          },
        ]),
      );

      await service.validateExcel({ ...makeDto(), ulbCount: 2 }, adminUser);

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs[0]).toMatchObject({ censusCode: 'DBCODE1', validationStatus: 'VALID', rowType: 'DB_ULB' });
      expect(docs[1]).toMatchObject({ censusCode: '', validationStatus: 'INVALID', rowType: 'DB_ULB' });
      expect(docs[1]['ulbId']).toBeUndefined();
    });
  });

  describe('existing dataset replacement', () => {
    it('deactivates previous active rows before inserting the new active dataset', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ _id: formOid, activeDatasetVersion: 3 }) }),
      });
      s3Service.getBuffer = jest.fn().mockResolvedValue(
        makeXlsxBuffer([
          {
            censusCode: 'UNIQ_EXISTING_REUPLOAD',
            ulbName: 'Reloaded City',
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
