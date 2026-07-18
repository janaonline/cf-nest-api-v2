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
import { Ulb } from 'src/schemas/ulb.schema';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Scope, UserRole, AccessLevel } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ForbiddenException } from '@nestjs/common';
import { SaveDraftDevolutionFormulaDto } from './dto/save-draft-devolution-formula.dto';
import { DumpDevolutionFormulaQueryDto } from './dto/dump-devolution-formula-query.dto';
import { DF_DUMP_HEADERS, DF_TEMPLATE_HEADERS } from './constants/devolution-formula.constants';
import { DfFormJsonConfigService } from './services/form-json/devolution-formula-form-json.service';
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
  aggregate: jest.fn(),
};

const mockGrantAllocationModel = { findOne: jest.fn() };
const mockEulbModel = { findOne: jest.fn() };
const mockUlbModel = { countDocuments: jest.fn() };

const mockDfFormJsonConfig = { loadFields: jest.fn() };

const mockDfTypedFields = [
  {
    fieldTypes: ['DF_MAIN_FORM_FIELDS'],
    formFieldType: 'number',
    key: 'ulbCount',
    label: 'Active ULBs Registered on City Finance as of March 31, 2026',
    value: 0,
    placeholder: '',
    disabled: true,
    disabledReason: 'This value is automatically computed from City Finance registered active ULBs.',
    includeInPayload: false,
    validations: [],
    layout: { variant: 'inline', labelWidth: 'lg' },
  },
  {
    fieldTypes: ['DF_MAIN_FORM_FIELDS'],
    formFieldType: 'file',
    key: 'excelFile',
    label: 'Upload Devolution Formula Excel',
    allowedFileTypes: ['xlsx', 'xls'],
    maxFileSize: 20,
    folderPathKey: 'devolution-formula/excels',
    validations: [{ name: 'required', validator: null, message: 'Excel file is required.' }],
    appearance: { color: 'success', variant: 'soft' },
    value: { originalName: '', path: '', mimeType: '', sizeKb: 0, pageCount: null },
  },
  {
    fieldTypes: ['DF_MAIN_FORM_FIELDS'],
    formFieldType: 'checkbox',
    key: 'checkboxConfirmation',
    label: 'I understand...',
    value: false,
    validations: [{ name: 'requiredTrue', validator: null, message: 'Please confirm before submitting.' }],
  },
  {
    fieldTypes: ['DF_ROW_EDIT_FIELDS'],
    formFieldType: 'number',
    key: 'totalGrantAllocation',
    label: 'Total Grant Allocation',
    validations: [
      { name: 'required', validator: null, message: 'Total Grant Allocation is required.' },
      { name: 'min', validator: 0, message: 'Total Grant Allocation cannot be negative.' },
    ],
  },
  {
    fieldTypes: ['DF_ROW_EDIT_FIELDS'],
    formFieldType: 'number',
    key: 'installment1Amount',
    label: 'Installment 1 Amount',
    validations: [
      { name: 'required', validator: null, message: 'Installment 1 Amount is required.' },
      { name: 'min', validator: 0, message: 'Installment 1 Amount cannot be negative.' },
    ],
  },
  {
    fieldTypes: ['DF_ROW_EDIT_FIELDS'],
    formFieldType: 'number',
    key: 'installment2Amount',
    label: 'Installment 2 Amount',
    validations: [
      { name: 'required', validator: null, message: 'Installment 2 Amount is required.' },
      { name: 'min', validator: 0, message: 'Installment 2 Amount cannot be negative.' },
    ],
  },
  {
    fieldTypes: ['DF_ROW_EDIT_FIELDS'],
    formFieldType: 'text',
    key: 'devolutionFormula',
    label: 'Devolution Formula',
    validations: [
      { name: 'required', validator: null, message: 'Devolution Formula is required.' },
      { name: 'maxLength', validator: 250, message: 'Devolution Formula cannot exceed 250 characters.' },
    ],
  },
];

// ─── 1 · Constants ───────────────────────────────────────────────────────────

describe('Devolution Formula — constants', () => {
  it('DF_TEMPLATE_HEADERS includes Census Code and does not include SB Code (mirrors EULB)', () => {
    const labels = DF_TEMPLATE_HEADERS.map((h) => h.label);
    expect(labels).toContain('Census Code');
    expect(labels).not.toContain('SB Code');
  });
});

// ─── 2 · DevolutionFormulaValidator ──────────────────────────────────────────

