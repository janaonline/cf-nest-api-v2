import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import { S3Service } from 'src/core/s3/s3.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { buildClaimLetterRefNo } from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-financial.helpers';
import {
  ClaimLetterDocumentService,
  type ClaimLetterDocumentParent,
} from 'src/module/xvi-fc/state/claim-letter/services/document/claim-letter-document.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { GrantAllocation } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { OM_STATUS, Om, OmLog, type OmStatus } from 'src/schemas/xvi-fc/mohua/om.schema';
import { OmUlb } from 'src/schemas/xvi-fc/mohua/om-ulb.schema';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import type { FileInfo } from 'src/schemas/common/file.schema';
import { buildXviFcDownloadFileName } from 'src/shared/utils/xvi-fc-download-file-name.util';
import { buildOmContent, todayIso } from './om-content.builder';
import { OmPdfService } from './om-pdf.service';
import type { SaveOmDraftDto } from './om-draft.dto';
import { copyClaimLetterUlbsToOm } from './om-ulbs.helper';
import {
  OM_FIELDS,
  OM_NUMBER_MAX_LENGTH,
  OM_SIGNED_FILE_MAX_SIZE_KB,
  OM_SOURCE_CLAIM_LETTER_STATUS,
} from './om.constants';
import type {
  OmClaimLetterRow,
  OmContent,
  OmEditorView,
  OmGeneratedFile,
  OmHistoryRow,
  OmStateRow,
  OmStates,
  OmUlbRow,
} from './om.types';

type VerifiedLetter = ClaimLetterDocumentParent & {
  ulbCount: number;
  financialSummary?: { currentSelectedClaim?: number };
};

type LeanOm = {
  _id: Types.ObjectId;
  claimLetter: Types.ObjectId;
  state: Types.ObjectId;
  status: OmStatus;
  omNumber: string | null;
  omDate: string | null;
  refNo: string | null;
  ulbCount: number;
  totalAmount: number;
  content: OmContent | null;
  signedFile: FileInfo | null;
  generatedAt: Date | null;
};

const ISSUED_STATUSES: OmStatus[] = [OM_STATUS.GENERATED, OM_STATUS.SIGNED_UPLOADED];
const DUPLICATE_KEY = 11000;

/**
 * MoHUA's Office Memorandum for each claim letter the SO verified (status 5): the list by State, the editable draft,
 * Generate (number, freeze, stamp the letter's ULBs), the PDF (the OM followed by the claim letter's annexures), and
 * the signed copy. One OM per claim letter; it always covers every ULB on the letter.
 */
@Injectable()
export class OmService {
  private readonly logger = new Logger(OmService.name);

