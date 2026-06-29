import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DevolutionFormulaService } from './services/main/devolution-formula.service';
import { DevolutionFormulaRowService } from './services/row/devolution-formula-row.service';
import { DevolutionFormulaValidator } from './validators/devolution-formula.validator';
import type { DfParsedExcelRow } from './validators/devolution-formula.validator';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { GrantAllocation } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Scope, UserRole, AccessLevel } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { SaveDraftDevolutionFormulaDto } from './dto/save-draft-devolution-formula.dto';
import { DF_FORM_QUESTIONS, DF_TEMPLATE_HEADERS } from './constants/devolution-formula.constants';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

// ─── Chainable Mongoose query mock ──────────────────────────────────────────

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Valid yearId from YearIdToLabel map (2023-24)
const YEAR_ID = '606aafc14dff55e6c075d3ec';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId(YEAR_ID);
const formOid = new Types.ObjectId();
const allocOid = new Types.ObjectId();
const rowOid = new Types.ObjectId();
const ulbOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: AccessLevel.ADMIN,
  state: null,
};

const mockGrantAlloc = {
  _id: allocOid,
  basic: 400_000,
  performance: 100_000,
};

const mockFormInProgress = {
  _id: formOid,
  state: stateOid,
  year: yearOid,
  installment: 1 as const,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  validationStatus: 'VALID' as const,
  totalMoHUAAllocation: 500_000,
  totalAllocatedSum: 500_000,
  excelRowCount: 2,
  errorRowCount: 0,
  activeDatasetVersion: 1,
};

const mockRow = {
  _id: rowOid,
  form: formOid,
  datasetVersion: 1,
  rowNumber: 1,
  ulbId: ulbOid,
  censusCode: 'C001',
  sbCode: '',
  ulbName: 'Alpha City',
  totalGrantAllocation: 500_000,
  installment1Amount: 300_000,
  installment2Amount: 200_000,
  devolutionFormula: 'population',
  validationStatus: 'VALID' as const,
  errors: [],
  isActive: true,
};

// ─── Model mocks ─────────────────────────────────────────────────────────────

const mockFormModel = {
  findOne: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

const mockRowModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
};

const mockGrantAllocationModel = { findOne: jest.fn() };
const mockEulbModel = { findOne: jest.fn() };

// ─── 1 · Constants ───────────────────────────────────────────────────────────

describe('Devolution Formula — constants', () => {
  it('DF_TEMPLATE_HEADERS includes Census Code and SB Code column labels', () => {
    const labels = DF_TEMPLATE_HEADERS.map((h) => h.label);
    expect(labels).toContain('Census Code');
    expect(labels).toContain('SB Code');
  });

  it('DF_FORM_QUESTIONS contains excelFile (file) and checkboxConfirmation (checkbox)', () => {
    const keys = DF_FORM_QUESTIONS.map((q) => q.key);
    expect(keys).toContain('excelFile');
    expect(keys).toContain('checkboxConfirmation');

    const fileQ = DF_FORM_QUESTIONS.find((q) => q.key === 'excelFile');
    expect(fileQ?.formFieldType).toBe('file');
    expect(fileQ?.allowedFileTypes).toContain('xlsx');
    expect(fileQ?.allowedFileTypes).toContain('xls');
    expect(fileQ?.maxFileSize).toBe(20);
    expect(fileQ?.folderPathKey).toBe('devolution-formula/excels');

    const cbQ = DF_FORM_QUESTIONS.find((q) => q.key === 'checkboxConfirmation');
    expect(cbQ?.formFieldType).toBe('checkbox');
    expect(cbQ?.validations?.some((v) => v.name === 'requiredTrue')).toBe(true);
  });
});

// ─── 2 · DevolutionFormulaValidator ──────────────────────────────────────────

