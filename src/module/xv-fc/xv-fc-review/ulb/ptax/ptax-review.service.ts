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
import { S3Service } from '../../../../../core/s3/s3.service';
import { S3UploadService } from '../../../../file/s3-upload.service';
import type { AuthUser } from '../../../../auth/auth-user.interface';
import { PropertyTaxOpMapper, PropertyTaxOpMapperDocument } from '../../../../../schemas/property-tax-op-mapper.schema';
import { State, StateDocument } from '../../../../../schemas/state.schema';
import { Ulb, UlbDocument } from '../../../../../schemas/ulb.schema';
import { XvFcPtaxReview, XvFcPtaxReviewDocument } from '../../../../../schemas/xv-fc-ptax-review.schema';
import { Year, YearDocument } from '../../../../../schemas/year.schema';
import {
  fromMetricKey,
  PTAX_METRIC_CODES,
  PTAX_METRIC_ORDER_PAIRS,
  PTAX_METRIC_VALIDATION,
  PTAX_METRICS,
  PTAX_REVIEWABLE_YEARS,
  toMetricKey,
  validatePtaxMetricOrder,
  validatePtaxMetricValue,
} from '../../common/ptax.constants';
import {
  DECLARATION_TARGET_CODE,
  MAX_UPLOAD_SIZE_BYTES,
  SUPPORTING_DOCUMENT_TARGET_CODE,
} from '../../common/xv-fc-review.constants';
import { ConfirmPtaxUploadDto } from './dto/confirm-ptax-upload.dto';
import { PresignPtaxUploadDto } from './dto/presign-ptax-upload.dto';
import { SavePtaxDraftDto } from './dto/save-ptax-draft.dto';
import { SubmitPtaxReviewDto } from './dto/submit-ptax-review.dto';

const NOT_EDITABLE_STATUSES = ['SUBMITTED', 'APPROVED'] as const;
const UPLOAD_TARGET_CODES = [DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE] as const;

@Injectable()
export class PtaxReviewService {
  private readonly logger = new Logger(PtaxReviewService.name);

  constructor(
    @InjectModel(XvFcPtaxReview.name) private readonly reviewModel: Model<XvFcPtaxReviewDocument>,
    @InjectModel(PropertyTaxOpMapper.name) private readonly mapperModel: Model<PropertyTaxOpMapperDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    private readonly s3Service: S3Service,
    private readonly s3UploadService: S3UploadService,
  ) {}

  // ─── FY tabs summary ──────────────────────────────────────────────────────

  async getSummary(ulbId: string, user: AuthUser) {
    this.validateUlbAccess(ulbId, user);

    const yearDocs = await this.yearModel
      .find({ year: { $in: PTAX_REVIEWABLE_YEARS } })
      .select('_id year')
      .lean()
      .exec();
    const yearIdByYear = new Map(yearDocs.map((y) => [y.year, y._id]));
    const yearIds = [...yearIdByYear.values()];

    const [mapperCounts, reviews] = await Promise.all([
      this.mapperModel
        .aggregate([
          {
            $match: {
              ulb: new Types.ObjectId(ulbId),
              displayPriority: { $in: PTAX_METRIC_CODES },
              year: { $in: yearIds },
            },
          },
          { $group: { _id: '$year', count: { $sum: 1 } } },
        ])
        .exec(),
      this.reviewModel
        .find({ ulb_id: new Types.ObjectId(ulbId), year_id: { $in: yearIds } })
        .select('year_id financialYear status submissionCount metricReviews')
        .lean()
        .exec(),
    ]);

    const countByYearId = new Map(mapperCounts.map((c: any) => [c._id.toString(), c.count]));
    const reviewsByYearId = new Map(reviews.map((r: any) => [r.year_id.toString(), r]));

    return PTAX_REVIEWABLE_YEARS.map((financialYear) => {
      const yearId = yearIdByYear.get(financialYear);
      const yearIdStr = yearId?.toString() ?? null;
      const hasData = !!yearIdStr && (countByYearId.get(yearIdStr) ?? 0) >= PTAX_METRIC_CODES.length;
      const review = yearIdStr ? reviewsByYearId.get(yearIdStr) : undefined;
      return {
        yearId: yearIdStr,
        financialYear,
        hasData,
        reviewStatus: review?.status ?? 'NOT_STARTED',
        submissionCount: review?.submissionCount ?? 0,
        flaggedCount: this.countFlagged(review?.metricReviews),
      };
    });
  }

