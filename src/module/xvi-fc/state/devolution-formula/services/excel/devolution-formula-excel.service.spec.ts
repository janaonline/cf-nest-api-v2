import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { DevolutionFormulaExcelService } from './devolution-formula-excel.service';
import { DevolutionFormulaValidator } from '../../validators/devolution-formula.validator';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { S3Service } from 'src/core/s3/s3.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { DevolutionFormulaService } from '../main/devolution-formula.service';
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
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, ...dataRows]);
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
  excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
  errorExcelFile: { fileName: 'errors.xlsx', fileUrl: 'state/path/errors.xlsx', fileSize: 512 },
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

// ─── Model mocks ──────────────────────────────────────────────────────────────

const mockFormModel = {
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
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

const mockS3Service = { getBuffer: jest.fn(), uploadPublic: jest.fn() };
const mockExcelService = { generateExcel: jest.fn().mockResolvedValue(Buffer.from('')) };
const mockFileTokenService = { signFileUrl: jest.fn((url: string) => `signed::${url}`) };
const mockFileUrlNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
const mockDfService = { resolveGrantAllocation: jest.fn() };

// ─── 1 · Safe dataset replace ────────────────────────────────────────────────

describe('DevolutionFormulaExcelService — safe dataset replace', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
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
        { provide: DevolutionFormulaService, useValue: mockDfService },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  it('rolls back (reactivates old rows, deletes new rows) when insertMany fails on an existing form', async () => {
    const insertError = new Error('insertMany failed');
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
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
          excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
        },
        adminUser,
      ),
    ).rejects.toThrow();

    // Deactivation must have been called (old rows set isActive: false)
    const deactivateCalls = mockRowModel.updateMany.mock.calls as unknown[][][];
    expect(deactivateCalls.some((c) => (c[1] as Record<string, unknown>)?.['$set'] !== undefined)).toBe(true);

    // Reactivation must follow (rollback sets isActive: true)
    const reactivateCalls = deactivateCalls.filter(
      (c) => ((c[1] as Record<string, unknown>)?.['$set'] as Record<string, unknown>)?.['isActive'] === true,
    );
    expect(reactivateCalls.length).toBeGreaterThan(0);

    // New version rows must be deleted as part of rollback
    expect(mockRowModel.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ datasetVersion: mockExistingForm.activeDatasetVersion + 1 }),
    );
  });

  it('cleans up orphan new rows when form.create fails on a brand-new form', async () => {
    // No existing form doc
    mockFormModel.findOne.mockReturnValue(q(null));
    mockRowModel.insertMany.mockResolvedValue([]);
    mockFormModel.create.mockRejectedValue(new Error('DB write failed'));
    mockRowModel.deleteMany.mockReturnValue(q(null));

    const buffer = makeXlsxBuffer([['C001', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
    mockS3Service.getBuffer.mockResolvedValue(buffer);

    await expect(
      service.validateExcel(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
        },
        adminUser,
      ),
    ).rejects.toThrow();

    // updateMany for deactivation must NOT have been called (no existing version)
    expect(mockRowModel.updateMany).not.toHaveBeenCalled();

    // Orphan rows must be cleaned up (deleteMany for the new version)
    expect(mockRowModel.deleteMany).toHaveBeenCalled();
  });

  it('fires async deletion of old-version rows only after a successful replacement', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
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
        excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
      },
      adminUser,
    );

    // After success, deleteMany for the old version (currentVersion = 1) must have been called
    const deleteCalls = mockRowModel.deleteMany.mock.calls as unknown[][][];
    const oldVersionDelete = deleteCalls.find(
      (c) => (c[0] as Record<string, unknown>)?.['datasetVersion'] === mockExistingForm.activeDatasetVersion,
    );
    expect(oldVersionDelete).toBeDefined();
  });
});

// ─── 2 · Revalidate behavior ─────────────────────────────────────────────────

describe('DevolutionFormulaExcelService — revalidateExcel', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();

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
        { provide: DevolutionFormulaService, useValue: mockDfService },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
  });

  it('does NOT increment activeDatasetVersion when revalidating active rows (Case A)', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q(mockActiveRows));

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

  it('does NOT unset errorExcelFile when revalidation still has row errors (Case A)', async () => {
    // Both rows present including the unknown one → errorRowCount stays > 0
    mockFormModel.findOne.mockReturnValue(q(mockExistingForm));
    mockRowModel.find.mockReturnValue(q(mockActiveRows));

    await service.revalidateExcel(stateOid.toString(), YEAR_ID, 1, adminUser);

    const formUpdateCalls = mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][];
    const allArgs = formUpdateCalls.map((c) => c[1] as Record<string, unknown>);
    const hasUnset = allArgs.some((a) => a['$unset'] !== undefined);
    expect(hasUnset).toBe(false);
  });
});

// ─── 3 · Template generation ─────────────────────────────────────────────────

describe('DevolutionFormulaExcelService — generateTemplate', () => {
  let service: DevolutionFormulaExcelService;

  beforeEach(async () => {
    jest.clearAllMocks();

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
        { provide: DevolutionFormulaService, useValue: mockDfService },
      ],
    }).compile();

    service = module.get<DevolutionFormulaExcelService>(DevolutionFormulaExcelService);
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
    expect(columnValidations[3].mode).toBe('static');
  });

  it('pre-fills rows from the active dataset when form.activeDatasetVersion > 0', async () => {
    const savedRow = {
      _id: new Types.ObjectId(),
      rowNumber: 1,
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

    expect(mockRowModel.find).toHaveBeenCalledWith({ form: formOid, datasetVersion: 1, isActive: true });
    expect(mockUlbModel.find).not.toHaveBeenCalled();

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

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.create.mockResolvedValue({ _id: formOid });
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
        { provide: DevolutionFormulaService, useValue: mockDfService },
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
        excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
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
        excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
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
          excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
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
          excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
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

    mockDfService.resolveGrantAllocation.mockResolvedValue(mockGrantAlloc);
    mockUlbModel.find.mockReturnValue(q(mockDbUlbs));
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.create.mockResolvedValue({ _id: formOid });
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
        { provide: DevolutionFormulaService, useValue: mockDfService },
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
          excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
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

    const createCallArg = (mockFormModel.create.mock.calls as unknown[][])[0][0] as { newUlbCount: number };
    expect(createCallArg.newUlbCount).toBe(1);
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
        excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
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
        excelFile: { fileName: 'test.xlsx', fileUrl: 'state/path/test.xlsx', fileSize: 1024 },
      },
      adminUser,
    );

    const updateCallArg = (mockFormModel.findByIdAndUpdate.mock.calls as unknown[][])[0][1] as {
      $set: { newUlbCount: number };
    };
    expect(updateCallArg.$set.newUlbCount).toBe(0);
  });
});
