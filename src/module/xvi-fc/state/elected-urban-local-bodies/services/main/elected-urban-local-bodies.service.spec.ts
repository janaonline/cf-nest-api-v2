import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import { ElectedUrbanLocalBodiesService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/main/elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { ExcelService } from 'src/services/excel/excel.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { FormFieldOption } from 'src/module/xvi-fc/common/types/field-config.type';
import type { EulbDumpRowRecord } from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
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

async function loadSheet(buffer: ExcelJS.Buffer, sheetName: string): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb.getWorksheet(sheetName)!;
}

function getRowStringValues(row: ExcelJS.Row): string[] {
  const values = row.values;
  return Array.isArray(values) ? values.slice(1).map((value) => String(value ?? '')) : [];
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId('67d7d136d3d038946a5239e9'); // 2026-27
const formOid = new Types.ObjectId();
const submittedByUser = { _id: new Types.ObjectId(), name: 'Submitter User' };
const createdByUser = { _id: new Types.ObjectId(), name: 'Creator User' };
const updatedByUser = { _id: new Types.ObjectId(), name: 'Updater User' };

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: AccessLevel.ADMIN,
  state: null,
};

/** Two active registry ULBs (used by both the fallback and overlay paths). */
const mockUlbs = [
  { _id: new Types.ObjectId(), name: 'Alpha City', censusCode: 'C001' },
  { _id: new Types.ObjectId(), name: 'Beta Town', censusCode: 'C002' },
];

/** Form doc with an active dataset. */
const mockFormWithDataset = {
  _id: formOid,
  activeDatasetVersion: 1,
  dbUlbCount: 2,
};

/**
 * Saved DB_ULB rows for the overlay path.
 * ulbId fields correspond to mockUlbs so the service overlay map matches.
 */
const mockSavedDbRows = [
  {
    ulbId: mockUlbs[0]._id,
    rowNumber: 1,
    censusCode: 'C001',
    ulbName: 'Alpha City',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-06-15T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-06-14T00:00:00.000Z'),
    remarks: 'All good',
    isActive: true,
  },
  {
    ulbId: mockUlbs[1]._id,
    rowNumber: 2,
    censusCode: 'C002',
    ulbName: 'Beta Town',
    electedBodyStatus: 'Not Constituted',
    dateOfConstitution: undefined,
    dateOfExpiry: undefined,
    remarks: '',
    isActive: true,
  },
];

/** Unmatched row (no ulbId) that should never appear in a newly generated template. */
const mockExtraUlbRow = {
  ulbId: undefined,
  rowNumber: 3,
  censusCode: 'EX01',
  ulbName: 'Extra ULB One',
  electedBodyStatus: '6th Schedule',
  dateOfConstitution: undefined,
  dateOfExpiry: undefined,
  remarks: 'User added',
  isActive: true,
};

type DumpRowFixture = EulbDumpRowRecord & {
  isActive: boolean;
  updateHistory?: unknown[];
  rawExcelData?: Record<string, unknown>;
  errors?: unknown[];
};

const dumpRows: DumpRowFixture[] = [
  {
    rowNumber: 1,
    censusCode: 'C001',
    ulbName: 'Alpha City',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-06-15T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-06-14T00:00:00.000Z'),
    remarks: 'Portal corrected',
    validationStatus: 'VALID',
    lastUpdatedSource: 'PORTAL',
    datasetVersion: 2,
    createdBy: createdByUser,
    updatedBy: updatedByUser,
    isActive: true,
    updateHistory: [{ previous: { remarks: 'Old' } }],
    rawExcelData: { remarks: 'Old' },
    errors: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  },
  {
    rowNumber: 2,
    censusCode: 'C002',
    ulbName: 'Beta Town',
    electedBodyStatus: 'Not Constituted',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: '',
    validationStatus: 'VALID',
    lastUpdatedSource: 'EXCEL',
    datasetVersion: 2,
    createdBy: createdByUser,
    updatedBy: createdByUser,
    isActive: true,
  },
  {
    rowNumber: 3,
    censusCode: 'OLD01',
    ulbName: 'Old Version ULB',
    electedBodyStatus: '6th Schedule',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: 'Old version',
    validationStatus: 'VALID',
    lastUpdatedSource: 'EXCEL',
    datasetVersion: 1,
    createdBy: createdByUser,
    updatedBy: updatedByUser,
    isActive: true,
  },
  {
    rowNumber: 4,
    censusCode: 'INACTIVE01',
    ulbName: 'Inactive ULB',
    electedBodyStatus: '6th Schedule',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: 'Inactive row',
    validationStatus: 'VALID',
    lastUpdatedSource: 'EXCEL',
    datasetVersion: 2,
    createdBy: createdByUser,
    updatedBy: updatedByUser,
    isActive: false,
  },
];

