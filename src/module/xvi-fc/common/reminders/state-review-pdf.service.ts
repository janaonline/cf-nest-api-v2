import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface StateReviewPdfRow {
  slNo: number;
  ulbName: string;
  ulbCode: string;
  formType: string;
  submittedOnLabel: string;
  daysPending: number;
}

export interface StateReviewPdfData {
  stateName: string;
  generatedAtLabel: string;
  rows: StateReviewPdfRow[];
}

const PAGE_SIZE = 'A4' as const;
const MARGIN = 40;
const BOTTOM_THRESHOLD = 760;
const ROW_HEIGHT = 18;

// Same brand palette as the HTML email shell (state-member-invite.hbs / the two reminder templates)
// so the attachment reads as the same document family as the email it's attached to.
const BRAND_BLUE = '#0f4c81';
const BRAND_TEAL = '#009688';
const BAND_HEIGHT = 78;
const CONTENT_START_Y = BAND_HEIGHT + 34;

const FONT_SIZE_TITLE = 14;
const FONT_SIZE_BODY = 10;
const FONT_SIZE_TABLE = 9;

// Fixed 6-column layout — unlike claim-letter's PDF (2 fixed + N dynamic trailing columns), every
// column here is fixed and known up front, so widths are hardcoded rather than computed. Weighted
// by realistic content rather than split dead-even — a literal 1/6 split would starve "Submitted
// On" (needs ~100pt for "25 Aug 2026, 12:39 PM" on one line) while wasting space on "Days Pending"
// (never more than 2-3 digits). Widths sum to the full 515pt content area (A4 minus margins).
const COLUMNS: { header: string; width: number; align: 'left' | 'center' | 'right' }[] = [
  { header: 'S.No.', width: 35, align: 'left' },
  { header: 'ULB Name', width: 150, align: 'left' },
  { header: 'ULB Code', width: 55, align: 'center' },
  { header: 'Form Type', width: 115, align: 'left' },
  { header: 'Submitted On', width: 105, align: 'center' },
  { header: 'Days Pending', width: 55, align: 'center' },
];

/**
 * Renders the STATE review-reminder digest's ULB/form list into a PDF buffer — the same data the
 * digest email's HTML table shows, attached so the state user has a dated, state-stamped record
 * even if forwarded outside the email. Modeled on
 * `state/claim-letter/services/document/claim-letter-pdf.service.ts`'s stream-to-Buffer shape, but
 * with a purpose-built fixed-column table rather than importing that service's private `drawTable`
 * — its "2 fixed + N dynamic trailing" column model doesn't fit this flat 6-column report.
 *
 * Every page carries the same letterhead band + watermark as a matching pair: `pageAdded` covers
 * pages created by `doc.addPage()` during table overflow, and `drawPageChrome` is also called once
 * up front for the first page, which is created by the constructor rather than `addPage()` and so
 * never fires that event itself.
 */
