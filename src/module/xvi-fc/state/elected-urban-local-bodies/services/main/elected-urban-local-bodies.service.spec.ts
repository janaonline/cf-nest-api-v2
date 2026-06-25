import { Test, TestingModule } from '@nestjs/testing';
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
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { ELECTED_BODY_STATUSES } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { FormFieldOption } from 'src/module/xvi-fc/common/types/field-config.type';
import type { EulbDumpRowRecord } from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

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
const yearOid = new Types.ObjectId();
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

/** Two ULBs used by the fallback (no-active-dataset) path. */
const mockUlbs = [
  { _id: new Types.ObjectId(), name: 'Alpha City', censusCode: 'C001' },
  { _id: new Types.ObjectId(), name: 'Beta Town', censusCode: 'C002' },
];

/** Form doc with an active dataset (dbUlbCount = 2 → maxAllowedExcelRows = 4). */
const mockFormWithDataset = {
  _id: formOid,
  activeDatasetVersion: 1,
  dbUlbCount: 2,
};

/** Saved rows for the active dataset: 2 DB_ULB rows + 1 EXTRA_ULB row. */
const mockSavedRows = [
  {
    rowNumber: 1,
    censusCode: 'C001',
    ulbName: 'Alpha City',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-06-15T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-06-14T00:00:00.000Z'),
    remarks: 'All good',
    rowType: 'DB_ULB',
    isActive: true,
  },
  {
    rowNumber: 2,
    censusCode: 'C002',
    ulbName: 'Beta Town',
    electedBodyStatus: 'Not Constituted',
    dateOfConstitution: undefined,
    dateOfExpiry: undefined,
    remarks: '',
    rowType: 'DB_ULB',
    isActive: true,
  },
  {
    rowNumber: 3,
    censusCode: 'EX01',
    ulbName: 'Extra ULB One',
    electedBodyStatus: 'Exempt',
    dateOfConstitution: undefined,
    dateOfExpiry: undefined,
    remarks: 'User added',
    rowType: 'EXTRA_ULB',
    isActive: true,
  },
];

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
    rowType: 'DB_ULB',
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
    rowType: 'DB_ULB',
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
    electedBodyStatus: 'Exempt',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: 'Old version',
    rowType: 'EXTRA_ULB',
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
    electedBodyStatus: 'Exempt',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: 'Inactive row',
    rowType: 'EXTRA_ULB',
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
    label: 'Total ULBs',
    formFieldType: 'number',
    fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
  },
  {
    key: 'censusCode',
    label: 'Census Code',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [
      { name: 'required', validator: null, message: 'Census Code is required.' },
    ],
  },
  {
    key: 'ulbName',
    label: 'ULB Name',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [
      { name: 'required', validator: null, message: 'ULB Name is required.' },
    ],
  },
  {
    key: 'electedBodyStatus',
    label: 'Elected Body Status',
    formFieldType: 'select',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    options: ELECTED_BODY_STATUSES.map((s) => ({ id: s, label: s })) as FormFieldOption[],
    validations: [
      { name: 'required', validator: null, message: 'Elected Body Status is required.' },
    ],
  },
  {
    key: 'dateOfConstitution',
    label: 'Date of Constitution',
    formFieldType: 'date',
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    minDate: '2021-05-31',
    maxDate: 'TODAY',
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
    validations: [
      { name: 'maxlength', validator: 250, message: 'Remarks must not exceed 250 characters.' },
    ],
  },
];

const mockEulbFormJsonConfigService = {
  loadFields: jest.fn().mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS),
};

