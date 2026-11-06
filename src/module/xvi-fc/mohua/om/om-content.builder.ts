import { formatRupeesInLakh } from 'src/module/xvi-fc/common/utils/xvi-fc-amount-format.util';
import {
  b,
  formatIsoDate,
  ordinal,
  para,
  plural,
  printedText,
  slotRun,
  t,
} from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-letter.helpers';
import type {
  ClaimLetterComplianceRow,
  ClaimLetterFullDocument,
  ClaimLetterParagraph,
} from 'src/module/xvi-fc/state/claim-letter/types/claim-letter-document.types';
import {
  OM_ADDRESSEE,
  OM_COMPLIANCE_HEADERS,
  OM_FIELD,
  OM_LETTERHEAD,
  OM_OFFICE_ADDRESS,
  OM_RECOMMENDATION_HEADERS,
  OM_SIGNATORY,
  OM_TITLE,
  OM_ULB_LISTS_FOOTNOTE,
} from './om.constants';
import type { OmContent } from './om.types';

export interface OmContentInput {
  claimLetterId: string;
  /** The claim letter as its own .docx renders it: rows A-K and the counts behind them. */
  letter: ClaimLetterFullDocument;
  ulbCount: number;
  totalAmount: number;
  yearAllocation: number | null;
  omNumber: string | null;
  /** ISO date; today when not set. */
  omDate: string | null;
}

/**
 * The OM's text, section by section. Rows A-K are the claim letter's own compliance rows (same figures, same
 * wording), so the OM matches the letter the SO verified; everything else is the fixed MoHUA OM format.
 */
export function buildOmContent(input: OmContentInput): OmContent {
  const { letter } = input;
  const state = letter.stateName;
  const fy = letter.designYearLabel;
  const installment = `${ordinal(letter.installment)} installment`;
  const amount = `Rs. ${formatRupeesInLakh(input.totalAmount)} lakh`;
  const eligible = `${input.ulbCount} eligible ${plural(input.ulbCount, 'ULB', 'ULBs')}`;
  const stateUlbTotal = letter.counts.stateUlbTotal;

  return {
    claimLetterId: input.claimLetterId,
    claimLetterRefNo: letter.refNo,
    stateName: state,
    designYearLabel: fy,
    installment: letter.installment,
    ulbCount: input.ulbCount,
    stateUlbTotal,
    totalAmount: input.totalAmount,
    yearAllocation: input.yearAllocation,
    number: para([t('No. '), slotRun(OM_FIELD.NUMBER, blankToNull(input.omNumber), 'No.')]),
    letterhead: OM_LETTERHEAD.map((line) => para([b(line)])),
    address: [
      ...OM_OFFICE_ADDRESS.map((line) => para([t(line)])),
      para([t('Dated: '), slotRun(OM_FIELD.DATE, formatIsoDate(input.omDate ?? todayIso()), 'Dated')]),
    ],
    title: OM_TITLE,
    subject: para([
      b(
        `Subject: Recommendation for release of ${installment} of Basic Grants (Both Tied and Untied) to the State of ` +
          `${state} for FY ${fy} under 16th Finance Commission-reg.`,
      ),
    ]),
    intro: para([
      t(
        `The undersigned is directed to forward herewith the recommendation of this Ministry regarding release of ` +
          `${installment} of basic grants (both tied and untied) for FY ${fy} under 16th Finance Commission in respect ` +
          `of the State of ${state} as State/ULBs have fulfilled the following necessary conditions:`,
      ),
    ]),
    complianceHeaders: OM_COMPLIANCE_HEADERS,
    compliance: letter.letter.compliance.map(plainRow),
    analysis: para(
      [t(`In view of the above, analysis of claim received from the State of ${state} has been prepared and tabulated as under:`)],
      '2.',
    ),
    recommendationHeaders: OM_RECOMMENDATION_HEADERS,
    recommendation: [
      para([t(state)]),
      para([
        t(
          input.yearAllocation === null
            ? 'Not available'
            : `Rs. ${formatRupeesInLakh(input.yearAllocation)} lakh for the FY ${fy}`,
        ),
      ]),
      para([t(`${capitalise(installment)} of ${amount} may be recommended for FY ${fy} for ${eligible}.`)]),
    ],
    closing: [
      para(
        [
          t(
            `In view of above, Grant of ${amount} is recommended for ${eligible} out of the total ${stateUlbTotal} ULBs in ` +
              `the State of ${state} as the ${installment} of basic grants (both tied and untied) for FY ${fy}.`,
          ),
        ],
        '3.',
      ),
      para(
        [
          t(
            'As and when Department of Expenditure, Ministry of Finance releases the grant for the above-mentioned ' +
              'State, a copy of sanction order may be endorsed and forwarded to this Department at email id: ' +
              `${OM_SIGNATORY.email}`,
          ),
        ],
        '4.',
      ),
    ],
    enclosure: para([t('Encl: As above.')]),
    signature: [
      para([t(`(${OM_SIGNATORY.name})`)]),
      para([t(OM_SIGNATORY.designation)]),
      para([t(`Contact: ${OM_SIGNATORY.contact}`)]),
    ],
    addressee: OM_ADDRESSEE.map((line) => para([t(line)])),
    ulbLists: {
      title: letter.annexure.title,
      columns: letter.annexure.columns,
      lists: letter.annexure.lists.map((list) => ({
        heading: list.heading,
        subheading: list.subheading,
        rows: letter.rowsByList[list.key].map((row) => row.cells),
      })),
      footnote: para([b('Note: '), t(OM_ULB_LISTS_FOOTNOTE)]),
    },
  };
}

/** The claim letter's rows without its own letter-detail boxes: on the OM they are fixed text, never edited. */
function plainRow(row: ClaimLetterComplianceRow): ClaimLetterComplianceRow {
  const plain = (p: ClaimLetterParagraph): ClaimLetterParagraph =>
    para(
      p.runs.map((run) => ({ text: printedText(run), ...(run.bold && { bold: true }) })),
      p.number,
    );
  return { key: row.key, condition: row.condition.map(plain), status: row.status.map(plain) };
}

function blankToNull(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Today in IST as yyyy-mm-dd (the OM is dated in India). */
export function todayIso(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
