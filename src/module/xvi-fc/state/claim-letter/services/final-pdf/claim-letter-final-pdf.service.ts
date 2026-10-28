import { createHash } from 'crypto';
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
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { YearIdToLabel } from 'src/core/constants/years';
import { S3Service } from 'src/core/s3/s3.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { ClaimEligibilityConfig } from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { buildClaimSourceQuery } from 'src/module/xvi-fc/common/utils/claim-eligibility-source-query.util';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import {
  ClaimLetterBatch,
  ClaimLetterBatchDocument,
  ClaimLetterFinalPdf,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { buildXviFcDownloadFileName } from 'src/shared/utils/xvi-fc-download-file-name.util';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import { ClaimLetterFormJsonService, type ClaimLetterMergeDocument } from '../form-json/claim-letter-form-json.service';

export const FINAL_PDF_OUTDATED = 'FINAL_PDF_OUTDATED';
export const FINAL_PDF_SOURCE_UNREADABLE = 'FINAL_PDF_SOURCE_UNREADABLE';
export const FINAL_PDF_INCOMPLETE = 'FINAL_PDF_INCOMPLETE';

const SOURCE_KEY_VERSION = 'claim-letter-final-pdf:v1';

/** pdf-lib ships ES5 classes, so `instanceof EncryptedPDFError` is false at runtime; match its text. */
function isEncryptedPdfError(err: unknown): boolean {
  return err instanceof EncryptedPDFError || (err instanceof Error && /is encrypted/i.test(err.message));
}
const SIGNED_LETTER_LABEL = 'Signed claim letter';

interface FinalPdfSource {
  label: string;
  /** Where to re-upload it; null for the signed claim letter itself. */
  formName: string | null;
  path: string | null;
  /** `meta.mergeDocuments[].optional`: when missing, listed but never blocking Submit. */
  optional: boolean;
}

interface ResolvedFinalPdf {
  finalPdf: ClaimLetterFinalPdf;
  /** Fresh bytes when this request built the PDF; null when it comes from S3. */
  bytes: Buffer | null;
  /** Non-optional documents missing now (always empty for a submitted batch). */
  missingRequired: string[];
}

interface FinalPdfParent {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: number;
  batchNumber: number;
  currentFormStatus: number;
  isAbandoned: boolean;
  submittedAt?: Date | null;
  signedClaimFile?: { path?: string } | null;
  finalClaimPdf?: ClaimLetterFinalPdf | null;
}

/** What the source key depends on. */
export type ClaimLetterFinalPdfInputs = Pick<FinalPdfParent, 'state' | 'year' | 'installment' | 'signedClaimFile'> & {
  finalClaimPdf?: ClaimLetterFinalPdf | null;
};

export interface ClaimLetterFinalPdfView {
  sourceKey: string;
  fileName: string;
  included: string[];
  missing: string[];
  /** Blocks Submit until uploaded in their forms. */
  missingRequired: string[];
  pageCount: number | null;
  builtAt: string;
}

const PARENT_FIELDS =
  'state year installment batchNumber currentFormStatus isAbandoned submittedAt signedClaimFile finalClaimPdf';

/**
 * The final claim letter: signed letter + `meta.mergeDocuments`, merged only when an upload changes.
 * A submitted batch serves the copy it was submitted with (module CLAUDE.md).
 */
@Injectable()
export class ClaimLetterFinalPdfService {
  private readonly logger = new Logger(ClaimLetterFinalPdfService.name);
  /** One merge per batch and source key at a time; concurrent requests share it (this process). */
  private readonly building = new Map<string, Promise<{ finalPdf: ClaimLetterFinalPdf; bytes: Buffer }>>();

  constructor(
    private readonly formJsonConfigService: ClaimLetterFormJsonService,
    private readonly formJsonService: FormJsonService,
    private readonly activeBatchService: ClaimLetterActiveBatchService,
    private readonly s3Service: S3Service,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
  ) {}

  async getFinalPdf(claimLetterId: string, user: AuthUser): Promise<XviFcApiResponse<ClaimLetterFinalPdfView>> {
    const parent = await this.loadParent(claimLetterId, user);
    const [resolved, fileName] = await Promise.all([this.resolve(parent), this.fileName(parent)]);
    return xviFcSuccess('Final claim letter PDF ready.', this.toView(resolved, fileName));
  }

  async getFinalPdfFile(claimLetterId: string, user: AuthUser): Promise<{ buffer: Buffer; fileName: string }> {
    const parent = await this.loadParent(claimLetterId, user);
    const [{ finalPdf, bytes }, fileName] = await Promise.all([this.resolve(parent), this.fileName(parent)]);
    const buffer = bytes ?? (await this.s3Service.getPdfBufferFromS3(finalPdf.file.path));
    return { buffer, fileName };
  }