describe('DevolutionFormulaValidator', () => {
  const validator = new DevolutionFormulaValidator();

  const baseRow = (): DfParsedExcelRow => ({
    rowNumber: 1,
    censusCode: 'C001',
    sbCode: '',
    ulbName: 'Alpha City',
    totalGrantAllocation: 500_000,
    installment1Amount: 300_000,
    installment2Amount: 200_000,
    devolutionFormula: 'population',
  });

  it('validateRow returns allocationMismatch error when inst1 + inst2 ≠ totalGrantAllocation', () => {
    const row = { ...baseRow(), installment1Amount: 300_000, installment2Amount: 100_000 };
    const errors = validator.validateRow(row, 1);
    expect(errors.some((e) => e.code === 'allocationMismatch')).toBe(true);
  });

  it('validateRow returns required error when ulbName is blank', () => {
    const row = { ...baseRow(), ulbName: '   ' };
    const errors = validator.validateRow(row, 1);
    expect(errors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
    // Required phase fails early — no type or business errors should be appended
    expect(errors.every((e) => e.code === 'required')).toBe(true);
  });

  it('validateRow returns required errors when all allocation fields are missing', () => {
    const row: DfParsedExcelRow = {
      ...baseRow(),
      totalGrantAllocation: '',
      installment1Amount: undefined as unknown as number,
      installment2Amount: null as unknown as number,
    };
    const errors = validator.validateRow(row, 1);
    const codes = errors.map((e) => e.field);
    expect(codes).toContain('totalGrantAllocation');
    expect(codes).toContain('installment1Amount');
    expect(codes).toContain('installment2Amount');
  });

  it('validateRow returns number error when totalGrantAllocation is a non-numeric string', () => {
    const row = { ...baseRow(), totalGrantAllocation: 'abc' };
    const errors = validator.validateRow(row, 1);
    expect(errors.some((e) => e.field === 'totalGrantAllocation' && e.code === 'number')).toBe(true);
  });

  it('validateRow returns min error when installment1Amount is negative', () => {
    const row = { ...baseRow(), installment1Amount: -500, installment2Amount: 700_000 };
    const errors = validator.validateRow(row, 1);
    expect(errors.some((e) => e.field === 'installment1Amount' && e.code === 'min')).toBe(true);
  });

  it('validateRow returns 0 errors for a fully valid row', () => {
    const errors = validator.validateRow(baseRow(), 1);
    expect(errors).toHaveLength(0);
  });

  it('buildValidationSummary marks INVALID when errorRowCount > 0 (e.g., a duplicate ULB row was rejected)', () => {
    const summary = validator.buildValidationSummary({
      excelRowCount: 3,
      validRowCount: 2,
      errorRowCount: 1,
      missingUlbCount: 0,
      totalMoHUAAllocation: 500_000,
      totalAllocatedSum: 500_000,
      activeDatasetVersion: 1,
    });
    expect(summary.validationStatus).toBe('INVALID');
  });

  it('buildValidationSummary marks INVALID when missingUlbCount > 0 (onboarded ULB absent from upload)', () => {
    const summary = validator.buildValidationSummary({
      excelRowCount: 2,
      validRowCount: 2,
      errorRowCount: 0,
      missingUlbCount: 1,
      totalMoHUAAllocation: 500_000,
      totalAllocatedSum: 500_000,
      activeDatasetVersion: 1,
    });
    expect(summary.validationStatus).toBe('INVALID');
    expect(summary.allUlbsCovered).toBe(false);
  });

  it('buildValidationSummary marks INVALID when totalAllocatedSum ≠ totalMoHUAAllocation', () => {
    const summary = validator.buildValidationSummary({
      excelRowCount: 2,
      validRowCount: 2,
      errorRowCount: 0,
      missingUlbCount: 0,
      totalMoHUAAllocation: 500_000,
      totalAllocatedSum: 450_000,
      activeDatasetVersion: 1,
    });
    expect(summary.validationStatus).toBe('INVALID');
    expect(summary.allocationBalanced).toBe(false);
  });
});

// ─── 3 · DTO validation ───────────────────────────────────────────────────────

describe('SaveDraftDevolutionFormulaDto', () => {
  it('rejects installment value 3 (not in [1, 2])', async () => {
    const dto = plainToInstance(SaveDraftDevolutionFormulaDto, {
      stateId: stateOid.toString(),
      yearId: YEAR_ID,
      installment: 3,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'installment')).toBe(true);
  });

  it('accepts a valid draft without data', async () => {
    const dto = plainToInstance(SaveDraftDevolutionFormulaDto, {
      stateId: stateOid.toString(),
      yearId: YEAR_ID,
      installment: 1,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid draft with data.excelFile and data.checkboxConfirmation', async () => {
    const dto = plainToInstance(SaveDraftDevolutionFormulaDto, {
      stateId: stateOid.toString(),
      yearId: YEAR_ID,
      installment: 1,
      data: {
        excelFile: { fileName: 'test.xlsx', fileUrl: 'some/path.xlsx', fileSize: 1024 },
        checkboxConfirmation: true,
      },
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
  });
});

// ─── 4 · DevolutionFormulaService ─────────────────────────────────────────────

describe('DevolutionFormulaService', () => {
  let service: DevolutionFormulaService;

  const mockActorsService = {
    buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Test State' }),
  };
  const mockFileTokenService = {
    signFileUrl: jest.fn((url: string) => `signed::${url}`),
  };
  const mockFileUrlNormalizer = {
    toRawStoragePath: jest.fn((url: string) => `raw::${url}`),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(q(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaService,
        DevolutionFormulaValidator,
        ExcelService,
        DynamicFormValidationService,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: getModelToken(GrantAllocation.name), useValue: mockGrantAllocationModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockEulbModel },
        { provide: XvifcFormActorsService, useValue: mockActorsService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
      ],
    }).compile();

    service = module.get<DevolutionFormulaService>(DevolutionFormulaService);
  });

  // Test 2: grant allocation math
  it('saveDraft sets totalMoHUAAllocation = grantAlloc.basic + grantAlloc.performance', async () => {
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        data: { checkboxConfirmation: true },
      },
      adminUser,
    );

    const findOneAndUpdateCalls = mockFormModel.findOneAndUpdate.mock.calls as unknown[][][];
    const updatePayload = findOneAndUpdateCalls[0][1] as { $set: { totalMoHUAAllocation: number } };
    expect(updatePayload.$set.totalMoHUAAllocation).toBe(mockGrantAlloc.basic + mockGrantAlloc.performance);
  });

  // Test 3: missing grant allocation — error must be keyed to excelFile
  it('saveDraft throws when grantAllocation is missing, error keyed to excelFile', async () => {
    mockGrantAllocationModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOne.mockReturnValue(q(null));

    await expect(
      service.saveDraft({ stateId: stateOid.toString(), yearId: YEAR_ID, installment: 1 }, adminUser),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { excelFile: [{ field: 'excelFile', code: 'grantAllocationMissing' }] },
      },
    });
  });

  // Test 12: URL normalization before save
  it('saveDraft normalizes a signed file URL to a raw storage path before persisting', async () => {
    const signedUrl = 'https://cdn.example.com/signed-file.xlsx?token=abc';
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        data: { excelFile: { fileName: 'test.xlsx', fileUrl: signedUrl, fileSize: 1024 }, checkboxConfirmation: true },
      },
      adminUser,
    );

    expect(mockFileUrlNormalizer.toRawStoragePath).toHaveBeenCalledWith(signedUrl);

    const saveCallArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { excelFile: { fileUrl: string } };
    };
    expect(saveCallArg.$set.excelFile.fileUrl).toBe(`raw::${signedUrl}`);
  });

  // saveDraft dynamic validation: checkboxConfirmation requiredTrue enforced in draft
  it('saveDraft throws when checkboxConfirmation is present but false (requiredTrue)', async () => {
    mockFormModel.findOne.mockReturnValue(q(null));

    await expect(
      service.saveDraft(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: { checkboxConfirmation: false },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({ response: { message: 'Validation failed.' } });
  });

  // Test 13: GET form signs raw paths and returns questions array
  it('getForm returns a questions array with excelFile signed URL and folderPath set', async () => {
    const rawUrl = 'state/devolution-formula/excels/file.xlsx';
    mockFormModel.findOne.mockReturnValue(
      q({
        ...mockFormInProgress,
        excelFile: { fileName: 'file.xlsx', fileUrl: rawUrl, fileSize: 2048 },
      }),
    );
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };

    expect(Array.isArray(data.questions)).toBe(true);

    const fileQ = data.questions.find((q) => q.key === 'excelFile');
    expect(fileQ).toBeDefined();
    expect(mockFileTokenService.signFileUrl).toHaveBeenCalledWith(rawUrl);
    const fileValue = fileQ?.value as { fileUrl: string } | undefined;
    expect(fileValue?.fileUrl).toBe(`signed::${rawUrl}`);
    expect(fileQ?.folderPath).toContain('devolution-formula/excels');
  });

  // GET form: excelFile supportingContent contains action ids
  it('getForm excelFile question has supportingContent with action ids for download, view, revalidate', async () => {
    mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, activeDatasetVersion: 1 }));
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };
    const fileQ = data.questions.find((q) => q.key === 'excelFile');

    const actions = fileQ?.supportingContent?.[0]?.actions ?? [];
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('download-template');
    expect(ids).toContain('view-uploaded-data');
    expect(ids).toContain('revalidate-excel');
  });

  // Test 11: final-submit blocked when form not valid — error keyed to excelFile
  it('finalSubmit throws when validationStatus is INVALID, error keyed to excelFile', async () => {
    mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, validationStatus: 'INVALID' }));
    mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: { fileName: 'f.xlsx', fileUrl: 'path/f.xlsx', fileSize: 1024 },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { excelFile: [{ field: 'excelFile', code: 'notValid' }] },
      },
    });
  });

  // finalSubmit dynamic validation: missing excelFile rejected
  it('finalSubmit throws when excelFile is missing from data (dynamic required validation)', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          // @ts-expect-error intentionally omitting excelFile
          data: { checkboxConfirmation: true },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({ response: { message: 'Validation failed.' } });
  });

  // Test 5: installment 2 always locked — error keyed to installment
  it('finalSubmit throws for installment 2 (locked), error keyed to installment', async () => {
    mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, installment: 2, validationStatus: 'VALID' }));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 2,
          data: {
            excelFile: { fileName: 'f.xlsx', fileUrl: 'path/f.xlsx', fileSize: 1024 },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { installment: [{ field: 'installment', code: 'installment2Locked' }] },
      },
    });
  });

  // finalSubmit: excelRowCount === 0 blocks submission — error keyed to excelFile
  it('finalSubmit throws when excelRowCount is 0, error keyed to excelFile', async () => {
    mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, excelRowCount: 0, validationStatus: 'VALID' }));
    mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: { fileName: 'f.xlsx', fileUrl: 'path/f.xlsx', fileSize: 1024 },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { excelFile: [{ field: 'excelFile', code: 'noData' }] },
      },
    });
  });

  // finalSubmit: stale grant allocation blocks submission — error keyed to excelFile
  it('finalSubmit throws when stored totalMoHUAAllocation differs from current grant alloc, error keyed to excelFile', async () => {
    // Form was validated against 600_000 but current alloc is 500_000
    mockFormModel.findOne.mockReturnValue(
      q({ ...mockFormInProgress, validationStatus: 'VALID', totalMoHUAAllocation: 600_000 }),
    );
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc)); // basic=400k + performance=100k = 500k
    mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: { fileName: 'f.xlsx', fileUrl: 'path/f.xlsx', fileSize: 1024 },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { excelFile: [{ field: 'excelFile', code: 'staleAllocation' }] },
      },
    });
  });

  // installment 1 prerequisite not met — error keyed to installment
  it('finalSubmit throws when installment 1 EULB prerequisite is not met, error keyed to installment', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress)); // validationStatus: VALID, excelRowCount: 2
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(q(null)); // EULB not yet acknowledged

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: { fileName: 'f.xlsx', fileUrl: 'path/f.xlsx', fileSize: 1024 },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { installment: [{ field: 'installment', code: 'prerequisiteNotMet' }] },
      },
    });
  });

  // GET response: no old flat fields exposed at top level
  it('getForm response does not include flat excelFile, excelFolderPath, or supportingActions at top level', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as Record<string, unknown>;

    expect(data).not.toHaveProperty('excelFolderPath');
    expect(data).not.toHaveProperty('supportingActions');
    expect(data).toHaveProperty('questions');
    expect(Array.isArray(data['questions'])).toBe(true);
  });
});