const mockFormModel = { findOne: jest.fn() };
const mockRowModel = { find: jest.fn() };
const mockUlbModel = { find: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ElectedUrbanLocalBodiesService', () => {
  describe('getTemplate', () => {
    let service: ElectedUrbanLocalBodiesService;

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);

      // Default: no form found → blank template from ULB master.
      mockFormModel.findOne.mockReturnValue(q(null));
      // Default: 2 ULBs in master for the fallback path.
      mockUlbModel.find.mockReturnValue(q(mockUlbs));
      // Default: no rows (unused in the fallback path, but avoids unresolved promises).
      mockRowModel.find.mockReturnValue(q([]));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: DynamicFormValidationService, useValue: null },
          { provide: XvifcFormActorsService, useValue: null },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: null },
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

    it('generates a workbook with electedBodyStatus dropdown derived from MOCK_TYPED_ROW_EDIT_FIELDS', async () => {
      const sheet = await generateAndLoad();

      const statusField = MOCK_TYPED_ROW_EDIT_FIELDS.find((f) => f.key === 'electedBodyStatus')!;
      const expectedOpts = (statusField.options as FormFieldOption[]).map((o) => o.id).join(',');

      const dvValues = Object.values(sheet.dataValidations.model);
      const listDv = dvValues.find((v) => v.type === 'list');
      expect(listDv).toBeDefined();
      expect(listDv!.formulae?.[0]).toBe(`"${expectedOpts}"`);
    });

    it('generates dateOfConstitution custom formula with config-derived dates and correct per-row references', async () => {
      // NOTE: ExcelJS 4.x does not serialize allowBlank: false — Excel defaults allowBlank to 1,
      // so blank date cells may pass client-side validation. Backend upload validation is authoritative.
      const sheet = await generateAndLoad();

      const constitutionMin = MOCK_TYPED_ROW_EDIT_FIELDS.find((f) => f.key === 'dateOfConstitution')!.validations?.find(
        (v) => v.name === 'minDate',
      )?.validator as string;

      const dvRow2 = sheet.dataValidations.model['D2'];
      const dvRow3 = sheet.dataValidations.model['D3'];

      expect(dvRow2).toBeDefined();
      expect(dvRow2!.type).toBe('custom');

      // Formula must NOT start with '=' — OOXML <formula1> expects the expression body only.
      expect(dvRow2!.formulae?.[0]).not.toMatch(/^=/);
      expect(dvRow2!.formulae?.[0]).toContain('$C2');

      // When status is not Constituted, date cell must be blank.
      expect(dvRow2!.formulae?.[0]).toContain('$C2<>"Constituted",D2=""');
      // When status is Constituted, cell must be a valid date in the configured range.
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

    it('extends validations to blank rows up to maxAllowedExcelRows (dbUlbCount × 2)', async () => {
      // mockUlbs has 2 ULBs → maxAllowedExcelRows = 4 → validations on rows 2–5; row 6 absent.
      const sheet = await generateAndLoad();

      const dvRow4D = sheet.dataValidations.model['D4'];
      expect(dvRow4D).toBeDefined();
      expect(dvRow4D!.type).toBe('custom');
      expect(dvRow4D!.formulae?.[0]).not.toMatch(/^=/);
      expect(dvRow4D!.formulae?.[0]).toContain('$C4');
      expect(dvRow4D!.formulae?.[0]).toContain('D4');

      const dvRow4E = sheet.dataValidations.model['E4'];
      expect(dvRow4E).toBeDefined();
      expect(dvRow4E!.type).toBe('custom');
      expect(dvRow4E!.formulae?.[0]).toContain('$C4');
      expect(dvRow4E!.formulae?.[0]).toContain('E4');

      expect(sheet.dataValidations.model['D5']).toBeDefined();
      expect(sheet.dataValidations.model['D6']).toBeUndefined();
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

    // ── Active dataset (prefill path) ────────────────────────────────────────

    it('prefills electedBodyStatus from saved rows when an active dataset exists', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedRows));
      const sheet = await generateAndLoad();

      // Column 3 = electedBodyStatus (C); rows sorted by rowNumber from mock.
      expect(sheet.getRow(2).getCell(3).value).toBe('Constituted'); // rowNumber 1
      expect(sheet.getRow(3).getCell(3).value).toBe('Not Constituted'); // rowNumber 2
      expect(sheet.getRow(4).getCell(3).value).toBe('Exempt'); // rowNumber 3 (EXTRA_ULB)
    });

    it('prefills dateOfConstitution and dateOfExpiry as Date objects for Constituted rows', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedRows));
      const sheet = await generateAndLoad();

      // Row 2 = Alpha City (Constituted) → date cells must be Date instances.
      expect(sheet.getRow(2).getCell(4).value).toBeInstanceOf(Date); // dateOfConstitution
      expect(sheet.getRow(2).getCell(5).value).toBeInstanceOf(Date); // dateOfExpiry

      // Row 3 = Beta Town (Not Constituted) → date cells must be empty.
      expect(sheet.getRow(3).getCell(4).value).toBeFalsy();
      expect(sheet.getRow(3).getCell(5).value).toBeFalsy();
    });

    it('includes EXTRA_ULB rows from the active dataset in the template', async () => {
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedRows));
      const sheet = await generateAndLoad();

      // Row 4 = Extra ULB One (rowNumber 3, EXTRA_ULB).
      expect(sheet.getRow(4).getCell(2).value).toBe('Extra ULB One'); // ulbName column B
      expect(sheet.getRow(4).getCell(1).value).toBe('EX01'); // censusCode column A
    });

    it('applies validations to data rows and blank extra rows when active dataset exists', async () => {
      // mockFormWithDataset.dbUlbCount = 2 → maxAllowedExcelRows = 4.
      // mockSavedRows has 3 rows → 1 blank padding row → templateRows = 4.
      // Validations cover rows 2–5; row 6 absent.
      mockFormModel.findOne.mockReturnValueOnce(q(mockFormWithDataset));
      mockRowModel.find.mockReturnValueOnce(q(mockSavedRows));
      const sheet = await generateAndLoad();

      expect(sheet.dataValidations.model['D2']).toBeDefined(); // first data row
      expect(sheet.dataValidations.model['D5']).toBeDefined(); // last row (row 4 + 1)
      expect(sheet.dataValidations.model['D6']).toBeUndefined(); // beyond max
    });

    it('falls back to ULB master with blank editable fields when no form record exists', async () => {
      // Default mock: formModel.findOne returns null → fallback path.
      const sheet = await generateAndLoad();

      // Column 2 = ulbName (B); sorted by name from mockUlbs.
      expect(sheet.getRow(2).getCell(2).value).toBe('Alpha City');
      expect(sheet.getRow(3).getCell(2).value).toBe('Beta Town');

      // Editable fields are blank in the fallback path.
      expect(sheet.getRow(2).getCell(3).value).toBe(''); // electedBodyStatus
      expect(sheet.getRow(2).getCell(4).value).toBe(''); // dateOfConstitution
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
          { provide: DynamicFormValidationService, useValue: null },
          { provide: XvifcFormActorsService, useValue: null },
          { provide: FileTokenService, useValue: null },
          { provide: ConfigService, useValue: null },
          { provide: FileUrlNormalizerService, useValue: null },
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

      expect(sheet.getRow(2).getCell(10).value).toBe('PORTAL');
      expect(sheet.getRow(3).getCell(10).value).toBe('EXCEL');
    });

    it('exports submission metadata and row actor names', async () => {
      const sheet = await dumpSheet();

      expect(sheet.getRow(2).getCell(12).value).toBe('Submitter User');
      expect(sheet.getRow(2).getCell(13).value).toBe('2026-02-01T00:00:00.000Z');
      expect(sheet.getRow(2).getCell(14).value).toBe('Creator User');
      expect(sheet.getRow(2).getCell(15).value).toBe('Updater User');
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
        'Date of Constitution',
        'Date of Expiry',
        'Remarks',
        'Row Type',
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
    const mockFileTokenService = { signUrl: jest.fn((url: string) => url) };
    const mockConfig = { get: jest.fn().mockReturnValue('24h') };
    const mockFileUrlNormalizer = { normalizeFileUrl: jest.fn((v: unknown) => v) };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockEulbFormJsonConfigService.loadFields.mockResolvedValue(MOCK_TYPED_ROW_EDIT_FIELDS);
      mockFormModel.findOne.mockReturnValue(q(null)); // no saved form → default NOT_STARTED response

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElectedUrbanLocalBodiesService,
          ExcelService,
          { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
          { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
          { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
          { provide: DynamicFormValidationService, useValue: mockDynamicFormValidator },
          { provide: XvifcFormActorsService, useValue: mockActorsService },
          { provide: FileTokenService, useValue: mockFileTokenService },
          { provide: ConfigService, useValue: mockConfig },
          { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer },
          { provide: EulbFormJsonConfigService, useValue: mockEulbFormJsonConfigService },
        ],
      }).compile();

      service = module.get<ElectedUrbanLocalBodiesService>(ElectedUrbanLocalBodiesService);
    });

    it('includes extraUlbEditFields in the response with censusCode and ulbName entries', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      expect(Array.isArray(data['extraUlbEditFields'])).toBe(true);
      const fields = data['extraUlbEditFields'] as Array<{ key: string }>;
      expect(fields.some((f) => f.key === 'censusCode')).toBe(true);
      expect(fields.some((f) => f.key === 'ulbName')).toBe(true);
    });

    it('leaves rowEditFields unchanged — does not include censusCode or ulbName', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const data = result.data as Record<string, unknown>;
      const fields = data['rowEditFields'] as Array<{ key: string }>;
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.some((f) => f.key === 'censusCode')).toBe(false);
      expect(fields.some((f) => f.key === 'ulbName')).toBe(false);
    });
  });
});