  constructor(
    @InjectModel(Om.name) private readonly omModel: Model<Om>,
    @InjectModel(OmLog.name) private readonly omLogModel: Model<OmLog>,
    @InjectModel(OmUlb.name) private readonly omUlbModel: Model<OmUlb>,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatch>,
    @InjectModel(ClaimLetterBatchUlb.name) private readonly batchUlbModel: Model<ClaimLetterBatchUlb>,
    @InjectModel(State.name) private readonly stateModel: Model<State>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    @InjectModel(GrantAllocation.name) private readonly grantAllocationModel: Model<GrantAllocation>,
    private readonly documentService: ClaimLetterDocumentService,
    private readonly pdfService: OmPdfService,
    private readonly s3Service: S3Service,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** States with verified claim letters for the year and installment, each letter with its OM's status. */
  async listStates(yearId: string, installment: number): Promise<OmStates> {
    const year = await this.loadYear(new Types.ObjectId(yearId));
    const letters = await this.batchModel
      .find({ ...verifiedFilter(), year: new Types.ObjectId(yearId), installment })
      .select('state installment batchNumber ulbCount financialSummary.currentSelectedClaim')
      .sort({ batchNumber: 1 })
      .lean<
        {
          _id: Types.ObjectId;
          state: Types.ObjectId;
          installment: 1 | 2;
          batchNumber: number;
          ulbCount: number;
          financialSummary?: { currentSelectedClaim?: number };
        }[]
      >()
      .exec();

    const [states, oms] = await Promise.all([
      this.loadStates([...new Set(letters.map((l) => String(l.state)))]),
      this.omModel
        .find({ claimLetter: { $in: letters.map((l) => l._id) } })
        .select('claimLetter status refNo')
        .lean<{ _id: Types.ObjectId; claimLetter: Types.ObjectId; status: OmStatus; refNo: string | null }[]>()
        .exec(),
    ]);
    const omByLetter = new Map(oms.map((om) => [String(om.claimLetter), om]));

    const byState = new Map<string, OmStateRow>();
    for (const letter of letters) {
      const state = states.get(String(letter.state));
      if (!state) continue;
      const row = byState.get(state.id) ?? { stateId: state.id, stateName: state.name, claimLetters: [] };
      const om = omByLetter.get(String(letter._id));
      const claimLetter: OmClaimLetterRow = {
        claimLetterId: String(letter._id),
        claimLetterRefNo: buildClaimLetterRefNo({
          stateCode: state.code,
          designYearLabel: year.year,
          installment: letter.installment,
          batchNumber: letter.batchNumber,
        }),
        batchNumber: letter.batchNumber,
        ulbCount: letter.ulbCount ?? 0,
        amount: letter.financialSummary?.currentSelectedClaim ?? 0,
        omId: om ? String(om._id) : null,
        omStatus: om?.status ?? null,
        omRefNo: om?.refNo ?? null,
      };
      row.claimLetters.push(claimLetter);
      byState.set(state.id, row);
    }

    return {
      year: { id: yearId, label: year.year },
      installment,
      states: [...byState.values()].sort((a, b) => a.stateName.localeCompare(b.stateName)),
    };
  }

  /** The OM for one verified letter: the frozen copy once generated, otherwise built live with the draft's values. */
  async getEditor(claimLetterId: string): Promise<OmEditorView> {
    const letter = await this.loadVerifiedLetter(claimLetterId);
    const om = await this.findOm(letter._id);
    const values = { omNumber: om?.omNumber ?? null, omDate: om?.omDate ?? todayIso() };
    const [{ ulbLists: _printedOnly, ...content }, ulbs] = await Promise.all([
      om?.content && om.status !== OM_STATUS.DRAFT
        ? Promise.resolve(om.content)
        : this.buildContent(letter, values.omNumber, values.omDate),
      this.loadLetterUlbs(letter._id),
    ]);
    return {
      omId: om ? String(om._id) : null,
      status: om?.status ?? OM_STATUS.DRAFT,
      refNo: om?.refNo ?? null,
      fields: OM_FIELDS,
      values,
      content,
      // An OM always covers every ULB on its letter: none is excluded at this step.
      counts: { noActionRecorded: letter.ulbCount, excluded: 0, included: letter.ulbCount },
      ulbs,
    };
  }

  /** The letter's own ULB rows (the same ULBs its OM covers), A-Z. */
  private async loadLetterUlbs(claimLetter: Types.ObjectId): Promise<OmUlbRow[]> {
    const rows = await this.batchUlbModel
      .find({ claimLetter })
      .select('ulbId ulbSnapshot allocatedAmount claimedAmount')
      .sort({ 'ulbSnapshot.name': 1, _id: 1 })
      .lean<
        {
          ulbId: Types.ObjectId;
          ulbSnapshot: { name: string; censusCode?: string | null };
          allocatedAmount: number;
          claimedAmount: number;
        }[]
      >()
      .exec();
    return rows.map((row) => ({
      ulbId: String(row.ulbId),
      name: row.ulbSnapshot.name,
      censusCode: row.ulbSnapshot.censusCode ?? null,
      allocatedAmount: row.allocatedAmount,
      claimedAmount: row.claimedAmount,
    }));
  }

  /** Autosaves the draft's boxes; creates the draft on the first save. Refused once the OM is generated. */
  async saveDraft(claimLetterId: string, dto: SaveOmDraftDto, user: AuthUser): Promise<OmEditorView> {
    const letter = await this.loadVerifiedLetter(claimLetterId);
    const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(user._id) };
    if (dto.omNumber !== undefined) set['omNumber'] = dto.omNumber?.trim() || null;
    if (dto.omDate !== undefined) set['omDate'] = dto.omDate ? dto.omDate.slice(0, 10) : null;

    try {
      await this.omModel
        .updateOne(
          { claimLetter: letter._id, status: OM_STATUS.DRAFT },
          {
            $set: set,
            $setOnInsert: { state: letter.state, year: letter.year, installment: letter.installment },
          },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      // The upsert hits the one-OM-per-letter index only when the OM is no longer a draft.
      if (isDuplicateKey(err)) throw new ConflictException('This OM has already been generated and can no longer be edited.');
      throw err;
    }
    return this.getEditor(claimLetterId);
  }

  /**
   * Issues the OM: checks the "No.", numbers it (OM/<STATE>/<FY>/<n>), freezes its content and stamps it on every ULB
   * of the letter, in one transaction, then renders the PDF. Calling it again returns the issued OM's file.
   */
  async generate(claimLetterId: string, user: AuthUser, ip?: string, userAgent?: string): Promise<OmGeneratedFile> {
    const letter = await this.loadVerifiedLetter(claimLetterId);
    const existing = await this.findOm(letter._id);
    if (existing?.content && existing.status !== OM_STATUS.DRAFT) return this.render(existing.content, letter._id);

    const omNumber = existing?.omNumber?.trim() || null;
    if (!omNumber) throw new BadRequestException('Fill in the OM No. before generating the Office Memorandum.');
    if (omNumber.length > OM_NUMBER_MAX_LENGTH) {
      throw new BadRequestException(`The OM No. can be at most ${OM_NUMBER_MAX_LENGTH} characters.`);
    }
    const omDate = existing?.omDate ?? todayIso();
    const content = await this.buildContent(letter, omNumber, omDate);
    const [state, year] = await Promise.all([
      this.stateModel.findById(letter.state).select('code').lean<{ code: string }>().exec(),
      this.loadYear(letter.year),
    ]);
    const sequence =
      (await this.omModel.countDocuments({ state: letter.state, year: letter.year, sequence: { $type: 'number' } })) + 1;
    const refNo = `OM/${state?.code ?? 'NA'}/${year.year}/${sequence}`;
    const userOid = new Types.ObjectId(user._id);
    const now = new Date();

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const ulbRows = await copyClaimLetterUlbsToOm(this.batchUlbModel, this.omUlbModel, letter._id, session);
      if (ulbRows !== letter.ulbCount) {
        throw new ConflictException('The claim letter\'s ULBs do not match its OM rows. Reload and try again.');
      }

      const om = await this.omModel
        .findOneAndUpdate(
          { claimLetter: letter._id, status: OM_STATUS.DRAFT },
          {
            $set: {
              status: OM_STATUS.GENERATED,
              omNumber,
              omDate,
              sequence,
              refNo,
              ulbCount: letter.ulbCount,
              totalAmount: content.totalAmount,
              content,
              generatedBy: userOid,
              generatedAt: now,
              updatedBy: userOid,
            },
          },
          { new: true, session },
        )
        .select('_id')
        .lean<{ _id: Types.ObjectId }>()
        .exec();
      if (!om) throw new ConflictException('This OM changed while you were working on it. Reload and try again.');

      const stamped = await this.omUlbModel
        .updateMany({ claimLetter: letter._id, om: null }, { $set: { om: om._id } }, { session })
        .exec();
      if (stamped.modifiedCount !== letter.ulbCount) {
        throw new ConflictException('Some ULBs of this claim letter are already in another OM. Reload and try again.');
      }

      await this.omLogModel.create(
        [{ om: om._id, action: 'GENERATED', changedBy: userOid, changedAt: now, ipAddress: ip ?? null, userAgent: userAgent ?? null }],
        { session },
      );
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      if (isDuplicateKey(err)) {
        throw new ConflictException('Another OM was issued at the same moment. Please try again.');
      }
      throw err;
    } finally {
      await session.endSession();
    }

    return this.render(content, letter._id);
  }