// ─── 5 · DevolutionFormulaRowService ─────────────────────────────────────────

describe('DevolutionFormulaRowService', () => {
  let service: DevolutionFormulaRowService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaRowService,
        DevolutionFormulaValidator,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: mockFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: mockRowModel },
        { provide: ExcelService, useValue: { generateExcel: jest.fn() } },
      ],
    }).compile();

    service = module.get<DevolutionFormulaRowService>(DevolutionFormulaRowService);
  });

  // Test 6: unknown ULB row — only registry error, business checks skipped
  it('updateRow adds only the registry error for a row with no ulbId (unknown ULB skips business checks)', async () => {
    const rowWithNoUlb = { ...mockRow, ulbId: null };

    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
    mockRowModel.findOne.mockReturnValue(q(rowWithNoUlb));
    mockRowModel.findByIdAndUpdate.mockReturnValue(q({ ...rowWithNoUlb, validationStatus: 'INVALID' }));
    mockRowModel.find.mockReturnValue(q([]));
    mockRowModel.countDocuments
      .mockReturnValueOnce(q(1)) // recalc: total active rows
      .mockReturnValueOnce(q(0)) // after: valid count
      .mockReturnValueOnce(q(1)); // after: total count
    mockFormModel.findById
      .mockReturnValueOnce(q({ totalMoHUAAllocation: 500_000, excelRowCount: 1 }))
      .mockReturnValueOnce(q({ ...mockFormInProgress, totalAllocatedSum: 0, errorRowCount: 1 }));
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));

    await service.updateRow(
      stateOid.toString(),
      YEAR_ID,
      1,
      rowOid.toString(),
      { devolutionFormula: 'newFormula' },
      adminUser,
    );

    const rowUpdateArg = (mockRowModel.findByIdAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { errors: Array<{ code: string }> };
    };
    expect(rowUpdateArg.$set.errors).toHaveLength(1);
    expect(rowUpdateArg.$set.errors[0].code).toBe('unknownUlb');
  });

  // Test 14: updateRow triggers form-level recalculation
  it('updateRow recalculates parent form totalAllocatedSum and validationStatus after a valid edit', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
    mockRowModel.findOne.mockReturnValue(q(mockRow));
    mockRowModel.findByIdAndUpdate.mockReturnValue(q(mockRow));
    mockRowModel.find.mockReturnValue(q([{ totalGrantAllocation: 500_000 }]));
    mockRowModel.countDocuments
      .mockReturnValueOnce(q(1)) // recalc: total active rows
      .mockReturnValueOnce(q(1)) // after: valid count
      .mockReturnValueOnce(q(1)); // after: total count
    mockFormModel.findById
      .mockReturnValueOnce(q({ totalMoHUAAllocation: 500_000, excelRowCount: 1 }))
      .mockReturnValueOnce(q({ ...mockFormInProgress, totalAllocatedSum: 500_000 }));
    mockFormModel.findByIdAndUpdate.mockReturnValue(q(null));

    await service.updateRow(
      stateOid.toString(),
      YEAR_ID,
      1,
      rowOid.toString(),
      { devolutionFormula: 'updated-formula' },
      adminUser,
    );

    const formUpdateArg = (mockFormModel.findByIdAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { totalAllocatedSum: number };
    };
    expect(formUpdateArg.$set.totalAllocatedSum).toBe(500_000);
  });

  // Test 15: mutation blocked when form is under MoHUA review
  it('updateRow throws when form currentFormStatus is UNDER_REVIEW_BY_MOHUA', async () => {
    mockFormModel.findOne.mockReturnValue(
      q({ ...mockFormInProgress, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
    );

    await expect(
      service.updateRow(
        stateOid.toString(),
        YEAR_ID,
        1,
        rowOid.toString(),
        { devolutionFormula: 'newFormula' },
        adminUser,
      ),
    ).rejects.toThrow();
  });
});
