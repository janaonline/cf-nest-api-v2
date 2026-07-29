import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../core/s3/s3.service';
import { S3UploadService } from '../../module/file/s3-upload.service';
import type { AuthUser } from '../../module/auth/auth-user.interface';
import { AnnualAccountData, AnnualAccountDataDocument } from '../../schemas/annual-account-data.schema';
import { LedgerLog, LedgerLogDocument } from '../../schemas/ledger-log.schema';
import { LineItem, LineItemDocument } from '../../schemas/line-item.schema';
import { Year, YearDocument } from '../../schemas/year.schema';
import {
  DECLARATION_TARGET_CODE,
  SUPPORTING_DOCUMENT_TARGET_CODE,
  XV_FC_REVIEWABLE_YEARS,
  mapHeadOfAccountToSection,
} from '../common/xv-fc-review.constants';
import { ConfirmReviewUploadDto } from './dto/confirm-review-upload.dto';
import { PresignReviewUploadDto } from './dto/presign-review-upload.dto';
import { XvFcSaveDraftDto } from './dto/save-draft.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';

type OriginalDocumentBundle = Record<string, { url: string; name: string } | null> | null;
const UPLOAD_TARGET_CODES = [DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE] as const;

@Injectable()
export class XvFcReviewService {
  private readonly logger = new Logger(XvFcReviewService.name);

  constructor(
    @InjectModel(LedgerLog.name) private readonly ledgerLogModel: Model<LedgerLogDocument>,
    @InjectModel(LineItem.name) private readonly lineItemModel: Model<LineItemDocument>,
    @InjectModel(AnnualAccountData.name) private readonly annualAccountModel: Model<AnnualAccountDataDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    private readonly s3Service: S3Service,
    private readonly s3UploadService: S3UploadService,
  ) {}

  // ─── FY tabs summary ──────────────────────────────────────────────────────

  async getSummary(ulbId: string, user: AuthUser) {
    this.validateUlbAccess(ulbId, user);

    const [yearDocs, docs] = await Promise.all([
      this.yearModel
        .find({ year: { $in: XV_FC_REVIEWABLE_YEARS } })
        .select('_id year')
        .lean()
        .exec(),
      this.ledgerLogModel
        .find({ ulb_id: new Types.ObjectId(ulbId), year: { $in: XV_FC_REVIEWABLE_YEARS } })
        .select('year xvFcReview.status xvFcReview.lineItemReviews')
        .lean()
        .exec(),
    ]);
    const yearIdByYear = new Map(yearDocs.map((y) => [y.year, y._id]));
    const docsByYear = new Map(docs.map((doc: any) => [doc.year, doc]));

    // Always return all 5 tabs, even for years MaGC hasn't digitized yet —
    // the FE renders a tab per year regardless of data availability.
    return XV_FC_REVIEWABLE_YEARS.map((financialYear) => {
      const doc = docsByYear.get(financialYear);
      return {
        yearId: yearIdByYear.get(financialYear)?.toString() ?? null,
        financialYear,
        hasData: !!doc,
        reviewStatus: doc?.xvFcReview?.status ?? 'NOT_STARTED',
        flaggedCount: this.countFlagged(doc?.xvFcReview?.lineItemReviews),
      };
    });
  }

  // ─── Full detail — also serves as the preview-screen payload ────────────────

