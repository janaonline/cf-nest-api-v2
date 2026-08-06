import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { MongoServerError } from 'mongodb';
import { Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { ElectedUrbanLocalBodiesExcelService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/excel/elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { S3Service } from 'src/core/s3/s3.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { ValidateElectedUrbanLocalBodiesExcelDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/validate-elected-urban-local-bodies-excel.dto';
import type {
  EulbRevalidateExcelResponseData,
  EulbRowValidationError,
  EulbValidateExcelResponseData,
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

/** Fresh transaction session mock — each describe block gets its own via a new beforeEach call. */
function buildMockSession() {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
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
    key: 'electedBodyExcelFile',
    label: 'Upload elected bodies list',
    formFieldType: 'file',
    fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
    allowedFileTypes: ['xlsx', 'xls'],
    maxFileSize: 20,
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
  },
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
      originalName: 'test.xlsx',
      path: 'state/test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeKb: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
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
  let formModel: {
    findOne: jest.Mock;
    create: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findOneAndUpdate: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let ulbModel: { find: jest.Mock };
  let s3Service: { getBuffer: jest.Mock; uploadPrivate: jest.Mock };
  let mockSession: ReturnType<typeof buildMockSession>;

  function buildUlbFindMock(ulbs: unknown[]) {
    return jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(ulbs) }),
      }),
    });
  }

  /** Builds the `findOneAndUpdate` upsert result for the atomic version-allocation call. */
  function mockUpsertedForm(activeDatasetVersion: number) {
    return { exec: jest.fn().mockResolvedValue({ _id: formOid, activeDatasetVersion }) };
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

    mockSession = buildMockSession();

    formModel = {
      findOne: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      }),
      create: jest.fn().mockResolvedValue({}),
      findByIdAndUpdate: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({}) }),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue(mockUpsertedForm(1)),
      db: { startSession: jest.fn().mockResolvedValue(mockSession) },
    };

    // Default: 1 registry ULB (DBCODE1).
    ulbModel = { find: buildUlbFindMock([DB_ULB_1]) };

    s3Service = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
      uploadPrivate: jest.fn().mockResolvedValue(undefined),
    };

    const ulbEligibilityService = {
      getEligibleUlbFilter: jest
        .fn()
        .mockImplementation((stateOid: unknown) => Promise.resolve({ state: stateOid, isActive: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesExcelService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: UlbEligibilityService, useValue: ulbEligibilityService },
        { provide: S3Service, useValue: s3Service },
        { provide: ExcelService, useValue: { generateExcel: jest.fn().mockResolvedValue(new ArrayBuffer(8)) } },
        {
          provide: FileTokenService,
          useValue: { parseToken: jest.fn(), signFileUrl: jest.fn((p: string) => `signed::${p}`) },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        FileInfoNormalizerService,
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

      // No unmatched/duplicate rows in this upload — the snapshot is empty, and would overwrite
      // (not append to) any stale snapshot left over from a prior, messier upload.
      const [, update] = formModel.findOneAndUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
      expect((update['$set'] as Record<string, unknown>)['excludedRows']).toEqual([]);
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
      expect(docs[0]).toMatchObject({ validationStatus: 'VALID' });
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

      // New form path (findOne → null): atomic version-alloc call carries the normalized file metadata
      const updateArg = (formModel.findOneAndUpdate.mock.calls as unknown[][])[0][1] as {
        $set: Record<string, unknown>;
      };
      expect((updateArg.$set['electedBodyExcelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
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

    it('never persists an unmatched row — insertMany is called with zero docs', async () => {
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

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs).toHaveLength(0);

      // The row is still fully reported — just never written as a row.
      const dataErrors = (response.data as { errors?: EulbRowValidationError[] } | undefined)?.errors ?? [];
      expect(dataErrors.some((e) => e.field === 'censusCode' && e.code === 'unknownUlb')).toBe(true);
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

    it('insertMany is still called (with zero rows) before throwing newUlbsAdded', async () => {
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
      expect(docs).toHaveLength(0);
    });

    it('stores the unmatched row in the excludedRows snapshot so getErrorSheet can still surface it', async () => {
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

      const [, update] = formModel.findOneAndUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
      const excludedRows = (update['$set'] as Record<string, unknown>)['excludedRows'] as Array<{
        censusCode?: string;
        ulbName: string;
        errors: Array<{ code: string }>;
      }>;

      expect(excludedRows).toHaveLength(1);
      expect(excludedRows[0].censusCode).toBe('NOT_IN_DB');
      expect(excludedRows[0].ulbName).toBe('Some New City');
      expect(excludedRows[0].errors.some((e) => e.code === 'unknownUlb')).toBe(true);
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

    it('calls insertMany with zero docs — the unmatched row is never persisted', async () => {
      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs, opts] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[], unknown];
      expect(opts).toMatchObject({ lean: true, ordered: false });
      expect(docs).toHaveLength(0);
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

    it('never persists the blank-identity unmatched row', async () => {
      await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs).toHaveLength(0);
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

      // Only the first (matched, non-duplicate) occurrence is persisted — the second occurrence's
      // ulbId was nulled by the duplicate check, so it's excluded the same way an unmatched row is.
      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ censusCode: 'DBCODE1', validationStatus: 'VALID' });

      const errors = (result.data as EulbValidateExcelResponseData).errors;
      const dupError = errors.find((e) => e.field === 'censusCode' && e.code === 'duplicate');
      expect(dupError).toBeDefined();
      expect(dupError!.rowNumber).toBe(2);

      // The dropped duplicate occurrence is snapshotted so getErrorSheet can still surface it,
      // even though it's a soft 200 response (not the newUlbsAdded hard-throw path).
      const [, update] = formModel.findOneAndUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
      const excludedRows = (update['$set'] as Record<string, unknown>)['excludedRows'] as Array<{
        rowNumber: number;
        censusCode?: string;
        errors: Array<{ code: string }>;
      }>;
      expect(excludedRows).toHaveLength(1);
      expect(excludedRows[0].rowNumber).toBe(2);
      expect(excludedRows[0].errors.some((e) => e.code === 'duplicate')).toBe(true);
    });

    it('marks both unmatched duplicate rows INVALID and reports both, but persists neither', async () => {
      // DUP001 is not in registry → both rows are unmatched → newUlbsAdded thrown
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

      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));

      // Neither row has a resolved ulbId (both unmatched; the second is additionally a duplicate),
      // so neither gets persisted.
      const [docs] = rowModel.insertMany.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs).toHaveLength(0);

      const dataErrors = (response.data as { errors?: EulbRowValidationError[] } | undefined)?.errors ?? [];
      // First row: unmatched → unknownUlb
      expect(dataErrors.some((e) => e.rowNumber === 1 && e.code === 'unknownUlb')).toBe(true);
      // Second row: unmatched AND duplicate → both errors
      expect(dataErrors.some((e) => e.rowNumber === 2 && e.code === 'unknownUlb')).toBe(true);
      expect(dataErrors.some((e) => e.rowNumber === 2 && e.code === 'duplicate')).toBe(true);
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
      expect(docs[0]).toMatchObject({ censusCode: 'DBCODE1', validationStatus: 'VALID' });
      expect(docs[1]).toMatchObject({ censusCode: 'DBCODE2', validationStatus: 'VALID' });
    });
  });

  // ─── existing dataset replacement ─────────────────────────────────────────

  describe('existing dataset replacement', () => {
    it('deactivates previous active rows before inserting the new active dataset', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ _id: formOid, activeDatasetVersion: 3, currentFormStatus: 1 }) }),
      });
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(4));
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
        { session: mockSession },
      );
      expect(rowModel.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        rowModel.insertMany.mock.invocationCallOrder[0],
      );
    });

    it('deletes old-version rows inside the transaction, before commit, on a successful replacement', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ _id: formOid, activeDatasetVersion: 3, currentFormStatus: 1 }) }),
      });
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(4));
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

      expect(rowModel.deleteMany).toHaveBeenCalledWith({ form: formOid, datasetVersion: 3 }, { session: mockSession });
      const deleteOrder = rowModel.deleteMany.mock.invocationCallOrder[0];
      const commitOrder = mockSession.commitTransaction.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(commitOrder);
    });

    it('aborts the transaction (no manual reactivation) when insertMany fails on an existing form', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ _id: formOid, activeDatasetVersion: 3, currentFormStatus: 1 }) }),
      });
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(4));
      rowModel.insertMany = jest.fn().mockRejectedValue(new Error('insertMany failed'));
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

      await expect(service.validateExcel(makeDto(), adminUser)).rejects.toThrow();

      // Deactivation must have been attempted inside the transaction.
      expect(rowModel.updateMany).toHaveBeenCalled();
      // Transaction abort replaces the old manual rollback — no reactivation/delete calls follow.
      const reactivateCalls = (rowModel.updateMany.mock.calls as unknown[][]).filter(
        (c) => ((c[1] as Record<string, unknown>)?.['$set'] as Record<string, unknown>)?.['isActive'] === true,
      );
      expect(reactivateCalls.length).toBe(0);
      expect(rowModel.deleteMany).not.toHaveBeenCalled();

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('aborts the transaction (no orphan cleanup needed) when insertMany fails on a brand-new form', async () => {
      // formModel.findOne default (from beforeEach) already returns null — brand-new form.
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(1));
      rowModel.insertMany = jest.fn().mockRejectedValue(new Error('insertMany failed'));
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

      await expect(service.validateExcel(makeDto(), adminUser)).rejects.toThrow();

      expect(rowModel.updateMany).not.toHaveBeenCalled();
      expect(rowModel.deleteMany).not.toHaveBeenCalled();
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });

    it('surfaces a row-level duplicate-key conflict with the existing "Duplicate census code" message', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(1));
      rowModel.insertMany = jest.fn().mockRejectedValue(
        new MongoServerError({
          message: 'E11000 duplicate key error',
          code: 11000,
          keyValue: { year: yearOid, censusCode: 'DBCODE1' },
        }),
      );
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

      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      expect(response.errors?.['censusCode']).toEqual([
        expect.objectContaining({
          code: 'duplicate',
          message: 'A ULB with this census code already exists for the selected design year.',
        }),
      ]);
    });

    it('surfaces a form-level duplicate-key conflict (two requests racing to create the same form) with an honest refresh message', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue(
          new MongoServerError({
            message: 'E11000 duplicate key error',
            code: 11000,
            keyValue: { state: stateOid, year: yearOid, formType: 'ELECTED_URBAN_LOCAL_BODIES' },
          }),
        ),
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

      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      expect(response.errors?.['electedBodyExcelFile']).toEqual([
        expect.objectContaining({
          code: 'conflict',
          message: 'This form was just updated by another request. Please refresh and try again.',
        }),
      ]);
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it('surfaces a transaction write-conflict (TransientTransactionError) with the same honest refresh message', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(1));
      rowModel.insertMany = jest
        .fn()
        .mockRejectedValue(
          new MongoServerError({ message: 'WriteConflict', code: 112, errorLabels: ['TransientTransactionError'] }),
        );
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

      const { response } = await catchBadRequest(() => service.validateExcel(makeDto(), adminUser));
      expect(response.errors?.['electedBodyExcelFile']).toEqual([
        expect.objectContaining({
          code: 'conflict',
          message: 'This form was just updated by another request. Please refresh and try again.',
        }),
      ]);
    });

    it('hands two concurrent uploads distinct, monotonically increasing dataset versions (simulated real $inc semantics)', async () => {
      // A shared counter stands in for MongoDB's real atomic $inc: every call to the mocked
      // findOneAndUpdate increments it exactly once, so two "concurrent" callers can never
      // observe (or be handed) the same activeDatasetVersion.
      let sharedVersionCounter = 0;
      formModel.findOneAndUpdate = jest.fn().mockImplementation(() => {
        sharedVersionCounter += 1;
        return { exec: jest.fn().mockResolvedValue({ _id: formOid, activeDatasetVersion: sharedVersionCounter }) };
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

      const [first, second] = await Promise.all([
        service.validateExcel(makeDto(), adminUser),
        service.validateExcel(makeDto(), adminUser),
      ]);

      const firstVersion = (first.data as EulbValidateExcelResponseData).summary?.activeDatasetVersion;
      const secondVersion = (second.data as EulbValidateExcelResponseData).summary?.activeDatasetVersion;
      expect(firstVersion).not.toBe(secondVersion);
      expect([firstVersion, secondVersion].sort()).toEqual([1, 2]);
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
  let formModel: {
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    create: jest.Mock;
    findOneAndUpdate: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let ulbModel: { find: jest.Mock };
  let s3Service: { getBuffer: jest.Mock; uploadPrivate: jest.Mock };
  let mockSession: ReturnType<typeof buildMockSession>;

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

  /** Builds the `findOneAndUpdate` result for the atomic version-allocation call. */
  function mockUpsertedForm(activeDatasetVersion: number) {
    return { exec: jest.fn().mockResolvedValue({ _id: formOid, activeDatasetVersion }) };
  }

  beforeEach(async () => {
    rowModel = {
      find: buildRowFindMock([]),
      bulkWrite: jest.fn().mockResolvedValue({}),
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
    };

    mockSession = buildMockSession();

    formModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
      findByIdAndUpdate: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({}) }) }),
      create: jest.fn().mockResolvedValue({}),
      findOneAndUpdate: jest.fn().mockReturnValue(mockUpsertedForm(1)),
      db: { startSession: jest.fn().mockResolvedValue(mockSession) },
    };

    ulbModel = { find: buildUlbFindMock([DB_ULB_1]) };

    s3Service = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
      uploadPrivate: jest.fn().mockResolvedValue(undefined),
    };

    const ulbEligibilityService = {
      getEligibleUlbFilter: jest
        .fn()
        .mockImplementation((stateOid: unknown) => Promise.resolve({ state: stateOid, isActive: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesExcelService,
        ElectedUrbanLocalBodiesValidator,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: UlbEligibilityService, useValue: ulbEligibilityService },
        { provide: S3Service, useValue: s3Service },
        { provide: ExcelService, useValue: { generateExcel: jest.fn().mockResolvedValue(new ArrayBuffer(8)) } },
        {
          provide: FileTokenService,
          useValue: { parseToken: jest.fn(), signFileUrl: jest.fn((p: string) => `signed::${p}`) },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        FileInfoNormalizerService,
        { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesExcelService);
  });

  const baseFormDoc = {
    _id: formOid,
    currentFormStatus: 1, // IN_PROGRESS
    activeDatasetVersion: 1,
    electedBodyExcelFile: {
      originalName: 'test.xlsx',
      path: 'state/test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeKb: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
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
          ulbId: DB_ULB_1._id,
          isActive: true,
        },
      ]);

      const result = await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as EulbRevalidateExcelResponseData;

      expect(data.validationSummary?.validationStatus).toBe('VALID');
      expect(data.errors).toHaveLength(0);
    });

    it('deletes a stored row with no resolved ulbId instead of throwing — no re-parse can discover a new row here', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      const staleRowId = new Types.ObjectId();
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
          ulbId: DB_ULB_1._id,
          isActive: true,
        },
        {
          _id: staleRowId,
          rowNumber: 2,
          censusCode: 'EXTRA01',
          ulbName: 'Extra ULB',
          electedBodyStatus: 'Exempt',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          ulbId: undefined,
          isActive: true,
        },
      ]);

      // Registry (DB_ULB_1) is fully covered by row 1, so deleting the unmatched row 2 leaves
      // missingDbUlbCount at 0 — this succeeds (200), it never throws newUlbsAdded.
      const result = await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as EulbRevalidateExcelResponseData;

      expect(rowModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: [staleRowId] } });
      expect(data.validationSummary?.missingDbUlbCount).toBe(0);
      expect(data.validationSummary?.extraExcelRowCount).toBe(0);
    });

    it('deletes an unmatched row and counts it toward missingDbUlbCount when nothing else covers the registry ULB', async () => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(baseFormDoc) }),
      });
      const staleRowId = new Types.ObjectId();
      rowModel.find = buildRowFindMock([
        {
          _id: staleRowId,
          rowNumber: 1,
          censusCode: 'EXTRA01',
          ulbName: 'Extra ULB',
          electedBodyStatus: 'Exempt',
          dateOfConstitution: null,
          dateOfExpiry: null,
          remarks: '',
          ulbId: undefined,
          isActive: true,
        },
      ]);

      // Registry is [DB_ULB_1] (default ulbModel mock) but the only stored row is unmatched, so
      // it's deleted and DB_ULB_1 has no covering row — missingDbUlbCount becomes 1, INVALID, 200.
      const result = await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as EulbRevalidateExcelResponseData;

      expect(rowModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: [staleRowId] } });
      expect(data.validationSummary?.missingDbUlbCount).toBe(1);
      expect(data.validationSummary?.validationStatus).toBe('INVALID');
    });

    it('calls deleteMany, not bulkWrite, when the only stored row has no resolved ulbId', async () => {
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
          ulbId: undefined,
          isActive: true,
        },
      ]);

      await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);

      expect(rowModel.deleteMany).toHaveBeenCalledTimes(1);
      expect(rowModel.bulkWrite).not.toHaveBeenCalled();
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

  // ─── Case B: no active rows — re-parse from stored Excel (revalidateFromStoredFile) ──

  describe('Case B — no active rows, re-parse from stored Excel', () => {
    const storedFileFormDoc = {
      _id: formOid,
      currentFormStatus: 1,
      activeDatasetVersion: 0,
      electedBodyExcelFile: {
        originalName: 'test.xlsx',
        path: 'state/test.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeKb: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };

    beforeEach(() => {
      formModel.findOne = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(storedFileFormDoc) }),
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
    });

    it('re-parses the stored file and inserts a fresh dataset when there is no prior version', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(1));

      const result = await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as EulbRevalidateExcelResponseData;

      expect(rowModel.insertMany).toHaveBeenCalledTimes(1);
      expect(data.validationSummary?.activeDatasetVersion).toBe(1);
      // No prior version to deactivate/delete.
      expect(rowModel.updateMany).not.toHaveBeenCalled();
      expect(rowModel.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes old-version rows inside the transaction, before commit, when replacing an existing dataset', async () => {
      // The version-allocation $inc returns 3 (i.e. currentVersion=2) regardless of the stale
      // activeDatasetVersion on the initially-read form doc — this path never upserts.
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(3));

      await service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser);

      expect(rowModel.updateMany).toHaveBeenCalledWith(
        { form: formOid, datasetVersion: 2 },
        { $set: { isActive: false } },
        { session: mockSession },
      );
      expect(rowModel.deleteMany).toHaveBeenCalledWith({ form: formOid, datasetVersion: 2 }, { session: mockSession });

      const deleteOrder = rowModel.deleteMany.mock.invocationCallOrder[0];
      const commitOrder = mockSession.commitTransaction.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(commitOrder);
    });

    it('snapshots an unmatched row into excludedRows on the re-parsed dataset', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(1));
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

      await catchBadRequest(() => service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser));

      const [, update] = formModel.findOneAndUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
      const excludedRows = (update['$set'] as Record<string, unknown>)['excludedRows'] as Array<{
        censusCode?: string;
        errors: Array<{ code: string }>;
      }>;
      expect(excludedRows).toHaveLength(1);
      expect(excludedRows[0].censusCode).toBe('NOT_IN_DB');
      expect(excludedRows[0].errors.some((e) => e.code === 'unknownUlb')).toBe(true);
    });

    it('aborts the transaction (no manual reactivation) when insertMany fails', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue(mockUpsertedForm(1));
      rowModel.insertMany = jest.fn().mockRejectedValue(new Error('insertMany failed'));

      await expect(service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow();

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('surfaces a transaction write-conflict (TransientTransactionError) with an honest refresh message', async () => {
      formModel.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockRejectedValue(
            new MongoServerError({ message: 'WriteConflict', code: 112, errorLabels: ['TransientTransactionError'] }),
          ),
      });

      const { response } = await catchBadRequest(() =>
        service.revalidateExcel(stateOid.toString(), yearOid.toString(), adminUser),
      );
      expect(response.errors?.['electedBodyExcelFile']).toEqual([
        expect.objectContaining({
          code: 'conflict',
          message: 'This form was just updated by another request. Please refresh and try again.',
        }),
      ]);
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });
  });
});