  // ─── Full detail — also serves as the preview-screen payload ────────────────

  // Read-through cache: once a metric's value has been stored on the review
  // doc, it's read from there forever after — propertytaxopmappers is only
  // consulted the first time a given (ulb, year, metric) is opened.
  async getDetail(ulbId: string, yearId: string, user: AuthUser) {
    const yearDoc = await this.resolveYear(yearId);
    const doc = await this.findOrInitializeReview(ulbId, yearDoc, user);

    const metricReviewMap: Record<string, any> = doc.metricReviews ?? {};
    const missingCodes = PTAX_METRIC_CODES.filter((code) => {
      const cached = metricReviewMap[toMetricKey(code)]?.value;
      return cached === undefined || cached === null;
    });

    let fetchedValueByCode = new Map<string, string>();
    if (missingCodes.length > 0) {
      const mapperDocs = await this.mapperModel
        .find({ ulb: new Types.ObjectId(ulbId), year: yearDoc._id, displayPriority: { $in: missingCodes } })
        .select('displayPriority value')
        .lean()
        .exec();
      fetchedValueByCode = new Map(mapperDocs.map((d: any) => [d.displayPriority, d.value]));

      if (fetchedValueByCode.size > 0) {
        const setOps: Record<string, unknown> = {};
        for (const [code, value] of fetchedValueByCode) {
          setOps[`metricReviews.${toMetricKey(code)}.value`] = value;
        }
        await this.reviewModel.updateOne({ _id: doc._id }, { $set: setOps }).exec();
      }
    }

    // hasData reflects whether the source has ever had anything to show for
    // this ulb+year — true once every metric has a value from either the
    // cache or a fresh fetch.
    const hasData = PTAX_METRIC_CODES.every((code) => {
      const key = toMetricKey(code);
      return metricReviewMap[key]?.value != null || fetchedValueByCode.has(code);
    });

    const metrics = PTAX_METRICS.map(({ code, label }) => {
      const key = toMetricKey(code);
      const metricReview = metricReviewMap[key];
      return {
        code,
        label,
        value: metricReview?.value ?? fetchedValueByCode.get(code) ?? null,
        flagged: metricReview?.flagged ?? false,
        proposedValue: metricReview?.proposedValue ?? null,
        comment: metricReview?.comment ?? '',
        adminDecision: metricReview?.adminDecision ?? null,
        validation: PTAX_METRIC_VALIDATION[code] ?? null,
      };
    });

    return {
      ulbId,
      ulbName: doc.ulbName ?? null,
      yearId,
      financialYear: yearDoc.year,
      hasData,
      status: doc.status ?? 'NOT_STARTED',
      finalAction: doc.finalAction ?? null,
      submittedAt: doc.submittedAt ?? null,
      declaration: doc.declaration ?? null,
      supportingDocument: doc.supportingDocument ?? null,
      submissionCount: doc.submissionCount ?? 0,
      metrics,
      metricOrderRules: PTAX_METRIC_ORDER_PAIRS,
      history: doc.history ?? [],
    };
  }

  // ─── Save as draft ────────────────────────────────────────────────────────

