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
          errorStyle: 'stop',
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
            errorStyle: 'stop',
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

    it('leaves the sheet unprotected and unformatted when no header asks for it', async () => {
      const buffer = await service.generateExcel(HEADERS, [{ name: 'Alice', status: 'A', score: 1, notes: '' }], 'S');
      const sheet = await loadSheet(buffer, 'S');
      expect((sheet as unknown as { sheetProtection?: unknown }).sheetProtection).toBeFalsy();
      expect(sheet.getCell(2, 3).numFmt).toBeUndefined();
      expect(sheet.getCell(2, 3).fill).toBeUndefined();
    });

    it('greys out a `readOnly` column on the header and data rows only and refuses typing there, without protection', async () => {
      const headers = [
        { label: 'Total', key: 'total' },
        { label: 'Half', key: 'half', numFmt: '#,##0.00', readOnly: true, note: 'Calculated automatically.' },
      ];
      const rows = [
        { total: 3, half: { formula: 'A2/2', result: 1.5 } },
        { total: 4, half: { formula: 'A3/2', result: 2 } },
      ];
      const buffer = await service.generateExcel(headers, rows, 'S');
      const sheet = await loadSheet(buffer, 'S');

      const grey = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      expect((sheet as unknown as { sheetProtection?: unknown }).sheetProtection).toBeFalsy();
      for (const row of [1, 2, 3]) {
        expect(sheet.getCell(row, 2).fill).toEqual(grey);
        expect(sheet.getCell(row, 2).font?.color).toEqual({ argb: 'FF595959' });
      }
      // Read back, ExcelJS lists the rule once per cell of the range.
      const { model } = (sheet as unknown as { dataValidations: { model: Record<string, ExcelJS.DataValidation> } })
        .dataValidations;
      const readOnlyRules = Object.entries(model).filter(([, v]) => v.formulae?.[0] === 'FALSE');
      expect(readOnlyRules.map(([address]) => address)).toEqual(['B2', 'B3']);
      expect(readOnlyRules[0][1]).toEqual(
        expect.objectContaining({
          type: 'custom',
          prompt: 'Calculated automatically.',
          error: 'Calculated automatically.',
          errorStyle: 'stop',
        }),
      );
      // A cell styled only by the column's number format reads back as "no fill" ({ pattern: 'none' }).
      expect(sheet.getCell(4, 2).fill).not.toEqual(grey);
      expect(sheet.getColumn(2).fill).not.toEqual(grey);
      expect(sheet.getCell(2, 1).fill).not.toEqual(grey);
      expect(sheet.getCell(2, 2).numFmt).toBe('#,##0.00');
      expect(sheet.getCell(2, 2).value).toEqual({ formula: 'A2/2', result: 1.5 });
    });

    it('writes a header note as an Excel comment', async () => {
      const headers = [{ label: 'Half', key: 'half', note: 'Calculated automatically.' }];
      const buffer = await service.generateExcel(headers, [{ half: 1 }], 'S');
      const sheet = await loadSheet(buffer, 'S');
      const note = sheet.getCell(1, 1).note as string | { texts: Array<{ text: string }> };
      const text = typeof note === 'string' ? note : note.texts.map((t) => t.text).join('');
      expect(text).toBe('Calculated automatically.');
    });
  });
});