  async getDetail(ulbId: string, yearId: string, user: AuthUser) {
    this.validateUlbAccess(ulbId, user);

    const financialYear = await this.resolveYearString(yearId);

    const doc = await this.ledgerLogModel
      .findOne({ ulb_id: new Types.ObjectId(ulbId), year: financialYear })
      .lean()
      .exec();

    // A year with no digitized data yet (e.g. 2023-24/2024-25 not yet loaded
    // by MaGC) is a valid, expected state — not an error. Return an empty
    // "not started" shape rather than 404ing, so the FE can render the tab
    // without special-casing every read call.
    if (!doc) {
      const originalDocuments = await this.resolveOriginalDocuments(ulbId, financialYear);
      return {
        ulbId,
        ulbName: null,
        yearId,
        financialYear,
        hasData: false,
        status: 'NOT_STARTED',
        finalAction: null,
        declaration: null,
        supportingDocument: null,
        lineItems: [],
        originalDocuments,
        excelUrl: null,
      };
    }

    const codes = Object.keys(doc.lineItems ?? {});
    const catalog = await this.lineItemModel
      .find({ code: { $in: codes } })
      .lean()
      .exec();
    const catalogByCode = new Map(catalog.map((c) => [c.code, c]));

    const reviewMap: Record<string, any> = doc.xvFcReview?.lineItemReviews ?? {};

    const lineItems = codes
      .map((code) => {
        const meta = catalogByCode.get(code);
        const review = reviewMap[code];
        return {
          code,
          name: meta?.name ?? null,
          headOfAccount: meta?.headOfAccount ?? null,
          section: mapHeadOfAccountToSection(meta?.headOfAccount),
          standardizedAmount: doc.lineItems?.[code] ?? null,
          flagged: review?.flagged ?? false,
          proposedValue: review?.proposedValue ?? null,
          comment: review?.comment ?? '',
          adminDecision: review?.adminDecision ?? null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    const originalDocuments = await this.resolveOriginalDocuments(ulbId, financialYear);

    return {
      ulbId,
      ulbName: doc.ulb ?? null,
      yearId,
      financialYear,
      hasData: true,
      status: doc.xvFcReview?.status ?? 'NOT_STARTED',
      finalAction: doc.xvFcReview?.finalAction ?? null,
      declaration: doc.xvFcReview?.declaration ?? null,
      supportingDocument: doc.xvFcReview?.supportingDocument ?? null,
      lineItems,
      originalDocuments,
      excelUrl: doc.excel_url ?? null,
    };
  }

  // ─── Save as draft ────────────────────────────────────────────────────────

  async saveDraft(ulbId: string, yearId: string, dto: XvFcSaveDraftDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear, user);
    this.assertNotLocked(doc);

    const validCodes = new Set(Object.keys(doc.lineItems ?? {}));
    const unknownCode = dto.lineItems.find((item) => !validCodes.has(item.code));
    if (unknownCode) {
      throw new BadRequestException(`Line item ${unknownCode.code} does not exist on this financial year's data`);
    }

    const setOps: Record<string, unknown> = {
      'xvFcReview.status': 'DRAFT',
      'xvFcReview.draftSavedBy': new Types.ObjectId(user._id),
      'xvFcReview.draftSavedAt': new Date(),
    };

    for (const item of dto.lineItems) {
      setOps[`xvFcReview.lineItemReviews.${item.code}.flagged`] = item.flagged;
      if (item.proposedValue !== undefined) {
        setOps[`xvFcReview.lineItemReviews.${item.code}.proposedValue`] = item.proposedValue;
      }
      if (item.comment !== undefined) {
        setOps[`xvFcReview.lineItemReviews.${item.code}.comment`] = item.comment;
      }
    }

    await this.ledgerLogModel.updateOne({ _id: doc._id }, { $set: setOps }).exec();

    return this.getDetail(ulbId, yearId, user);
  }

  // ─── Presign / confirm declaration & (single, shared) supporting-document uploads ──

  async presignUpload(ulbId: string, yearId: string, dto: PresignReviewUploadDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear, user);
    this.assertNotLocked(doc);
    this.assertValidUploadTarget(dto.targetCode);

    const ext = dto.fileName.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf') {
      throw new BadRequestException('Only PDF files are allowed');
    }

    const uploadId = uuidv4();
    const folder = `xv-fc-review/${ulbId}/${yearId}/${dto.targetCode}`;
    const expiresIn = 300;

    const result = await this.s3UploadService.generatePutSignedUrl({
      fileName: dto.fileName,
      folder,
      mimeType: 'application/pdf',
      uploadId,
      expiresIn,
    });

    return { uploadId, presignedUrl: result.url, s3Key: result.path, expiresIn };
  }

  async confirmUpload(ulbId: string, yearId: string, dto: ConfirmReviewUploadDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear, user);
    this.assertNotLocked(doc);
    this.assertValidUploadTarget(dto.targetCode);

    // The presigned PUT URL is generated with the caller-supplied uploadId as the
    // S3 filename (only .pdf is allowed — enforced in presignUpload), so the
    // confirmed key must match exactly, not just share a folder prefix. Otherwise
    // a client could confirm an unrelated object already sitting under this folder.
    const expectedKey = `xv-fc-review/${ulbId}/${yearId}/${dto.targetCode}/${dto.uploadId}.pdf`;
    if (dto.s3Key !== expectedKey) {
      throw new BadRequestException('Invalid s3Key for this upload');
    }