  async saveDraft(ulbId: string, yearId: string, dto: SavePtaxDraftDto, user: AuthUser) {
    const yearDoc = await this.resolveYear(yearId);
    const doc = await this.findOrInitializeReview(ulbId, yearDoc, user);
    this.assertEditable(doc);

    // Validate every proposed value up front — fail the whole call rather
    // than partially persisting some metrics and rejecting others.
    for (const item of dto.metrics) {
      if (item.proposedValue !== undefined) {
        const error = validatePtaxMetricValue(item.code, item.proposedValue);
        if (error) throw new BadRequestException(`Metric ${item.code}: ${error}`);
      }
    }

    // Cross-field ordering (1.10<=1.9, 1.18<=1.17, 2.4<=2.3) checked against
    // the merged state — the two sides of a pair are often saved separately,
    // so this call's changes are layered on top of whatever's already stored.
    const existingReviews: Record<string, any> = doc.metricReviews ?? {};
    const mergedValuesByCode: Record<string, number | null | undefined> = {};
    for (const code of PTAX_METRIC_CODES) {
      mergedValuesByCode[code] = existingReviews[toMetricKey(code)]?.proposedValue ?? null;
    }
    for (const item of dto.metrics) {
      if (item.proposedValue !== undefined) {
        mergedValuesByCode[item.code] = item.proposedValue;
      }
    }
    const orderError = validatePtaxMetricOrder(mergedValuesByCode);
    if (orderError) throw new BadRequestException(orderError);

    const setOps: Record<string, unknown> = { status: doc.status === 'NOT_STARTED' ? 'DRAFT' : doc.status };
    for (const item of dto.metrics) {
      const key = toMetricKey(item.code);
      const existing = existingReviews[key];
      setOps[`metricReviews.${key}.flagged`] = item.flagged;
      if (item.proposedValue !== undefined) {
        setOps[`metricReviews.${key}.proposedValue`] = item.proposedValue;
      }
      if (item.comment !== undefined) {
        setOps[`metricReviews.${key}.comment`] = item.comment;
      }

      // A previously-ACCEPTED decision was made against the old data —
      // submit()'s resubmission loop leaves ACCEPTED metrics untouched on
      // the assumption they can't have changed since. If the ULB actually
      // edits a metric's flagged state, proposed value, or comment after
      // it was accepted, that acceptance is stale and must be re-reviewed.
      const changed =
        existing?.flagged !== item.flagged ||
        (item.proposedValue !== undefined && existing?.proposedValue !== item.proposedValue) ||
        (item.comment !== undefined && existing?.comment !== item.comment);
      if (changed && existing?.adminDecision?.status === 'ACCEPTED') {
        setOps[`metricReviews.${key}.adminDecision`] = {
          status: 'PENDING',
          reason: '',
          correctedValue: null,
          reviewedBy: null,
          reviewedAt: null,
        };
      }
    }

    await this.reviewModel.updateOne({ _id: doc._id }, { $set: setOps }).exec();

    return this.getDetail(ulbId, yearId, user);
  }

  // ─── Presign / confirm declaration & shared supporting-document uploads ─────

  async presignUpload(ulbId: string, yearId: string, dto: PresignPtaxUploadDto, user: AuthUser) {
    const yearDoc = await this.resolveYear(yearId);
    const doc = await this.findOrInitializeReview(ulbId, yearDoc, user);
    this.assertEditable(doc);
    this.assertValidUploadTarget(dto.targetCode);

    const ext = dto.fileName.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf') {
      throw new BadRequestException('Only PDF files are allowed');
    }

    const uploadId = uuidv4();
    const folder = `xv-fc-review/ptax/${ulbId}/${yearId}/${dto.targetCode}`;
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

  async confirmUpload(ulbId: string, yearId: string, dto: ConfirmPtaxUploadDto, user: AuthUser) {
    const yearDoc = await this.resolveYear(yearId);
    const doc = await this.findOrInitializeReview(ulbId, yearDoc, user);
    this.assertEditable(doc);
    this.assertValidUploadTarget(dto.targetCode);

    // The presigned PUT URL is generated with the caller-supplied uploadId as the
    // S3 filename (only .pdf is allowed — enforced in presignUpload), so the
    // confirmed key must match exactly, not just share a folder prefix. Otherwise
    // a client could confirm an unrelated object already sitting under this folder.
    const expectedKey = `xv-fc-review/ptax/${ulbId}/${yearId}/${dto.targetCode}/${dto.uploadId}.pdf`;
    if (dto.s3Key !== expectedKey) {
      throw new BadRequestException('Invalid s3Key for this upload');
    }

    let head: Awaited<ReturnType<S3Service['headObject']>>;
    try {
      head = await this.s3Service.headObject(dto.s3Key);
    } catch {
      throw new BadRequestException('File not found in S3 — upload may have failed or expired');
    }
    // dto.fileSize is client-supplied and never persisted — the presigned PUT
    // URL doesn't constrain upload size, so the actual S3 object is the only
    // trustworthy source for this check.
    if (head.ContentLength != null && head.ContentLength > MAX_UPLOAD_SIZE_BYTES) {
      throw new BadRequestException(`Uploaded file exceeds the ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB limit`);
    }

    const fileRef = { url: dto.s3Key, name: dto.originalName, uploadedAt: new Date() };

    const setPath = dto.targetCode === DECLARATION_TARGET_CODE ? 'declaration' : 'supportingDocument';
    const setValue =
      dto.targetCode === DECLARATION_TARGET_CODE
        ? { file: fileRef, declaredBy: new Types.ObjectId(user._id), declaredAt: new Date() }
        : fileRef;

    await this.reviewModel.updateOne({ _id: doc._id }, { $set: { [setPath]: setValue } }).exec();

    return { targetCode: dto.targetCode, file: fileRef };
  }

