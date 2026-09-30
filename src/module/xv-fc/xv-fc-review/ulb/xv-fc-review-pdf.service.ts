import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export type XvFcCurrency = 'INR' | 'LAKH' | 'CRORE';

interface AdminDecision {
  status: string;
  reason?: string | null;
  correctedValue?: number | null;
}

interface PdfLineItem {
  code: string;
  name: string | null;
  standardizedAmount: number | null;
  flagged: boolean;
  proposedValue: number | null;
  comment: string | null;
  adminDecision: AdminDecision | null;
}

interface BuildPdfParams {
  ulbName: string;
  financialYear: string;
  status: string;
  finalAction: string | null;
  submittedAt: Date | string | null;
  lineItems: PdfLineItem[];
}

// The controller passes through whatever string a caller sends in the
// `currency` query param — never validated or case-normalized. A strict
// `=== 'LAKH'` comparison silently no-ops (falls back to unconverted INR)
// for anything but an exact uppercase match, while the header still prints
// back the caller's original string, making it look like the currency was
// applied when it wasn't. Normalize once, up front, so the displayed label
// and the actual conversion can never disagree.
export function normalizeCurrency(currency: string | null | undefined): XvFcCurrency {
  const upper = (currency ?? '').trim().toUpperCase();
  return upper === 'LAKH' || upper === 'CRORE' ? upper : 'INR';
}

// Unlike Ptax's propertytaxopmappers source, ledgerlogs.lineItems values
// are genuine raw rupees (e.g. 4741268), not pre-scaled to lakhs — verified
// against real data. Divide down for LAKH/CRORE display.
function formatAmount(amount: number | null | undefined, currency: XvFcCurrency): string {
  if (amount === null || amount === undefined) return '-';
  const divisor = currency === 'CRORE' ? 1e7 : currency === 'LAKH' ? 1e5 : 1;
  return (amount / divisor).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(value: Date | string | null): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const FLAG_COLOR = '#B45309'; // amber — draws the eye without reading as an error
const COMMENT_COLOR = '#374151'; // neutral dark gray
const HIGHLIGHT_FILL = '#FEF3C7'; // pale amber background behind a flagged block
const DECISION_COLOR: Record<string, string> = {
  ACCEPTED: '#15803D', // green
  REJECTED: '#B91C1C', // red
  PENDING: '#B45309', // amber — matches the "still open" flagged color
};

const HEADER_HIGHLIGHT = '#EFF6FF'; // pale blue — visually distinct from the amber flagged-row highlight
const LABEL_COLOR = '#1F2937';
const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: '#6B7280', // gray
  DRAFT: '#6B7280', // gray
  SUBMITTED: '#B45309', // amber — awaiting review
  LOCKED: '#1D4ED8', // blue — finalized (AFS's terminal state)
  APPROVED: '#15803D', // green
  REJECTED: '#B91C1C', // red
};

interface DetailLine {
  text: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
}

// The Status/Final Action/Submitted summary line, as inline colored
// segments — Status carries semantic meaning (approved vs. rejected vs.
// still pending), so it gets state-based coloring; the others are bold
// but neutral, since there's no inherent "good/bad" to a final action.
function buildSummarySegments(
  status: string,
  finalAction: string | null,
  submittedAt: Date | string | null,
): DetailLine[] {
  const segments: DetailLine[] = [
    { text: 'Status: ', color: LABEL_COLOR, bold: true },
    { text: status, color: STATUS_COLOR[status] ?? LABEL_COLOR, bold: true },
  ];
  if (finalAction) {
    segments.push({ text: '   |   Final Action: ', color: LABEL_COLOR, bold: true });
    segments.push({ text: finalAction, color: LABEL_COLOR, bold: true });
  }
  if (submittedAt) {
    segments.push({ text: '   |   Submitted: ', color: LABEL_COLOR, bold: true });
    segments.push({ text: formatDate(submittedAt), color: LABEL_COLOR });
  }
  return segments;
}

// A flagged line item's "modification block" — what the ULB claimed and
// where the admin decision currently stands, one color-coded line each.
// Skipped entirely for unflagged items, which have no user action to
// report.
function buildModificationLines(item: PdfLineItem, currency: XvFcCurrency): DetailLine[] {
  const lines: DetailLine[] = [
    { text: `Flagged — Proposed Value: ${formatAmount(item.proposedValue, currency)}`, color: FLAG_COLOR, bold: true },
  ];
  if (item.comment) lines.push({ text: `Comment: ${item.comment}`, color: COMMENT_COLOR, italic: true });
  if (item.adminDecision) {
    const d = item.adminDecision;
    let text = `Admin Decision: ${d.status}`;
    if (d.reason) text += ` — Reason: ${d.reason}`;
    if (d.correctedValue !== null && d.correctedValue !== undefined) {
      text += ` — Corrected Value: ${formatAmount(d.correctedValue, currency)}`;
    }
    lines.push({ text, color: DECISION_COLOR[d.status] ?? FLAG_COLOR, bold: true });
  }
  return lines;
}