@Injectable()
export class StateReviewPdfService {
  generatePdf(data: StateReviewPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: MARGIN, size: PAGE_SIZE, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.on('pageAdded', () => this.drawPageChrome(doc));

      this.drawPageChrome(doc);
      this.drawReportHeader(doc, data);
      this.drawTable(doc, data.rows);
      this.drawFooter(doc, data.rows.length);

      doc.end();
    });
  }

  /** Letterhead band + CityFinance wordmark + faint diagonal watermark — drawn first on every
   *  page so the table/text painted afterward layers cleanly on top. */
  private drawPageChrome(doc: PDFKit.PDFDocument): void {
    this.drawWatermark(doc);

    doc.rect(0, 0, doc.page.width, BAND_HEIGHT).fill(BRAND_BLUE);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('city', MARGIN, 20, { continued: true })
      .fillColor('#8fd6cc')
      .text('finance', { continued: false });
    doc
      .fillColor('#c7d9ea')
      .font('Helvetica')
      .fontSize(9)
      .text('XVI Finance Commission — CityFinance Portal', MARGIN, 46);
    doc.moveTo(0, BAND_HEIGHT).lineTo(doc.page.width, BAND_HEIGHT).strokeColor(BRAND_TEAL).lineWidth(3).stroke();
    doc.lineWidth(1);

    doc.fillColor('black').font('Times-Roman');
    doc.y = CONTENT_START_Y;
    doc.x = doc.page.margins.left;
  }

  private drawWatermark(doc: PDFKit.PDFDocument): void {
    doc.save();
    doc
      .rotate(-40, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .fillColor(BRAND_BLUE)
      .opacity(0.06)
      .font('Helvetica-Bold')
      .fontSize(76)
      .text('CityFinance', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
    doc.restore();
    doc.opacity(1).fillColor('black');
  }

  private drawReportHeader(doc: PDFKit.PDFDocument, data: StateReviewPdfData): void {
    doc.font('Times-Bold').fontSize(FONT_SIZE_TITLE).fillColor(BRAND_BLUE);
    doc.text(`Forms Pending State Review — ${data.stateName}`);
    doc
      .font('Times-Roman')
      .fontSize(FONT_SIZE_BODY)
      .fillColor('#666666')
      .text(`Generated on ${data.generatedAtLabel} IST`);
    doc.fillColor('black');
    doc.moveDown();
  }

  private drawFooter(doc: PDFKit.PDFDocument, total: number): void {
    doc.moveDown();
    doc.font('Times-Bold').fontSize(FONT_SIZE_BODY).fillColor(BRAND_BLUE).text(`Total forms pending: ${total}`);
    doc.fillColor('black');

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // pdfkit auto-inserts a new page whenever `.text()` lands within the page's bottom margin —
      // exactly where a footer has to sit. Zeroing the bottom margin for this page only disables
      // that safety check without affecting layout (nothing else draws down here).
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      const bottomY = doc.page.height - 30;
      doc
        .moveTo(doc.page.margins.left, bottomY)
        .lineTo(doc.page.width - doc.page.margins.right, bottomY)
        .strokeColor('#dddddd')
        .stroke();
      doc
        .font('Times-Roman')
        .fontSize(8)
        .fillColor('#999999')
        .text('CityFinance — Ministry of Housing and Urban Affairs, Government of India', doc.page.margins.left, bottomY + 6, {
          width: this.contentWidth(doc) - 60,
          lineBreak: false,
        })
        .text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - doc.page.margins.right - 60, bottomY + 6, {
          width: 60,
          align: 'right',
          lineBreak: false,
        });
      doc.fillColor('black');
      doc.page.margins.bottom = originalBottomMargin;
    }
  }

  private contentWidth(doc: PDFKit.PDFDocument): number {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  private toXOffsets(): number[] {
    const offsets: number[] = [];
    let x = MARGIN;
    for (const col of COLUMNS) {
      offsets.push(x);
      x += col.width;
    }
    return offsets;
  }

  private drawTable(doc: PDFKit.PDFDocument, rows: StateReviewPdfRow[]): void {
    const contentWidth = this.contentWidth(doc);
    const xOffsets = this.toXOffsets();

    const drawHeaderRow = (): void => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(FONT_SIZE_TABLE);
      // A narrow column's header label (e.g. "Days Pending") can wrap to 2 lines — measure the
      // tallest header cell instead of assuming a fixed single-line row, otherwise the band clips
      // the wrapped second line right where the first data row starts.
      const headerHeight = Math.max(
        ROW_HEIGHT,
        ...COLUMNS.map((col) => doc.heightOfString(col.header, { width: col.width }) + 8),
      );
      doc.rect(doc.page.margins.left, y, contentWidth, headerHeight).fill(BRAND_BLUE);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(FONT_SIZE_TABLE);
      COLUMNS.forEach((col, i) => {
        doc.text(col.header, xOffsets[i], y + 4, { width: col.width, align: col.align });
      });
      doc.y = y + headerHeight;
      doc.fillColor('black').font('Times-Roman').fontSize(FONT_SIZE_TABLE);
    };

    drawHeaderRow();

    rows.forEach((row, index) => {
      const cells = [
        String(row.slNo),
        row.ulbName,
        row.ulbCode,
        row.formType,
        row.submittedOnLabel,
        String(row.daysPending),
      ];
      // Grow the row to fit whichever cell wraps tallest — a long ULB name is the usual case, but
      // a narrow date format wrapping mid-word (e.g. "12:39" / "pm" splitting across two lines)
      // can do it too, so this checks every cell rather than assuming only the ULB-name column.
      const tallestCellHeight = Math.max(
        ...cells.map((cell, i) => doc.heightOfString(cell, { width: COLUMNS[i].width })),
      );
      const rowHeight = Math.max(ROW_HEIGHT, tallestCellHeight + 8);

      if (doc.y + rowHeight > BOTTOM_THRESHOLD) {
        doc.addPage();
        drawHeaderRow();
      }

      const y = doc.y;
      // Zebra striping — alternate a faint tint behind each row for readability on a long list.
      if (index % 2 === 1) {
        doc.rect(doc.page.margins.left, y, contentWidth, rowHeight).fill('#f4f8f8');
        doc.fillColor('black');
      }
      cells.forEach((cell, i) => {
        doc.text(cell, xOffsets[i], y + 4, { width: COLUMNS[i].width, align: COLUMNS[i].align });
      });
      doc
        .moveTo(doc.page.margins.left, y + rowHeight)
        .lineTo(doc.page.margins.left + contentWidth, y + rowHeight)
        .strokeColor('#e5e5e5')
        .stroke();
      doc.y = y + rowHeight;
    });

    doc.x = doc.page.margins.left;
  }
}
