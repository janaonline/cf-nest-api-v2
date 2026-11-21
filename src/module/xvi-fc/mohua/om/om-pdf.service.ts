import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  CLAIM_LETTER_COLUMN_ALIGN,
  claimLetterColumnShares,
} from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-annexure-columns.helpers';
import { printedText } from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-letter.helpers';
import type {
  ClaimLetterParagraph,
  ClaimLetterRun,
} from 'src/module/xvi-fc/state/claim-letter/types/claim-letter-document.types';
import type { OmContent, OmUlbLists } from './om.types';

/** The claim letter's .docx layout in points: 1" margins, Times 12pt body, 11pt tables. */
const MARGIN = 72;
const BODY_SIZE = 12;
const TABLE_SIZE = 11;
const REGULAR = 'Times-Roman';
const BOLD = 'Times-Bold';
/** Where a numbered paragraph's text starts ("2." hangs in front of it). */
const NUMBER_INDENT = 36;
const PARAGRAPH_AFTER = 6;
const CELL_PADDING = 4;
const CELL_PARAGRAPH_AFTER = 2;
/** Column widths per mille of the text width: S. No. | condition | status, and State | allocation | recommendation. */
const COMPLIANCE_SHARES = [90, 440, 470];
const RECOMMENDATION_SHARES = [180, 330, 490];

type Doc = PDFKit.PDFDocument;
type Align = 'left' | 'center' | 'right' | 'justify';

interface TableOptions {
  /** One per column; left when not given. */
  aligns?: Align[];
  headerAlign?: Align;
}

interface ParagraphOptions {
  align?: Align;
  before?: number;
  after?: number;
  size?: number;
  x?: number;
  width?: number;
  underline?: boolean;
}

/**
 * Draws the OM model as an A4 PDF, section by section in the order the portal preview shows, then the claim letter's
 * ULB lists (rows J and K) on landscape pages. The State's annexure documents are appended by OmService.
 */
@Injectable()
export class OmPdfService {
  render(content: OmContent): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        this.draw(doc, content);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
      doc.end();
    });
  }

  private draw(doc: Doc, c: OmContent): void {
    const lastAddress = c.address.length - 1;
    paragraph(doc, c.number, { after: 12 });
    c.letterhead.forEach((p) => paragraph(doc, p, { align: 'center', after: 2 }));
    c.address.forEach((p, i) =>
      paragraph(doc, p, { align: 'right', before: i === 0 ? 12 : 0, after: i === lastAddress ? 12 : 2 }),
    );
    paragraph(doc, { runs: [{ text: c.title, bold: true }] }, { align: 'center', after: 12, underline: true });
    paragraph(doc, c.subject, { align: 'justify', after: 10 });
    paragraph(doc, c.intro, { align: 'justify', after: 10 });
    table(
      doc,
      c.complianceHeaders,
      c.compliance.map((row) => [[{ runs: [{ text: row.key }] }], row.condition, row.status]),
      COMPLIANCE_SHARES,
    );
    paragraph(doc, c.analysis, { before: 12 });
    table(doc, c.recommendationHeaders, [c.recommendation.map((p) => [p])], RECOMMENDATION_SHARES);
    c.closing.forEach((p, i) => paragraph(doc, p, { before: i === 0 ? 12 : 0 }));
    paragraph(doc, c.enclosure, { before: 6, after: 18 });

    // The signature block stays on one page.
    const signatureHeight = c.signature.reduce((h, p) => h + measure(doc, p, textWidth(doc), BODY_SIZE) + 2, 0);
    if (doc.y + signatureHeight > bottom(doc)) newPage(doc);
    c.signature.forEach((p) => paragraph(doc, p, { align: 'right', after: 2 }));
    c.addressee.forEach((p, i) => paragraph(doc, p, { before: i === 0 ? 18 : 0, after: 2 }));
    if (c.ulbLists) this.drawUlbLists(doc, c.ulbLists);
  }

  /** The claim letter's annexure as its .docx prints it: same columns, widths and alignment. */
  private drawUlbLists(doc: Doc, u: OmUlbLists): void {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: MARGIN });
    paragraph(doc, { runs: [{ text: u.title }] }, { align: 'right', after: 8 });
    const shares = claimLetterColumnShares(u.columns);
    const aligns = u.columns.map((col) => CLAIM_LETTER_COLUMN_ALIGN[col.kind]);
    const headers = u.columns.map((col) => col.header);
    u.lists.forEach((list, i) => {
      paragraph(doc, { runs: [{ text: list.heading, bold: true }] }, { before: i ? 16 : 0, after: 3 });
      paragraph(doc, { runs: [{ text: list.subheading }] }, { after: 5 });
      if (!list.rows.length) {
        paragraph(doc, { runs: [{ text: 'Nil' }] });
        return;
      }
      const rows = list.rows.map((cells) => cells.map((text) => [{ runs: [{ text }] }]));
      table(doc, headers, rows, shares, { aligns, headerAlign: 'center' });
    });
    if (u.footnote) paragraph(doc, u.footnote, { before: 10 });
  }
}

