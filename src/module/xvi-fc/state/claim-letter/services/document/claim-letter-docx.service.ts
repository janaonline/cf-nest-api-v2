import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { buildXviFcDownloadFileName } from 'src/shared/utils/xvi-fc-download-file-name.util';
import {
  XVI_FC_DOCX_BODY_SIZE as BODY_SIZE,
  XVI_FC_DOCX_FONT as FONT,
  XVI_FC_DOCX_TABLE_SIZE as TABLE_SIZE,
} from 'src/module/xvi-fc/common/utils/xvi-fc-docx-style.util';
import type {
  ClaimLetterAnnexureRow,
  ClaimLetterColumn,
  ClaimLetterColumnKind,
  ClaimLetterComplianceRow,
  ClaimLetterFullDocument,
  ClaimLetterParagraph,
  ClaimLetterRun,
} from '../../types/claim-letter-document.types';
import { printedText } from '../../helpers/claim-letter-letter.helpers';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import { ClaimLetterDocumentService, type ClaimLetterDocumentParent } from './claim-letter-document.service';

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

const A4 = { width: 11906, height: 16838 };
const MARGIN = 1440;
const PORTRAIT_WIDTH = A4.width - 2 * MARGIN;
const LANDSCAPE_WIDTH = A4.height - 2 * MARGIN;
const HANGING = { left: 720, hanging: 360 };

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const TABLE_BORDERS = {
  top: BORDER,
  bottom: BORDER,
  left: BORDER,
  right: BORDER,
  insideHorizontal: BORDER,
  insideVertical: BORDER,
};

/** Per-mille column shares (approved v3 sample); Yes/No columns share what is left. */
const COLUMN_SHARE: Record<Exclude<ClaimLetterColumnKind, 'yesNo'>, number> = {
  serial: 35,
  name: 140,
  value: 95,
  amount: 100,
};
const ALLOCATION_SHARE = 95; // Tied and Untied (the last two columns)
const COLUMN_ALIGN: Record<ClaimLetterColumnKind, Align> = {
  serial: AlignmentType.CENTER,
  name: AlignmentType.LEFT,
  value: AlignmentType.CENTER,
  yesNo: AlignmentType.CENTER,
  amount: AlignmentType.RIGHT,
};

interface ParaOptions {
  align?: Align;
  before?: number;
  after?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  size?: number;
}

/** Renders the letter model as an A4 .docx in the approved Phase 0 v3 layout; all text comes from the model. */
@Injectable()
export class ClaimLetterDocxService {
  constructor(
    private readonly documentService: ClaimLetterDocumentService,
    private readonly letterDetailsService: ClaimLetterLetterDetailsService,
  ) {}

  /** The State's download: only once the mandatory letter details are complete. */
  async generateForDownload(claimLetterId: string, user: AuthUser): Promise<{ buffer: Buffer; fileName: string }> {
    const parent = await this.documentService.loadParent(claimLetterId, user);
    await this.letterDetailsService.assertComplete(parent, 'downloading');
    return this.generate(parent);
  }

