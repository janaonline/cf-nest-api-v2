import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { DevolutionFormulaExcelService } from './devolution-formula-excel.service';
import { DF_TEMPLATE_HEADERS } from '../../constants/devolution-formula.constants';
import { DevolutionFormulaValidator } from '../../validators/devolution-formula.validator';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { S3Service } from 'src/core/s3/s3.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { DevolutionFormulaService } from '../main/devolution-formula.service';
import { DfFormJsonConfigService } from '../form-json/devolution-formula-form-json.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Scope, UserRole, AccessLevel } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const EXCEL_HEADERS = [
  'Census Code',
  'ULB Name',
  'Total Grant Allocation',
  'Installment 1 Amount',
  'Installment 2 Amount',
  'Devolution Formula',
];

function makeXlsxBuffer(dataRows: unknown[][]): Buffer {
  return makeXlsxBufferWithHeaders(EXCEL_HEADERS, dataRows);
}

function makeXlsxBufferWithHeaders(headers: string[], dataRows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const YEAR_ID = '606aafc14dff55e6c075d3ec';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId(YEAR_ID);
const formOid = new Types.ObjectId();
const ulbOid = new Types.ObjectId();
const allocOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: AccessLevel.ADMIN,
  state: null,
};

const mockGrantAlloc = { _id: allocOid, basic: 400_000, performance: 100_000 };