/** One model paragraph: runs in order (bold runs in Times-Bold), a "2." number hanging in front when present. */
function paragraph(doc: Doc, p: ClaimLetterParagraph, o: ParagraphOptions = {}): void {
  const size = o.size ?? BODY_SIZE;
  const x = o.x ?? doc.page.margins.left;
  const width = o.width ?? textWidth(doc);
  const numbered = p.number !== undefined;
  const runs = p.runs.map((run) => ({ text: pdfText(run), bold: run.bold })).filter((run) => run.text);

  doc.y += o.before ?? 0;
  if (runs.length || numbered) {
    doc.font(REGULAR).fontSize(size);
    // Keep the number and the first line together.
    if (doc.y + doc.currentLineHeight(true) > bottom(doc)) newPage(doc);
    const top = doc.y;
    if (numbered) {
      doc.text(p.number ?? '', x, top, { lineBreak: false });
      doc.y = top;
    }
    const textX = numbered ? x + NUMBER_INDENT : x;
    const options = {
      width: numbered ? width - NUMBER_INDENT : width,
      align: o.align ?? (numbered ? 'justify' : 'left'),
      underline: o.underline,
    };
    runs.forEach((run, i) => {
      doc.font(run.bold ? BOLD : REGULAR).fontSize(size);
      const continued = i < runs.length - 1;
      if (i === 0) doc.text(run.text, textX, top, { ...options, continued });
      else doc.text(run.text, { ...options, continued });
    });
  }
  doc.y += o.after ?? PARAGRAPH_AFTER;
  doc.x = doc.page.margins.left;
}

/** A bordered table across the text width: bold header row, repeated on every page the table runs onto. */
function table(
  doc: Doc,
  headers: string[],
  rows: ClaimLetterParagraph[][][],
  shares: number[],
  o: TableOptions = {},
): void {
  const total = textWidth(doc);
  const sum = shares.reduce((a, s) => a + s, 0);
  const widths = shares.map((share) => (total * share) / sum);
  const aligns = o.aligns ?? [];
  const headerAligns = headers.map(() => o.headerAlign ?? 'left');
  const header: ClaimLetterParagraph[][] = headers.map((h) => [{ runs: [{ text: h, bold: true }] }]);
  const headerHeight = rowHeight(doc, header, widths);

  // ponytail: a single row taller than a page overflows it; rows A-K and a ULB row are a few lines each.
  if (doc.y + headerHeight + (rows[0] ? rowHeight(doc, rows[0], widths) : 0) > bottom(doc)) newPage(doc);
  drawRow(doc, header, widths, headerHeight, headerAligns);
  for (const row of rows) {
    const height = rowHeight(doc, row, widths);
    if (doc.y + height > bottom(doc)) {
      newPage(doc);
      drawRow(doc, header, widths, headerHeight, headerAligns);
    }
    drawRow(doc, row, widths, height, aligns);
  }
  doc.x = doc.page.margins.left;
}

function drawRow(doc: Doc, cells: ClaimLetterParagraph[][], widths: number[], height: number, aligns: Align[]): void {
  const top = doc.y;
  let x = doc.page.margins.left;
  cells.forEach((cell, i) => {
    doc.lineWidth(0.5).rect(x, top, widths[i], height).stroke();
    doc.y = top + CELL_PADDING;
    cell.forEach((p) =>
      paragraph(doc, p, {
        x: x + CELL_PADDING,
        width: widths[i] - 2 * CELL_PADDING,
        size: TABLE_SIZE,
        align: aligns[i] ?? 'left',
        after: CELL_PARAGRAPH_AFTER,
      }),
    );
    x += widths[i];
  });
  doc.y = top + height;
}

function rowHeight(doc: Doc, cells: ClaimLetterParagraph[][], widths: number[]): number {
  const inner = cells.map((cell, i) =>
    cell.reduce((h, p) => h + measure(doc, p, widths[i] - 2 * CELL_PADDING, TABLE_SIZE) + CELL_PARAGRAPH_AFTER, 0),
  );
  return Math.max(...inner) + 2 * CELL_PADDING;
}

/** Measured in bold when any run is bold: bold is wider, so the estimate never comes up short. */
function measure(doc: Doc, p: ClaimLetterParagraph, width: number, size: number): number {
  const text = p.runs.map(pdfText).join('');
  if (!text) return 0;
  const font = p.runs.some((run) => run.bold) ? BOLD : REGULAR;
  const w = p.number !== undefined ? width - NUMBER_INDENT : width;
  return doc.font(font).fontSize(size).heightOfString(text, { width: w });
}

/** A run's text in the PDF's standard fonts, which have no rupee sign (the OM itself already writes "Rs."). */
function pdfText(run: ClaimLetterRun): string {
  return printedText(run).replace(/₹/g, 'Rs.');
}

/** A new page in the current page's orientation (pdfkit's bare addPage() reverts to the document's portrait). */
function newPage(doc: Doc): void {
  doc.addPage({ size: 'A4', layout: doc.page.width > doc.page.height ? 'landscape' : 'portrait', margin: MARGIN });
}

function textWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottom(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom;
}
