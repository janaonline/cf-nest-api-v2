import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ClaimLetterDocumentService } from './claim-letter-document.service';
import type { ClaimLetterDocumentData } from '../../types/claim-letter.types';
import {
  CLAIM_LETTER_PDF_BOTTOM_THRESHOLD,
  CLAIM_LETTER_PDF_FONT_SIZE_BODY,
  CLAIM_LETTER_PDF_FONT_SIZE_FOOTNOTE,
  CLAIM_LETTER_PDF_FONT_SIZE_HEADING,
  CLAIM_LETTER_PDF_FONT_SIZE_TABLE,
  CLAIM_LETTER_PDF_FONT_SIZE_TITLE,
  CLAIM_LETTER_PDF_MARGIN,
  CLAIM_LETTER_PDF_PAGE_SIZE,
  CLAIM_LETTER_PDF_ROW_HEIGHT,
  computeColumnWidths,
} from './claim-letter-pdf-layout.helpers';

type CellAlign = 'left' | 'center' | 'right';

interface PdfTableSpec {
  headers: string[];
  rows: string[][];
  /** Defaults to left-aligned S.No./ULB columns, center-aligned for everything after. */
  align?: CellAlign[];
}

function formatCrore(value: number): string {
  return `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr.`;
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

/**
 * Renders the same `ClaimLetterDocumentData` the Preview Template dialog shows (Covering Letter +
 * Annexure 1 FC Disclosures + Annexure 2 City Conditions) into a PDF buffer, server-side —
 * previously done in the browser with `pdfmake`, moved here because `pdfmake`'s font-table parser
 * needs `'unsafe-eval'` in `script-src`, which environments with a strict CSP reject (see the
 * feature's own history for detail). Uses `pdfkit`, not `pdf-lib` — `pdfkit` has built-in text
 * wrapping and already has a working precedent in this backend
 * (`xv-fc-review/ulb/xv-fc-review-pdf.service.ts`); `pdf-lib` has neither and is only ever used
 * read-only elsewhere in this repo (`s3.service.ts`).
 *
 * `pdfkit` has no table/grid primitive of its own — `drawTable` below is the one hand-rolled
 * primitive shared by all 3 sections (fixed S.No./ULB columns + N dynamic trailing columns, a
 * repeating header row on page overflow, and a per-row height that grows for a wrapped ULB name).
 */
@Injectable()
export class ClaimLetterPdfService {
  constructor(private readonly documentService: ClaimLetterDocumentService) {}

  async generateDocumentPdf(claimLetterId: string, user: AuthUser): Promise<{ buffer: Buffer; fileName: string }> {
    const response = await this.documentService.getDocumentData(claimLetterId, user);
    // getDocumentData() always resolves with `data` populated on success (it throws rather than
    // ever returning `success: false`) — `data` is only optional on XviFcApiResponse's shared
    // shape to also cover error responses, matching this codebase's existing `.data!` convention
    // (see claim-letter-document.service.spec.ts).
    const data = response.data!;
    const buffer = await this.renderPdf(data);
    // Mirrors the frontend's pre-migration `downloadTemplate()` filename derivation exactly — the
    // Ref No.'s `/` separators aren't filesystem-safe.
    const fileName = `claim-letter-${data.refNo.replace(/[/\\]/g, '-')}.pdf`;
    return { buffer, fileName };
  }

  private renderPdf(data: ClaimLetterDocumentData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: CLAIM_LETTER_PDF_MARGIN, size: CLAIM_LETTER_PDF_PAGE_SIZE });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawCoveringLetterSection(doc, data);
      this.drawAnnexure1Section(doc, data);
      this.drawAnnexure2Section(doc, data);

      doc.end();
    });
  }

  private drawCoveringLetterSection(doc: PDFKit.PDFDocument, data: ClaimLetterDocumentData): void {
    const contentWidth = this.contentWidth(doc);

    doc
      .font('Times-Bold')
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_TITLE)
      .text(`${data.stateName} - ${data.departmentName}`);
    doc
      .font('Times-Roman')
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_BODY)
      .fillColor('#666666')
      .text(`Government of ${data.stateName}`);
    doc.fillColor('black');
    doc.moveDown(0.5);

    const metaY = doc.y;
    const formattedDate = new Date(data.letterDate).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    doc.fontSize(9).fillColor('#444444');
    doc.text(`Ref No.: ${data.refNo}`, doc.page.margins.left, metaY, { width: contentWidth / 2 });
    doc.text(`Date: ${formattedDate}`, doc.page.margins.left + contentWidth / 2, metaY, {
      width: contentWidth / 2,
      align: 'right',
    });
    doc.fillColor('black');
    // Reset `doc.x` back to the left margin — the "Date:" cell above was drawn with an explicit
    // `x` at the page's horizontal midpoint, and pdfkit never auto-resets `doc.x` afterward. Any
    // following `.text()` call that omits `x` inherits that stale midpoint as both its start
    // position *and* its default wrap width, rendering into the right half of the page only.
    doc.x = doc.page.margins.left;
    doc.y = metaY + 16;

    doc
      .font('Times-Bold')
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_BODY)
      .text(`Subject: ${data.subjectLine}`, doc.page.margins.left, doc.y, { width: contentWidth });
    doc.moveDown(0.5);
    doc
      .font('Times-Roman')
      .text(data.introParagraph, doc.page.margins.left, doc.y, { width: contentWidth, align: 'justify' });
    doc.moveDown();

    this.drawTable(doc, {
      headers: ['S.No.', 'Urban Local Body', 'Amount (Cr.)'],
      rows: data.coveringLetterRows.map((row) => [String(row.slNo), row.ulbName, formatCrore(row.claimAmount)]),
      align: ['left', 'left', 'right'],
    });

    const totalY = doc.y + 4;
    doc
      .moveTo(doc.page.margins.left, totalY)
      .lineTo(doc.page.margins.left + contentWidth, totalY)
      .strokeColor('black')
      .stroke();
    doc.font('Times-Bold').fontSize(CLAIM_LETTER_PDF_FONT_SIZE_TABLE);
    doc.text('Total', doc.page.margins.left, totalY + 4, { width: contentWidth * 0.7 });
    doc.text(formatCrore(data.totalClaimAmount), doc.page.margins.left + contentWidth * 0.7, totalY + 4, {
      width: contentWidth * 0.3,
      align: 'right',
    });
    // Same stale-`doc.x` reset as above — the "Total" amount cell just above was drawn at an
    // explicit x ~70% across the page.
    doc.x = doc.page.margins.left;
    doc.y = totalY + 4 + CLAIM_LETTER_PDF_ROW_HEIGHT;

    doc.font('Times-Roman').fontSize(CLAIM_LETTER_PDF_FONT_SIZE_BODY);
    doc.moveDown();
    doc.text(data.closingParagraph, doc.page.margins.left, doc.y, { width: contentWidth, align: 'justify' });
    doc.moveDown(2);
    doc.font('Times-Bold').text(data.signatoryName);
    doc.font('Times-Roman').fontSize(9).fillColor('#444444').text(data.signatoryDesignation);
    doc.fillColor('black');
  }

  private drawAnnexure1Section(doc: PDFKit.PDFDocument, data: ClaimLetterDocumentData): void {
    doc.addPage();
    doc
      .font('Times-Bold')
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_HEADING)
      .text('Annexure 1 - FC Unspent Balance Disclosures');
    doc.font('Times-Roman').fontSize(9).fillColor('#444444').text(`Ref: ${data.refNo}`);
    doc.fillColor('black');
    doc.moveDown(0.5);
    doc
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_BODY)
      .text(
        'The following table summarises the FC unspent balance disclosures for all recommended Urban Local Bodies.',
      );
    doc.moveDown();

    this.drawTable(doc, {
      headers: [
        'S.No.',
        'Urban Local Body',
        `${data.priorFcCycleLabel} Unspent (Cr.)`,
        '16th FC Allocation (Cr.)',
        'Eligible (<10%)',
      ],
      rows: data.annexure1Rows.map((row) => [
        String(row.slNo),
        row.ulbName,
        formatCrore(row.priorFcUnspentAmount),
        formatCrore(row.claimedAmount),
        yesNo(row.eligible),
      ]),
      align: ['left', 'left', 'right', 'right', 'center'],
    });
  }

  private drawAnnexure2Section(doc: PDFKit.PDFDocument, data: ClaimLetterDocumentData): void {
    doc.addPage();
    doc
      .font('Times-Bold')
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_HEADING)
      .text('Annexure 2 - City-wise Eligibility Conditions');
    doc.font('Times-Roman').fontSize(9).fillColor('#444444').text(`Ref: ${data.refNo}`);
    doc.fillColor('black');
    doc.moveDown(0.5);
    doc
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_BODY)
      .text(
        'Confirmation that each recommended Urban Local Body has met all prescribed eligibility conditions as on the date of this letter.',
      );
    doc.moveDown();

    // `row.criteria` is always built from the same `criteriaColumns` array as `annexure2Columns`,
    // in the same order (see ClaimLetterDocumentService) — a positional zip is safe, no need to
    // key by `type`.
    this.drawTable(doc, {
      headers: ['S.No.', 'Urban Local Body', ...data.annexure2Columns.map((c) => c.shortLabel)],
      rows: data.annexure2Rows.map((row) => [String(row.slNo), row.ulbName, ...row.criteria.map((c) => yesNo(c.met))]),
      align: ['left', 'left', ...data.annexure2Columns.map((): CellAlign => 'center')],
    });

    doc.moveDown();
    doc
      .fontSize(CLAIM_LETTER_PDF_FONT_SIZE_FOOTNOTE)
      .fillColor('#666666')
      .text(data.annexure2Columns.map((c) => `${c.shortLabel} = ${c.label}`).join(' · '));
    doc.fillColor('black');
  }

  /** The one table primitive shared by all 3 sections — fixed S.No./ULB columns (see
   *  `computeColumnWidths`) plus however many trailing columns `spec.headers` has beyond those 2.
   *  Re-draws the header on every page overflow, matching what pdfmake's `headerRows: 1` did
   *  automatically in the removed client-side builder — needed because a batch can run to hundreds
   *  of ULBs. */
  private drawTable(doc: PDFKit.PDFDocument, spec: PdfTableSpec): void {
    const contentWidth = this.contentWidth(doc);
    const widths = computeColumnWidths(spec.headers.length - 2, contentWidth);
    const columnWidths = [widths.slNo, widths.ulb, ...widths.trailing];
    const columnXOffsets = this.toXOffsets(columnWidths, doc.page.margins.left);
    const align: CellAlign[] = spec.align ?? columnWidths.map((_, i) => (i < 2 ? 'left' : 'center'));

    const drawHeader = (): void => {
      const y = doc.y;
      // A header label can wrap to 2 lines in a narrow trailing column — measure the tallest
      // header cell (same technique the row loop below already uses for the ULB-name column)
      // instead of assuming every header fits on one line; otherwise the fixed row height clips
      // the second line and the first data row overlaps it.
      doc.font('Times-Bold').fontSize(CLAIM_LETTER_PDF_FONT_SIZE_TABLE);
      const headerHeight = Math.max(
        CLAIM_LETTER_PDF_ROW_HEIGHT,
        ...spec.headers.map((label, i) => doc.heightOfString(label, { width: columnWidths[i] }) + 6),
      );
      doc.rect(doc.page.margins.left, y, contentWidth, headerHeight).fill('#f2f2f2');
      doc.fillColor('black').font('Times-Bold').fontSize(CLAIM_LETTER_PDF_FONT_SIZE_TABLE);
      spec.headers.forEach((label, i) => {
        doc.text(label, columnXOffsets[i], y + 3, { width: columnWidths[i], align: align[i] });
      });
      // Separator line sits at the shaded rect's bottom edge; the first row then starts 2pt below
      // the line — that gap is what was missing before (row text used to start flush against it).
      doc
        .moveTo(doc.page.margins.left, y + headerHeight)
        .lineTo(doc.page.margins.left + contentWidth, y + headerHeight)
        .strokeColor('#cccccc')
        .stroke();
      doc.y = y + headerHeight + 2;
      doc.font('Times-Roman').fontSize(CLAIM_LETTER_PDF_FONT_SIZE_TABLE);
    };

    drawHeader();

    for (const row of spec.rows) {
      // Only the ULB-name column (always index 1) realistically wraps to more than one line —
      // grow the row height for it rather than assuming a fixed single-line row everywhere. `+ 6`
      // (not `+ 4`) to match the `y + 3` top padding cells are drawn with below, same as headers.
      const ulbCellHeight = doc.heightOfString(row[1] ?? '', { width: columnWidths[1] });
      const rowHeight = Math.max(CLAIM_LETTER_PDF_ROW_HEIGHT, ulbCellHeight + 6);

      if (doc.y + rowHeight > CLAIM_LETTER_PDF_BOTTOM_THRESHOLD) {
        doc.addPage();
        drawHeader();
      }

      const y = doc.y;
      row.forEach((cell, i) => {
        // `y + 3` top padding matches the header cells — previously cells were drawn flush at
        // `y`, which is why rows looked tight against whatever was above them.
        doc.text(cell, columnXOffsets[i], y + 3, { width: columnWidths[i], align: align[i] });
      });
      doc.y = y + rowHeight;
    }

    // Reset `doc.x` back to the left margin — the last cell drawn above used an explicit `x`
    // (possibly far right, e.g. Annexure 2's last criteria column), and pdfkit never auto-resets
    // `doc.x` afterward. Without this, whatever plain-flow `.text()` call follows `drawTable()`
    // (e.g. Annexure 2's footnote line) would inherit that stale x as both its start position and
    // its default wrap width.
    doc.x = doc.page.margins.left;
  }

  private contentWidth(doc: PDFKit.PDFDocument): number {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  private toXOffsets(widths: number[], startX: number): number[] {
    const offsets: number[] = [];
    let x = startX;
    for (const w of widths) {
      offsets.push(x);
      x += w;
    }
    return offsets;
  }
}