  async getSignedUrl(ulbId: string, yearId: string, targetCode: string, user: AuthUser) {
    const doc = await this.findReviewOrThrow(ulbId, yearId, user);
    this.assertValidUploadTarget(targetCode);

    const s3Key: string | undefined =
      targetCode === DECLARATION_TARGET_CODE ? doc.declaration?.file?.url : doc.supportingDocument?.url;

    if (!s3Key) throw new NotFoundException('Document not found');

    const url = await this.s3Service.presignGet(s3Key);
    return { url };
  }

  // ─── Submit (and resubmit after rejection) ───────────────────────────────────

  async submit(ulbId: string, yearId: string, dto: SubmitPtaxReviewDto, user: AuthUser) {
    const yearDoc = await this.resolveYear(yearId);
    const doc = await this.findOrInitializeReview(ulbId, yearDoc, user);
    this.assertEditable(doc);

    if (!doc.declaration?.file) {
      throw new BadRequestException('A signed declaration must be uploaded before submitting');
    }

    const reviews: Record<string, any> = doc.metricReviews ?? {};
    const flaggedEntries = Object.entries(reviews).filter(([, r]) => r?.flagged);

    const now = new Date();
    const performedBy = new Types.ObjectId(user._id);

    if (dto.finalAction === 'ACCEPT_NO_CHANGES') {
      if (flaggedEntries.length > 0) {
        throw new BadRequestException('Cannot accept with no changes while metrics are flagged — unflag them first');
      }

      await this.reviewModel
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'APPROVED',
              finalAction: dto.finalAction,
              submittedBy: performedBy,
              submittedAt: now,
            },
            $inc: { submissionCount: 1 },
            $push: {
              history: {
                action: 'SUBMISSION_APPROVED',
                metricCode: null,
                previousValue: null,
                newValue: null,
                performedBy,
                performedByRole: user.role,
                reason: 'ACCEPT_NO_CHANGES — no flagged metrics, no admin review required',
                createdAt: now,
              },
            },
          },
        )
        .exec();

      this.logger.log(`Ptax review auto-approved (no changes) — ulb=${ulbId} year=${yearDoc.year} by=${user._id}`);
      return this.getDetail(ulbId, yearId, user);
    }

    // SUBMIT_WITH_COMMENTS
    if (flaggedEntries.length === 0) {
      throw new BadRequestException('At least one metric must be flagged to submit with comments');
    }
    const missingProposedValue = flaggedEntries.find(([, r]) => r.proposedValue == null);
    if (missingProposedValue) {
      throw new BadRequestException(`Metric ${fromMetricKey(missingProposedValue[0])} requires a proposed value`);
    }
    // Unlike the main AFS review, a supporting document is optional here —
    // the declaration alone is sufficient to submit with comments.

    const setOps: Record<string, unknown> = {
      status: 'SUBMITTED',
      finalAction: dto.finalAction,
      submittedBy: performedBy,
      submittedAt: now,
    };
    const historyEntries = flaggedEntries.map(([key, r]) => {
      const previousValueNum = r.value != null && r.value !== '' ? Number(r.value) : null;
      return {
        action: 'ULB_FLAG',
        metricCode: fromMetricKey(key),
        previousValue: previousValueNum != null && !Number.isNaN(previousValueNum) ? previousValueNum : null,
        newValue: r.proposedValue ?? null,
        performedBy,
        performedByRole: user.role,
        reason: r.comment ?? '',
        createdAt: now,
      };
    });
    historyEntries.push({
      action: 'ULB_SUBMIT',
      metricCode: null as unknown as string,
      previousValue: null,
      newValue: null,
      performedBy,
      performedByRole: user.role,
      reason: dto.finalAction,
      createdAt: now,
    });

    // Reset any previously-REJECTED metric's decision back to PENDING for
    // re-review; newly-flagged metrics get PENDING for the first time.
    // ACCEPTED metrics are left untouched — already resolved.
    for (const [code, r] of flaggedEntries) {
      if (!r.adminDecision || r.adminDecision.status !== 'ACCEPTED') {
        setOps[`metricReviews.${code}.adminDecision`] = {
          status: 'PENDING',
          reason: '',
          correctedValue: null,
          reviewedBy: null,
          reviewedAt: null,
        };
      }
    }

    await this.reviewModel
      .updateOne(
        { _id: doc._id },
        { $set: setOps, $inc: { submissionCount: 1 }, $push: { history: { $each: historyEntries } } },
      )
      .exec();

    this.logger.log(
      `Ptax review submitted — ulb=${ulbId} year=${yearDoc.year} action=${dto.finalAction} by=${user._id}`,
    );
    return this.getDetail(ulbId, yearId, user);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  // Validates :yearId resolves to a real Year within the Ptax reviewable
  // range — this is now the real join key for xvfc_ptax_reviews AND matches
  // propertytaxopmappers.year's own ObjectId type, so no string resolution
  // is needed to query the source table (unlike the AFS/ledgerlogs module).
  private async resolveYear(yearId: string): Promise<{ _id: Types.ObjectId; year: string }> {
    const yearDoc = await this.yearModel.findById(new Types.ObjectId(yearId)).select('year').lean().exec();
    if (!yearDoc) throw new NotFoundException('Year not found');
    if (!(PTAX_REVIEWABLE_YEARS as readonly string[]).includes(yearDoc.year)) {
      throw new BadRequestException(`Year ${yearDoc.year} is not in the reviewable range for this module`);
    }
    return { _id: yearDoc._id, year: yearDoc.year };
  }

  private async findReviewOrThrow(ulbId: string, yearId: string, user: AuthUser): Promise<any> {
    this.validateUlbAccess(ulbId, user);

    const doc = await this.reviewModel
      .findOne({ ulb_id: new Types.ObjectId(ulbId), year_id: new Types.ObjectId(yearId) })
      .lean()
      .exec();

    if (!doc) throw new NotFoundException('No Ptax review found for this ULB and financial year');
    return doc;
  }

  // Atomic upsert — avoids a find→create race when the ULB first touches a
  // given year. Denormalizes ULB/state display fields once.
  private async findOrInitializeReview(
    ulbId: string,
    yearDoc: { _id: Types.ObjectId; year: string },
    user: AuthUser,
  ): Promise<any> {
    this.validateUlbAccess(ulbId, user);

    const existing = await this.reviewModel
      .findOne({ ulb_id: new Types.ObjectId(ulbId), year_id: yearDoc._id })
      .lean()
      .exec();
    if (existing) return existing;

    const ulb = await this.ulbModel.findById(new Types.ObjectId(ulbId)).select('name code state').lean().exec();
    if (!ulb) throw new NotFoundException('ULB not found');

    const state = ulb.state ? await this.stateModel.findById(ulb.state).select('name code').lean().exec() : null;

    const created = await this.reviewModel
      .findOneAndUpdate(
        { ulb_id: new Types.ObjectId(ulbId), year_id: yearDoc._id },
        {
          $setOnInsert: {
            ulb_id: new Types.ObjectId(ulbId),
            ulbName: ulb.name,
            ulbCode: ulb.code,
            state: state?.name ?? null,
            stateCode: state?.code ?? null,
            year_id: yearDoc._id,
            financialYear: yearDoc.year,
            status: 'NOT_STARTED',
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    return created;
  }

  private assertEditable(doc: any) {
    if (NOT_EDITABLE_STATUSES.includes(doc.status)) {
      throw new ConflictException(
        doc.status === 'APPROVED'
          ? 'This financial year has already been approved and is locked'
          : 'This submission is currently under admin review and cannot be edited',
      );
    }
  }

  private assertValidUploadTarget(targetCode: string) {
    if (!UPLOAD_TARGET_CODES.includes(targetCode as (typeof UPLOAD_TARGET_CODES)[number])) {
      throw new BadRequestException(`targetCode must be one of: ${UPLOAD_TARGET_CODES.join(', ')}`);
    }
  }

  private countFlagged(metricReviews: Record<string, any> | undefined): number {
    if (!metricReviews) return 0;
    return Object.values(metricReviews).filter((r: any) => r?.flagged).length;
  }

  private validateUlbAccess(ulbId: string, user: AuthUser) {
    if (user.scope === 'ULB') {
      if (user.ulb?.toString() !== ulbId) {
        throw new ForbiddenException('You can only access your own ULB data');
      }
    }
  }
}
