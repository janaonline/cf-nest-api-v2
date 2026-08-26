import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ITableBordersOptions,
} from 'docx';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { buildXviFcDownloadFileName } from 'src/shared/utils/xvi-fc-download-file-name.util';
import { buildMohuaLetterAddressBlock } from 'src/module/xvi-fc/common/utils/xvi-fc-letter-address-block.util';
import { formatXviFcDate } from 'src/module/xvi-fc/common/utils/xvi-fc-date-format.util';
import { ElectedUrbanLocalBodiesDocumentService } from './elected-urban-local-bodies-document.service';
import type {
  EulbListDocumentData,
  EulbListDocumentRow,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies-document.types';

/** Percentage column widths, in the same left-to-right order as the rendered table: '#' plus the
 *  6 form-json-labelled columns. Sums to 100. */
const COLUMN_WIDTHS_PCT = [5, 10, 20, 15, 15, 15, 20];

const TABLE_BORDER: ITableBordersOptions = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
};

function cellText(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: text || '-', bold: opts.bold })] });
}

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { fill: 'F2F2F2' },
    children: [cellText(text, { bold: true })],
  });
}

function dataCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [cellText(text)],
  });
}

/**
 * Renders the "Elected Bodies List" declaration letter (see the shared PDF mockup this mirrors)
 * as a `.docx` — consumed by `GET :stateId/:yearId/elected-bodies-list-document`. Uses the `docx`
 * npm package, unlike claim-letter's PDF sibling (which uses `pdfkit`): the state must be able to
 * type over the closing signature block in Word before printing and signing, so the output has to
 * be an editable document, not a flattened PDF.
 *
 * The closing signature block (`[Name]`, `[Designation]`, etc.) is written as literal,
 * non-interpolated text — including its own `[State Name]` — by design; only the intro
 * paragraph's state name and ULB count are filled with real data. See
 * ElectedUrbanLocalBodiesDocumentService for the gate that refuses to build this document at all
 * unless every active row is `validationStatus: 'VALID'`.
 */
@Injectable()
export class ElectedUrbanLocalBodiesDocxService {
  constructor(private readonly documentService: ElectedUrbanLocalBodiesDocumentService) {}

  async generateElectedBodiesListDocument(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.documentService.getDocumentData(stateId, yearId, user);
    const doc = this.buildDocument(data);
    const buffer = await Packer.toBuffer(doc);
    const fileName = buildXviFcDownloadFileName({
      entityName: data.stateName,
      formName: 'elected-body-list',
      yearLabel: data.designYearLabel,
      extension: 'docx',
    });
    return { buffer, fileName };
  }

  private buildDocument(data: EulbListDocumentData): Document {
    return new Document({
      sections: [
        {
          properties: {},
          children: [
            ...this.buildAddressBlock(),
            ...this.buildSubjectAndIntro(data),
            this.buildTable(data),
            new Paragraph({ text: '' }),
            ...this.buildClosingParagraph(data),
            new Paragraph({ text: '' }),
            ...this.buildSignatureBlock(),
          ],
        },
      ],
    });
  }

  private buildAddressBlock(): Paragraph[] {
    return [
      ...buildMohuaLetterAddressBlock(),
      new Paragraph({
        children: [
          new TextRun({ text: 'Subject: Declaration regarding Elected Body Status of Urban Local Bodies', bold: true }),
        ],
      }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: 'Respected Sir/Madam,' }),
      new Paragraph({ text: '' }),
    ];
  }

  private buildSubjectAndIntro(data: EulbListDocumentData): Paragraph[] {
    const ulbNoun = data.ulbCount === 1 ? 'Urban Local Body' : 'Urban Local Bodies';
    return [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        text:
          `This is to certify that the elected body status of every Urban Local Body in the State of ${data.stateName} ` +
          `has been compiled as per the current records maintained by the State Nodal Department, and is furnished ` +
          `in the table below. The table lists all ${data.ulbCount} ${ulbNoun} in the State, together with the ` +
          `status recorded for each.`,
      }),
      new Paragraph({ text: '' }),
    ];
  }

  private buildTable(data: EulbListDocumentData): Table {
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('#', COLUMN_WIDTHS_PCT[0]),
        ...data.columns.map((col, i) => headerCell(col.label, COLUMN_WIDTHS_PCT[i + 1])),
      ],
    });

    const dataRows = data.rows.map(
      (row: EulbListDocumentRow) =>
        new TableRow({
          children: [
            dataCell(String(row.slNo), COLUMN_WIDTHS_PCT[0]),
            dataCell(row.censusCode, COLUMN_WIDTHS_PCT[1]),
            dataCell(row.ulbName, COLUMN_WIDTHS_PCT[2]),
            dataCell(row.electedBodyStatus, COLUMN_WIDTHS_PCT[3]),
            dataCell(formatXviFcDate(row.dateOfConstitution), COLUMN_WIDTHS_PCT[4]),
            dataCell(formatXviFcDate(row.dateOfExpiry), COLUMN_WIDTHS_PCT[5]),
            dataCell(row.remarks, COLUMN_WIDTHS_PCT[6]),
          ],
        }),
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
      rows: [headerRow, ...dataRows],
    });
  }

  private buildClosingParagraph(data: EulbListDocumentData): Paragraph[] {
    return [
      new Paragraph({
        text:
          'This declaration is being submitted for consideration of the first installment claim for ' +
          `FY ${data.designYearLabel} under the 16th Finance Commission grants.`,
      }),
    ];
  }

  /** Literal, non-interpolated placeholder text — the state fills this in by hand in Word before
   *  printing and signing. Deliberately never substituted, including its own "[State Name]". */
  private buildSignatureBlock(): Paragraph[] {
    return [
      new Paragraph({ text: '[Name]' }),
      new Paragraph({ text: '[Designation]' }),
      new Paragraph({ text: '[Department / Directorate]' }),
      new Paragraph({ text: 'Government of [State Name]' }),
      new Paragraph({ text: 'Date: [DD/MM/YYYY]' }),
      new Paragraph({ text: 'Place: [Place]' }),
      new Paragraph({ text: 'Seal: [Official Seal]' }),
    ];
  }
}