// ─── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_TYPED_ROW_EDIT_FIELDS: EulbTypedFieldConfig[] = [
  {
    key: 'ulbCount',
    label: 'Active ULBs Registered on City Finance as of March 31, 2026',
    formFieldType: 'number',
    fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
    disabled: true,
    disabledReason: 'This value is automatically computed from City Finance registered active ULBs.',
    includeInPayload: false,
    validations: [],
  },
  {
    key: 'electedBodyExcelFile',
    label: 'Upload Elected Bodies Excel',
    formFieldType: 'file',
    fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
    folderPath: 'state/test/',
    allowedFileTypes: ['xlsx', 'xls'],
    maxFileSize: 20,
    validations: [],
  },
  {
    key: 'signedElectedbodyFile',
    label: 'Upload Signed elected bodies list',
    formFieldType: 'file',
    fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
    folderPath: 'state/test/',
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
  },
  {
    key: 'censusCode',
    label: 'Census Code',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [{ name: 'required', validator: null, message: 'Census Code is required.' }],
  },
  {
    key: 'ulbName',
    label: 'ULB Name',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [{ name: 'required', validator: null, message: 'ULB Name is required.' }],
  },
  {
    key: 'electedBodyStatus',
    label: 'Elected Body Status',
    formFieldType: 'select',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    options: [
      { id: 'Constituted', label: 'Constituted' },
      { id: 'Not Constituted', label: 'Not Constituted' },
      { id: '6th Schedule', label: '6th Schedule' },
    ] as FormFieldOption[],
    validations: [{ name: 'required', validator: null, message: 'Elected Body Status is required.' }],
  },
  {
    key: 'dateOfConstitution',
    label: 'Date on which the elected body is in place.',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    minDate: '2021-05-31',
    maxDate: 'TODAY',
    validations: [
      {
        name: 'minDate',
        validator: '2021-05-31',
        message: 'Date on which the elected body is in place cannot be before 31 May 2021.',
      },
      {
        name: 'maxDate',
        validator: 'TODAY',
        message: 'Date on which the elected body is in place cannot be a future date.',
      },
    ],
  },
  {
    key: 'dateOfExpiry',
    label: 'Date of Expiry',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    minDate: 'TODAY',
    maxDate: '2030-03-31',
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
  loadFields: jest.fn().mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS),
};

const mockFormModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
  db: { startSession: jest.fn() },
};
const mockRowModel = { find: jest.fn(), updateMany: jest.fn() };
const mockUlbModel = { find: jest.fn(), countDocuments: jest.fn() };
// Mirrors real behavior when no UlbType is excluded from the cycle: state + isActive only —
// the filter-shape assertions below use objectContaining, so extra keys wouldn't break them
// either, but this keeps the mock's output realistic.
const mockUlbEligibilityService = {
  getEligibleUlbFilter: jest.fn().mockImplementation((stateOid: unknown) =>
    Promise.resolve({
      state: stateOid,
      isActive: true,
    }),
  ),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ElectedUrbanLocalBodiesService', () => {
  describe('getTemplate', () => {
    let service: ElectedUrbanLocalBodiesService;

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);

      // Default: no form found → blank template from ULB master.
      mockFormModel.findOne.mockReturnValue(q(null));
      // Default: 2 ULBs in active registry (always loaded in the new implementation).
      mockUlbModel.find.mockReturnValue(q(mockUlbs));
      // Default: no rows (unused in the fallback path).
      mockRowModel.find.mockReturnValue(q([]));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
          { provide: DynamicFormValidationService, useValue: null },
          { provide: XvifcFormActorsService, useValue: null },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: null },
          { provide: FileInfoNormalizerService, useValue: null },
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();

      service = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);
    });

    async function generateAndLoad(): Promise<ExcelJS.Worksheet> {
      const buffer = await service.getTemplate(stateOid.toString(), yearOid.toString(), adminUser);
      return loadSheet(buffer as unknown as ExcelJS.Buffer, 'Elected Bodies Template');
    }

    // ── No active dataset (fallback path) ────────────────────────────────────

    it('generates a workbook with electedBodyStatus dropdown derived from MOCK_TYPED_ROW_EDIT_FIELDS labels', async () => {
      const sheet = await generateAndLoad();

      const statusField = MOCK_TYPED_ROW_EDIT_FIELDS.find((f) => f.key === 'electedBodyStatus')!;
      const expectedOpts = (statusField.options as FormFieldOption[]).map((o) => o.label).join(',');

      const dvValues = Object.values(sheet.dataValidations.model);
      const listDv = dvValues.find((v) => v.type === 'list');
      expect(listDv).toBeDefined();
      expect(listDv!.formulae?.[0]).toBe(`"${expectedOpts}"`);
    });

    it('generates dateOfConstitution custom formula with config-derived dates and correct per-row references', async () => {
      const sheet = await generateAndLoad();

      const constitutionMin = MOCK_TYPED_ROW_EDIT_FIELDS.find((f) => f.key === 'dateOfConstitution')!.validations?.find(
        (v) => v.name === 'minDate',
      )?.validator as string;

      const dvRow2 = sheet.dataValidations.model['D2'];
      const dvRow3 = sheet.dataValidations.model['D3'];

      expect(dvRow2).toBeDefined();
      expect(dvRow2!.type).toBe('custom');
      expect(dvRow2!.formulae?.[0]).not.toMatch(/^=/);
      expect(dvRow2!.formulae?.[0]).toContain('$C2');
      expect(dvRow2!.formulae?.[0]).toContain('$C2<>"Constituted",D2=""');
      expect(dvRow2!.formulae?.[0]).toContain('$C2="Constituted"');
      expect(dvRow2!.formulae?.[0]).toContain('ISNUMBER(D2)');

      const [minYear, minMonth, minDay] = constitutionMin.split('-').map(Number);
      expect(dvRow2!.formulae?.[0]).toContain(`DATE(${minYear},${minMonth},${minDay})`);
      expect(dvRow2!.formulae?.[0]).toContain('TODAY()');
      expect(dvRow2!.formulae?.[0]).toContain('D2');
      expect(dvRow2!.formulae?.[0]).not.toContain('D3');

      expect(dvRow3).toBeDefined();
      expect(dvRow3!.formulae?.[0]).not.toMatch(/^=/);
      expect(dvRow3!.formulae?.[0]).toContain('$C3');
      expect(dvRow3!.formulae?.[0]).toContain('$C3<>"Constituted",D3=""');
      expect(dvRow3!.formulae?.[0]).toContain('D3');
      expect(dvRow3!.formulae?.[0]).not.toContain('D2');
    });

    it('generates dateOfExpiry custom formula with config-derived dates and correct per-row references', async () => {
      const sheet = await generateAndLoad();

      const expiryMax = MOCK_TYPED_ROW_EDIT_FIELDS.find((f) => f.key === 'dateOfExpiry')!.validations?.find(
        (v) => v.name === 'maxDate',
      )?.validator as string;

      const dvRow2 = sheet.dataValidations.model['E2'];
      const dvRow3 = sheet.dataValidations.model['E3'];

      expect(dvRow2).toBeDefined();
      expect(dvRow2!.type).toBe('custom');
      expect(dvRow2!.formulae?.[0]).not.toMatch(/^=/);
      expect(dvRow2!.formulae?.[0]).toContain('$C2');
      expect(dvRow2!.formulae?.[0]).toContain('$C2<>"Constituted",E2=""');
      expect(dvRow2!.formulae?.[0]).toContain('$C2="Constituted"');
      expect(dvRow2!.formulae?.[0]).toContain('ISNUMBER(E2)');
      expect(dvRow2!.formulae?.[0]).toContain('TODAY()');
      const [maxYear, maxMonth, maxDay] = expiryMax.split('-').map(Number);
      expect(dvRow2!.formulae?.[0]).toContain(`DATE(${maxYear},${maxMonth},${maxDay})`);
      expect(dvRow2!.formulae?.[0]).toContain('E2');
      expect(dvRow2!.formulae?.[0]).not.toContain('E3');

      expect(dvRow3).toBeDefined();
      expect(dvRow3!.formulae?.[0]).not.toMatch(/^=/);
      expect(dvRow3!.formulae?.[0]).toContain('$C3');
      expect(dvRow3!.formulae?.[0]).toContain('$C3<>"Constituted",E3=""');
      expect(dvRow3!.formulae?.[0]).toContain('E3');
      expect(dvRow3!.formulae?.[0]).not.toContain('E2');
    });

    it('generates validations covering exactly the active registry rows, with no blank padding', async () => {
      // 2 active ULBs → validations on data rows 2 and 3 only; row 4 absent (no blank padding).
      const sheet = await generateAndLoad();

      expect(sheet.dataValidations.model['D2']).toBeDefined();
      expect(sheet.dataValidations.model['D3']).toBeDefined();
      expect(sheet.dataValidations.model['D4']).toBeUndefined();
    });

    it('generates remarks textLength validation with max length from MOCK_TYPED_ROW_EDIT_FIELDS', async () => {
      const sheet = await generateAndLoad();

      const maxLength = MOCK_TYPED_ROW_EDIT_FIELDS.find((f) => f.key === 'remarks')!.validations?.find(
        (v) => v.name === 'maxlength',
      )?.validator as number;

      const dvValues = Object.values(sheet.dataValidations.model);
      const textLengthDv = dvValues.find((v) => v.type === 'textLength');
      expect(textLengthDv).toBeDefined();
      expect(textLengthDv!.operator).toBe('lessThanOrEqual');
      expect(textLengthDv!.formulae?.[0]).toBe(maxLength);
    });

    it('resolves without throwing and produces no dataValidations when there are zero ULBs', async () => {
      mockUlbModel.find.mockReturnValueOnce(q([]));

      const buffer = await service.getTemplate(stateOid.toString(), yearOid.toString(), adminUser);
      const sheet = await loadSheet(buffer as unknown as ExcelJS.Buffer, 'Elected Bodies Template');

      expect(Object.keys(sheet.dataValidations.model)).toHaveLength(0);
    });

    // ── Active dataset (prefill / overlay path) ──────────────────────────────

    it('overlays saved row values for active registry ULBs when an active dataset exists', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedDbRows));
      const sheet = await generateAndLoad();

      // Active ULBs sorted by name: Alpha City (row 2), Beta Town (row 3).
      expect(sheet.getRow(2).getCell(3).value).toBe('Constituted'); // electedBodyStatus
      expect(sheet.getRow(3).getCell(3).value).toBe('Not Constituted');
    });

    it('prefills dateOfConstitution and dateOfExpiry as Date objects for Constituted rows in overlay path', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedDbRows));
      const sheet = await generateAndLoad();

      // Alpha City (Constituted) → date cells must be Date instances.
      expect(sheet.getRow(2).getCell(4).value).toBeInstanceOf(Date); // dateOfConstitution
      expect(sheet.getRow(2).getCell(5).value).toBeInstanceOf(Date); // dateOfExpiry

      // Beta Town (Not Constituted) → date cells must be empty.
      expect(sheet.getRow(3).getCell(4).value).toBeFalsy();
      expect(sheet.getRow(3).getCell(5).value).toBeFalsy();
    });

    it('excludes unmatched (no-ulbId) rows from the template when an active dataset exists', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      // The service no longer filters by any row-type field at query time — it fetches every row
      // for the active version and overlays by ulbId, which naturally skips a row with no ulbId.
      mockRowModel.find.mockReturnValueOnce(q([...mockSavedDbRows, mockExtraUlbRow]));
      const sheet = await generateAndLoad();

      // Template should have exactly 2 rows (one per active ULB).
      // Row 4 should be empty (no EXTRA_ULB).
      const row4Name = sheet.getRow(4).getCell(2).value;
      expect(row4Name).toBeFalsy();

      // EXTRA_ULB census code should not appear.
      const allCodes = [
        sheet.getRow(2).getCell(1).value,
        sheet.getRow(3).getCell(1).value,
        sheet.getRow(4).getCell(1).value,
      ];
      expect(allCodes).not.toContain('EX01');
    });

    it('applies validations only to the active registry rows when an active dataset exists (no blank padding)', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedDbRows));
      const sheet = await generateAndLoad();

      // 2 active ULBs → validations on rows 2, 3 only.
      expect(sheet.dataValidations.model['D2']).toBeDefined();
      expect(sheet.dataValidations.model['D3']).toBeDefined();
      expect(sheet.dataValidations.model['D4']).toBeUndefined();
    });

    it('falls back to ULB master with blank editable fields when no form record exists', async () => {
      // Default mock: formModel.findOne returns null → fallback path.
      const sheet = await generateAndLoad();

      // Active ULBs sorted by name → Alpha City (row 2), Beta Town (row 3).
      expect(sheet.getRow(2).getCell(2).value).toBe('Alpha City');
      expect(sheet.getRow(3).getCell(2).value).toBe('Beta Town');

      // Editable fields are blank in the fallback path.
      expect(sheet.getRow(2).getCell(3).value).toBe(''); // electedBodyStatus
      expect(sheet.getRow(2).getCell(4).value).toBe(''); // dateOfConstitution
    });

    it('loads active ULBs scoped to the request state with { state: stateOid, isActive: true }', async () => {
      await generateAndLoad();

      expect(mockUlbModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ state: expect.any(Types.ObjectId), isActive: true }),
      );
    });
  });

  describe('dumpToExcel', () => {
    let service: ElectedUrbanLocalBodiesService;

    type RowFindFilter = {
      datasetVersion?: number;
      isActive?: boolean;
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);

      mockFormModel.findOne.mockReturnValue(
        q({
          _id: formOid,
          activeDatasetVersion: 2,
          submittedBy: submittedByUser,
          submittedAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
      );
      mockRowModel.find.mockImplementation((filter: RowFindFilter) =>
        q(
          dumpRows
            .filter((row) => row.datasetVersion === filter.datasetVersion && row.isActive === filter.isActive)
            .sort((a, b) => a.rowNumber - b.rowNumber)
            .map(({ isActive, updateHistory, rawExcelData, errors, ...row }) => {
              void isActive;
              void updateHistory;
              void rawExcelData;
              void errors;
              return row;
            }),
        ),
      );

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
          { provide: DynamicFormValidationService, useValue: null },
          { provide: XvifcFormActorsService, useValue: null },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: null },
          { provide: FileInfoNormalizerService, useValue: null },
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();

      service = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);
    });

    async function dumpSheet(): Promise<ExcelJS.Worksheet> {
      const buffer = await service.dumpToExcel(stateOid.toString(), yearOid.toString(), adminUser);
      return loadSheet(buffer as unknown as ExcelJS.Buffer, 'EULB Dump');
    }

    it('exports only active rows from the active dataset version', async () => {
      const sheet = await dumpSheet();

      expect(mockRowModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          form: formOid,
          datasetVersion: 2,
          isActive: true,
        }),
      );
      expect(sheet.actualRowCount).toBe(3);
      expect(sheet.getRow(2).getCell(3).value).toBe('Alpha City');
      expect(sheet.getRow(3).getCell(3).value).toBe('Beta Town');
    });

    it('excludes rows from older dataset versions', async () => {
      const sheet = await dumpSheet();
      const exportedNames = [sheet.getRow(2).getCell(3).value, sheet.getRow(3).getCell(3).value];

      expect(exportedNames).not.toContain('Old Version ULB');
    });

    it('excludes inactive rows', async () => {
      const sheet = await dumpSheet();
      const exportedNames = [sheet.getRow(2).getCell(3).value, sheet.getRow(3).getCell(3).value];

      expect(exportedNames).not.toContain('Inactive ULB');
    });

    it('does not include history, raw upload, or error array headers', async () => {
      const sheet = await dumpSheet();
      const headers = getRowStringValues(sheet.getRow(1));

      expect(headers).toContain('Latest Data Source');
      expect(headers).not.toContain('Update History');
      expect(headers).not.toContain('Post Submission Updates');
      expect(headers).not.toContain('Raw Excel Data');
      expect(headers).not.toContain('Errors');
    });

    it('exports latest data source from lastUpdatedSource', async () => {
      const sheet = await dumpSheet();

      expect(sheet.getRow(2).getCell(9).value).toBe('PORTAL');
      expect(sheet.getRow(3).getCell(9).value).toBe('EXCEL');
    });

    it('exports submission metadata and row actor names', async () => {
      const sheet = await dumpSheet();

      expect(sheet.getRow(2).getCell(11).value).toBe('Submitter User');
      expect(sheet.getRow(2).getCell(12).value).toBe('2026-02-01T00:00:00.000Z');
      expect(sheet.getRow(2).getCell(13).value).toBe('Creator User');
      expect(sheet.getRow(2).getCell(14).value).toBe('Updater User');
    });

    it('does not throw for empty rows and returns a workbook with headers', async () => {
      mockRowModel.find.mockReturnValueOnce(q([]));

      const sheet = await dumpSheet();
      const headers = getRowStringValues(sheet.getRow(1));

      expect(headers).toEqual([
        'Row Number',
        'Census Code',
        'ULB Name',
        'Elected Body Status',
        'Date on which the elected body is in place.',
        'Date of Expiry',
        'Remarks',
        'Validation Status',
        'Latest Data Source',
        'Dataset Version',
        'Submitted By',
        'Submitted At',
        'Created By',
        'Updated By',
        'Created At',
        'Updated At',
      ]);
      expect(sheet.actualRowCount).toBe(1);
    });
  });

  // ─── getForm ─────────────────────────────────────────────────────────────────

  describe('getForm', () => {
    let service: ElectedUrbanLocalBodiesService;

    const mockActorsService = {
      buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Test State' }),
    };
    const mockDynamicFormValidator = { validateForm: jest.fn() };
    const mockFileTokenService = { createToken: jest.fn().mockReturnValue('mock-token') };
    const mockConfig = {
      get: jest.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'JWT_EXPIRES_IN') return '24h';
        if (key === 'AWS_STORAGE_URL') return '';
        if (key === 'BASE_URL') return '';
        return def ?? '';
      }),
    };
    const mockFileUrlNormalizer = { normalizeFileUrl: jest.fn((v: unknown) => v) };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);
      mockFormModel.findOne.mockReturnValue(q(null));
      mockUlbModel.countDocuments.mockResolvedValue(5); // computed active ULB count

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
          { provide: DynamicFormValidationService, useValue: mockDynamicFormValidator },
          { provide: XvifcFormActorsService, useValue: mockActorsService },
          { provide: FileTokenService, useValue: mockFileTokenService },
          { provide: ConfigService, useValue: mockConfig },
          { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
          FileInfoNormalizerService,
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();

      service = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);
    });

    it('does not include extraUlbEditFields — no row is ever unregistered, so nothing needs a censusCode/ulbName edit form', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      expect(data['extraUlbEditFields']).toBeUndefined();
    });

    it('leaves rowEditFields unchanged — does not include censusCode or ulbName', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const fields = data['rowEditFields'] as Array<{ key: string }>;
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.some((f) => f.key === 'censusCode')).toBe(false);
      expect(fields.some((f) => f.key === 'ulbName')).toBe(false);
    });

    // ─── ulbCount hydration (backend-owned, read-only) ───────────────────────

    it('hydrates ulbCount with the computed active registry count from countDocuments', async () => {
      mockUlbModel.countDocuments.mockResolvedValueOnce(7);

      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const ulbCountQ = questions.find((q) => q['key'] === 'ulbCount');

      expect(ulbCountQ).toBeDefined();
      expect(ulbCountQ!['value']).toBe(7);
    });

    it('sets the correct updated label on the hydrated ulbCount field', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const ulbCountQ = questions.find((q) => q['key'] === 'ulbCount');

      expect(ulbCountQ!['label']).toBe('Active ULBs Registered on City Finance as of March 31, 2026');
    });

    it('marks ulbCount as disabled with a disabledReason', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const ulbCountQ = questions.find((q) => q['key'] === 'ulbCount');

      expect(ulbCountQ!['disabled']).toBe(true);
      expect(typeof ulbCountQ!['disabledReason']).toBe('string');
      expect((ulbCountQ!['disabledReason'] as string).length).toBeGreaterThan(0);
    });

    it('sets includeInPayload to false on the ulbCount field', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const ulbCountQ = questions.find((q) => q['key'] === 'ulbCount');

      expect(ulbCountQ!['includeInPayload']).toBe(false);
    });

    it('queries countDocuments with { state: stateOid, isActive: true }', async () => {
      await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);

      expect(mockUlbModel.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
    });

    // ─── Register ULB supporting action ─────────────────────────────────────

    it('exposes the Register ULB action when the user can edit and extraExcelRowCount > 0', async () => {
      mockFormModel.findOne.mockReturnValueOnce(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          activeDatasetVersion: 1,
          excelRowCount: 3,
          errorRowCount: 1,
          extraExcelRowCount: 2,
          validationStatus: 'INVALID',
          electedBodyExcelFile: { originalName: 'test.xlsx', path: 'state/test.xlsx' },
        }),
      );
      // adminUser has ADMIN scope so canEdit depends on form status (IN_PROGRESS → can edit)
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const excelQ = questions.find((q) => q['key'] === 'electedBodyExcelFile');

      const supportingContent = excelQ!['supportingContent'] as Array<{
        actions?: Array<{ id: string; visible: boolean }>;
      }>;
      const block = supportingContent[0];
      const registerUlbAction = block?.actions?.find((a) => a.id === 'register-ulb');

      expect(registerUlbAction).toBeDefined();
      expect(registerUlbAction!.visible).toBe(true);
    });

    it('hides the Register ULB action when extraExcelRowCount is 0', async () => {
      mockFormModel.findOne.mockReturnValueOnce(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          activeDatasetVersion: 1,
          excelRowCount: 2,
          errorRowCount: 0,
          extraExcelRowCount: 0,
          validationStatus: 'VALID',
          electedBodyExcelFile: { originalName: 'test.xlsx', path: 'state/test.xlsx' },
        }),
      );
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const excelQ = questions.find((q) => q['key'] === 'electedBodyExcelFile');

      const supportingContent = excelQ!['supportingContent'] as Array<{
        actions?: Array<{ id: string; visible: boolean }>;
      }>;
      const block = supportingContent[0];
      const registerUlbAction = block?.actions?.find((a) => a.id === 'register-ulb');

      expect(registerUlbAction?.visible).toBe(false);
    });

    it('hides the Register ULB action when the form has no saved record', async () => {
      // formModel.findOne returns null (no form yet)
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const excelQ = questions.find((q) => q['key'] === 'electedBodyExcelFile');

      const supportingContent = excelQ!['supportingContent'] as Array<{
        actions?: Array<{ id: string; visible: boolean }>;
      }>;
      const block = supportingContent[0];
      const registerUlbAction = block?.actions?.find((a) => a.id === 'register-ulb');

      expect(registerUlbAction?.visible).toBe(false);
    });

    it('includes the correct /xvifc/:yearId/register-ulb URL on the Register ULB action', async () => {
      mockFormModel.findOne.mockReturnValueOnce(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          activeDatasetVersion: 1,
          excelRowCount: 3,
          errorRowCount: 1,
          extraExcelRowCount: 1,
          validationStatus: 'INVALID',
          electedBodyExcelFile: { originalName: 'test.xlsx', path: 'state/test.xlsx' },
        }),
      );
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const excelQ = questions.find((q) => q['key'] === 'electedBodyExcelFile');

      const supportingContent = excelQ!['supportingContent'] as Array<{
        actions?: Array<{ id: string; url?: string }>;
      }>;
      const block = supportingContent[0];
      const registerUlbAction = block?.actions?.find((a) => a.id === 'register-ulb');

      expect(registerUlbAction?.url).toBe(`/xvifc/${yearOid.toString()}/register-ulb`);
    });

    // ─── pageCount hydration ─────────────────────────────────────────────────

    it('returns the saved electedBodyExcelFile.pageCount on the hydrated file value', async () => {
      mockFormModel.findOne.mockReturnValueOnce(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          activeDatasetVersion: 1,
          excelRowCount: 2,
          errorRowCount: 0,
          extraExcelRowCount: 0,
          validationStatus: 'VALID',
          electedBodyExcelFile: {
            originalName: 'test.xlsx',
            path: 'state/test.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeKb: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            pageCount: null,
          },
        }),
      );

      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const questions = data['questions'] as Array<Record<string, unknown>>;
      const excelQ = questions.find((q) => q['key'] === 'electedBodyExcelFile');

      const fileValue = excelQ!['value'] as { pageCount?: number | null };
      expect(fileValue.pageCount).toBeNull();
    });
  });

  // ─── saveDraft ───────────────────────────────────────────────────────────────

  describe('saveDraft', () => {
    let service: ElectedUrbanLocalBodiesService;

    const mockValidator = {
      validateDraftAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { checkboxConfirmation: true },
      }),
    };
    const mockFileUrlNormalizer = { toRawStoragePath: jest.fn((v: string) => v) };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);
      mockUlbModel.countDocuments.mockResolvedValue(3);
      mockFormModel.findOne.mockReturnValue(q(null)); // no existing form → create path
      mockFormModel.create.mockResolvedValue({ toObject: () => ({ _id: formOid, ulbCount: 3 }) });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
          { provide: DynamicFormValidationService, useValue: mockValidator },
          { provide: XvifcFormActorsService, useValue: { buildActorsAndStateName: jest.fn() } },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
          FileInfoNormalizerService,
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();

      service = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);
    });

    it('ignores the client-submitted ulbCount and uses the server-computed active ULB count', async () => {
      mockUlbModel.countDocuments.mockResolvedValueOnce(4);

      await service.saveDraft(
        { stateId: stateOid.toString(), yearId: yearOid.toString(), data: { ulbCount: 999 } },
        adminUser,
        '',
        '',
      );

      const createArg = (mockFormModel.create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect(createArg['ulbCount']).toBe(4);
    });

    it('persists the computed ulbCount even when the client sends a tampered value', async () => {
      mockUlbModel.countDocuments.mockResolvedValueOnce(2);

      await service.saveDraft(
        { stateId: stateOid.toString(), yearId: yearOid.toString(), data: { ulbCount: 50 } },
        adminUser,
        '',
        '',
      );

      const createArg = (mockFormModel.create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect(createArg['ulbCount']).toBe(2);
      expect(createArg['ulbCount']).not.toBe(50);
    });

    it('still saves draft successfully when no ulbCount is provided by the client', async () => {
      await expect(
        service.saveDraft({ stateId: stateOid.toString(), yearId: yearOid.toString(), data: {} }, adminUser, '', ''),
      ).resolves.toBeDefined();
    });

    it('accepts and persists data.electedBodyExcelFile.pageCount (null for Excel uploads)', async () => {
      await service.saveDraft(
        {
          stateId: stateOid.toString(),
          yearId: yearOid.toString(),
          data: {
            electedBodyExcelFile: {
              originalName: 'test.xlsx',
              path: 'state/test.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              pageCount: null,
            },
            checkboxConfirmation: true,
          },
        },
        adminUser,
        '',
        '',
      );

      const createArg = (mockFormModel.create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect((createArg['electedBodyExcelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
    });

    it('accepts and persists data.signedElectedbodyFile', async () => {
      await service.saveDraft(
        {
          stateId: stateOid.toString(),
          yearId: yearOid.toString(),
          data: {
            signedElectedbodyFile: {
              originalName: 'signed.pdf',
              path: 'state/signed.pdf',
              mimeType: 'application/pdf',
              sizeKb: 500,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            checkboxConfirmation: true,
          },
        },
        adminUser,
        '',
        '',
      );

      const createArg = (mockFormModel.create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect((createArg['signedElectedbodyFile'] as { originalName?: string }).originalName).toBe('signed.pdf');
    });

    it('leaves signedElectedbodyFile untouched when the client omits it from the draft payload', async () => {
      await service.saveDraft(
        { stateId: stateOid.toString(), yearId: yearOid.toString(), data: { checkboxConfirmation: true } },
        adminUser,
        '',
        '',
      );

      const createArg = (mockFormModel.create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect(createArg['signedElectedbodyFile']).toBeUndefined();
    });

    it('does not throw a mismatch error when client ulbCount differs from saved excelRowCount', async () => {
      // Prior behavior: mismatch between ulbCount and excelRowCount was a 400.
      // New behavior: ulbCount is backend-owned, so no mismatch check exists.
      mockFormModel.findOne.mockReturnValueOnce(
        q({ _id: formOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, excelRowCount: 10 }),
      );
      mockFormModel.findOneAndUpdate.mockReturnValue(q({ _id: formOid, ulbCount: 3 }));

      await expect(
        service.saveDraft(
          { stateId: stateOid.toString(), yearId: yearOid.toString(), data: { ulbCount: 999 } },
          adminUser,
          '',
          '',
        ),
      ).resolves.toBeDefined();
    });
  });

  // ─── finalSubmit ─────────────────────────────────────────────────────────────

  describe('finalSubmit', () => {
    let service: ElectedUrbanLocalBodiesService;
    let mockSession: Record<string, jest.Mock>;

    const mockValidator = {
      validateFinalSubmitAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { checkboxConfirmation: true, electedBodyExcelFile: {} },
      }),
    };
    const mockFileUrlNormalizer = { toRawStoragePath: jest.fn((v: string) => v) };

    const baseFormDoc = {
      _id: formOid,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      validationStatus: 'VALID',
      errorRowCount: 0,
      missingDbUlbCount: 0,
      excelRowCount: 3,
      dbUlbCount: 3,
      maxAllowedExcelRows: 6,
      matchedDbUlbCount: 3,
      extraExcelRowCount: 0,
      activeDatasetVersion: 1,
    };

    const baseDto = {
      stateId: stateOid.toString(),
      yearId: yearOid.toString(),
      data: {
        ulbCount: 999, // client sends tampered value — should be ignored
        electedBodyExcelFile: {
          originalName: 'test.xlsx',
          path: 'state/test.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeKb: 0.9765625,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        signedElectedbodyFile: {
          originalName: 'signed.pdf',
          path: 'state/signed.pdf',
          mimeType: 'application/pdf',
          sizeKb: 500,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        checkboxConfirmation: true,
      },
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);
      mockUlbModel.countDocuments.mockResolvedValue(3); // computed active ULB count
      mockFormModel.findOne.mockReturnValue(q(baseFormDoc));
      mockFormModel.findOneAndUpdate.mockReturnValue(q({ ...baseFormDoc, currentFormStatus: 3 }));

      mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      mockFormModel.db.startSession.mockResolvedValue(mockSession);
      mockRowModel.updateMany.mockReturnValue(q(undefined));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
          { provide: DynamicFormValidationService, useValue: mockValidator },
          { provide: XvifcFormActorsService, useValue: { buildActorsAndStateName: jest.fn() } },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
          FileInfoNormalizerService,
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();

      service = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);
    });

    it('succeeds (happy path) when all checks pass and extraExcelRowCount is 0', async () => {
      await expect(service.finalSubmit(baseDto, adminUser, '', '')).resolves.toBeDefined();
    });

    it('ignores client ulbCount and persists the server-computed active ULB count', async () => {
      mockUlbModel.countDocuments.mockResolvedValueOnce(3);
      await service.finalSubmit(baseDto, adminUser, '', '');

      const updateArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][])[0][1] as {
        $set: Record<string, unknown>;
      };
      expect(updateArg.$set['ulbCount']).toBe(3);
      expect(updateArg.$set['ulbCount']).not.toBe(999);
    });

    it('preserves data.electedBodyExcelFile.pageCount in the persisted final-submit update', async () => {
      await service.finalSubmit(
        {
          ...baseDto,
          data: {
            ...baseDto.data,
            electedBodyExcelFile: {
              originalName: 'test.xlsx',
              path: 'state/test.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeKb: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              pageCount: null,
            },
          },
        },
        adminUser,
        '',
        '',
      );

      const updateArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][])[0][1] as {
        $set: Record<string, unknown>;
      };
      expect((updateArg.$set['electedBodyExcelFile'] as { pageCount?: number | null }).pageCount).toBeNull();
    });

    it('persists data.signedElectedbodyFile in the final-submit update', async () => {
      await service.finalSubmit(baseDto, adminUser, '', '');

      const updateArg = (mockFormModel.findOneAndUpdate.mock.calls as unknown[][])[0][1] as {
        $set: Record<string, unknown>;
      };
      expect((updateArg.$set['signedElectedbodyFile'] as { originalName?: string }).originalName).toBe('signed.pdf');
    });

    it('rejects final submit when signedElectedbodyFile is missing (required field validator fires)', async () => {
      const mockValidatorRejecting = {
        validateFinalSubmitAndBuildPayload: jest.fn().mockReturnValue({
          isValid: false,
          errors: {
            signedElectedbodyFile: [
              { field: 'signedElectedbodyFile', code: 'required', message: 'This field is required.' },
            ],
          },
          sanitizedPayload: {},
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
          { provide: DynamicFormValidationService, useValue: mockValidatorRejecting },
          { provide: XvifcFormActorsService, useValue: { buildActorsAndStateName: jest.fn() } },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
          FileInfoNormalizerService,
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();
      const rejectingService = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);

      let caught: BadRequestException | undefined;
      try {
        await rejectingService.finalSubmit(
          { ...baseDto, data: { ...baseDto.data, signedElectedbodyFile: undefined as never } },
          adminUser,
          '',
          '',
        );
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
      const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
      expect(response.errors['signedElectedbodyFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'required' })]),
      );
    });

    it('blocks with electedBodyExcelFile.newUlbsAdded when extraExcelRowCount > 0', async () => {
      mockFormModel.findOne.mockReturnValueOnce(
        q({ ...baseFormDoc, extraExcelRowCount: 2, errorRowCount: 2, validationStatus: 'INVALID' }),
      );

      let caught: BadRequestException | undefined;
      try {
        await service.finalSubmit(baseDto, adminUser, '', '');
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
      const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
      expect(response.errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'newUlbsAdded' })]),
      );
    });

    it('blocks with electedBodyExcelFile.excelInvalid when excelRowCount !== computedActiveUlbCount', async () => {
      mockUlbModel.countDocuments.mockResolvedValueOnce(5); // registry says 5
      mockFormModel.findOne.mockReturnValueOnce(
        q({ ...baseFormDoc, excelRowCount: 3, validationStatus: 'INVALID' }), // Excel has 3 rows
      );

      let caught: BadRequestException | undefined;
      try {
        await service.finalSubmit(baseDto, adminUser, '', '');
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
      const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
      expect(response.errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'excelInvalid' })]),
      );
    });

    it('blocks with excelNotValidated when no form record exists', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(null));

      let caught: BadRequestException | undefined;
      try {
        await service.finalSubmit(baseDto, adminUser, '', '');
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
      const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
      expect(response.errors['electedBodyExcelFile']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'excelNotValidated' })]),
      );
    });

    it('blocks when validationStatus is INVALID (not VALID)', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q({ ...baseFormDoc, validationStatus: 'INVALID' }));

      let caught: BadRequestException | undefined;
      try {
        await service.finalSubmit(baseDto, adminUser, '', '');
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
    });

    it('blocks when errorRowCount > 0', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q({ ...baseFormDoc, errorRowCount: 3, validationStatus: 'INVALID' }));

      let caught: BadRequestException | undefined;
      try {
        await service.finalSubmit(baseDto, adminUser, '', '');
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
      const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
      expect(response.errors['electedBodyExcelFile']).toBeDefined();
    });

    it('blocks when missingDbUlbCount > 0', async () => {
      mockFormModel.findOne.mockReturnValueOnce(
        q({ ...baseFormDoc, missingDbUlbCount: 1, validationStatus: 'INVALID' }),
      );

      let caught: BadRequestException | undefined;
      try {
        await service.finalSubmit(baseDto, adminUser, '', '');
      } catch (e) {
        caught = e as BadRequestException;
      }

      expect(caught).toBeDefined();
    });

    it('bulk-updates active rows in the current dataset version to rowStatus UNDER_REVIEW_BY_MOHUA, in the same transaction as the parent update', async () => {
      await service.finalSubmit(baseDto, adminUser, '', '');

      expect(mockFormModel.db.startSession).toHaveBeenCalled();
      expect(mockRowModel.updateMany).toHaveBeenCalledWith(
        { form: formOid, datasetVersion: baseFormDoc.activeDatasetVersion, isActive: true },
        { $set: { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } },
        { session: mockSession },
      );
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('aborts the transaction and never commits when the row bulk-update fails', async () => {
      mockRowModel.updateMany.mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('row write failed')) });

      await expect(service.finalSubmit(baseDto, adminUser, '', '')).rejects.toThrow('row write failed');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });
  });
});