const mockExistingForm = {
  _id: formOid,
  state: stateOid,
  year: yearOid,
  installment: 1,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  validationStatus: 'INVALID',
  activeDatasetVersion: 1,
  excelRowCount: 2,
  errorRowCount: 1,
  totalMoHUAAllocation: 500_000,
  totalAllocatedSum: 300_000,
  excelFile: {
    originalName: 'test.xlsx',
    path: 'state/path/test.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeKb: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  errorExcelFile: {
    originalName: 'errors.xlsx',
    path: 'state/path/errors.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeKb: 0.5,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

const mockActiveRows = [
  {
    _id: new Types.ObjectId(),
    rowNumber: 1,
    ulbId: ulbOid,
    censusCode: 'C001',
    sbCode: '',
    ulbName: 'Alpha City',
    totalGrantAllocation: 300_000,
    installment1Amount: 200_000,
    installment2Amount: 100_000,
    devolutionFormula: 'population',
    validationStatus: 'VALID',
    errors: [],
  },
  {
    _id: new Types.ObjectId(),
    rowNumber: 2,
    ulbId: null,
    censusCode: 'UNKNOWN',
    sbCode: '',
    ulbName: 'Ghost City',
    totalGrantAllocation: 200_000,
    installment1Amount: 100_000,
    installment2Amount: 100_000,
    devolutionFormula: 'area',
    validationStatus: 'INVALID',
    errors: [{ field: 'censusCode', code: 'unknownUlb', message: 'ULB not found.' }],
  },
];

const mockDbUlbs = [{ _id: ulbOid, name: 'Alpha City', censusCode: 'C001', sbCode: '' }];

// DB-driven field config — single source of truth for excelFile's allowed types/size and
// devolutionFormula's max length, replacing what used to be hardcoded DF_* constants.
const mockDfTypedFields = [
  {
    fieldTypes: ['DF_MAIN_FORM_FIELDS'],
    formFieldType: 'file',
    key: 'excelFile',
    label: 'Upload Devolution Formula Excel',
    allowedFileTypes: ['xlsx', 'xls'],
    maxFileSize: 20,
    validations: [{ name: 'required', validator: null, message: 'Excel file is required.' }],
  },
  {
    fieldTypes: ['DF_ROW_EDIT_FIELDS'],
    formFieldType: 'text',
    key: 'devolutionFormula',
    label: 'Devolution Formula',
    validations: [
      { name: 'required', validator: null, message: 'Devolution Formula is required.' },
      { name: 'maxlength', validator: 250, message: 'Devolution Formula cannot exceed 250 characters.' },
    ],
  },
];

// ─── Transaction session mock ────────────────────────────────────────────────
// commitTransaction/abortTransaction/endSession resolve permanently at creation time —
// jest.clearAllMocks() only clears call history, it does not remove mockResolvedValue.

const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  abortTransaction: jest.fn().mockResolvedValue(undefined),
  endSession: jest.fn().mockResolvedValue(undefined),
};

/** Builds the `findOneAndUpdate` upsert result for the atomic version-allocation call. */
function mockUpsertedForm(overrides: { _id?: Types.ObjectId; activeDatasetVersion: number }) {
  return q({ _id: overrides._id ?? formOid, activeDatasetVersion: overrides.activeDatasetVersion });
}

// ─── Model mocks ──────────────────────────────────────────────────────────────

const mockFormModel = {
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
  db: { startSession: jest.fn().mockResolvedValue(mockSession) },
};

const mockRowModel = {
  find: jest.fn(),
  insertMany: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  countDocuments: jest.fn(),
  bulkWrite: jest.fn(),
};

const mockUlbModel = { find: jest.fn() };

// ─── Service mocks ────────────────────────────────────────────────────────────

const mockS3Service = { getBuffer: jest.fn(), uploadPublic: jest.fn(), uploadPrivate: jest.fn() };
const mockExcelService = { generateExcel: jest.fn().mockResolvedValue(Buffer.from('')) };
const mockFileTokenService = { signFileUrl: jest.fn((url: string) => `signed::${url}`) };
const mockFileUrlNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
const mockDfService = { resolveGrantAllocation: jest.fn() };
const mockDfFormJsonConfig = { loadFields: jest.fn() };

// ─── 1 · Safe dataset replace ────────────────────────────────────────────────

describe('DevolutionFormulaExcelService — safe dataset replace', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 2 }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaExcelService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DevolutionFormulaService, useValue: mockDfService },
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  it('aborts the transaction (no commit, no manual reactivation) when insertMany fails on an existing form', async () => {
    const insertError = new Error('insertMany failed');
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 2 }));
    mockRowModel.updateMany.mockReturnValue(q({ modifiedCount: 2 }));
    mockRowModel.insertMany.mockRejectedValue(insertError);
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(
      service.validateExcel(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          excelFile: {
            originalName: 'test.xlsx',
            path: 'state/path/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        adminUser,
      ),
    ).rejects.toThrow();

    // Deactivation must have been attempted inside the transaction (old rows set isActive: false)
    const deactivateCalls = mockRowModel.updateMany.mock.calls as unknown[][][];
    expect(deactivateCalls.some((c) => (c[1] as Record<string, unknown>)?.['$set'] !== undefined)).toBe(true);

    // Transaction abort replaces the old manual rollback — no reactivation call is issued.
    const reactivateCalls = deactivateCalls.filter(
      (c) => ((c[1] as Record<string, unknown>)?.['$set'] as Record<string, unknown>)?.['isActive'] === true,
    );
    expect(reactivateCalls.length).toBe(0);
    expect(mockRowModel.deleteMany).not.toHaveBeenCalled();

    expect(mockSession.abortTransaction).toHaveBeenCalled();
    expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    expect(mockSession.endSession).toHaveBeenCalled();
  });

  it('aborts the transaction (no orphan cleanup needed) when insertMany fails on a brand-new form', async () => {
    // No existing form doc
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 1 }));
    mockRowModel.insertMany.mockRejectedValue(new Error('DB write failed'));
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(
      service.validateExcel(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          excelFile: {
            originalName: 'test.xlsx',
            path: 'state/path/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        adminUser,
      ),
    ).rejects.toThrow();

    // No prior version to deactivate on a brand-new form
    expect(mockRowModel.updateMany).not.toHaveBeenCalled();
    // No manual orphan cleanup — transaction abort undoes the upsert + insert atomically
    expect(mockRowModel.deleteMany).not.toHaveBeenCalled();

    expect(mockSession.abortTransaction).toHaveBeenCalled();
    expect(mockSession.commitTransaction).not.toHaveBeenCalled();
  });

  it('deletes old-version rows inside the transaction, before commit, on a successful replacement', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 2 }));
    mockRowModel.updateMany.mockReturnValue(q({ modifiedCount: 2 }));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      adminUser,
    );

    // deleteMany for the old version (currentVersion = 1) must have been called
    const deleteCalls = mockRowModel.deleteMany.mock.calls as unknown[][][];
    const oldVersionDelete = deleteCalls.find(
      (c) => (c[0] as Record<string, unknown>)?.['datasetVersion'] === mockExistingForm.activeDatasetVersion,
    );
    expect(oldVersionDelete).toBeDefined();

    // ...and it must have happened before the transaction committed, not fire-and-forget after.
    const deleteOrder = mockRowModel.deleteMany.mock.invocationCallOrder[0];
    const commitOrder = mockSession.commitTransaction.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(commitOrder);
  });

  it('accepts excelFile.pageCount: null and persists it on the form excelFile', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 2 }));
    mockRowModel.updateMany.mockReturnValue(q({ modifiedCount: 2 }));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    // Different path than mockExistingForm.excelFile — a replacement upload, so the
    // incoming pageCount is used rather than the (unset) pageCount on the existing file.
    await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test2.xlsx',
          path: 'state/path/test2.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          pageCount: null,
        },
      },
      adminUser,
    );

    // The atomic version-allocation call must carry the excelFile metadata with pageCount preserved
    const updateCalls = mockFormModel.findOneAndUpdate.mock.calls as unknown[][][];
    const setWithExcelFile = updateCalls
      .map((c) => (c[1] as Record<string, unknown>)?.['$set'] as Record<string, unknown> | undefined)
      .find((s) => s?.['excelFile'] !== undefined);
    expect(setWithExcelFile).toBeDefined();
    expect((setWithExcelFile?.['excelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
  });

  it('generated errorExcelFile metadata has pageCount: null', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.updateMany.mockReturnValue(q({ modifiedCount: 2 }));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.deleteMany.mockReturnValue(q(null));

    // Known-registry ULB with a negative installment amount → row error → error sheet generated
    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, -300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          pageCount: null,
        },
      },
      adminUser,
    );

    const updateCalls = mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][];
    const errorFileSet = updateCalls
      .map((c) => (c[1] as Record<string, unknown>)?.['$set'] as Record<string, unknown> | undefined)
      .find((s) => s?.['errorExcelFile'] !== undefined);
    expect(errorFileSet).toBeDefined();
    expect((errorFileSet?.['errorExcelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
  });
});