  /** Submit gate: every required document is present, and the reviewed key still matches the
   *  current inputs and the cached PDF. */
  async assertReviewedKey(parent: ClaimLetterFinalPdfInputs, reviewedKey: string): Promise<void> {
    const formConfig = await this.formJsonConfigService.loadFormConfig(String(parent.year));
    const sources = await this.resolveSources(parent, formConfig.mergeDocuments);
    const missing = sources.filter((s) => s.path === null && !s.optional);
    if (missing.length) {
      const items = missing.map((s) => (s.formName ? `${s.label} (${s.formName} form)` : s.label));
      throw new BadRequestException({
        message: `Missing required documents: ${items.join(', ')}. Upload them before submitting.`,
        code: FINAL_PDF_INCOMPLETE,
      });
    }
    const currentKey = this.computeSourceKey(sources);
    if (currentKey === reviewedKey && parent.finalClaimPdf?.sourceKey === currentKey) return;
    throw new ConflictException({
      message: 'The documents changed after you reviewed the final PDF. Review the updated PDF and submit again.',
      code: FINAL_PDF_OUTDATED,
    });
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async loadParent(claimLetterId: string, user: AuthUser): Promise<FinalPdfParent> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .select(PARENT_FIELDS)
      .lean<FinalPdfParent | null>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, String(parent.state));
    return parent;
  }

  /** A submitted batch keeps the copy it was submitted with; a draft builds (or reuses) the merge. */
  private async resolve(parent: FinalPdfParent): Promise<ResolvedFinalPdf> {
    if (parent.submittedAt && parent.currentFormStatus !== FORM_STATUS.IN_PROGRESS) {
      if (!parent.finalClaimPdf) throw new NotFoundException('No final claim letter was stored for this submission.');
      return { finalPdf: parent.finalClaimPdf, bytes: null, missingRequired: [] };
    }
    if (parent.currentFormStatus !== FORM_STATUS.IN_PROGRESS || parent.isAbandoned) {
      throw new ConflictException(
        parent.isAbandoned
          ? 'This claim letter was abandoned.'
          : `The final claim letter is not available (status is ${getFormStatusLabel(parent.currentFormStatus)}).`,
      );
    }
    await this.activeBatchService.assertActive(parent);
    if (!parent.signedClaimFile?.path) {
      throw new BadRequestException('Upload the signed claim letter first.');
    }
    return this.ensure(parent);
  }

  private async fileName(parent: FinalPdfParent): Promise<string> {
    const stateDoc = await this.stateModel.findById(parent.state).select('name').lean<{ name: string } | null>().exec();
    return buildXviFcDownloadFileName({
      entityName: stateDoc?.name ?? '',
      formName: `claim-letter-${parent.installment}-${parent.batchNumber}`,
      yearLabel: YearIdToLabel[String(parent.year)] ?? '',
      extension: 'pdf',
    });
  }

  /** Reuses the cached PDF when the inputs are unchanged; otherwise merges, stores and caches it. */
  private async ensure(parent: FinalPdfParent): Promise<ResolvedFinalPdf> {
    const formConfig = await this.formJsonConfigService.loadFormConfig(String(parent.year));
    const sources = await this.resolveSources(parent, formConfig.mergeDocuments);
    const missingRequired = sources.filter((s) => s.path === null && !s.optional).map((s) => s.label);
    const sourceKey = this.computeSourceKey(sources);
    if (parent.finalClaimPdf?.sourceKey === sourceKey) {
      return { finalPdf: parent.finalClaimPdf, bytes: null, missingRequired };
    }

    const buildKey = `${String(parent._id)}:${sourceKey}`;
    let build = this.building.get(buildKey);
    if (!build) {
      build = this.build(parent, sources, sourceKey).finally(() => this.building.delete(buildKey));
      this.building.set(buildKey, build);
    }
    return { ...(await build), missingRequired };
  }

  private async build(
    parent: FinalPdfParent,
    sources: FinalPdfSource[],
    sourceKey: string,
  ): Promise<{ finalPdf: ClaimLetterFinalPdf; bytes: Buffer }> {
    const present = sources.filter((s): s is FinalPdfSource & { path: string } => s.path !== null);
    const { bytes, pageCount } = await this.merge(present);
    const s3Key = `state/claim-letter-final-pdfs/${String(parent._id)}/${sourceKey.slice(0, 16)}.pdf`;
    await this.s3Service.uploadPrivate(s3Key, bytes, 'application/pdf');

    const now = new Date();
    const file: FileInfo = {
      originalName: `claim-letter-final-batch-${parent.batchNumber}.pdf`,
      name: '',
      path: s3Key,
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeKb: Math.ceil(bytes.length / 1024),
      pageCount,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      createdAt: now,
      updatedAt: now,
    };
    const finalPdf: ClaimLetterFinalPdf = {
      file,
      sourceKey,
      included: present.map((s) => s.label),
      missing: sources.filter((s) => s.path === null).map((s) => s.label),
      pageCount,
      builtAt: now,
    };
    // A stale write is harmless: its key no longer matches the next time.
    await this.batchModel
      .updateOne({ _id: parent._id, currentFormStatus: FORM_STATUS.IN_PROGRESS }, { $set: { finalClaimPdf: finalPdf } })
      .exec();
    return { finalPdf, bytes };
  }

  /**
   * Signed letter first, then each configured document, found through its form's enabled
   * `claimEligibility.source` (so a new enclosure is a formjson change); one parallel `findOne` each.
   */
  private async resolveSources(
    parent: ClaimLetterFinalPdfInputs,
    documents: ClaimLetterMergeDocument[],
  ): Promise<FinalPdfSource[]> {
    const formJsons = await this.formJsonService.findEnabledClaimEligibilitySources(String(parent.year));
    const configByFormId = new Map(formJsons.map((f) => [f.formId, f.claimEligibility]));
    const paths = await Promise.all(
      documents.map((d) => {
        const config = configByFormId.get(d.formId);
        if (config?.source.collection) return this.findDocumentPath(parent, d, config);
        // Listed as not included rather than dropped, so a config gap is visible.
        this.logger.warn(
          `Claim letter merge document "${d.label}": formId ${d.formId} has no enabled claimEligibility source.`,
        );
        return Promise.resolve(null);
      }),
    );
    return [
      { label: SIGNED_LETTER_LABEL, formName: null, path: parent.signedClaimFile?.path ?? null, optional: false },
      ...documents.map((d, i) => ({
        label: d.label,
        formName: configByFormId.get(d.formId)?.displayLabel ?? d.label,
        path: paths[i],
        optional: d.optional,
      })),
    ];
  }

  private async findDocumentPath(
    parent: ClaimLetterFinalPdfInputs,
    document: ClaimLetterMergeDocument,
    config: ClaimEligibilityConfig,
  ): Promise<string | null> {
    const { collection, fields } = config.source;
    const projection = Object.fromEntries(
      document.fileKeys.flatMap((k) => [
        [k, 1],
        [`data.${k}`, 1],
      ]),
    );
    const query = {
      ...buildClaimSourceQuery(config, {
        stateId: parent.state,
        designYearId: String(parent.year),
        installment: parent.installment,
      }),
      isDeleted: { $ne: true },
      [fields?.isActive ?? 'isActive']: { $ne: false },
    };
    const doc = await this.connection.collection(collection!).findOne(query, { projection });
    if (!doc) return null;
    const data = (doc['data'] ?? {}) as Record<string, unknown>;
    for (const key of document.fileKeys) {
      const path = ((doc[key] ?? data[key]) as { path?: unknown } | null | undefined)?.path;
      if (typeof path === 'string' && path) return path;
    }
    return null;
  }

  private computeSourceKey(sources: FinalPdfSource[]): string {
    const tokens = [SOURCE_KEY_VERSION, ...sources.map((s) => `${s.label}|${s.path ?? '-'}`)];
    return createHash('sha256').update(tokens.join('\n')).digest('hex');
  }

  /** Downloads in parallel, appends in order; an unreadable PDF is a 422 naming the document. */
  private async merge(sources: (FinalPdfSource & { path: string })[]): Promise<{ bytes: Buffer; pageCount: number }> {
    const buffers = await Promise.all(
      sources.map((s) =>
        this.s3Service.getPdfBufferFromS3(s.path).catch(() => {
          throw this.unreadable(s, 'could not be found');
        }),
      ),
    );
    const out = await PDFDocument.create();
    for (const [i, source] of sources.entries()) {
      let doc: PDFDocument;
      try {
        doc = await PDFDocument.load(buffers[i]);
      } catch (err) {
        throw this.unreadable(source, isEncryptedPdfError(err) ? 'is password-protected' : 'is damaged');
      }
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((page) => out.addPage(page));
    }
    return { bytes: Buffer.from(await out.save()), pageCount: out.getPageCount() };
  }

  private unreadable(source: FinalPdfSource, problem: string): UnprocessableEntityException {
    const where = source.formName ? `in the ${source.formName} form` : 'as the signed claim letter';
    return new UnprocessableEntityException({
      message: `${source.label} ${problem}. Upload a readable, unprotected PDF ${where}.`,
      code: FINAL_PDF_SOURCE_UNREADABLE,
    });
  }

  private toView({ finalPdf, missingRequired }: ResolvedFinalPdf, fileName: string): ClaimLetterFinalPdfView {
    return {
      sourceKey: finalPdf.sourceKey,
      fileName,
      included: finalPdf.included,
      missing: finalPdf.missing,
      missingRequired,
      pageCount: finalPdf.pageCount,
      builtAt: new Date(finalPdf.builtAt).toISOString(),
    };
  }
}