describe('DevolutionFormulaValidator', () => {
  const validator = new DevolutionFormulaValidator();

  const baseRow = (): DfParsedExcelRow => ({
    rowNumber: 1,
    censusCode: 'C001',
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
        excelFile: {
          originalName: 'test.xlsx',
          path: 'some/path.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
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
    mockRowModel.findOne.mockReturnValue(q(null));
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);
    mockUlbModel.countDocuments.mockResolvedValue(2);

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
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: XvifcFormActorsService, useValue: mockActorsService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
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
    const rawPath = 'state/devolution-formula/excels/signed-file.xlsx';
    mockFileUrlNormalizer.toRawStoragePath.mockReturnValueOnce(rawPath);
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        data: {
          excelFile: {
            originalName: 'test.xlsx',
            path: signedUrl,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          checkboxConfirmation: true,
        },
      },
      adminUser,
    );

    expect(mockFileUrlNormalizer.toRawStoragePath).toHaveBeenCalledWith(signedUrl);

    const saveCallArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { excelFile: { path: string } };
    };
    expect(saveCallArg.$set.excelFile.path).toBe(rawPath);
  });

  // saveDraft: pageCount from the shared file-upload component is persisted alongside the normalized URL
  it('saveDraft persists excelFile.pageCount (null for Excel uploads)', async () => {
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        data: {
          excelFile: {
            originalName: 'test.xlsx',
            path: 'path/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            pageCount: null,
          },
          checkboxConfirmation: true,
        },
      },
      adminUser,
    );

    const saveCallArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { excelFile: { pageCount?: number | null } };
    };
    expect(saveCallArg.$set.excelFile.pageCount).toBeNull();
  });

  // saveDraft dynamic validation: checkboxConfirmation requiredTrue mandatory-on-draft
  // enforcement is temporarily disabled (see DynamicFormValidationService) — draft now
  // succeeds even with checkboxConfirmation false.
  it('saveDraft succeeds when checkboxConfirmation is present but false (requiredTrue mandatory-on-draft disabled)', async () => {
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
    ).resolves.toBeDefined();
  });

  // saveDraft: ulbCount is now server-computed — dto.data.ulbCount is ignored
  it('saveDraft persists server-computed ulbCount, ignores dto.data.ulbCount', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(37);
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        data: { checkboxConfirmation: true, ulbCount: 999 }, // client value must be ignored
      },
      adminUser,
    );

    const updatePayload = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { ulbCount?: number };
    };
    expect(updatePayload.$set.ulbCount).toBe(37); // computed, not 999
  });

  // saveDraft: computed ulbCount always written even when dto.data.ulbCount is absent
  it('saveDraft always writes computed ulbCount to the update payload even when dto.data.ulbCount is absent', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(10);
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      { stateId: stateOid.toString(), yearId: YEAR_ID, installment: 1, data: { checkboxConfirmation: true } },
      adminUser,
    );

    const updatePayload = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(updatePayload.$set['ulbCount']).toBe(10);
  });

  // saveDraft: countDocuments called with correct filter
  it('saveDraft calls ulbModel.countDocuments with { state: stateOid, isActive: true }', async () => {
    mockFormModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.saveDraft(
      { stateId: stateOid.toString(), yearId: YEAR_ID, installment: 1, data: { checkboxConfirmation: true } },
      adminUser,
    );

    expect(mockUlbModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.any(Types.ObjectId), isActive: true }),
    );
  });

  // Test 13: GET form signs raw paths and returns questions array
  it('getForm returns a questions array with excelFile signed URL and folderPath set', async () => {
    const rawUrl = 'state/devolution-formula/excels/file.xlsx';
    mockFormModel.findOne.mockReturnValue(
      q({
        ...mockFormInProgress,
        excelFile: {
          originalName: 'file.xlsx',
          path: rawUrl,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };

    expect(Array.isArray(data.questions)).toBe(true);

    const fileQ = data.questions.find((q) => q.key === 'excelFile');
    expect(fileQ).toBeDefined();
    expect(mockFileTokenService.signFileUrl).toHaveBeenCalledWith(rawUrl);
    const fileValue = fileQ?.value as { path: string } | undefined;
    expect(fileValue?.path).toBe(`signed::${rawUrl}`);
    expect(fileQ?.folderPath).toContain('devolution-formula/excels');
  });

  // GET form: saved pageCount is returned on the hydrated excelFile value
  it('getForm returns the saved excelFile.pageCount alongside the signed URL', async () => {
    const rawUrl = 'state/devolution-formula/excels/file.xlsx';
    mockFormModel.findOne.mockReturnValue(
      q({
        ...mockFormInProgress,
        excelFile: {
          originalName: 'file.xlsx',
          path: rawUrl,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          pageCount: null,
        },
      }),
    );
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };

    const fileQ = data.questions.find((q) => q.key === 'excelFile');
    const fileValue = fileQ?.value as { path: string; pageCount?: number | null } | undefined;
    expect(fileValue?.path).toBe(`signed::${rawUrl}`);
    expect(fileValue?.pageCount).toBeNull();
  });

  // GET form: ulbCount question is first, alongside excelFile/checkboxConfirmation
  it('getForm questions[0] is ulbCount, with excelFile and checkboxConfirmation still present', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };

    expect(data.questions[0]?.key).toBe('ulbCount');
    expect(data.questions.map((q) => q.key)).toContain('excelFile');
    expect(data.questions.map((q) => q.key)).toContain('checkboxConfirmation');
  });

  // GET form: ulbCount is now server-computed, not read from doc
  it('getForm hydrates ulbCount from ulbModel.countDocuments, ignoring doc.ulbCount', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(57);
    mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, ulbCount: 42 })); // doc has 42
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };

    const ulbCountQ = data.questions.find((q) => q.key === 'ulbCount');
    expect(ulbCountQ?.value).toBe(57); // computed, not 42 from doc
  });

  it('getForm ulbCount question has disabled: true, disabledReason set, and includeInPayload: false', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as { questions: HydratedFieldConfig[] };

    const ulbCountQ = data.questions.find((q) => q.key === 'ulbCount') as Record<string, unknown> | undefined;
    expect(ulbCountQ?.['disabled']).toBe(true);
    expect(ulbCountQ?.['disabledReason']).toBeTruthy();
    expect(ulbCountQ?.['includeInPayload']).toBe(false);
  });

  it('getForm calls ulbModel.countDocuments with { state: stateOid, isActive: true }', async () => {
    mockFormModel.findOne.mockReturnValue(q(null));
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

    await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);

    expect(mockUlbModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.any(Types.ObjectId), isActive: true }),
    );
  });

  // ─── GET form: installmentAccess ───────────────────────────────────────────

  describe('getForm installmentAccess', () => {
    it('response includes installmentAccess', async () => {
      mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { installmentAccess?: unknown };

      expect(data.installmentAccess).toBeDefined();
    });

    it('installment1 is always selectable and unlocked', async () => {
      mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as {
        installmentAccess: { installment1: { canSelect: boolean; locked: boolean; lockReason: string | null } };
      };

      expect(data.installmentAccess.installment1).toEqual({
        canSelect: true,
        locked: false,
        lockReason: null,
      });
    });

    it('installment2 is locked when no acknowledged Installment 1 claim batch exists', async () => {
      mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as {
        installmentAccess: { installment2: { canSelect: boolean; locked: boolean; lockReason: string | null } };
      };

      expect(data.installmentAccess.installment2.canSelect).toBe(false);
      expect(data.installmentAccess.installment2.locked).toBe(true);
    });

    it('installment2 lockReason matches the required message', async () => {
      mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { installmentAccess: { installment2: { lockReason: string | null } } };

      expect(data.installmentAccess.installment2.lockReason).toBe(
        'Installment 2 is locked until at least one Installment 1 claim batch is acknowledged by MoHUA.',
      );
    });
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

  // ─── excelFile supportingContent — badges ──────────────────────────────────

  describe('excelFile supportingContent — badges', () => {
    const docWithErrors = { ...mockFormInProgress, errorRowCount: 3, validationStatus: 'INVALID' as const };
    const docUnbalanced = { ...mockFormInProgress, totalAllocatedSum: 400_000 };
    const docNoDataset = { ...mockFormInProgress, activeDatasetVersion: 0 };

    async function getBadges(doc: object) {
      mockFormModel.findOne.mockReturnValue(q(doc));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { questions: HydratedFieldConfig[] };
      const fileQ = data.questions.find((q) => q.key === 'excelFile');
      return fileQ?.supportingContent?.[0]?.badges ?? [];
    }

    it('badges array exists on excelFile supportingContent', async () => {
      const badges = await getBadges(mockFormInProgress);
      expect(Array.isArray(badges)).toBe(true);
      expect(badges.length).toBeGreaterThan(0);
    });

    it('Total rows badge is visible with correct label when activeDatasetVersion > 0', async () => {
      const badges = await getBadges(mockFormInProgress);
      const badge = badges.find((b) => b.label?.startsWith('Total rows'));
      expect(badge).toBeDefined();
      expect(badge?.visible).toBe(true);
      expect(badge?.label).toBe('Total rows: 2');
    });

    it('Total rows badge is not visible when no active dataset', async () => {
      const badges = await getBadges(docNoDataset);
      const badge = badges.find((b) => b.label?.startsWith('Total rows'));
      expect(badge?.visible).toBe(false);
    });

    it('Error badge is not visible when errorRowCount is 0', async () => {
      const badges = await getBadges(mockFormInProgress);
      const badge = badges.find((b) => b.label?.includes('error(s)'));
      expect(badge?.visible).toBe(false);
    });

    it('Error badge is visible with correct label when errorRowCount > 0', async () => {
      const badges = await getBadges(docWithErrors);
      const badge = badges.find((b) => b.label?.includes('error(s)'));
      expect(badge).toBeDefined();
      expect(badge?.visible).toBe(true);
      expect(badge?.label).toBe('3 error(s)');
    });

    it('Allocated amount badge label uses INR format with Cr. suffix', async () => {
      const badges = await getBadges(mockFormInProgress);
      const badge = badges.find((b) => b.label?.startsWith('Allocated amount'));
      expect(badge?.label).toBe('Allocated amount: ₹5,00,000 Cr.');
    });

    it('Allocated sum badge tone is success when allocation is balanced', async () => {
      const badges = await getBadges(mockFormInProgress);
      const badge = badges.find((b) => b.label?.startsWith('Allocated sum'));
      expect(badge?.tone).toBe('success');
    });

    it('Allocated sum badge tone is danger when allocation is unbalanced', async () => {
      const badges = await getBadges(docUnbalanced);
      const badge = badges.find((b) => b.label?.startsWith('Allocated sum'));
      expect(badge?.tone).toBe('danger');
    });

    it('Remaining badge label shows formatted difference with Cr. suffix', async () => {
      const badges = await getBadges(docUnbalanced);
      const badge = badges.find((b) => b.label?.startsWith('Remaining'));
      expect(badge?.label).toBe('Remaining: ₹1,00,000 Cr.');
    });

    it('All valid badge is visible when validationStatus is VALID', async () => {
      const badges = await getBadges(mockFormInProgress);
      const badge = badges.find((b) => b.label === 'All valid');
      expect(badge).toBeDefined();
      expect(badge?.visible).toBe(true);
    });
  });

  // ─── excelFile supportingContent — Register ULB action (Phase 5) ──────────

  describe('excelFile supportingContent — Register ULB action', () => {
    const docWithNewUlbs = {
      ...mockFormInProgress,
      newUlbCount: 2,
      errorRowCount: 2,
      validationStatus: 'INVALID' as const,
    };
    const docAllocationMismatchOnly = {
      ...mockFormInProgress,
      newUlbCount: 0,
      totalAllocatedSum: 400_000,
      validationStatus: 'INVALID' as const,
    };

    async function getSupportingContent(doc: object) {
      mockFormModel.findOne.mockReturnValue(q(doc));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { questions: HydratedFieldConfig[] };
      const fileQ = data.questions.find((q) => q.key === 'excelFile');
      return fileQ?.supportingContent ?? [];
    }

    function findRegisterUlbAction(supportingContent: Array<{ actions?: Array<Record<string, unknown>> }>) {
      for (const block of supportingContent) {
        const action = block.actions?.find((a) => a['id'] === 'register-ulb');
        if (action) return action;
      }
      return undefined;
    }

    it('is visible when newUlbCount > 0', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action).toBeDefined();
      expect(action?.['visible']).toBe(true);
    });

    it('uses label "Register ULB"', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['label']).toBe('Register ULB');
    });

    it('uses target "/xvifc/:yearId/register-ulb" built from the runtime yearId', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['url']).toBe(`/xvifc/${YEAR_ID}/register-ulb`);
    });

    it('does not use the "/resigter-ulb" typo route', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['url']).not.toContain('resigter-ulb');
    });

    it('does not include a frontend host/domain in the url', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['url']).toMatch(/^\//);
      expect(action?.['url']).not.toMatch(/^https?:\/\//);
    });

    it('uses a green/success tone', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['tone']).toBe('success');
    });

    it('uses icon "bi bi-person-check"', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['icon']).toBe('bi bi-person-check');
    });

    it('is included in the same first supportingContent block as download-template (no separate block)', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      expect(supportingContent.length).toBe(1);
      const ids = (supportingContent[0]?.actions ?? []).map((a) => (a as { id: string }).id);
      expect(ids).toContain('download-template');
      expect(ids).toContain('register-ulb');
    });

    it('is not visible when newUlbCount is 0', async () => {
      const supportingContent = await getSupportingContent(mockFormInProgress);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['visible']).toBe(false);
    });

    it('does not create a second supportingContent block when newUlbCount is 0', async () => {
      const supportingContent = await getSupportingContent(mockFormInProgress);
      expect(supportingContent.length).toBe(1);
    });

    it('is not visible for an allocation-mismatch-only failure (no new ULBs)', async () => {
      const supportingContent = await getSupportingContent(docAllocationMismatchOnly);
      const action = findRegisterUlbAction(supportingContent);
      expect(action?.['visible']).toBe(false);
    });

    it('preserves existing download-template/view-uploaded-data/error-sheet/revalidate actions when newUlbCount > 0', async () => {
      const supportingContent = await getSupportingContent(docWithNewUlbs);
      const ids = (supportingContent[0]?.actions ?? []).map((a) => (a as { id: string }).id);
      expect(ids).toContain('download-template');
      expect(ids).toContain('view-uploaded-data');
      expect(ids).toContain('download-error-sheet');
      expect(ids).toContain('revalidate-excel');
    });
  });

  // ─── validationSummary.newUlbCount (Phase 6) ───────────────────────────────

  describe('GET form validationSummary — newUlbCount', () => {
    it('includes newUlbCount on the validationSummary', async () => {
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, newUlbCount: 3 }));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { validationSummary: { newUlbCount: number } };

      expect(data.validationSummary).toHaveProperty('newUlbCount');
    });

    it('defaults newUlbCount to 0 when the form has no persisted newUlbCount', async () => {
      mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { validationSummary: { newUlbCount: number } };

      expect(data.validationSummary.newUlbCount).toBe(0);
    });

    it('returns the persisted newUlbCount when greater than 0', async () => {
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, newUlbCount: 4 }));
      mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));

      const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
      const data = result.data as { validationSummary: { newUlbCount: number } };

      expect(data.validationSummary.newUlbCount).toBe(4);
    });
  });

  // ─── finalSubmit blocking gates — newUlbCount / identityModified (Phase 7) ─

  describe('finalSubmit — new ULB / identity-modified blocking gates', () => {
    it('rejects when persisted newUlbCount > 0, error keyed to excelFile with code newUlbsAdded', async () => {
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, newUlbCount: 3 }));
      mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));

      await expect(
        service.finalSubmit(
          {
            stateId: stateOid.toString(),
            yearId: YEAR_ID,
            installment: 1,
            data: {
              excelFile: {
                originalName: 'f.xlsx',
                path: 'path/f.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeKb: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              checkboxConfirmation: true,
              ulbCount: 50,
            },
          },
          adminUser,
        ),
      ).rejects.toMatchObject({
        response: {
          message: 'Validation failed.',
          errors: { excelFile: [{ field: 'excelFile', code: 'newUlbsAdded' }] },
        },
      });
    });

    it('newUlbsAdded message includes the persisted count', async () => {
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, newUlbCount: 3 }));
      mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));

      await expect(
        service.finalSubmit(
          {
            stateId: stateOid.toString(),
            yearId: YEAR_ID,
            installment: 1,
            data: {
              excelFile: {
                originalName: 'f.xlsx',
                path: 'path/f.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeKb: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              checkboxConfirmation: true,
              ulbCount: 50,
            },
          },
          adminUser,
        ),
      ).rejects.toMatchObject({
        response: {
          errors: {
            excelFile: [{ message: 'You have added 3 ULB(s). Please register before proceeding.' }],
          },
        },
      });
    });

    it('rejects when the active dataset has a row error with code identityModified, error keyed to excelFile', async () => {
      mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));
      mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));
      mockRowModel.findOne.mockReturnValue(q({ _id: rowOid }));

      await expect(
        service.finalSubmit(
          {
            stateId: stateOid.toString(),
            yearId: YEAR_ID,
            installment: 1,
            data: {
              excelFile: {
                originalName: 'f.xlsx',
                path: 'path/f.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeKb: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              checkboxConfirmation: true,
              ulbCount: 50,
            },
          },
          adminUser,
        ),
      ).rejects.toMatchObject({
        response: {
          message: 'Validation failed.',
          errors: { excelFile: [{ field: 'excelFile', code: 'identityModified' }] },
        },
      });
    });

    it('returns both newUlbsAdded and identityModified under errors.excelFile when both conditions exist', async () => {
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, newUlbCount: 2 }));
      mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));
      mockRowModel.findOne.mockReturnValue(q({ _id: rowOid }));

      await expect(
        service.finalSubmit(
          {
            stateId: stateOid.toString(),
            yearId: YEAR_ID,
            installment: 1,
            data: {
              excelFile: {
                originalName: 'f.xlsx',
                path: 'path/f.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeKb: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              checkboxConfirmation: true,
              ulbCount: 50,
            },
          },
          adminUser,
        ),
      ).rejects.toMatchObject({
        response: {
          message: 'Validation failed.',
          errors: {
            excelFile: [
              { field: 'excelFile', code: 'newUlbsAdded' },
              { field: 'excelFile', code: 'identityModified' },
            ],
          },
        },
      });
    });

    it('happy path: finalSubmit succeeds when newUlbCount is 0, no identityModified rows, validationStatus VALID, and excelRowCount matches computed active ULB count', async () => {
      mockUlbModel.countDocuments.mockResolvedValue(50);
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, excelRowCount: 50, newUlbCount: 0 }));
      mockEulbModel.findOne.mockReturnValue(
        q({ _id: new Types.ObjectId(), currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
      );
      mockRowModel.findOne.mockReturnValue(q(null));
      mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

      await expect(
        service.finalSubmit(
          {
            stateId: stateOid.toString(),
            yearId: YEAR_ID,
            installment: 1,
            data: {
              excelFile: {
                originalName: 'f.xlsx',
                path: 'path/f.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeKb: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              checkboxConfirmation: true,
            },
          },
          adminUser,
        ),
      ).resolves.not.toThrow();
    });

    it('finalSubmit preserves data.excelFile.pageCount in the persisted update', async () => {
      mockUlbModel.countDocuments.mockResolvedValue(50);
      mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, excelRowCount: 50, newUlbCount: 0 }));
      mockEulbModel.findOne.mockReturnValue(
        q({ _id: new Types.ObjectId(), currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
      );
      mockRowModel.findOne.mockReturnValue(q(null));
      mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

      await service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              pageCount: null,
            },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      );

      const updatePayload = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
        $set: { excelFile: { pageCount?: number | null } };
      };
      expect(updatePayload.$set.excelFile.pageCount).toBeNull();
    });
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
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            ulbCount: 50,
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
          data: { checkboxConfirmation: true, ulbCount: 50 },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({ response: { message: 'Validation failed.' } });
  });

  // finalSubmit: ulbCount is now server-computed — missing dto.data.ulbCount no longer blocks
  it('finalSubmit does not require ulbCount in dto.data (it is server-computed)', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(2);
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress)); // excelRowCount: 2
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));
    mockRowModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            // ulbCount intentionally omitted
          },
        },
        adminUser,
      ),
    ).resolves.not.toThrow();
  });

  // finalSubmit: excelRowCount !== computed active ULB count → excelFile.excelInvalid
  it('finalSubmit blocks when form.excelRowCount does not match computed active ULB count, error keyed to excelFile with code excelInvalid', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(5); // registry has 5 active ULBs
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress)); // excelRowCount: 2
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));
    mockRowModel.findOne.mockReturnValue(q(null));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
          },
        },
        adminUser,
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed.',
        errors: { excelFile: [{ field: 'excelFile', code: 'excelInvalid' }] },
      },
    });
  });

  // finalSubmit: computed count is persisted as ulbCount on successful submit
  it('finalSubmit persists computedActiveUlbCount as ulbCount in the final update', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(2);
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress)); // excelRowCount: 2
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));
    mockRowModel.findOne.mockReturnValue(q(null));
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await service.finalSubmit(
      {
        stateId: stateOid.toString(),
        yearId: YEAR_ID,
        installment: 1,
        data: {
          excelFile: {
            originalName: 'f.xlsx',
            path: 'path/f.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          checkboxConfirmation: true,
        },
      },
      adminUser,
    );

    const updatePayload = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { ulbCount?: number };
    };
    expect(updatePayload.$set.ulbCount).toBe(2); // server-computed, not from dto
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
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            ulbCount: 50,
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
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            ulbCount: 50,
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
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            ulbCount: 50,
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

  // installment 1 prerequisite not met — EULB not yet under review by MoHUA
  it('finalSubmit throws when installment 1 EULB prerequisite is not met, error keyed to installment', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress)); // validationStatus: VALID, excelRowCount: 2
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(q(null)); // EULB not yet under review

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            ulbCount: 50,
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

  // installment 1 prerequisite met — EULB is UNDER_REVIEW_BY_MOHUA
  it('finalSubmit installment 1 prerequisite passes when EULB currentFormStatus is UNDER_REVIEW_BY_MOHUA', async () => {
    mockUlbModel.countDocuments.mockResolvedValue(50); // must match excelRowCount below
    mockFormModel.findOne.mockReturnValue(q({ ...mockFormInProgress, excelRowCount: 50, newUlbCount: 0 }));
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockEulbModel.findOne.mockReturnValue(
      q({ _id: new Types.ObjectId(), currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
    );
    mockRowModel.findOne.mockReturnValue(q(null)); // no identityModified rows
    mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid }));

    await expect(
      service.finalSubmit(
        {
          stateId: stateOid.toString(),
          yearId: YEAR_ID,
          installment: 1,
          data: {
            excelFile: {
              originalName: 'f.xlsx',
              path: 'path/f.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
            ulbCount: 50,
          },
        },
        adminUser,
      ),
    ).resolves.not.toThrow();

    const updatePayload = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][][])[0][1] as {
      $set: { ulbCount?: number };
    };
    expect(updatePayload.$set.ulbCount).toBe(50);
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