// ─── 2 · Revalidate behavior ─────────────────────────────────────────────────

describe('DevolutionFormulaExcelService — revalidateExcel', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockRowModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.bulkWrite.mockResolvedValue({ modifiedCount: 0 });
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaExcelService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DevolutionFormulaService, useValue: mockDfService },
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  it('does NOT increment activeDatasetVersion when revalidating active rows (Case A)', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q([mockActiveRows[0]])); // single known-registry row; no null-ulbId row to avoid newUlbsAdded throw

    await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);

    const formUpdateCalls = mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][];
    expect(formUpdateCalls.length).toBeGreaterThan(0);
    const updateArg = formUpdateCalls[0][1] as { $set: Record<string, unknown> };
    expect(Object.keys(updateArg.$set)).not.toContain('activeDatasetVersion');
  });

  it('unsets errorExcelFile when revalidation produces zero row errors (Case A)', async () => {
    // One valid row whose totalGrantAllocation equals grantAlloc.basic + performance (500_000)
    // so allocationBalanced is true → formValidationStatus VALID → $unset is applied
    const balancedRow = {
      ...mockActiveRows[0],
      totalGrantAllocation: 500_000,
      installment1Amount: 300_000,
      installment2Amount: 200_000,
    };
    mockFormModel.findOne.mockReturnValue(q({ ...mockExistingForm }));
    mockRowModel.find.mockReturnValue(q([balancedRow]));

    await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);

    const formUpdateCalls = mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][];
    const allArgs = formUpdateCalls.map((c) => c[1] as Record<string, unknown>);
    const hasUnset = allArgs.some((a) => a['$unset'] !== undefined);
    expect(hasUnset).toBe(true);
  });

  it('does NOT unset errorExcelFile when revalidation has allocation imbalance (Case A)', async () => {
    // Single known-registry row whose totalAllocatedSum (300_000) ≠ totalMoHUAAllocation (500_000)
    // → formValidationStatus stays INVALID → no $unset
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q([mockActiveRows[0]]));

    await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);

    const formUpdateCalls = mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][];
    const allArgs = formUpdateCalls.map((c) => c[1] as Record<string, unknown>);
    const hasUnset = allArgs.some((a) => a['$unset'] !== undefined);
    expect(hasUnset).toBe(false);
  });

  it('throws excelFile.newUlbsAdded when stored rows include rows without ulbId (Case A)', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q(mockActiveRows)); // includes null-ulbId row

    let caught: unknown;
    try {
      await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);
    } catch (e) {
      caught = e;
    }

    const response = (caught as { response: { errors: Record<string, unknown> } }).response;
    expect(response.errors['excelFile']).toEqual([expect.objectContaining({ code: 'newUlbsAdded' })]);
  });

  it('includes newUlbCount in the findByIdAndUpdate $set when unknown rows are present (Case A)', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q(mockActiveRows)); // 1 null-ulbId row → newUlbCount = 1

    try {
      await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);
    } catch {
      // expected throw
    }

    const formUpdateCalls = mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][];
    const updateArg = formUpdateCalls[0][1] as { $set: Record<string, unknown> };
    expect(updateArg.$set['newUlbCount']).toBe(1);
  });

  it('newUlbsAdded message reports the correct count (Case A)', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q(mockActiveRows));

    let caught: unknown;
    try {
      await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);
    } catch (e) {
      caught = e;
    }

    const response = (caught as { response: { errors: Record<string, unknown> } }).response;
    const error = (response.errors['excelFile'] as Array<{ message: string }>)[0];
    expect(error.message).toBe('You have added 1 ULB(s). Please register before proceeding.');
  });

  it('validationSummary.newUlbCount in the throw data uses the freshly computed count, not the stale form value (Case A)', async () => {
    mockFormModel.findOne.mockReturnValue(q({ ...mockExistingForm, newUlbCount: 99 })); // stale value on form
    mockRowModel.find.mockReturnValue(q(mockActiveRows)); // 1 null-ulbId row → actual count = 1

    let caught: unknown;
    try {
      await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);
    } catch (e) {
      caught = e;
    }

    const response = (caught as { response: { data: Record<string, unknown> } }).response;
    const summary = response.data['validationSummary'] as { newUlbCount: number };
    expect(summary.newUlbCount).toBe(1); // freshly computed, not 99
  });

  it('returns success without throwing when all stored rows have ulbId and allocation balances (Case A)', async () => {
    const balancedRow = {
      ...mockActiveRows[0],
      totalGrantAllocation: 500_000,
      installment1Amount: 300_000,
      installment2Amount: 200_000,
    };
    mockFormModel.findOne.mockReturnValue(q({ ...mockExistingForm }));
    mockRowModel.find.mockReturnValue(q([balancedRow]));

    const result = await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);

    expect(result).toBeDefined();
    const summary = result.data?.validationSummary as { newUlbCount: number };
    expect(summary.newUlbCount).toBe(0);
  });
});

