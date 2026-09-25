import { Test, TestingModule } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { ExcelService, PerRowColumnValidation, StaticColumnValidation } from './excel.service';

const HEADERS = [
  { label: 'Name', key: 'name', width: 20 },
  { label: 'Status', key: 'status', width: 15 },
  { label: 'Score', key: 'score', width: 10 },
  { label: 'Notes', key: 'notes', width: 30 },
];

async function loadSheet(buffer: ExcelJS.Buffer, sheetName: string): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb.getWorksheet(sheetName)!;
}

describe('ExcelService', () => {
  let service: ExcelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExcelService],
    }).compile();

    service = module.get<ExcelService>(ExcelService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateExcel', () => {
    it('produces a readable workbook with correct row data when no validations are passed', async () => {
      const rows = [
        { name: 'Alice', status: 'Active', score: 95, notes: '' },
        { name: 'Bob', status: 'Inactive', score: 70, notes: 'n/a' },
      ];
      const buffer = await service.generateExcel(HEADERS, rows, 'TestSheet');
      const sheet = await loadSheet(buffer, 'TestSheet');

      expect(sheet).toBeDefined();
      // Column 1 = Name (A), column 2 = Status (B). Use column index since keys aren't preserved.
      expect(sheet.getRow(2).getCell(1).value).toBe('Alice');
      expect(sheet.getRow(3).getCell(1).value).toBe('Bob');
      expect(Object.keys(sheet.dataValidations.model)).toHaveLength(0);
    });

    it('applies a static list validation to the correct column range', async () => {
      const rows = [
        { name: 'Alice', status: 'Active', score: 95, notes: '' },
        { name: 'Bob', status: 'Inactive', score: 70, notes: '' },
      ];
      const statusValidation: StaticColumnValidation = {
        key: 'status',
        mode: 'static',
        validation: {
          type: 'list',
          allowBlank: false,
          formulae: ['"Active,Inactive,Pending"'],
          showErrorMessage: true,
          errorStyle: 'error',
          errorTitle: 'Invalid',
          error: 'Pick a valid status.',
        },
      };

      const buffer = await service.generateExcel(HEADERS, rows, 'TestSheet', [statusValidation]);
      const sheet = await loadSheet(buffer, 'TestSheet');

      // Static range is stored as a single model entry keyed by the range string.
      const dvValues = Object.values(sheet.dataValidations.model);
      const listDv = dvValues.find((v) => v.type === 'list');
      expect(listDv).toBeDefined();
      expect(listDv!.formulae?.[0]).toBe('"Active,Inactive,Pending"');
    });

    it('applies per-row custom validations with distinct row-specific formulas', async () => {
      const rows = [
        { name: 'Alice', status: 'Active', score: 95, notes: '' },
        { name: 'Bob', status: 'Active', score: 80, notes: '' },
      ];
      const perRowValidation: PerRowColumnValidation = {
        key: 'notes',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const statusLetter = keyToLetter.get('status')!;
          const notesLetter = keyToLetter.get('notes')!;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [`=OR($${statusLetter}${row}<>"Active",ISNUMBER(${notesLetter}${row}))`],
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Notes',
            error: 'Required when Active.',
          };
        },
      };

      const buffer = await service.generateExcel(HEADERS, rows, 'TestSheet', [perRowValidation]);
      const sheet = await loadSheet(buffer, 'TestSheet');

      // Per-row validations are stored with individual cell addresses as keys.
      const dvRow2 = sheet.dataValidations.model['D2'];
      const dvRow3 = sheet.dataValidations.model['D3'];

      expect(dvRow2).toBeDefined();
      expect(dvRow2!.type).toBe('custom');
      expect(dvRow2!.formulae?.[0]).toContain('D2');
      expect(dvRow2!.formulae?.[0]).not.toContain('D3');

      expect(dvRow3).toBeDefined();
      expect(dvRow3!.formulae?.[0]).toContain('D3');
      expect(dvRow3!.formulae?.[0]).not.toContain('D2');
    });

    it('does not apply validations and does not throw when rows array is empty', async () => {
      const validation: StaticColumnValidation = {
        key: 'status',
        mode: 'static',
        validation: { type: 'list', allowBlank: false, formulae: ['"A,B"'] },
      };
      const buffer = await service.generateExcel(HEADERS, [], 'TestSheet', [validation]);
      const sheet = await loadSheet(buffer, 'TestSheet');
      expect(Object.keys(sheet.dataValidations.model)).toHaveLength(0);
    });
  });
});