@Injectable()
export class XvFcReviewPdfService {
  buildLineItemsPdf(params: BuildPdfParams, currency: string = 'INR'): Promise<Buffer> {
    const normalizedCurrency = normalizeCurrency(currency);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(14).text(`Standardised Financial Statement — ${params.ulbName}`);
      doc.fontSize(11).text(`Financial Year: ${params.financialYear}   |   Currency: ${normalizedCurrency}`);

      // Status/Final Action/Submitted, highlighted as its own panel below
      // the title lines — Status colored by state so the reviewer can spot
      // where a submission stands at a glance.
      doc.fontSize(10);
      const summarySegments = buildSummarySegments(params.status, params.finalAction, params.submittedAt);
      const summaryPlainText = summarySegments.map((s) => s.text).join('');
      const summaryHeight = doc.heightOfString(summaryPlainText, { width: 515 });
      doc.rect(36, doc.y - 3, 523, summaryHeight + 6).fill(HEADER_HIGHLIGHT);
      const summaryY = doc.y;
      summarySegments.forEach((segment, i) => {
        const isLast = i === summarySegments.length - 1;
        doc.font(segment.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(segment.color);
        if (i === 0) doc.text(segment.text, 40, summaryY, { continued: !isLast });
        else doc.text(segment.text, { continued: !isLast });
      });
      doc.font('Helvetica').fillColor('black');
      doc.moveDown();

      const columns = { code: 40, name: 100, amount: 420 };
      const nameWidth = 300;
      const amountWidth = 115;
      const detailX = 100;
      const detailWidth = 435;

      doc.fontSize(9).text('Code', columns.code, doc.y, { continued: true, width: 60 });
      doc.text('Line Item', columns.name, doc.y, { continued: true, width: 320 });
      // Right-aligned to match the right-aligned data column below it —
      // left-aligning the header while the data is right-aligned reads as
      // misaligned even though each cell individually is correctly placed.
      doc.text('Amount', columns.amount, doc.y, { width: amountWidth, align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.3);

      // A handful of catalog names run long enough to wrap (e.g. "Prepaid
      // Expenses" is short, but "Miscellaneous Expenditure (to the extent
      // not written off)" isn't) — a fixed moveDown() only advances past
      // the first line, letting the next row overlap the wrapped
      // remainder. Measure the actual wrapped height and advance the
      // cursor past the tallest cell in the row instead. Flagged items get
      // an extra indented, highlighted block underneath reporting what the
      // ULB proposed and where the admin decision stands — skipped for
      // unflagged items, which have no user action to report.
      params.lineItems.forEach((item, index) => {
        const y = doc.y;
        doc.fontSize(9);
        const nameHeight = doc.heightOfString(item.name ?? '-', { width: nameWidth });
        doc.text(item.code, columns.code, y, { width: 55 });
        doc.text(item.name ?? '-', columns.name, y, { width: nameWidth });
        doc.text(formatAmount(item.standardizedAmount, normalizedCurrency), columns.amount, y, {
          width: amountWidth,
          align: 'right',
        });
        let cursorY = y + Math.max(nameHeight, doc.currentLineHeight()) + 4;

        if (item.flagged) {
          doc.fontSize(8);
          const lines = buildModificationLines(item, normalizedCurrency);
          const lineHeights = lines.map((l) => doc.heightOfString(l.text, { width: detailWidth }));
          const blockHeight = lineHeights.reduce((sum, h) => sum + h, 0) + (lines.length - 1) * 2;

          // Highlight rectangle behind the block, drawn first so the text
          // renders on top of it.
          doc.rect(detailX - 4, cursorY - 2, detailWidth + 8, blockHeight + 4).fill(HIGHLIGHT_FILL);

          let lineY = cursorY;
          lines.forEach((line, i) => {
            const font = line.bold ? 'Helvetica-Bold' : line.italic ? 'Helvetica-Oblique' : 'Helvetica';
            doc.font(font).fillColor(line.color).text(line.text, detailX, lineY, { width: detailWidth });
            lineY += lineHeights[i] + 2;
          });
          doc.font('Helvetica').fillColor('black').fontSize(9);
          cursorY = lineY + 2;
        }

        doc.y = cursorY + 2;
        // Only break to a new page if there's actually another row to
        // draw on it — checking purely on y-position would add a
        // trailing blank page whenever the last row happened to cross
        // the threshold.
        const isLastItem = index === params.lineItems.length - 1;
        if (doc.y > 740 && !isLastItem) doc.addPage();
      });

      doc.end();
    });
  }
}