// ─── 6 · ULB identifier consolidation (mirrors EULB) ─────────────────────────

describe('Devolution Formula — ULB identifier consolidation', () => {
  it('template row uses censusCode when censusCode is present on ULB', () => {
    const ulb = { censusCode: 'C001', sbCode: '' };
    const identifier = ulb.censusCode || ulb.sbCode || '';
    expect(identifier).toBe('C001');
  });

  it('template row falls back to sbCode when censusCode is absent or empty', () => {
    const ulb = { censusCode: '', sbCode: 'SB001' };
    const identifier = ulb.censusCode || ulb.sbCode || '';
    expect(identifier).toBe('SB001');
  });

  it('template row returns empty string when both censusCode and sbCode are absent', () => {
    const ulb = { censusCode: '', sbCode: '' };
    const identifier = ulb.censusCode || ulb.sbCode || '';
    expect(identifier).toBe('');
  });

  it('DF_TEMPLATE_HEADERS has exactly one identifier column (Census Code)', () => {
    const identifierCols = DF_TEMPLATE_HEADERS.filter((h) => h.key === 'censusCode' || h.key === 'sbCode');
    expect(identifierCols).toHaveLength(1);
    expect(identifierCols[0].key).toBe('censusCode');
    expect(identifierCols[0].label).toBe('Census Code');
  });

  it('ulb lookup map uses censusCode when present, sbCode as fallback (uses || to handle empty strings)', () => {
    type FakeUlb = { _id: string; censusCode?: string | null; sbCode?: string | null };
    const dbUlbs: FakeUlb[] = [
      { _id: 'u1', censusCode: 'C001', sbCode: null }, // census code only
      { _id: 'u2', censusCode: null, sbCode: 'SB002' }, // null censusCode → sbCode
      { _id: 'u3', censusCode: '', sbCode: 'SB003' }, // empty censusCode → sbCode
    ];
    const ulbByCode = new Map<string, FakeUlb>();
    for (const ulb of dbUlbs) {
      const code = String(ulb.censusCode || ulb.sbCode || '')
        .trim()
        .toLowerCase();
      if (code) ulbByCode.set(code, ulb);
    }
    expect(ulbByCode.get('c001')?._id).toBe('u1');
    expect(ulbByCode.get('sb002')?._id).toBe('u2');
    expect(ulbByCode.get('sb003')?._id).toBe('u3');
  });

  it('registry: identifierMissing error is keyed to censusCode field', () => {
    const missingIdentifierError = {
      field: 'censusCode',
      code: 'identifierMissing',
      message: 'Census Code is required.',
    };
    expect(missingIdentifierError.field).toBe('censusCode');
    expect(missingIdentifierError.code).toBe('identifierMissing');
  });

  it('registry: unknownUlb error is keyed to censusCode field', () => {
    const unknownError = {
      field: 'censusCode',
      code: 'unknownUlb',
      message: 'Census Code "X999" does not match any active onboarded ULB for this state.',
    };
    expect(unknownError.field).toBe('censusCode');
    expect(unknownError.code).toBe('unknownUlb');
  });
});

