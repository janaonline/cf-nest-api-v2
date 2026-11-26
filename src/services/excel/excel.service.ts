import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface RowHeader {
  label: string;
  key: string;
  width?: number;
  numFmt?: string;
  /** Greyed out on the header and data rows, and typed entries are refused (no sheet protection: devolution-formula ADR 0002). */
  readOnly?: boolean;
  /** Excel comment on the header cell (shown on hover); also the read-only message of a `readOnly` column. */
  note?: string;
}

// Fresh objects per cell, so a later change to one cell's style can't leak into others ("Background 1, Darker 5%").
const readOnlyFill = (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } });
const readOnlyFont = (): Partial<ExcelJS.Font> => ({ color: { argb: 'FF595959' } });

/** Refuses every typed entry; a paste or Delete gets past it. */
function readOnlyValidation(note?: string): ExcelJS.DataValidation {
  const text = note ?? 'This column is read-only.';
  return {
    type: 'custom',
    allowBlank: false,
    formulae: ['FALSE'],
    showInputMessage: true,
    promptTitle: 'Read-only',
    prompt: text,
    showErrorMessage: true,
    errorStyle: 'error',
    errorTitle: 'Read-only',
    error: text,
  };
}

export interface StaticColumnValidation {
  key: string;
  mode: 'static';
  validation: ExcelJS.DataValidation;
}

export interface PerRowColumnValidation {
  key: string;
  mode: 'perRow';
  /** Called once per data row with the resolved column-letter map and the 1-based row number. */
  buildValidation: (row: number, keyToLetter: ReadonlyMap<string, string>) => ExcelJS.DataValidation;
}

export type ExcelColumnValidation = StaticColumnValidation | PerRowColumnValidation;

/** ExcelJS 4.4 omits dataValidations from its Worksheet typings; augment locally. */
interface WorksheetWithValidations extends ExcelJS.Worksheet {
  readonly dataValidations: {
    add(address: string, validation: ExcelJS.DataValidation): void;
    readonly model: Record<string, ExcelJS.DataValidation>;
  };
}

@Injectable()
export class ExcelService {
  public async generateExcel<TRow extends object>(
    headers: RowHeader[],
    rows: ReadonlyArray<TRow>,
    sheetName = 'Sheet1',
    columnValidations?: ExcelColumnValidation[],
  ): Promise<ExcelJS.Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName) as WorksheetWithValidations;

    sheet.columns = headers.map((header) => ({
      header: header.label,
      key: header.key,
      width: header.width || 20,
      ...(header.numFmt ? { style: { numFmt: header.numFmt } } : {}),
    }));

    sheet.addRows(rows as unknown as object[]);

    const firstDataRow = 2;
    const lastDataRow = rows.length + 1;

    headers.forEach((header, idx) => {
      if (header.note) sheet.getCell(1, idx + 1).note = header.note;
      if (!header.readOnly) return;
      // Cell by cell, not a column style, so the grey stops at the last data row.
      for (let row = 1; row <= lastDataRow; row++) {
        const cell = sheet.getCell(row, idx + 1);
        cell.fill = readOnlyFill();
        cell.font = readOnlyFont();
      }
    });

    if (rows.length > 0) {
      const keyToLetter = new Map<string, string>();
      for (const col of sheet.columns) {
        if (col.key && col.letter) keyToLetter.set(col.key, col.letter);
      }

      for (const header of headers) {
        const letter = keyToLetter.get(header.key);
        if (header.readOnly && letter) {
          sheet.dataValidations.add(
            `${letter}${firstDataRow}:${letter}${lastDataRow}`,
            readOnlyValidation(header.note),
          );
        }
      }

      for (const config of columnValidations ?? []) {
        const letter = keyToLetter.get(config.key);
        if (!letter) continue;

        if (config.mode === 'static') {
          sheet.dataValidations.add(`${letter}${firstDataRow}:${letter}${lastDataRow}`, config.validation);
        } else {
          for (let row = firstDataRow; row <= lastDataRow; row++) {
            sheet.dataValidations.add(`${letter}${row}`, config.buildValidation(row, keyToLetter));
          }
        }
      }
    }

    // // Style headers
    // sheet.getRow(1).eachCell(cell => {
    //     cell.font = { bold: true };
    //     cell.fill = {
    //         type: 'pattern',
    //         pattern: 'solid',
    //         fgColor: { argb: 'FFEEEEEE' },
    //     };
    // });

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }
}