  async generate(parent: ClaimLetterDocumentParent): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.documentService.buildFullDocument(parent);
    const buffer = await Packer.toBuffer(this.render(doc));
    const fileName = buildXviFcDownloadFileName({
      entityName: doc.stateName,
      formName: `claim-letter-${doc.installment}-${doc.batchNumber}`,
      yearLabel: doc.designYearLabel,
      extension: 'docx',
    });
    return { buffer, fileName };
  }

  render(doc: ClaimLetterFullDocument): Document {
    const page = (orientation: (typeof PageOrientation)[keyof typeof PageOrientation]) => ({
      page: {
        size: { width: A4.width, height: A4.height, orientation },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    });
    return new Document({
      styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
      sections: [
        { properties: page(PageOrientation.PORTRAIT), children: this.coveringLetter(doc) },
        { properties: page(PageOrientation.LANDSCAPE), children: this.annexure(doc) },
      ],
    });
  }

  private coveringLetter(doc: ClaimLetterFullDocument): (Paragraph | Table)[] {
    const l = doc.letter;
    const lastClosing = l.closing.length - 1;
    return [
      this.para(l.letterhead, { align: AlignmentType.CENTER, after: 200 }),
      this.para(l.letterNo, { align: AlignmentType.CENTER, after: 200 }),
      this.para(l.refAndDate, { align: AlignmentType.CENTER, after: 240 }),
      this.para(l.addressee, { after: 240 }),
      this.para(l.subject, { align: AlignmentType.JUSTIFIED }),
      this.para({ runs: [{ text: l.referencesTitle, bold: true }] }, { after: 60 }),
      ...l.references.map((p) => this.para(p)),
      this.para(l.salutation),
      ...l.body.map((p) => this.para(p, { align: AlignmentType.JUSTIFIED })),
      this.complianceTable(l.complianceHeaders, l.compliance),
      this.para(l.note, { before: 120, after: 200 }),
      ...l.closing.map((p, i) => this.para(p, { align: AlignmentType.JUSTIFIED, keepNext: i === lastClosing })),
      this.para(l.signOff, { before: 240, after: 480, keepNext: true }),
      this.para(l.signature, { keepLines: true }),
    ];
  }

  private annexure(doc: ClaimLetterFullDocument): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [
      this.para({ runs: [{ text: doc.annexure.title }] }, { align: AlignmentType.RIGHT, after: 120 }),
    ];
    doc.annexure.lists.forEach((list, i) => {
      out.push(
        this.para({ runs: [{ text: list.heading, bold: true }] }, { before: i ? 240 : 0, after: 60, keepNext: true }),
        this.para({ runs: [{ text: list.subheading }] }, { after: 80, keepNext: true }),
      );
      const rows = doc.rowsByList[list.key];
      out.push(rows.length ? this.ulbTable(doc.annexure.columns, rows) : this.para({ runs: [{ text: 'Nil' }] }));
    });
    return out;
  }

  // ─── Tables ───────────────────────────────────────────────────────────────

  private complianceTable(headers: string[], rows: ClaimLetterComplianceRow[]): Table {
    const widths = perMilleWidths(PORTRAIT_WIDTH, [90, 440, 470]);
    const align = AlignmentType.LEFT;
    return this.table(
      widths,
      headers.map((h, i) => this.cell([{ runs: [{ text: h, bold: true }] }], widths[i], align)),
      rows.map((r) => [
        this.cell([{ runs: [{ text: r.key }] }], widths[0], align),
        this.cell(r.condition, widths[1], align),
        this.cell(r.status, widths[2], align),
      ]),
    );
  }

  private ulbTable(columns: ClaimLetterColumn[], rows: ClaimLetterAnnexureRow[]): Table {
    const widths = perMilleWidths(LANDSCAPE_WIDTH, columnShares(columns));
    const aligns = columns.map((c) => COLUMN_ALIGN[c.kind]);
    return this.table(
      widths,
      columns.map((c, i) => this.cell([{ runs: [{ text: c.header, bold: true }] }], widths[i], AlignmentType.CENTER)),
      rows.map((r) => r.cells.map((text, i) => this.cell([{ runs: [{ text }] }], widths[i], aligns[i]))),
    );
  }

  private table(widths: number[], header: TableCell[], body: TableCell[][]): Table {
    return new Table({
      layout: TableLayoutType.FIXED,
      width: { size: widths.reduce((a, w) => a + w, 0), type: WidthType.DXA },
      columnWidths: widths,
      borders: TABLE_BORDERS,
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: header }),
        ...body.map((cells) => new TableRow({ cantSplit: true, children: cells })),
      ],
    });
  }

  private cell(paragraphs: ClaimLetterParagraph[], width: number, align: Align): TableCell {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: paragraphs.map((p) => this.para(p, { align, size: TABLE_SIZE, after: 40 })),
    });
  }

  // ─── Paragraphs ───────────────────────────────────────────────────────────

  /** A numbered paragraph gets a hanging indent ("2.<tab>text") and keeps its lines together. */
  private para(p: ClaimLetterParagraph, opts: ParaOptions = {}): Paragraph {
    const size = opts.size ?? BODY_SIZE;
    const numbered = p.number !== undefined;
    return new Paragraph({
      alignment: opts.align ?? (numbered ? AlignmentType.JUSTIFIED : undefined),
      indent: numbered ? HANGING : undefined,
      keepNext: opts.keepNext,
      keepLines: numbered || opts.keepLines,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 120 },
      children: [
        ...(numbered
          ? [
              new TextRun({ text: p.number, font: FONT, size }),
              new TextRun({ children: [new Tab()], font: FONT, size }),
            ]
          : []),
        ...p.runs.flatMap((run) => textRuns(run, size)),
      ],
    });
  }
}

/** One model run -> docx runs; each '\n' starts a new line. */
function textRuns(run: ClaimLetterRun, size: number): TextRun[] {
  const printed = printedText(run);
  if (!printed) return [];
  return printed.split('\n').map(
    (text, i) =>
      new TextRun({
        text,
        bold: run.bold,
        highlight: run.placeholder ? 'yellow' : undefined,
        font: FONT,
        size,
        break: i > 0 ? 1 : undefined,
      }),
  );
}

/** Fixed shares per column kind; Yes/No columns split the rest equally (or it goes to the name). */
function columnShares(columns: ClaimLetterColumn[]): number[] {
  const last = columns.length - 1;
  const shares = columns.map((c, i) =>
    c.kind === 'yesNo' ? 0 : i >= last - 1 && c.kind === 'amount' ? ALLOCATION_SHARE : COLUMN_SHARE[c.kind],
  );
  const yesNoCount = columns.filter((c) => c.kind === 'yesNo').length;
  const rest = 1000 - shares.reduce((a, s) => a + s, 0);
  if (yesNoCount === 0) return shares;
  const each = Math.floor(rest / yesNoCount);
  return columns.map((c, i) => (c.kind === 'yesNo' ? each : shares[i]));
}

/** Splits `total` twips by per-mille shares; the rounding remainder goes to column 1 (ULB name). */
function perMilleWidths(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, s) => a + s, 0);
  const widths = shares.map((s) => Math.floor((total * s) / sum));
  widths[1] += total - widths.reduce((a, w) => a + w, 0);
  return widths;
}