  /** The issued OM's PDF again, from its frozen content and the letter's frozen annexures. */
  async downloadPdf(omId: string): Promise<OmGeneratedFile> {
    const om = await this.findIssuedOm(omId);
    return this.render(om.content as OmContent, om.claimLetter);
  }

  /** Saves the signed copy back from e-Office (PDF up to 5 MB); a new upload replaces the previous one. */
  async uploadSignedFile(
    omId: string,
    fileRef: XviFcFileRefDto,
    user: AuthUser,
    ip?: string,
    userAgent?: string,
  ): Promise<OmHistoryRow> {
    const om = await this.findIssuedOm(omId);
    const { file, errors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      fileRef as unknown as Record<string, unknown>,
      om.signedFile,
      { allowedExtensions: ['pdf'], maxSizeKb: OM_SIGNED_FILE_MAX_SIZE_KB, fieldKey: 'signedFile' },
    );
    if (errors.length) throw new BadRequestException({ message: 'Validation failed.', errors: { signedFile: errors } });

    if (file !== undefined) {
      const userOid = new Types.ObjectId(user._id);
      const now = new Date();
      await this.omModel
        .updateOne(
          { _id: om._id, status: { $in: ISSUED_STATUSES } },
          {
            $set: {
              signedFile: file,
              status: OM_STATUS.SIGNED_UPLOADED,
              signedUploadedBy: userOid,
              signedUploadedAt: now,
              updatedBy: userOid,
            },
          },
        )
        .exec();
      await this.omLogModel.create({
        om: om._id,
        action: 'SIGNED_UPLOADED',
        changedBy: userOid,
        changedAt: now,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      });
    }

    const [row] = await this.toHistoryRows([await this.findIssuedOm(omId)]);
    return row;
  }

