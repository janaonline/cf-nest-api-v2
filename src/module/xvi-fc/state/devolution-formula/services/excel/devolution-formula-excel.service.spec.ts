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
  'SB Code',
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

    const buffer = makeXlsxBuffer([['C001', '', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
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

    const buffer = makeXlsxBuffer([['C001', '', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
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

    const buffer = makeXlsxBuffer([['C001', '', 'Alpha City', 500_000, 300_000, 200_000, 'population']]);
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
