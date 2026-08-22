/** One ULB row rendered in the generated declaration's table (Yes branch only). */
export interface FcUnspentDeclarationDocumentRow {
  slNo: number;
  censusCode: string;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  allocationPerc: number;
  eligibility: boolean;
}

interface FcUnspentDeclarationDocumentDataBase {
  stateName: string;
  /** The `Year` document's label (e.g. `'2026-27'`) resolved via `YearIdToLabel`, same
   *  convention as the rest of this service — not a `Year` model DB lookup (see
   *  elected-urban-local-bodies-document.service.ts for that alternative pattern, deliberately
   *  not used here). */
  designYearLabel: string;
  /** e.g. `'14th FC'` — from `resolvePriorFcCycleLabel`, used in the table header. */
  priorFcCycleLabel: string;
  /** e.g. `'14th Finance Commission'` — from `resolvePriorFcCycleFullLabel`, used in prose. */
  priorFcCycleFullLabel: string;
}

/** Assembled data consumed by FcUnspentDeclarationDocxService to render the letter. Discriminated
 *  on `isFcUnspent` so the docx renderer only has `rows` to deal with on the Yes branch. */
export type FcUnspentDeclarationDocumentData =
  | (FcUnspentDeclarationDocumentDataBase & { isFcUnspent: false })
  | (FcUnspentDeclarationDocumentDataBase & { isFcUnspent: true; rows: FcUnspentDeclarationDocumentRow[] });