// ─── 3 · Template generation ─────────────────────────────────────────────────

describe('DevolutionFormulaExcelService — generateTemplate', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);

    mockFormModel.findOne.mockReturnValue(q(null)); // no saved form → fallback to master ULBs
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaExcelService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DevolutionFormulaService, useValue: mockDfService },
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  it('orders template columns as Census Code, ULB Name, Installment 1, Installment 2, Total Grant Allocation, Devolution Formula', () => {
    expect(DF_TEMPLATE_HEADERS.map((h) => h.key)).toEqual([
      'censusCode',
      'ulbName',
      'installment1Amount',
      'installment2Amount',
      'totalGrantAllocation',
      'devolutionFormula',
    ]);
  });

  it('queries active ULBs scoped to the requesting state with isActive: true', async () => {
    await service.generateTemplate(stateOid.toString(), YEAR_ID, 1, adminUser);

    expect(mockUlbModel.find).toHaveBeenCalledWith({ state: stateOid, isActive: true });
  });

  it('builds template rows from the registry ulbName and censusCode (not user-suppliable values)', async () => {
    await service.generateTemplate(stateOid.toString(), YEAR_ID, 1, adminUser);

    const calls = mockExcelService.generateExcel.mock.calls as unknown[][];
    const rows = calls[0][1] as Array<{ censusCode: string; ulbName: string }>;
    expect(rows).toEqual([expect.objectContaining({ censusCode: 'C001', ulbName: 'Alpha City' })]);
  });

  it('passes 4 column validations covering the 3 amount fields and devolutionFormula', async () => {
    await service.generateTemplate(stateOid.toString(), YEAR_ID, 1, adminUser);

    const calls = mockExcelService.generateExcel.mock.calls as unknown[][];
    const columnValidations = calls[0][3] as Array<{ key: string; mode: string }>;
    expect(columnValidations).toHaveLength(4);
    expect(columnValidations.map((v) => v.key)).toEqual([
      'totalGrantAllocation',
      'installment1Amount',
      'installment2Amount',
      'devolutionFormula',
    ]);
    expect(columnValidations[0].mode).toBe('perRow');
    expect(columnValidations[1].mode).toBe('perRow');
    expect(columnValidations[2].mode).toBe('perRow');
    // devolutionFormula is now perRow/custom with allowBlank:false so Excel blocks a blank cell
    // (a static textLength rule with allowBlank:true, as before, never flags an empty cell).
    expect(columnValidations[3].mode).toBe('perRow');
  });

  it('builds a required, non-blank-blocking validation formula for devolutionFormula', async () => {
    await service.generateTemplate(stateOid.toString(), YEAR_ID, 1, adminUser);

    const calls = mockExcelService.generateExcel.mock.calls as unknown[][];
    const columnValidations = calls[0][3] as Array<{
      key: string;
      mode: string;
      buildValidation: (row: number, keyToLetter: Map<string, string>) => Record<string, unknown>;
    }>;
    const devolutionFormulaValidation = columnValidations.find((v) => v.key === 'devolutionFormula')!;
    const keyToLetter = new Map([['devolutionFormula', 'F']]);
    const built = devolutionFormulaValidation.buildValidation(2, keyToLetter);

    expect(built['type']).toBe('custom');
    expect(built['allowBlank']).toBe(false);
    expect(built['formulae']).toEqual([expect.stringContaining('F2<>""')]);
    expect(built['formulae']).toEqual([expect.stringContaining('LEN(F2)<=')]);
  });

  it('pre-fills rows from the active dataset when form.activeDatasetVersion > 0', async () => {
    const savedRow = {
      _id: new Types.ObjectId(),
      rowNumber: 1,
      ulbId: ulbOid, // matched registry ULB — overlay pattern uses this to join
      censusCode: 'C001',
      ulbName: 'Alpha City',
      totalGrantAllocation: 500_000,
      installment1Amount: 300_000,
      installment2Amount: 200_000,
      devolutionFormula: 'Population-based',
      isActive: true,
    };
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 1 }));
    mockRowModel.find.mockReturnValue(q([savedRow]));

    await service.generateTemplate(stateOid.toString(), YEAR_ID, 1, adminUser);

    // registry is always loaded (even with a dataset) so unknown rows are excluded and new ULBs appear
    expect(mockUlbModel.find).toHaveBeenCalledWith({ state: stateOid, isActive: true });
    // only registry-matched rows fetched — ulbId: { $ne: null } excludes unknown-ULB rows
    expect(mockRowModel.find).toHaveBeenCalledWith({
      form: formOid,
      datasetVersion: 1,
      isActive: true,
      ulbId: { $ne: null },
    });

    const calls = mockExcelService.generateExcel.mock.calls as unknown[][];
    const rows = calls[0][1] as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      expect.objectContaining({
        censusCode: 'C001',
        ulbName: 'Alpha City',
        totalGrantAllocation: 500_000,
        installment1Amount: 300_000,
        installment2Amount: 200_000,
        devolutionFormula: 'Population-based',
      }),
    ]);
  });
});

