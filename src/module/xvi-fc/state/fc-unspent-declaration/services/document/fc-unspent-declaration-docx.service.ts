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
import { getTimeStamp } from 'src/shared/utils/date.utils';
import { FcUnspentDeclarationDocumentService } from './fc-unspent-declaration-document.service';
import type {
  FcUnspentDeclarationDocumentData,
  FcUnspentDeclarationDocumentRow,
} from 'src/module/xvi-fc/state/fc-unspent-declaration/types/fc-unspent-declaration-document.types';

/** Percentage column widths, in the same left-to-right order as the rendered table: '#', ULB,
 *  Census ID, 16th FC Allocation, prior-FC Unspent, % of Alloc., Eligible?. Sums to 100. */
const COLUMN_WIDTHS_PCT = [5, 20, 15, 17, 17, 13, 13];

const TABLE_BORDER: ITableBordersOptions = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
};

function formatRupees(value: number): string {
  // Whole Rupees only — no decimals.
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

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
 * Renders the FC Unspent Declaration letter as a `.docx` — consumed by
 * `GET :stateId/:yearId/fc-unspent-declaration-document`. Uses the `docx` npm package, same as
 * elected-urban-local-bodies' equivalent feature (the state must be able to type over the closing
 * signature block in Word before printing and signing, so the output has to be an editable
 * document, not a flattened PDF).
 *
 * Branches internally on `data.isFcUnspent`: the No branch is a short nil-balance certification
 * with no table; the Yes branch additionally renders the ULB-wise unspent-balance table. The
 * closing signature block (`[Name]`, `[Designation]`, etc.) is written as literal,
 * non-interpolated text — including its own `[State Name]` — by design, identical to
 * elected-urban-local-bodies' signature block; only the intro paragraph's state name (and, on the
 * Yes branch, the table) are filled with real data. See FcUnspentDeclarationDocumentService for
 * the gates that refuse to build this document (branch not yet chosen; Yes branch with zero rows).
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
    const fileName = `fc-unspent-declaration_${getTimeStamp(false)}.docx`;
    return { buffer, fileName };
  }

  private buildDocument(data: FcUnspentDeclarationDocumentData): Document {
    return new Document({
      sections: [
        {
          properties: {},
          children: [
            ...this.buildAddressBlock(),
            ...this.buildSubjectAndIntro(data),
            ...(data.isFcUnspent ? [this.buildTable(data), new Paragraph({ text: '' })] : []),
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
      new Paragraph({ text: 'To,' }),
      new Paragraph({ text: 'The Director,' }),
      new Paragraph({ text: 'Ministry of Housing and Urban Affairs (AMRUT-IIB),' }),
      new Paragraph({ text: 'Government of India,' }),
      new Paragraph({ text: 'New Delhi' }),
      new Paragraph({ text: '' }),
    ];
  }

  private buildSubjectAndIntro(data: FcUnspentDeclarationDocumentData): Paragraph[] {
    const subject = new Paragraph({
      children: [
        new TextRun({
          text: `Subject: Declaration regarding nil ${data.priorFcCycleFullLabel} unspent balance with Urban Local Bodies`,
          bold: true,
        }),
      ],
    });
    const salutation = new Paragraph({ text: 'Respected Sir/Madam,' });

    const intro = data.isFcUnspent
      ? new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          text:
            'This is to certify that, as per the records available with the State Government / Directorate ' +
            `and the confirmations received from the Urban Local Bodies, the following Urban Local Bodies in the ` +
            `State of ${data.stateName} hold unspent balance under ${data.priorFcCycleFullLabel} grants, as ` +
            'detailed below.',
        })
      : new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [
            new TextRun({
              text:
                'This is to certify that, as per the records available with the State Government / Directorate ' +
                'and the confirmations received from the Urban Local Bodies, ',
            }),
            new TextRun({
              bold: true,
              text:
                `no Urban Local Body in the State of ${data.stateName} holds any unspent balance under the ` +
                `${data.priorFcCycleFullLabel} grants`,
            }),
            new TextRun({ text: '.' }),
          ],
        });

    const paragraphs = [subject, new Paragraph({ text: '' }), salutation, new Paragraph({ text: '' }), intro];

    if (!data.isFcUnspent) {
      paragraphs.push(
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          text: `Accordingly, ULB-wise data on ${data.priorFcCycleFullLabel} unspent balance is not applicable for the State.`,
        }),
      );
    }

    paragraphs.push(new Paragraph({ text: '' }));
    return paragraphs;
  }

  private buildTable(data: FcUnspentDeclarationDocumentData & { isFcUnspent: true }): Table {
    // Header text matches the reference declaration's all-caps table styling verbatim.
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('#', COLUMN_WIDTHS_PCT[0]),
        headerCell('ULB', COLUMN_WIDTHS_PCT[1]),
        headerCell('CENSUS ID', COLUMN_WIDTHS_PCT[2]),
        headerCell('16TH FC ALLOCATION (RS.)', COLUMN_WIDTHS_PCT[3]),
        headerCell(`${data.priorFcCycleLabel.toUpperCase()} UNSPENT (RS.)`, COLUMN_WIDTHS_PCT[4]),
        headerCell('% OF ALLOC.', COLUMN_WIDTHS_PCT[5]),
        headerCell('ELIGIBLE?', COLUMN_WIDTHS_PCT[6]),
      ],
    });

    const dataRows = data.rows.map(
      (row: FcUnspentDeclarationDocumentRow) =>
        new TableRow({
          children: [
            dataCell(String(row.slNo), COLUMN_WIDTHS_PCT[0]),
            dataCell(row.ulbName, COLUMN_WIDTHS_PCT[1]),
            dataCell(row.censusCode, COLUMN_WIDTHS_PCT[2]),
            dataCell(formatRupees(row.allocationAmount), COLUMN_WIDTHS_PCT[3]),
            dataCell(formatRupees(row.unspentAmount), COLUMN_WIDTHS_PCT[4]),
            dataCell(formatPercent(row.allocationPerc), COLUMN_WIDTHS_PCT[5]),
            dataCell(yesNo(row.eligibility), COLUMN_WIDTHS_PCT[6]),
          ],
        }),
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
      rows: [headerRow, ...dataRows],
    });
  }

  private buildClosingParagraph(data: FcUnspentDeclarationDocumentData): Paragraph[] {
    const text = data.isFcUnspent
      ? `This is submitted for the consideration of the first installment claim for FY ${data.designYearLabel} under the 16th Finance Commission grants.`
      : `This declaration is being submitted for consideration of the first installment claim for FY ${data.designYearLabel} under the 16th Finance Commission grants.`;
    return [new Paragraph({ text })];
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