// ─── 8 · getForm includes rowEditFields ───────────────────────────────────────

describe('Devolution Formula — getForm rowEditFields', () => {
  let service: DevolutionFormulaService;

  const mockActorsService = {
    buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Test State' }),
  };
  const mockFileTokenService = { signFileUrl: jest.fn((url: string) => `signed::${url}`) };
  const mockFileUrlNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGrantAllocationModel.findOne.mockReturnValue(q(mockGrantAlloc));
    mockDfFormJsonConfig.loadFields.mockResolvedValue(mockDfTypedFields);
    mockUlbModel.countDocuments.mockResolvedValue(2);

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
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: XvifcFormActorsService, useValue: mockActorsService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
        FileInfoNormalizerService,
        { provide: DfFormJsonConfigService, useValue: mockDfFormJsonConfig },
      ],
    }).compile();

    service = module.get<DevolutionFormulaService>(DevolutionFormulaService);
  });

  it('getForm includes rowEditFields in response with 4 entries', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as Record<string, unknown>;

    expect(data).toHaveProperty('rowEditFields');
    expect(Array.isArray(data['rowEditFields'])).toBe(true);
    expect((data['rowEditFields'] as unknown[]).length).toBe(4);
  });

  it('getForm rowEditFields entries do not expose fieldTypes', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const fields = (result.data as Record<string, unknown>)['rowEditFields'] as Record<string, unknown>[];

    for (const field of fields) {
      expect(field).not.toHaveProperty('fieldTypes');
    }
  });

  it('getForm rowEditFields totalGrantAllocation has required and min validations', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const fields = (result.data as Record<string, unknown>)['rowEditFields'] as Array<{
      key: string;
      validations?: Array<{ name: string; validator: unknown }>;
    }>;

    const field = fields.find((f) => f.key === 'totalGrantAllocation');
    expect(field).toBeDefined();
    const names = field?.validations?.map((v) => v.name) ?? [];
    expect(names).toContain('required');
    expect(names).toContain('min');
  });

  it('getForm rowEditFields devolutionFormula has required and maxLength 250', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const fields = (result.data as Record<string, unknown>)['rowEditFields'] as Array<{
      key: string;
      validations?: Array<{ name: string; validator: unknown }>;
    }>;

    const field = fields.find((f) => f.key === 'devolutionFormula');
    expect(field).toBeDefined();
    const names = field?.validations?.map((v) => v.name) ?? [];
    expect(names).toContain('required');
    const maxLenV = field?.validations?.find((v) => v.name === 'maxLength');
    expect(maxLenV?.validator).toBe(250);
  });

  it('getForm preserves existing questions and validationSummary alongside rowEditFields', async () => {
    mockFormModel.findOne.mockReturnValue(q(mockFormInProgress));

    const result = await service.getForm(stateOid.toString(), YEAR_ID, 1, adminUser);
    const data = result.data as Record<string, unknown>;

    expect(data).toHaveProperty('questions');
    expect(data).toHaveProperty('validationSummary');
    expect(data).toHaveProperty('rowEditFields');
    expect(Array.isArray(data['questions'])).toBe(true);
  });

  // ─── dumpToExcel ──────────────────────────────────────────────────────────

  describe('dumpToExcel', () => {
    const stateUserNoState: AuthUser = {
      _id: new Types.ObjectId().toString(),
      role: UserRole.ADMIN,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: null,
    };

    const stateUserWithState: AuthUser = {
      _id: new Types.ObjectId().toString(),
      role: UserRole.ADMIN,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateOid,
    };

    const otherUser: AuthUser = {
      _id: new Types.ObjectId().toString(),
      role: UserRole.ADMIN,
      scope: 'MoHUA' as Scope,
      accessLevel: AccessLevel.ADMIN,
      state: null,
    };

    beforeEach(() => {
      mockRowModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      jest.spyOn((service as any).excelService, 'generateExcel').mockResolvedValue(Buffer.from(''));
    });

    it('throws ForbiddenException for STATE user with no state mapping', async () => {
      await expect(service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, stateUserNoState)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for non-STATE/non-ADMIN scope', async () => {
      await expect(service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, otherUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('calls rowModel.aggregate exactly once', async () => {
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);
      expect(mockRowModel.aggregate).toHaveBeenCalledTimes(1);
    });

    it('does not call rowModel.find', async () => {
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);
      expect(mockRowModel.find).not.toHaveBeenCalled();
    });

    it('default row match includes isActive: true', async () => {
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const rowMatchStage = pipeline.find((s) => '$match' in s && 'isActive' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(rowMatchStage?.['$match']?.['isActive']).toBe(true);
    });

    it('explicit isActive: false sets rowMatch.isActive = false', async () => {
      await service.dumpToExcel({ isActive: false } as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const rowMatchStage = pipeline.find((s) => '$match' in s && 'isActive' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(rowMatchStage?.['$match']?.['isActive']).toBe(false);
    });

    it('STATE scope sets formDoc.state to user state ObjectId', async () => {
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, stateUserWithState);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      const stateFilter = formMatchStage?.['$match']?.['formDoc.state'];
      expect(stateFilter?.toString()).toBe(stateOid.toString());
    });

    it('ADMIN with stateId sets formDoc.state to query stateId', async () => {
      const queryStateId = new Types.ObjectId();
      await service.dumpToExcel({ stateId: queryStateId.toString() } as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      const stateFilter = formMatchStage?.['$match']?.['formDoc.state'];
      expect(stateFilter?.toString()).toBe(queryStateId.toString());
    });

    it('ADMIN without stateId does not include formDoc.state in match', async () => {
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(formMatchStage?.['$match']).not.toHaveProperty('formDoc.state');
    });

    it('yearId filter sets formDoc.year in form match', async () => {
      await service.dumpToExcel({ yearId: YEAR_ID } as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      const yearFilter = formMatchStage?.['$match']?.['formDoc.year'];
      expect(yearFilter?.toString()).toBe(YEAR_ID);
    });

    it('installment filter sets formDoc.installment in form match', async () => {
      await service.dumpToExcel({ installment: 1 } as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(formMatchStage?.['$match']?.['formDoc.installment']).toBe(1);
    });

    it('validationStatus filter sets formDoc.validationStatus in form match', async () => {
      await service.dumpToExcel({ validationStatus: 'VALID' } as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(formMatchStage?.['$match']?.['formDoc.validationStatus']).toBe('VALID');
    });

    it('formStatus filter sets formDoc.currentFormStatus in form match', async () => {
      await service.dumpToExcel({ formStatus: 5 } as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(formMatchStage?.['$match']?.['formDoc.currentFormStatus']).toBe(5);
    });

    it('pipeline form match includes $expr active dataset version guard', async () => {
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);
      const [pipeline] = mockRowModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      const formMatchStage = pipeline.find((s) => '$match' in s && '$expr' in (s['$match'] as object)) as
        | { $match: Record<string, unknown> }
        | undefined;
      expect(formMatchStage?.['$match']?.['$expr']).toEqual({
        $eq: ['$datasetVersion', '$formDoc.activeDatasetVersion'],
      });
    });

    it('empty aggregate result calls generateExcel with empty rows', async () => {
      const generateExcelSpy = jest
        .spyOn((service as any).excelService, 'generateExcel')
        .mockResolvedValue(Buffer.from(''));
      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);
      expect(generateExcelSpy).toHaveBeenCalledWith(DF_DUMP_HEADERS, [], 'Devolution Formula Dump');
    });

    it('maps aggregation row to DfDumpRow shape with correct field values', async () => {
      const submittedAt = new Date('2024-01-15T10:00:00.000Z');
      const createdAt = new Date('2024-01-10T08:00:00.000Z');
      const updatedAt = new Date('2024-01-12T09:00:00.000Z');

      const aggRow = {
        rowNumber: 5,
        censusCode: 'C999',
        ulbName: 'Test City',
        totalGrantAllocation: 1_000_000,
        installment1Amount: 600_000,
        installment2Amount: 400_000,
        devolutionFormula: 'population',
        datasetVersion: 2,
        createdAt,
        updatedAt,
        formDoc: {
          year: new Types.ObjectId(YEAR_ID),
          installment: 1,
          currentFormStatus: 4,
          validationStatus: 'VALID',
          submittedAt,
        },
        stateDoc: { name: 'Maharashtra' },
        submittedByDoc: { name: 'Submitter Name' },
        createdByDoc: { name: 'Creator Name' },
        updatedByDoc: { name: 'Updater Name' },
      };

      mockRowModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([aggRow]) });

      const generateExcelSpy = jest
        .spyOn((service as any).excelService, 'generateExcel')
        .mockResolvedValue(Buffer.from(''));

      await service.dumpToExcel({} as DumpDevolutionFormulaQueryDto, adminUser);

      const [, rows] = generateExcelSpy.mock.calls[0] as [unknown, Record<string, unknown>[]];
      const row = rows[0];

      expect(row['rowNumber']).toBe(5);
      expect(row['stateName']).toBe('Maharashtra');
      expect(row['yearLabel']).toBe('2023-24');
      expect(row['installment']).toBe(1);
      expect(row['censusCode']).toBe('C999');
      expect(row['ulbName']).toBe('Test City');
      expect(row['submittedBy']).toBe('Submitter Name');
      expect(row['submittedAt']).toBe(submittedAt.toISOString());
      expect(row['createdBy']).toBe('Creator Name');
      expect(row['updatedBy']).toBe('Updater Name');
      expect(row['createdAt']).toBe(createdAt.toISOString());
      expect(row['updatedAt']).toBe(updatedAt.toISOString());
    });
  });
});
