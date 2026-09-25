/** One table column in the generated "Elected Bodies List" Word document.
 *  `label` is always sourced from the live EULB_EXTRA_ULB_PORTAL_FIELDS form-json config at
 *  generation time — never hardcoded — so a label edit in formjsons flows through automatically. */
export interface EulbListDocumentColumn {
  key: string;
  label: string;
}

/** One ULB row rendered in the generated document's table. */
export interface EulbListDocumentRow {
  slNo: number;
  censusCode: string;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: Date | string | null;
  dateOfExpiry: Date | string | null;
  remarks: string;
}

/** Assembled data consumed by ElectedUrbanLocalBodiesDocxService to render the letter. */
export interface EulbListDocumentData {
  stateName: string;
  /** Count of active ULB rows — the `{N}` filled into the letter's intro paragraph. */
  ulbCount: number;
  /** The `Year` document's `year` label (e.g. `'2026-27'`) for the form's grant cycle — interpolated
   *  into the closing paragraph's `FY {designYearLabel}` text. Same field name/shape as
   *  claim-letter-document.service.ts's `designYearLabel`. */
  designYearLabel: string;
  columns: EulbListDocumentColumn[];
  rows: EulbListDocumentRow[];
}
