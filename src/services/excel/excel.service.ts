import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface RowHeader {
  label: string;
  key: string;
  width?: number;
}

@Injectable()
export class ExcelService {
  public async generateExcel(headers: RowHeader[], rows: any[], sheetName = 'Sheet1'): Promise<ExcelJS.Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);

    // Set headers
    sheet.columns = headers.map((header) => ({
      header: header.label,
      key: header.key,
      width: header.width || 20,
    }));

    // Add rows
    sheet.addRows(rows);

    // // Style headers
    // sheet.getRow(1).eachCell(cell => {
    //     cell.font = { bold: true };
    //     cell.fill = {
    //         type: 'pattern',
    //         pattern: 'solid',
    //         fgColor: { argb: 'FFEEEEEE' },
    //     };
    // });

    // Send file as response
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }
}