  /** Every issued OM of the year and installment, newest first. */
  async history(yearId: string, installment: number): Promise<OmHistoryRow[]> {
    const oms = await this.omModel
      .find({ year: new Types.ObjectId(yearId), installment, status: { $in: ISSUED_STATUSES } })
      .sort({ generatedAt: -1 })
      .lean<LeanOm[]>()
      .exec();
    return this.toHistoryRows(oms);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** The OM, then the claim letter's annexure pages, as one PDF. */
  private async render(content: OmContent, claimLetter: Types.ObjectId): Promise<OmGeneratedFile> {
    const [omPdf, annexures] = await Promise.all([this.pdfService.render(content), this.loadAnnexures(claimLetter)]);
    const out = await PDFDocument.load(omPdf);
    if (annexures) {
      const pages = await out.copyPages(annexures.doc, annexures.pageIndices);
      pages.forEach((page) => out.addPage(page));
    }
    const fileName = buildXviFcDownloadFileName({
      entityName: content.stateName,
      formName: `office-memorandum-${content.installment}`,
      yearLabel: content.designYearLabel,
      extension: 'pdf',
    });
    return { buffer: Buffer.from(await out.save()), fileName };
  }

  /**
   * The annexures (Elected Body, GTC, Unspent Declaration, ATR...) exactly as the State submitted them: the letter's
   * stored final PDF is the signed letter followed by them, so they are its pages after the signed letter's. Null for
   * a letter submitted before the final PDF existed.
   */
  private async loadAnnexures(claimLetter: Types.ObjectId): Promise<{ doc: PDFDocument; pageIndices: number[] } | null> {
    const batch = await this.batchModel
      .findById(claimLetter)
      .select('finalClaimPdf.file.path signedClaimFile.path')
      .lean<{ finalClaimPdf?: { file?: { path?: string } } | null; signedClaimFile?: { path?: string } | null }>()
      .exec();
    const finalPath = batch?.finalClaimPdf?.file?.path;
    const signedPath = batch?.signedClaimFile?.path;
    if (!finalPath || !signedPath) {
      this.logger.warn(`Claim letter ${String(claimLetter)} has no stored final PDF; the OM is issued without annexures.`);
      return null;
    }
    try {
      const [finalBytes, signedBytes] = await Promise.all([
        this.s3Service.getPdfBufferFromS3(finalPath),
        this.s3Service.getPdfBufferFromS3(signedPath),
      ]);
      const [doc, signed] = await Promise.all([PDFDocument.load(finalBytes), PDFDocument.load(signedBytes)]);
      return { doc, pageIndices: doc.getPageIndices().slice(signed.getPageCount()) };
    } catch (err) {
      this.logger.error(`Claim letter ${String(claimLetter)} annexures could not be read: ${String(err)}`);
      throw new UnprocessableEntityException("The claim letter's annexures could not be read, so the OM cannot be downloaded.");
    }
  }

  private async toHistoryRows(oms: LeanOm[]): Promise<OmHistoryRow[]> {
    const states = await this.loadStates([...new Set(oms.map((om) => String(om.state)))]);
    return oms.map((om) => {
      const state = states.get(String(om.state));
      const file = om.signedFile;
      return {
        omId: String(om._id),
        refNo: om.refNo ?? '',
        omNumber: om.omNumber,
        claimLetterId: String(om.claimLetter),
        claimLetterRefNo: om.content?.claimLetterRefNo ?? '',
        stateId: String(om.state),
        stateName: state?.name ?? '',
        stateCode: state?.code ?? '',
        ulbCount: om.ulbCount,
        totalAmount: om.totalAmount,
        issuedOn: om.generatedAt ? new Date(om.generatedAt).toISOString() : null,
        status: om.status,
        doeStatus: 'PENDING',
        signedFile: file?.path
          ? {
              name: file.originalName || file.name || 'signed-om.pdf',
              url: this.fileTokenService.signFileUrlForSession(file.path, 'inline'),
              sizeKb: file.sizeKb ?? 0,
            }
          : null,
      };
    });
  }

  private async buildContent(letter: VerifiedLetter, omNumber: string | null, omDate: string | null): Promise<OmContent> {
    const [full, allocation] = await Promise.all([
      this.documentService.buildFullDocument(letter),
      this.grantAllocationModel
        .findOne({ stateId: letter.state, yearId: letter.year })
        .select('basic')
        .lean<{ basic: number }>()
        .exec(),
    ]);
    return buildOmContent({
      claimLetterId: String(letter._id),
      letter: full,
      ulbCount: letter.ulbCount,
      totalAmount: letter.financialSummary?.currentSelectedClaim ?? 0,
      yearAllocation: allocation ? Math.round(allocation.basic) : null,
      omNumber,
      omDate,
    });
  }

  /** A claim letter the SO verified: READY, at 5, not abandoned, not replaced. */
  private async loadVerifiedLetter(claimLetterId: string): Promise<VerifiedLetter> {
    const letter = await this.batchModel
      .findOne({ ...verifiedFilter(), _id: new Types.ObjectId(claimLetterId) })
      .select('state year installment batchNumber revision currentFormStatus isAbandoned letterDetails ulbCount financialSummary.currentSelectedClaim')
      .lean<VerifiedLetter>()
      .exec();
    if (!letter) throw new NotFoundException('No verified claim letter found for this OM.');
    return letter;
  }

  private findOm(claimLetter: Types.ObjectId): Promise<LeanOm | null> {
    return this.omModel.findOne({ claimLetter }).lean<LeanOm>().exec();
  }

  private async findIssuedOm(omId: string): Promise<LeanOm> {
    const om = await this.omModel
      .findOne({ _id: new Types.ObjectId(omId), status: { $in: ISSUED_STATUSES } })
      .lean<LeanOm>()
      .exec();
    if (!om?.content) throw new NotFoundException('Office Memorandum not found.');
    return om;
  }

  private async loadYear(yearId: Types.ObjectId): Promise<{ year: string }> {
    const year = await this.yearModel.findById(yearId).select('year').lean<{ year: string }>().exec();
    if (!year) throw new NotFoundException(`Year ${String(yearId)} not found`);
    return year;
  }

  private async loadStates(ids: string[]): Promise<Map<string, { id: string; name: string; code: string }>> {
    if (!ids.length) return new Map();
    const states = await this.stateModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('name code')
      .lean<{ _id: Types.ObjectId; name: string; code: string }[]>()
      .exec();
    return new Map(states.map((s) => [String(s._id), { id: String(s._id), name: s.name, code: s.code }]));
  }
}

function verifiedFilter() {
  return {
    assemblyStatus: 'READY',
    isAbandoned: false,
    supersededBy: null,
    currentFormStatus: OM_SOURCE_CLAIM_LETTER_STATUS,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === DUPLICATE_KEY;
}