// ─── 4 · Upload ULB identity validation ──────────────────────────────────────

describe('DevolutionFormulaExcelService — validateExcel ULB identity guard', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 1 }));
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaExcelService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DevolutionFormulaService, useValue: mockDfService },
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  it('passes when uploaded censusCode and ulbName match the active registry/template values', async () => {
    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    const result = await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      adminUser,
    );

    expect(result.data?.rowErrors).toEqual([]);
  });

  it('accepts the headers exactly as produced by the downloadable template (with the "(Cr.)" unit suffix)', async () => {
    // Regression test: DF_TEMPLATE_HEADERS' labels ("Total Grant Allocation (Cr.)", etc.)
    // must resolve via DF_EXCEL_HEADER_MAP the same way the un-suffixed labels do, or every
    // unmodified template re-upload falsely fails with "Missing required columns".
    // Row values are positioned to match DF_TEMPLATE_HEADERS' current column order
    // (Census Code, ULB Name, Installment 1, Installment 2, Total Grant Allocation, Devolution
    // Formula) — total (500,000) must equal installment1 + installment2 and totalMoHUAAllocation.
    const templateHeaderLabels = DF_TEMPLATE_HEADERS.map((h) => h.label);
    const buffer = makeXlsxBufferWithHeaders(templateHeaderLabels, [
      ['C001', 'Alpha City', 300_000, 200_000, 500_000, 'population'],
    ]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    const result = await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      adminUser,
    );

    expect(result.data?.rowErrors).toEqual([]);
  });

  it('returns a row error keyed to ulbName when the uploaded name diverges from the registry value, and skips business validation for that row', async () => {
    // Installment amounts intentionally do not sum to totalGrantAllocation — if business
    // validation ran, an additional allocation-mismatch error would also be present.
    const buffer = makeXlsxBuffer([['C001', 'Alpha City Renamed', 500_000, 100_000, 100_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    const result = await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      adminUser,
    );

    expect(result.data?.rowErrors).toEqual([expect.objectContaining({ field: 'ulbName', code: 'identityModified' })]);
  });

  it('still detects an unknown/unregistered censusCode via the existing registry-first row error, now escalated to a blocking excelFile control error, with no register-link content added', async () => {
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    let caught: unknown;
    try {
      await service.validateExcel(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          excelFile: {
            originalName: 'test.xlsx',
            path: 'state/path/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        adminUser,
      );
    } catch (e) {
      caught = e;
    }

    const response = (caught as { response: { errors: Record<string, unknown>; data: Record<string, unknown> } })
      .response;
    expect(response.errors['excelFile']).toEqual([expect.objectContaining({ code: 'newUlbsAdded' })]);
    expect(response.data['rowErrors']).toEqual([expect.objectContaining({ field: 'censusCode', code: 'unknownUlb' })]);

    const serialized = JSON.stringify(response);
    expect(serialized.toLowerCase()).not.toContain('register-ulb');
    expect(serialized.toLowerCase()).not.toContain('supportingaction');
  });

  it('still enforces file-level allocation-sum validation unchanged', async () => {
    // Row totalGrantAllocation (400,000) does not match totalMoHUAAllocation (500,000)
    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 400_000, 300_000, 100_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(
      service.validateExcel(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          excelFile: {
            originalName: 'test.xlsx',
            path: 'state/path/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: { errors: { excelFile: [expect.objectContaining({ code: 'allocationMismatch' })] } },
    });
  });
});

// ─── 5 · New/extra ULB detection (Phase 4) ───────────────────────────────────

describe('DevolutionFormulaExcelService — validateExcel new/extra ULB detection', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 1 }));
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaExcelService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DevolutionFormulaService, useValue: mockDfService },
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  async function expectRejection(buffer: Buffer) {
    mockS3Service.getBuffer.mockResolvedValue(buffer);
    let caught: unknown;
    try {
      await service.validateExcel(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          excelFile: {
            originalName: 'test.xlsx',
            path: 'state/path/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        adminUser,
      );
    } catch (e) {
      caught = e;
    }
    return caught as { response: { errors: Record<string, unknown[]>; data: Record<string, unknown> } };
  }

  it('creates the existing row-level unknownUlb error and also a file-level newUlbsAdded error for an unregistered row', async () => {
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 300_000, 200_000, 'population']]);
    const caught = await expectRejection(buffer);

    expect(caught.response.data['rowErrors']).toEqual([
      expect.objectContaining({ field: 'censusCode', code: 'unknownUlb' }),
    ]);
    expect(caught.response.errors['excelFile']).toEqual([expect.objectContaining({ code: 'newUlbsAdded' })]);
  });

  it('message reports the correct count for a single new ULB', async () => {
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 300_000, 200_000, 'population']]);
    const caught = await expectRejection(buffer);

    const error = caught.response.errors['excelFile'][0] as { message: string };
    expect(error.message).toBe('You have added 1 ULB(s). Please register before proceeding.');
  });

  it('message reports the correct count for multiple new ULBs', async () => {
    const buffer = makeXlsxBuffer([
      ['ZZZZ1', 'New Town 1', 500_000, 300_000, 200_000, 'population'],
      ['ZZZZ2', 'New Town 2', 500_000, 300_000, 200_000, 'population'],
    ]);
    const caught = await expectRejection(buffer);

    const error = caught.response.errors['excelFile'][0] as { message: string; code: string };
    expect(error.code).toBe('newUlbsAdded');
    expect(error.message).toBe('You have added 2 ULB(s). Please register before proceeding.');
  });

  it('skips required/type/business row validation for unknown ULB rows (no extra row error beyond unknownUlb)', async () => {
    // Installment amounts deliberately do not sum to totalGrantAllocation — if business
    // validation ran for this row, an additional row-level error would also appear.
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 100_000, 100_000, 'population']]);
    const caught = await expectRejection(buffer);

    expect(caught.response.data['rowErrors']).toEqual([
      expect.objectContaining({ field: 'censusCode', code: 'unknownUlb' }),
    ]);
  });

  it('merges newUlbsAdded with allocationMismatch in errors.excelFile rather than overwriting', async () => {
    // One valid, registered row whose totalGrantAllocation (300,000) does not equal
    // totalMoHUAAllocation (500,000), plus one unregistered row.
    const buffer = makeXlsxBuffer([
      ['C001', 'Alpha City', 300_000, 200_000, 100_000, 'population'],
      ['ZZZZ', 'New Town', 200_000, 100_000, 100_000, 'population'],
    ]);
    const caught = await expectRejection(buffer);

    expect(caught.response.errors['excelFile']).toEqual([
      expect.objectContaining({ code: 'newUlbsAdded' }),
      expect.objectContaining({ code: 'allocationMismatch' }),
    ]);
  });

  it('persists newUlbCount on the form document for GET-time Register ULB supporting content (Phase 5)', async () => {
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 300_000, 200_000, 'population']]);
    await expectRejection(buffer);

    const updateCallArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][])[0][1] as {
      $set: { newUlbCount: number };
    };
    expect(updateCallArg.$set.newUlbCount).toBe(1);
  });

  it('does not include any register-link or supporting-content payload in the validateExcel response itself', async () => {
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 300_000, 200_000, 'population']]);
    const caught = await expectRejection(buffer);

    const serialized = JSON.stringify(caught.response).toLowerCase();
    expect(serialized).not.toContain('register-ulb');
    expect(serialized).not.toContain('supportingaction');
    expect(serialized).not.toContain('actionlink');
  });

  // ─── validationSummary.newUlbCount (Phase 6) ─────────────────────────────

  it('includes data.validationSummary.newUlbCount on the failed-validation response when new ULBs are detected', async () => {
    const buffer = makeXlsxBuffer([['ZZZZ', 'New Town', 500_000, 300_000, 200_000, 'population']]);
    const caught = await expectRejection(buffer);

    const validationSummary = caught.response.data['validationSummary'] as { newUlbCount: number };
    expect(validationSummary.newUlbCount).toBe(1);
  });

  it('summary.newUlbCount is 0 on a clean upload with no new ULBs', async () => {
    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    const result = await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      adminUser,
    );

    expect(result.data?.summary.newUlbCount).toBe(0);
  });

  it('resets persisted newUlbCount to 0 on a clean re-upload after a previous invalid upload had added new ULBs', async () => {
    mockFormModel.findOne.mockReturnValue(
      q({ _id: formOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, activeDatasetVersion: 1, newUlbCount: 2 }),
    );
    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await service.validateExcel(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        excelFile: {
          originalName: 'test.xlsx',
          path: 'state/path/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      adminUser,
    );

    const updateCallArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][])[0][1] as {
      $set: { newUlbCount: number };
    };
    expect(updateCallArg.$set.newUlbCount).toBe(0);
  });
});

