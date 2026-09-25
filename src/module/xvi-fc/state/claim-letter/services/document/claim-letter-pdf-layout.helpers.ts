/**
 * Pure layout constants/math for `ClaimLetterPdfService` — no `pdfkit` document/page objects
 * touched here, so this stays trivially unit-testable. `pdfkit` handles text wrapping itself
 * (`doc.text(str, x, y, { width })`), so the one thing genuinely worth extracting is Annexure 2's
 * dynamic column-width split — everything else is a fixed layout constant.
 */

/** A4 in points, matching the removed frontend pdfmake builder's page geometry. */
export const CLAIM_LETTER_PDF_PAGE_SIZE = 'A4' as const;
export const CLAIM_LETTER_PDF_MARGIN = 40;
/** `doc.y` beyond which a table row must not be drawn — triggers a new page + header re-draw
 *  instead. A4 height (842pt) minus the bottom margin, with a little headroom for the row itself. */
export const CLAIM_LETTER_PDF_BOTTOM_THRESHOLD = 780;

export const CLAIM_LETTER_PDF_FONT_SIZE_TITLE = 14;
export const CLAIM_LETTER_PDF_FONT_SIZE_HEADING = 12;
export const CLAIM_LETTER_PDF_FONT_SIZE_BODY = 10;
export const CLAIM_LETTER_PDF_FONT_SIZE_TABLE = 9;
export const CLAIM_LETTER_PDF_FONT_SIZE_FOOTNOTE = 8;

export const CLAIM_LETTER_PDF_ROW_HEIGHT = 16;

/** Fixed widths for the two leading columns every table shares (S.No., ULB name); the remaining
 *  content width is split evenly across however many criteria/amount columns follow. */
const SL_NO_COLUMN_WIDTH = 35;
const ULB_NAME_COLUMN_WIDTH = 160;

export interface ClaimLetterPdfColumnWidths {
  slNo: number;
  ulb: number;
  /** One entry per trailing column (e.g. Annexure 2's dynamic criteria columns, or Annexure 1's
   *  fixed 3 amount/eligibility columns) — always sums to `contentWidth - slNo - ulb`. */
  trailing: number[];
}

/**
 * Splits `contentWidth` into the shared S.No./ULB columns plus `trailingColumnCount` equal-width
 * columns for whatever follows (Annexure 2's per-criterion columns, Annexure 1's amount/eligibility
 * columns, or the covering letter's single amount column). `trailingColumnCount: 0` is valid (all
 * width folds into the ULB column) — never divides by zero.
 */
export function computeColumnWidths(trailingColumnCount: number, contentWidth: number): ClaimLetterPdfColumnWidths {
  const remaining = contentWidth - SL_NO_COLUMN_WIDTH - ULB_NAME_COLUMN_WIDTH;
  if (trailingColumnCount <= 0) {
    return { slNo: SL_NO_COLUMN_WIDTH, ulb: ULB_NAME_COLUMN_WIDTH + Math.max(remaining, 0), trailing: [] };
  }
  const each = Math.max(remaining, 0) / trailingColumnCount;
  return {
    slNo: SL_NO_COLUMN_WIDTH,
    ulb: ULB_NAME_COLUMN_WIDTH,
    trailing: Array.from({ length: trailingColumnCount }, () => each),
  };
}
