import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface RowHeader {
  label: string;
  key: string;
  width?: number;
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
    }));

    sheet.addRows(rows as unknown as object[]);

    if (columnValidations?.length && rows.length > 0) {
      const keyToLetter = new Map<string, string>();
      for (const col of sheet.columns) {
        if (col.key && col.letter) keyToLetter.set(col.key, col.letter);
      }

      const firstDataRow = 2;
      const lastDataRow = rows.length + 1;

      for (const config of columnValidations) {
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
