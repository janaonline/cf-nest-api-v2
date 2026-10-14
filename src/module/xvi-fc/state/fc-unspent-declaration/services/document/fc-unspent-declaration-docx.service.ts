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
import { FcUnspentDeclarationDocumentService } from './fc-unspent-declaration-document.service';
import type {
  FcUnspentDeclarationDocumentData,
  FcUnspentDeclarationDocumentRow,
} from 'src/module/xvi-fc/state/fc-unspent-declaration/types/fc-unspent-declaration-document.types';

/** Times New Roman 12pt (size is in half-points) — matches the MoHUA specimen letter's font. Set as
 *  the `Document`-level default below, and repeated explicitly on table-cell runs as a defensive
 *  fallback since Word's built-in Table Grid style can override inherited run properties. */
const DOC_FONT = { font: 'Times New Roman', size: 24 };

/** Percentage column widths, in the same left-to-right order as the rendered table: '#', ULB Name,
 *  Census ID, {priorFcCycleLabel} unspent balance, Previous FC unspent balance. Sums to 100. */
const COLUMN_WIDTHS_PCT = [6, 30, 16, 24, 24];

const TABLE_BORDER: ITableBordersOptions = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
};

/** Whole-Rupee amounts are shown in Lakhs (÷100,000), matching the specimen's "(in Lakhs)" column
 *  headers — the underlying data (`unspentAmount`/`previousFcUnspentBalance`) is stored unconverted. */
function formatLakhs(rupees: number): string {
  return (rupees / 100000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cellText(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text || '-', bold: opts.bold, ...DOC_FONT })],
  });
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
 * Renders the FC Unspent Declaration letter as a `.docx`, consumed by
 * `GET :stateId/:yearId/fc-unspent-declaration-document`. See CLAUDE.md's "The docx letter mirrors
 * the MoHUA specimen's branch structure" section for why `.docx` not PDF, the No/Yes branch layout,
 * and what's literal vs. real data; see `FcUnspentDeclarationDocumentService` for the gates that
 * refuse to build it.
 */
@Injectable()
export class FcUnspentDeclarationDocxService {
  constructor(private readonly documentService: FcUnspentDeclarationDocumentService) {}

  async generateDeclarationDocument(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.documentService.getDocumentData(stateId, yearId, user);
    const doc = this.buildDocument(data);
    const buffer = await Packer.toBuffer(doc);
    const branch = data.isFcUnspent ? 'yes' : 'no';
    const fileName = buildXviFcDownloadFileName({
      entityName: data.stateName,
      formName: `fc-unspent-declaration-${branch}`,
      yearLabel: data.designYearLabel,
      extension: 'docx',
    });
    return { buffer, fileName };
  }

  private buildDocument(data: FcUnspentDeclarationDocumentData): Document {
    return new Document({
      styles: {
        default: {
          document: { run: DOC_FONT },
        },
      },
      sections: [
        {
          properties: {},
          children: [
            ...this.buildTitle(data),
            ...this.buildAddressBlock(data),
            ...this.buildCertification(data),
            ...this.buildClosingParagraph(data),
            new Paragraph({ text: '' }),
            ...this.buildSignatureBlock(),
          ],
        },
      ],
    });
  }