// ─── 6 · Atomic version allocation & write-conflict classification ──────────

describe('DevolutionFormulaExcelService — atomic version allocation & write-conflict classification', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockRowModel.updateMany.mockReturnValue(q({ modifiedCount: 0 }));
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaExcelService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DevolutionFormulaService, useValue: mockDfService },
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  function buildRequest() {
    return {
      stateId: stateOid.toString(),
      yearId: YEAR_ID,
      installment: 1 as const,
      excelFile: {
        originalName: 'test.xlsx',
        path: 'state/path/test.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeKb: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
  }

  it('hands two concurrent uploads distinct, monotonically increasing dataset versions (simulated real $inc semantics)', async () => {
    // A shared counter stands in for MongoDB's real atomic $inc: every call to the mocked
    // findOneAndUpdate increments it exactly once, so two "concurrent" callers can never observe
    // (or be handed) the same activeDatasetVersion — the exact race the old read-then-increment
    // code was vulnerable to.
    let sharedVersionCounter = 0;
    mockFormModel.findOneAndUpdate.mockImplementation(() => {
      sharedVersionCounter += 1;
      return q({ _id: formOid, activeDatasetVersion: sharedVersionCounter });
    });

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    const [first, second] = await Promise.all([
      service.validateExcel(buildRequest(), adminUser),
      service.validateExcel(buildRequest(), adminUser),
    ]);

    const firstVersion = first.data?.summary.activeDatasetVersion;
    const secondVersion = second.data?.summary.activeDatasetVersion;
    expect(firstVersion).not.toBe(secondVersion);
    expect([firstVersion, secondVersion].sort()).toEqual([1, 2]);
  });

  it('surfaces a row-level duplicate-key conflict with the existing "Duplicate ULB entries" message', async () => {
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 1 }));
    mockRowModel.insertMany.mockRejectedValue(
      new MongoServerError({
        message: 'E11000 duplicate key error',
        code: 11000,
        keyValue: { form: formOid, datasetVersion: 1, ulbId: ulbOid },
      }),
    );

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(service.validateExcel(buildRequest(), adminUser)).rejects.toMatchObject({
      response: {
        errors: {
          excelFile: [expect.objectContaining({ code: 'duplicate', message: 'Duplicate ULB entries detected.' })],
        },
      },
    });
  });

  it('surfaces a form-level duplicate-key conflict (two requests racing to create the same form) with an honest refresh message', async () => {
    mockFormModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockRejectedValue(
        new MongoServerError({
          message: 'E11000 duplicate key error',
          code: 11000,
          keyValue: { state: stateOid, year: yearOid, installment: 1 },
        }),
      ),
    });

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(service.validateExcel(buildRequest(), adminUser)).rejects.toMatchObject({
      response: {
        errors: {
          excelFile: [
            expect.objectContaining({
              code: 'conflict',
              message: 'This form was just updated by another request. Please refresh and try again.',
            }),
          ],
        },
      },
    });

    expect(mockSession.abortTransaction).toHaveBeenCalled();
  });

  it('surfaces a transaction write-conflict (TransientTransactionError) with the same honest refresh message', async () => {
    mockFormModel.findOneAndUpdate.mockReturnValue(mockUpsertedForm({ activeDatasetVersion: 1 }));
    mockRowModel.insertMany.mockRejectedValue(
      new MongoServerError({ message: 'WriteConflict', code: 112, errorLabels: ['TransientTransactionError'] }),
    );

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(service.validateExcel(buildRequest(), adminUser)).rejects.toMatchObject({
      response: {
        errors: {
          excelFile: [
            expect.objectContaining({
              code: 'conflict',
              message: 'This form was just updated by another request. Please refresh and try again.',
            }),
          ],
        },
      },
    });
  });
});
