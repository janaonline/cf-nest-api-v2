/** One run of letter text; a '\n' inside `text` is a line break. */
export interface ClaimLetterRun {
  text: string;
  bold?: boolean;
  /** A highlighted `< >` the State still has to fill. */
  placeholder?: boolean;
  /** Letter-detail key of a slot, filled or blank, where the portal draws an input. */
  field?: string;
  /** Printed before a filled slot value only. */
  lead?: string;
  /** Portal-only help for a placeholder filled elsewhere. */
  hint?: string;
}

/** `number` (e.g. "2.") renders as a hanging-indent list item. */
export interface ClaimLetterParagraph {
  runs: ClaimLetterRun[];
  number?: string;
}

export interface ClaimLetterComplianceRow {
  key: string;
  condition: ClaimLetterParagraph[];
  status: ClaimLetterParagraph[];
}

/** The covering letter, section by section; each renderer applies its own fixed styling. */
export interface ClaimLetterCoveringLetter {
  letterhead: ClaimLetterParagraph;
  letterNo: ClaimLetterParagraph;
  refAndDate: ClaimLetterParagraph;
  addressee: ClaimLetterParagraph;
  subject: ClaimLetterParagraph;
  referencesTitle: string;
  references: ClaimLetterParagraph[];
  salutation: ClaimLetterParagraph;
  body: ClaimLetterParagraph[];
  complianceHeaders: string[];
  compliance: ClaimLetterComplianceRow[];
  note: ClaimLetterParagraph;
  closing: ClaimLetterParagraph[];
  signOff: ClaimLetterParagraph;
  signature: ClaimLetterParagraph;
}

/** Drives alignment and width: serial centre, name left, value / yesNo centre, amount right. */
export type ClaimLetterColumnKind = 'serial' | 'name' | 'value' | 'yesNo' | 'amount';

export interface ClaimLetterColumn {
  header: string;
  kind: ClaimLetterColumnKind;
}

export type ClaimLetterListKey = 'ELIGIBLE' | 'INELIGIBLE';

/** One annexure row; `cells` follow `ClaimLetterAnnexure.columns` (S. No. included). */
export interface ClaimLetterAnnexureRow {
  ulbId: string;
  cells: string[];
}

export interface ClaimLetterListMeta {
  key: ClaimLetterListKey;
  heading: string;
  subheading: string;
  total: number;
}

export interface ClaimLetterAnnexure {
  title: string;
  columns: ClaimLetterColumn[];
  lists: ClaimLetterListMeta[];
}

/** Raw counts behind rows C-K, kept in the response (exempt counts are never printed). */
export interface ClaimLetterCriterionCount {
  type: string;
  label: string;
  met: number;
  exempted: number;
}

export interface ClaimLetterDocumentCounts {
  stateUlbTotal: number;
  proposalUlbs: number;
  eligibleInProposal: number;
  ineligibleStateWide: number;
  withUnspentInProposal: number;
  sixthScheduleInProposal: number;
  criteria: ClaimLetterCriterionCount[];
}

/** `GET :claimLetterId/document` - the letter without annexure rows (paged separately). */
export interface ClaimLetterDocument {
  refNo: string;
  stateName: string;
  designYearLabel: string;
  installment: 1 | 2;
  batchNumber: number;
  /** When (IST, "07 Oct 2026, 14:30") the eligibility behind rows C-K and the lists was evaluated. */
  asOn: string;
  letter: ClaimLetterCoveringLetter;
  annexure: ClaimLetterAnnexure;
  counts: ClaimLetterDocumentCounts;
}

/** The full letter, every annexure row included - what the .docx renders. */
export interface ClaimLetterFullDocument extends ClaimLetterDocument {
  rowsByList: Record<ClaimLetterListKey, ClaimLetterAnnexureRow[]>;
}
