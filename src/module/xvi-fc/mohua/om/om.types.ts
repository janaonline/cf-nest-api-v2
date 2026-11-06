import type {
  ClaimLetterColumn,
  ClaimLetterComplianceRow,
  ClaimLetterParagraph,
} from 'src/module/xvi-fc/state/claim-letter/types/claim-letter-document.types';
import type { OM_FIELDS } from './om.constants';
import type { OmStatus } from 'src/schemas/xvi-fc/mohua/om.schema';

/** The OM, section by section; the preview and the PDF render the same model. Frozen on the OM when generated. */
export interface OmContent {
  claimLetterId: string;
  /** The claim letter's reference (CL/<STATE>/<FY>/<installment>-<batch>). */
  claimLetterRefNo: string;
  stateName: string;
  designYearLabel: string;
  installment: 1 | 2;
  ulbCount: number;
  stateUlbTotal: number;
  /** Whole rupees recommended (the claim letter's total). */
  totalAmount: number;
  /** The State's basic grant allocation for the year, whole rupees; null when not loaded. */
  yearAllocation: number | null;
  /** "No." line (field omNumber), centred letterhead, right-aligned address with "Dated" (field omDate). */
  number: ClaimLetterParagraph;
  letterhead: ClaimLetterParagraph[];
  address: ClaimLetterParagraph[];
  title: string;
  subject: ClaimLetterParagraph;
  intro: ClaimLetterParagraph;
  complianceHeaders: string[];
  compliance: ClaimLetterComplianceRow[];
  analysis: ClaimLetterParagraph;
  recommendationHeaders: string[];
  /** One row, a cell per header. */
  recommendation: ClaimLetterParagraph[];
  closing: ClaimLetterParagraph[];
  enclosure: ClaimLetterParagraph;
  signature: ClaimLetterParagraph[];
  addressee: ClaimLetterParagraph[];
  /** The claim letter's ULB lists that rows J and K point to, printed after the OM. Absent on an OM generated before
   *  they were frozen with it, and left out of the editor view (only the PDF prints them). */
  ulbLists?: OmUlbLists;
}

/** The claim letter's annexure: its columns, then each list with its rows' cells in column order. */
export interface OmUlbLists {
  title: string;
  columns: ClaimLetterColumn[];
  lists: { heading: string; subheading: string; rows: string[][] }[];
  /** After the last list; absent on an OM generated before it was added. */
  footnote?: ClaimLetterParagraph;
}

export type OmField = (typeof OM_FIELDS)[number];

/** One verified claim letter on the Generate OM page. */
export interface OmClaimLetterRow {
  claimLetterId: string;
  claimLetterRefNo: string;
  batchNumber: number;
  ulbCount: number;
  amount: number;
  omId: string | null;
  omStatus: OmStatus | null;
  omRefNo: string | null;
}

export interface OmStateRow {
  stateId: string;
  stateName: string;
  claimLetters: OmClaimLetterRow[];
}

export interface OmStates {
  year: { id: string; label: string };
  installment: number;
  states: OmStateRow[];
}

/** GET letter/:id/document: the OM to show and edit, plus what the Generate dialog prints. */
export interface OmEditorView {
  omId: string | null;
  status: OmStatus;
  refNo: string | null;
  fields: readonly OmField[];
  values: { omNumber: string | null; omDate: string | null };
  content: OmContent;
  counts: { noActionRecorded: number; excluded: number; included: number };
  /** Every ULB on the letter (all go into the OM), A-Z. Whole rupees. */
  ulbs: OmUlbRow[];
}

export interface OmUlbRow {
  ulbId: string;
  name: string;
  censusCode: string | null;
  allocatedAmount: number;
  claimedAmount: number;
}

export interface OmSignedFileView {
  name: string;
  url: string;
  sizeKb: number;
}

export interface OmHistoryRow {
  omId: string;
  refNo: string;
  omNumber: string | null;
  claimLetterId: string;
  claimLetterRefNo: string;
  stateId: string;
  stateName: string;
  stateCode: string;
  ulbCount: number;
  totalAmount: number;
  issuedOn: string | null;
  status: OmStatus;
  /** DoE tracking is not built yet; always PENDING for now. */
  doeStatus: 'PENDING';
  signedFile: OmSignedFileView | null;
}

export interface OmGeneratedFile {
  buffer: Buffer;
  fileName: string;
}