    try {
      await this.s3Service.headObject(dto.s3Key);
    } catch {
      throw new BadRequestException('File not found in S3 — upload may have failed or expired');
    }

    const fileRef = { url: dto.s3Key, name: dto.originalName, uploadedAt: new Date() };

    const setPath =
      dto.targetCode === DECLARATION_TARGET_CODE ? 'xvFcReview.declaration' : 'xvFcReview.supportingDocument';
    const setValue =
      dto.targetCode === DECLARATION_TARGET_CODE
        ? { file: fileRef, declaredBy: new Types.ObjectId(user._id), declaredAt: new Date() }
        : fileRef;

    await this.ledgerLogModel.updateOne({ _id: doc._id }, { $set: { [setPath]: setValue } }).exec();

    return { targetCode: dto.targetCode, file: fileRef };
  }

  async getSignedUrl(ulbId: string, yearId: string, targetCode: string, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear, user);
    this.assertValidUploadTarget(targetCode);

    const s3Key: string | undefined =
      targetCode === DECLARATION_TARGET_CODE
        ? doc.xvFcReview?.declaration?.file?.url
        : doc.xvFcReview?.supportingDocument?.url;

    if (!s3Key) throw new NotFoundException('Document not found');

    const url = await this.s3Service.presignGet(s3Key);
    return { url };
  }

  // ─── Final submit ─────────────────────────────────────────────────────────

  async submit(ulbId: string, yearId: string, dto: SubmitReviewDto, user: AuthUser) {
    const financialYear = await this.resolveYearString(yearId);
    const doc = await this.findLedgerLogOrThrow(ulbId, financialYear, user);
    this.assertNotLocked(doc);

    const review = doc.xvFcReview;
    if (!review?.declaration?.file) {
      throw new BadRequestException('A signed declaration must be uploaded before submitting');
    }

    const reviews: Record<string, any> = review.lineItemReviews ?? {};
    const flaggedEntries = Object.entries(reviews).filter(([, r]) => r?.flagged);

    if (dto.finalAction === 'ACCEPT_NO_CHANGES' && flaggedEntries.length > 0) {
      throw new BadRequestException('Cannot accept with no changes while items are flagged — unflag them first');
    }
    if (dto.finalAction === 'SUBMIT_WITH_COMMENTS') {
      if (flaggedEntries.length === 0) {
        throw new BadRequestException('At least one line item must be flagged to submit with comments');
      }
      const missingProposedValue = flaggedEntries.find(([, r]) => r.proposedValue == null);
      if (missingProposedValue) {
        throw new BadRequestException(`Line item ${missingProposedValue[0]} requires a proposed value`);
      }
      if (!review.supportingDocument) {
        throw new BadRequestException('A supporting document must be uploaded before submitting with comments');
      }
    }

    const now = new Date();
    const performedBy = new Types.ObjectId(user._id);

    const auditEntries = flaggedEntries.map(([code, r]) => ({
      action: 'ULB_FLAG',
      lineItemCode: code,
      previousValue: doc.lineItems?.[code] ?? null,
      newValue: r.proposedValue ?? null,
      performedBy,
      performedByRole: user.role,
      reason: r.comment ?? '',
      createdAt: now,
    }));

    auditEntries.push({
      action: 'ULB_SUBMIT',
      lineItemCode: null as unknown as string,
      previousValue: null,
      newValue: null,
      performedBy,
      performedByRole: user.role,
      reason: dto.finalAction,
      createdAt: now,
    });

    const setOps: Record<string, unknown> = {
      'xvFcReview.status': 'LOCKED',
      'xvFcReview.finalAction': dto.finalAction,
      'xvFcReview.submittedBy': performedBy,
      'xvFcReview.submittedAt': now,
    };
    // Initialize adminDecision to PENDING for every flagged item so the admin
    // module's optimistic-concurrency filter (matching on adminDecision.status)
    // has something to match on the first decision — it starts out `null`.
    for (const [code] of flaggedEntries) {
      setOps[`xvFcReview.lineItemReviews.${code}.adminDecision`] = {
        status: 'PENDING',
        reason: '',
        correctedValue: null,
        reviewedBy: null,
        reviewedAt: null,
      };
    }

    await this.ledgerLogModel
      .updateOne(
        { _id: doc._id },
        {
          $set: setOps,
          $push: { 'xvFcReview.auditTrail': { $each: auditEntries } },
        },
      )
      .exec();

    this.logger.log(
      `XV-FC review submitted — ulb=${ulbId} year=${financialYear} action=${dto.finalAction} by=${user._id}`,
    );

    return this.getDetail(ulbId, yearId, user);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  // Resolves the route's :yearId to the "YYYY-YY" string ledgerlogs is
  // actually keyed by, and rejects anything outside the in-scope review
  // window — the client now identifies years by ObjectId, but the
  // underlying 16k-doc collection is genuinely keyed by the string.
  private async resolveYearString(yearId: string): Promise<string> {
    const yearDoc = await this.yearModel.findById(new Types.ObjectId(yearId)).select('year').lean().exec();
    if (!yearDoc) throw new NotFoundException('Year not found');
    if (!(XV_FC_REVIEWABLE_YEARS as readonly string[]).includes(yearDoc.year)) {
      throw new BadRequestException(`Year ${yearDoc.year} is not in the reviewable range for this module`);
    }
    return yearDoc.year;
  }

  private async findLedgerLogOrThrow(ulbId: string, financialYear: string, user: AuthUser): Promise<any> {
    this.validateUlbAccess(ulbId, user);

    const doc = await this.ledgerLogModel
      .findOne({ ulb_id: new Types.ObjectId(ulbId), year: financialYear })
      .lean()
      .exec();

    if (!doc) throw new NotFoundException('No standardized data found for this ULB and financial year');
    return doc;
  }

  private assertNotLocked(doc: any) {
    if (doc.xvFcReview?.status === 'LOCKED') {
      throw new ConflictException('This financial year has already been submitted and is locked');
    }
  }

  private assertValidUploadTarget(targetCode: string) {
    if (!UPLOAD_TARGET_CODES.includes(targetCode as (typeof UPLOAD_TARGET_CODES)[number])) {
      throw new BadRequestException(`targetCode must be one of: ${UPLOAD_TARGET_CODES.join(', ')}`);
    }
  }

  private countFlagged(lineItemReviews: Record<string, any> | undefined): number {
    if (!lineItemReviews) return 0;
    return Object.values(lineItemReviews).filter((r: any) => r?.flagged).length;
  }

  private validateUlbAccess(ulbId: string, user: AuthUser) {
    if (user.scope === 'ULB') {
      if (user.ulb?.toString() !== ulbId) {
        throw new ForbiddenException('You can only access your own ULB data');
      }
    }
  }

  // Cross-references the pre-existing annualaccountdatas collection (same ULB's
  // Annual Accounts submission flow) to find the ULB's originally-submitted PDFs
  // for the target financial year. `ledgerlogs` itself carries no source-PDF
  // reference — only the digitized amounts.
  private async resolveOriginalDocuments(ulbId: string, financialYear: string): Promise<OriginalDocumentBundle> {
    const yearDoc = await this.yearModel.findOne({ year: financialYear }).select('_id').lean().exec();
    if (!yearDoc) return null;
    const yearIdStr = yearDoc._id.toString();

    const accountDocs = await this.annualAccountModel
      .find({ ulb: new Types.ObjectId(ulbId) })
      .select('audited unAudited history')
      .lean()
      .exec();

    const extractBundle = (formData: any): OriginalDocumentBundle => {
      if (!formData || formData.year?.toString() !== yearIdStr) return null;
      const pd = formData.provisional_data ?? {};
      const pick = (c: any) => (c?.pdf?.url ? { url: c.pdf.url, name: c.pdf.name } : null);
      return {
        bal_sheet: pick(pd.bal_sheet),
        bal_sheet_schedules: pick(pd.bal_sheet_schedules),
        inc_exp: pick(pd.inc_exp),
        inc_exp_schedules: pick(pd.inc_exp_schedules),
        cash_flow: pick(pd.cash_flow),
        auditor_report: pick(pd.auditor_report),
      };
    };

    for (const doc of accountDocs as any[]) {
      const bundle = extractBundle(doc.audited) ?? extractBundle(doc.unAudited);
      if (bundle) return bundle;
    }

    for (const doc of accountDocs as any[]) {
      for (const h of doc.history ?? []) {
        const bundle = extractBundle(h.audited) ?? extractBundle(h.unAudited);
        if (bundle) return bundle;
      }
    }

    return null;
  }
}