  /** Verbatim heading from the MoHUA specimen letter this mirrors — bold, underlined, centered.
   *  Dynamic on `priorFcCycleFullLabel` so it stays correct once the applicable cycle shifts from
   *  14th to 15th FC (see resolvePriorFcCycleFullLabel). */
  private buildTitle(data: FcUnspentDeclarationDocumentData): Paragraph[] {
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text:
              'Format of Letter to be submitted by the State reg. Unspent Balance of ' +
              `${data.priorFcCycleFullLabel} and Previous Finance Commissions`,
            bold: true,
            underline: {},
          }),
        ],
      }),
      new Paragraph({ text: '' }),
    ];
  }

  /** Address block, subject line, and salutation — common to both branches; the subject line no
   *  longer presupposes a "nil" balance the way an earlier version's wording did. */
  private buildAddressBlock(data: FcUnspentDeclarationDocumentData): Paragraph[] {
    return [
      ...buildMohuaLetterAddressBlock(),
      new Paragraph({
        children: [
          new TextRun({
            text:
              `Subject: Declaration regarding ${data.priorFcCycleFullLabel} and previous Finance ` +
              `Commissions' unspent balance with Urban Local Bodies in the State of ${data.stateName} -reg.`,
            bold: true,
          }),
        ],
      }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: 'Sir,' }),
      new Paragraph({ text: '' }),
    ];
  }

  /** The certifying content: a common lead-in line, then whichever branch applies. Only this
   *  method (and the table it calls for the Yes branch) differs by `data.isFcUnspent`. Return type
   *  includes `Table` — the Yes branch splices `buildTable`'s result directly into this array. */
  private buildCertification(data: FcUnspentDeclarationDocumentData): (Paragraph | Table)[] {
    const leadIn = [new Paragraph({ text: 'This is to certify that,' }), new Paragraph({ text: '' })];

    if (!data.isFcUnspent) {
      return [
        ...leadIn,
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [
            new TextRun({ text: 'NO', bold: true }),
            new TextRun({
              text:
                ` Urban Local Body in the State of ${data.stateName} has any unspent balance under the ` +
                `${data.priorFcCycleFullLabel} grants and any previous Finance Commission grants.`,
            }),
          ],
        }),
        new Paragraph({ text: '' }),
      ];
    }

    return [
      ...leadIn,
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        text:
          `Following Urban Local Bodies in the State of ${data.stateName} has unspent balance under the ` +
          `${data.priorFcCycleFullLabel} grants and previous Finance Commission grants. The details of ULBs ` +
          'have been attached as under:',
      }),
      new Paragraph({ text: '' }),
      this.buildTable(data),
      new Paragraph({ text: '' }),
      new Paragraph({ text: 'The above-mentioned ULBs may be excluded from the list of eligible ULBs.' }),
      new Paragraph({ text: '' }),
    ];
  }

  private buildTable(data: FcUnspentDeclarationDocumentData & { isFcUnspent: true }): Table {
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('#', COLUMN_WIDTHS_PCT[0]),
        headerCell('ULB Name', COLUMN_WIDTHS_PCT[1]),
        headerCell('Census ID', COLUMN_WIDTHS_PCT[2]),
        headerCell(`${data.priorFcCycleLabel} unspent balance (in Lakhs)`, COLUMN_WIDTHS_PCT[3]),
        headerCell('Previous FC unspent balance (in Lakhs)', COLUMN_WIDTHS_PCT[4]),
      ],
    });

    const dataRows = data.rows.map(
      (row: FcUnspentDeclarationDocumentRow) =>
        new TableRow({
          children: [
            dataCell(String(row.slNo), COLUMN_WIDTHS_PCT[0]),
            dataCell(row.ulbName, COLUMN_WIDTHS_PCT[1]),
            dataCell(row.censusCode, COLUMN_WIDTHS_PCT[2]),
            dataCell(formatLakhs(row.unspentAmount), COLUMN_WIDTHS_PCT[3]),
            dataCell(formatLakhs(row.previousFcUnspentBalance), COLUMN_WIDTHS_PCT[4]),
          ],
        }),
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
      rows: [headerRow, ...dataRows],
    });
  }

  /** Matches the specimen's placement below both No/Yes options, and elected-urban-local-bodies'
   *  closing paragraph verbatim — both specimens use identical text here. */
  private buildClosingParagraph(data: FcUnspentDeclarationDocumentData): Paragraph[] {
    return [
      new Paragraph({
        text:
          '2. This is submitted for the consideration of the claim of first installment for ' +
          `FY ${data.designYearLabel} under the 16th Finance Commission grants.`,
      }),
    ];
  }

  /** Right-aligned to match the MoHUA specimen's bottom-right signature block; see CLAUDE.md's "The
   *  docx letter mirrors the MoHUA specimen's branch structure" section for why this text is
   *  literal, never substituted. */
  private buildSignatureBlock(): Paragraph[] {
    const line = (text: string) => new Paragraph({ alignment: AlignmentType.RIGHT, text });
    return [
      line('[Name]'),
      line('[Designation]'),
      line('[Department / Directorate]'),
      line('Government of [State Name]'),
      line('Date: [DD/MM/YYYY]'),
      line('Place: [Place]'),
      line('Seal: [Official Seal]'),
    ];
  }
}
