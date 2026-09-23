import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Model, PipelineStage, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import { assertValidFormStatusTransition } from 'src/common/utils/form-status-transitions';
import {
  canStateReviewForm,
  canStateUndoFormApproval,
  canUlbEditForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { resolveStateScopeFilter } from 'src/module/xvi-fc/common/utils/xvi-fc-scope-filter.util';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { S3Service } from 'src/core/s3/s3.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { YearAccessService, type UlbAccessInput } from 'src/module/xvi-fc/common/services/year-access.service';
import { ExemptionResolverService, type ExemptionResolution } from 'src/module/xvi-fc/common/services/exemption-resolver.service';
import { XviFcDur, XviFcDurDocument, DUR_DOC_IDS, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';
import { XviFcDurFormLog, XviFcDurFormLogDocument } from 'src/schemas/xvi-fc/dur-form-log.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';
import { DUR_VALIDATION_QUEUE } from 'src/core/constants/queues';
import { DocumentActionGatesService } from 'src/module/xvi-fc/common/services/document-action-gates.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { FormReturnedNotificationService } from 'src/module/xvi-fc/common/reminders/form-returned-notification.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  buildDecisionRecord,
  resolveDeciderName,
  runBulkDecision,
  type BulkDecisionResult,
} from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import {
  isAwaitingManualReviewDecision,
  isUploadBlocked,
  UPLOAD_BLOCKED_MESSAGE,
} from 'src/common/utils/manual-review-cooldown.util';
import { ConfirmDurUploadDto } from './dto/confirm-dur-upload.dto';
import { SubmitDurDto } from './dto/submit-dur.dto';
import { DurDecisionDto } from './dto/dur-decision.dto';
import { BulkDurDecisionDto } from './dto/bulk-dur-decision.dto';
import type { DurUlbSubmissionsQueryDto } from './dto/dur-ulb-submissions-query.dto';
import type { DurValidationJobData } from './dto/dur-validation-job.dto';
import type { DurFormLogEntry, DurPermissions } from './dur.types';
import { DUR_DOC_LABELS, DUR_FORM_ID, DUR_REPORTING_FINANCIAL_YEAR } from './constants/dur-form.constants';

interface DurSubmissionRow {
  ulbId: Types.ObjectId;
  ulbCode: string;
  censusCode: string;
  ulbName: string;
  formStatus: FormStatusType;
  lastUpdatedAt: Date | null;
  /** When this form entered UNDER_REVIEW_BY_STATE (dur.declaredAt) — same rationale as the
   *  identical field on AnnualAccountsService/BankAccountService's own submission rows. */
  enteredReviewAt: Date | null;
  durId: Types.ObjectId | null;
}

interface DurSubmissionsFacetResult {
  data: DurSubmissionRow[];
  totalCount: Array<{ count: number }>;
  counts: Array<{ _id: FormStatusType; count: number }>;
}

@Injectable()
export class DurService {
  private readonly logger = new Logger(DurService.name);

  constructor(
    @InjectModel(XviFcDur.name)
    private readonly durModel: Model<XviFcDurDocument>,

    @InjectModel(XviFcDurFormLog.name)
    private readonly formLogModel: Model<XviFcDurFormLogDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private readonly yearModel: Model<Year>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    private readonly s3Service: S3Service,

    @InjectQueue(DUR_VALIDATION_QUEUE)
    private readonly durQueue: Queue<DurValidationJobData>,

    private readonly ulbEligibilityService: UlbEligibilityService,

    private readonly documentActionGates: DocumentActionGatesService,

    private readonly formJsonService: FormJsonService,

    private readonly formReturnedNotification: FormReturnedNotificationService,

    private readonly fileTokenService: FileTokenService,

    private readonly yearAccessService: YearAccessService,

    private readonly exemptionResolverService: ExemptionResolverService,
  ) {}

  /** Signs a document's stored S3 key into a short-lived, inline-viewable download URL — same
   *  pattern as BankAccountService.signProofFileUrl. Documents without an upload yet have no path. */
  private signDurFileUrl(s3Key: string | undefined | null): string | null {
    return s3Key ? this.fileTokenService.signFileUrl(s3Key, 'inline') : null;
  }

  async getActionGates() {
    return this.documentActionGates.getActionGates(DUR_FORM_ID);
  }

  /**
   * Document-slot config for the DUR form (labels, file constraints, template-download links),
   * sourced from formjson (formId 36) — same pattern as
   * AnnualAccountsService.getUploadConfig/BankAccountService.getFormConfig, kept separate from
   * getActionGates() (unlike Annual Account's getUploadConfig, which folds both into one
   * response) since DUR's action-gates endpoint already ships and is tested on its own.
   */
  async getFormConfig(yearId: string) {
    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, DUR_FORM_ID);
    return { meta: formJson.meta ?? {}, data: formJson.data ?? [] };
  }

  // ─── Access checks ─────────────────────────────────────────────────────────

  async validateViewAccess(doc: { ulb: Types.ObjectId }, user: AuthUser): Promise<void> {
    if (user.scope === Scope.ULB) {
      if (doc.ulb?.toString() !== user.ulb?.toString()) throw new ForbiddenException('Access denied');
      return;
    }
    if (user.scope === Scope.STATE) {
      const ulb = await this.ulbModel.findById(doc.ulb).select('state').lean().exec();
      if (!ulb || ulb.state?.toString() !== user.state?.toString()) {
        throw new ForbiddenException('Access denied');
      }
    }
  }

  private async validateUploadPermission(user: AuthUser, ulbId: string): Promise<void> {
    if (user.accessLevel === 'VIEWER') throw new ForbiddenException('Viewers cannot upload documents');
    if (user.scope === Scope.ULB && user.ulb?.toString() !== ulbId) {
      throw new ForbiddenException('You can only upload documents for your own ULB');
    }
    await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
      ulbId,
      'XVIFC',
      CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
    );
  }

  private assertCanUlbUpload(dur: { currentFormStatus: number; documents: XviFcDur['documents'] }, docId: XviFcDurDocId) {
    if (!canUlbEditForm(dur.currentFormStatus)) {
      throw new ForbiddenException(`This form cannot be edited while its status is ${getFormStatusLabel(dur.currentFormStatus)}.`);
    }
    const docSlot = dur.documents.find((d) => d.docId === docId);
    if (
      isAwaitingManualReviewDecision(docSlot?.currentUpload?.ocrInfo?.isManualReviewRequested, docSlot?.manualReviewDecision)
    ) {
      throw new ForbiddenException('This document is awaiting manual review and cannot be re-uploaded until an ADMIN makes a decision.');
    }
    if (isUploadBlocked(docSlot?.uploadBlockedUntil)) {
      throw new ForbiddenException(UPLOAD_BLOCKED_MESSAGE);
    }
  }

  // ─── Find-or-create ────────────────────────────────────────────────────────

  /** One XviFcDur per {ulb, design_year} — both document slots pre-seeded on creation (unlike
   *  Annual Account's lazily-created sibling, DUR's two docIds are always both present). */
  private async findOrInitialize(ulbId: string, stateId: string, designYearId: string, user: AuthUser): Promise<string> {
    const ulb = await this.ulbModel.findById(new Types.ObjectId(ulbId)).select('state').lean().exec();
    if (!ulb) throw new NotFoundException('ULB not found');
    if (ulb.state?.toString() !== stateId) {
      throw new BadRequestException("stateId does not match this ULB's state");
    }

    const doc = await this.durModel
      .findOneAndUpdate(
        { ulb: new Types.ObjectId(ulbId), design_year: new Types.ObjectId(designYearId) },
        {
          $setOnInsert: {
            state: new Types.ObjectId(stateId),
            currentFormStatus: FORM_STATUS.NOT_STARTED,
            currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.NOT_STARTED),
            documents: DUR_DOC_IDS.map((docId) => ({
              docId,
              uploadStatus: 'NOT_UPLOADED',
              processingStatus: 'NOT_STARTED',
              currentUpload: null,
              stateDecision: null,
              manualReviewDecision: null,
              postRejectionAttemptsUsed: 0,
              manualReviewRejectionCount: 0,
              uploadBlockedUntil: null,
            })),
            createdBy: new Types.ObjectId(user._id),
            modifiedBy: new Types.ObjectId(user._id),
          },
        },
        { upsert: true, new: true },
      )
      .select('_id')
      .lean()
      .exec();

    if (!doc) throw new NotFoundException('DUR form could not be created');
    return doc._id.toString();
  }

  // ─── Confirm upload ────────────────────────────────────────────────────────

  async confirmUpload(dto: ConfirmDurUploadDto, user: AuthUser, ipAddress: string | null, userAgent: string | null) {
    await this.validateUploadPermission(user, dto.ulbId);

    const durId = await this.findOrInitialize(dto.ulbId, dto.stateId, dto.designYearId, user);
    const dur = await this.durModel.findById(new Types.ObjectId(durId)).lean().exec();
    if (!dur) throw new NotFoundException('DUR form not found');
    this.assertCanUlbUpload(dur, dto.docId);

    const expectedKeyPrefix = `xvi-fc/dur/${dto.ulbId}/${dto.designYearId}/${dto.docId}/`;
    if (!dto.s3Key.startsWith(expectedKeyPrefix)) {
      throw new BadRequestException('Invalid s3Key for this upload');
    }

    try {
      await this.s3Service.headObject(dto.s3Key);
    } catch {
      throw new BadRequestException('File not found in S3 — upload may have failed or expired');
    }

    const pdfBuffer = await this.s3Service.getPdfBufferFromS3(dto.s3Key);
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
    const sizeKb = Math.round((dto.fileSize / 1024) * 100) / 100;
    const pages = await this.s3Service.getPdfPageCountFromBuffer(pdfBuffer);

    const docSlot = dur.documents.find((d) => d.docId === dto.docId);
    const version = (docSlot?.currentUpload?.version ?? 0) + 1;
    const versionLabel = `v${version}`;
    const now = new Date();

    const currentUpload = {
      uploadId: dto.uploadId,
      version,
      versionLabel,
      file: {
        originalName: dto.originalName,
        mimeType: 'application/pdf',
        extension: 'pdf',
        pageCount: pages,
        sizeKb,
        path: dto.s3Key,
        sha256,
      },
      ocrInfo: {
        jobId: null,
        status: null,
        progressStep: null,
        submittedAt: null,
        completedAt: null,
        validationStatus: null,
        validationDetails: null,
        failedChecks: [],
        isManualReviewRequested: false,
        manualReviewRequestedAt: null,
      },
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      uploadedAt: now,
      retryValidationCount: 0,
      retryValidationAt: null,
    };

    // The IN_PROGRESS transition + inProgressSince stamp happen once, on the form's first ever
    // touch — mirrors Annual Account's findOrInitialize/upsertDocumentSlot split, simplified here
    // since DUR has no sibling section to juggle.
    await this.durModel.updateOne(
      { _id: dur._id, currentFormStatus: FORM_STATUS.NOT_STARTED },
      {
        $set: {
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
          inProgressSince: now,
        },
      },
    );
    await this.durModel.updateOne(
      { _id: dur._id, financialYear: null },
      { $set: { financialYear: DUR_REPORTING_FINANCIAL_YEAR } },
    );

    await this.durModel.updateOne(
      { _id: dur._id, 'documents.docId': dto.docId },
      {
        $set: {
          'documents.$.currentUpload': currentUpload,
          'documents.$.uploadStatus': 'UPLOADED',
          'documents.$.processingStatus': 'PROCESSING',
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    await this.enqueueValidationJob({
      uploadId: dto.uploadId,
      durId,
      ulbId: dto.ulbId,
      docId: dto.docId,
      s3Key: dto.s3Key,
      financialYear: dto.financialYear,
    });

    this.logger.log(`DUR upload confirmed — durId=${durId} docId=${dto.docId} uploadId=${dto.uploadId}`);

    return { durId, uploadId: dto.uploadId, docId: dto.docId, version, versionLabel, processingStatus: 'PROCESSING', uploadedAt: now };
  }

  // ─── Retry ─────────────────────────────────────────────────────────────────

  async retryUpload(id: string, docId: XviFcDurDocId, user: AuthUser) {
    const dur = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!dur) throw new NotFoundException('DUR form not found');
    await this.validateViewAccess(dur, user);
    this.assertCanUlbUpload(dur, docId);

    const docSlot = dur.documents.find((d) => d.docId === docId);
    if (!docSlot?.currentUpload) throw new NotFoundException('No upload found for this document');

    const retryAt = new Date();
    await this.durModel.updateOne(
      { _id: dur._id, 'documents.docId': docId },
      {
        $set: {
          'documents.$.processingStatus': 'PROCESSING',
          'documents.$.currentUpload.retryValidationAt': retryAt,
        },
        $inc: { 'documents.$.currentUpload.retryValidationCount': 1 },
      },
    );

    await this.enqueueValidationJob({
      uploadId: docSlot.currentUpload.uploadId,
      durId: id,
      ulbId: dur.ulb.toString(),
      docId,
      s3Key: docSlot.currentUpload.file.path,
      financialYear: dur.financialYear ?? '',
    });

    this.logger.log(`DUR retry triggered — durId=${id} docId=${docId}`);
    return this.getProcessingStatus(id, user);
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  async getProcessingStatus(id: string, user: AuthUser) {
    const dur = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!dur) throw new NotFoundException('DUR form not found');
    await this.validateViewAccess(dur, user);

    return {
      id: dur._id.toString(),
      currentFormStatus: dur.currentFormStatus,
      currentFormStatusLabel: dur.currentFormStatusLabel,
      declaredAt: dur.declaredAt,
      stateDecision: dur.stateDecision,
      mohuaDecision: dur.mohuaDecision,
      permissions: this.buildDurPermissions(user, dur.currentFormStatus),
      documents: dur.documents.map((d) => ({
        docId: d.docId,
        label: DUR_DOC_LABELS[d.docId as 'tiedGrant' | 'untiedGrant'],
        uploadStatus: d.uploadStatus,
        processingStatus: d.processingStatus,
        currentUpload: d.currentUpload
          ? {
              ...d.currentUpload,
              file: { ...d.currentUpload.file, fileUrl: this.signDurFileUrl(d.currentUpload.file?.path) },
            }
          : null,
        stateDecision: d.stateDecision,
        manualReviewDecision: d.manualReviewDecision,
        postRejectionAttemptsUsed: d.postRejectionAttemptsUsed,
        manualReviewRejectionCount: d.manualReviewRejectionCount,
        uploadBlockedUntil: d.uploadBlockedUntil,
      })),
    };
  }

  /** Mirrors BankAccountService.buildBankAccountPermissions — status-aware capability flags for
   *  the STATE reviewer UI, computed here so both ULB and STATE callers of getProcessingStatus
   *  get one shared response shape (ULB simply ignores the fields it doesn't use). */
  private buildDurPermissions(user: AuthUser, status: FormStatusType): DurPermissions {
    const hasStateAccess = user.scope === Scope.STATE || user.scope === Scope.ADMIN;
    const perms = getEffectivePermissions(user);
    const reviewable = canStateReviewForm(status);
    const undoable = canStateUndoFormApproval(status);

    return {
      canReview: hasStateAccess && perms.includes(Permission.REVIEW_ULB_SUBMISSIONS) && reviewable,
      canApprove: hasStateAccess && perms.includes(Permission.APPROVE_ULB_SUBMISSIONS) && reviewable,
      canUndoApproval: hasStateAccess && perms.includes(Permission.APPROVE_ULB_SUBMISSIONS) && undoable,
    };
  }

  async findByUlbAndYear(ulbId: string, designYearId: string, user: AuthUser) {
    // Authorize before any read/write below - materializeExemptionStubIfNeeded and
    // revalidateExemptionStubIfNeeded can both write (create or delete a stub), so an out-of-scope
    // caller must be rejected before either ever runs, not after. Only doc.ulb is ever read by
    // validateViewAccess, so a synthetic object works fine before a real document exists.
    await this.validateViewAccess({ ulb: new Types.ObjectId(ulbId) }, user);

    let dur = await this.durModel
      .findOne({ ulb: new Types.ObjectId(ulbId), design_year: new Types.ObjectId(designYearId) })
      .lean()
      .exec();

    // xvi-fc dynamic year access: no record yet - if this ULB is exempted, materialize a stub
    // instead of showing a blank form. Never touches an existing record (see `if (!dur)` above).
    if (!dur) {
      dur = await this.materializeExemptionStubIfNeeded(ulbId, designYearId, user);
    } else if (dur.isExemptionStub) {
      // Existing doc is a stub - an admin may have since undone the exemption. Re-check live state.
      dur = await this.revalidateExemptionStubIfNeeded(dur, ulbId, designYearId);
    }
    if (!dur) return null;

    return this.getProcessingStatus(dur._id.toString(), user);
  }

  /**
   * Called only when no DUR record exists yet for (ulb, design_year). Checks whether this ULB is
   * exempted from DUR this year (dynamic year access) and, if so, upserts an automatic stub
   * (never a real answer, never a ULB action) so findByUlbAndYear returns an already-exempted form
   * instead of a blank one. Returns null (unchanged flow) when not exempted. Mirrors
   * SlbService.materializeExemptionStubIfNeeded, the worked reference implementation documented in
   * src/module/xvi-fc/common/services/CLAUDE.md.
   */
  private async materializeExemptionStubIfNeeded(ulbId: string, designYearId: string, user: AuthUser) {
    const ulbOid = new Types.ObjectId(ulbId);
    const designYearOid = new Types.ObjectId(designYearId);

    const ulb = await this.ulbModel.findById(ulbOid, { startYear: 1, yearAccess: 1, state: 1 }).lean().exec();
    if (!ulb) return null;
    const year = await this.yearModel
      .findById(designYearOid, { year: 1 })
      .lean<{ _id: Types.ObjectId; year: string }>()
      .exec();
    if (!year) return null;

    const exempt = await this.yearAccessService.isFormExempt(ulb, year, DUR_FORM_ID);
    if (!exempt) return null;

    const userOid = new Types.ObjectId(user._id);
    await this.durModel.findOneAndUpdate(
      { ulb: ulbOid, design_year: designYearOid },
      {
        $setOnInsert: {
          state: ulb.state,
          documents: DUR_DOC_IDS.map((docId) => ({
            docId,
            uploadStatus: 'NOT_UPLOADED',
            processingStatus: 'NOT_STARTED',
            currentUpload: null,
            stateDecision: null,
            manualReviewDecision: null,
            postRejectionAttemptsUsed: 0,
            manualReviewRejectionCount: 0,
            uploadBlockedUntil: null,
          })),
          currentFormStatus: FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
          currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.EXEMPTED_ACKNOWLEDGED),
          isExemptionStub: true,
          exemptionMaterializedAt: new Date(),
          createdBy: userOid,
          modifiedBy: userOid,
        },
      },
      { upsert: true },
    );

    return this.durModel.findOne({ ulb: ulbOid, design_year: designYearOid }).lean().exec();
  }

  /**
   * Reverse of materializeExemptionStubIfNeeded - runs whenever an existing doc is a stub, to catch
   * an admin having since undone the exemption. Still-exempt is a no-op; no-longer-exempt deletes
   * the stub (never rewritten to NOT_STARTED - that status is never persisted, see ulb.service.ts's
   * assertNoRealSubmissionsForExemptedForms) so findByUlbAndYear falls back to the same
   * never-visited-ULB path. isExemptionStub:true in the delete filter guards against a real
   * submission racing in between the live check and the delete.
   */
  private async revalidateExemptionStubIfNeeded<T extends { _id: Types.ObjectId; isExemptionStub?: boolean }>(
    dur: T,
    ulbId: string,
    designYearId: string,
  ): Promise<T | null> {
    const ulbOid = new Types.ObjectId(ulbId);
    const designYearOid = new Types.ObjectId(designYearId);

    const ulb = await this.ulbModel.findById(ulbOid, { startYear: 1, yearAccess: 1 }).lean().exec();
    const year = await this.yearModel
      .findById(designYearOid, { year: 1 })
      .lean<{ _id: Types.ObjectId; year: string }>()
      .exec();
    if (ulb && year && (await this.yearAccessService.isFormExempt(ulb, year, DUR_FORM_ID))) return dur;

    await this.durModel.deleteOne({ _id: dur._id, isExemptionStub: true });
    return null;
  }

  // ─── Submit to STATE ───────────────────────────────────────────────────────

  async submitToState(id: string, dto: SubmitDurDto, user: AuthUser) {
    if (user.scope !== Scope.ULB) throw new ForbiddenException('Only ULB users can submit the DUR form');

    const dur = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!dur) throw new NotFoundException('DUR form not found');
    if (dur.ulb.toString() !== user.ulb?.toString()) throw new ForbiddenException('Access denied');
    if (!canUlbEditForm(dur.currentFormStatus)) {
      throw new ForbiddenException(`This form cannot be submitted while its status is ${dur.currentFormStatusLabel}.`);
    }

    const notPassed = dur.documents.filter((d) => d.processingStatus !== 'PASSED');
    if (notPassed.length > 0) {
      throw new BadRequestException(
        `All documents must pass validation before submitting. Pending: ${notPassed.map((d) => d.docId).join(', ')}`,
      );
    }

    const now = new Date();
    await this.durModel.updateOne(
      { _id: dur._id },
      {
        $set: {
          declaredBy: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress: null, userAgent: null },
          declaredAt: now,
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
          currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_STATE),
          modifiedBy: new Types.ObjectId(user._id),
        },
      },
    );

    await this.formLogModel.create({
      durId: dur._id,
      ulb: dur.ulb,
      designYear: dur.design_year,
      action: 'SUBMITTED',
      toStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      toStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_STATE),
      actorStage: 'ULB',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, name: null, ipAddress: null, userAgent: null },
    });

    this.logger.log(`DUR submitted to STATE — durId=${id}`);
    return this.getProcessingStatus(id, user);
  }

  // ─── STATE review decision ───────────────────────────────────────────────────

  async decideDur(
    id: string,
    dto: DurDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
    batchId: string | null = null,
  ): Promise<XviFcApiResponse<{ id: string; currentFormStatus: FormStatusType; currentFormStatusLabel: string }>> {
    const record = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!record) throw new NotFoundException('DUR form not found');
    await this.assertCanStateDecideDur(user, record);

    const newStatus = dto.decision === 'APPROVED' ? FORM_STATUS.APPROVED_BY_STATE : FORM_STATUS.RETURNED_BY_STATE;
    assertValidFormStatusTransition(record.currentFormStatus, newStatus);

    const deciderName = await resolveDeciderName(this.userModel, user._id);
    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent, deciderName);

    const updated = await this.durModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            currentFormStatus: newStatus,
            currentFormStatusLabel: getFormStatusLabel(newStatus),
            stateDecision: decision,
            modifiedBy: new Types.ObjectId(user._id),
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('DUR form not found');

    await this.formLogModel.create({
      durId: new Types.ObjectId(id),
      ulb: record.ulb,
      designYear: record.design_year,
      action: dto.decision,
      toStatus: newStatus,
      toStatusLabel: getFormStatusLabel(newStatus),
      actorStage: 'STATE',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      ...(dto.note != null && { note: dto.note }),
      ...(batchId != null && { batchId }),
    });

    this.logger.log(`DUR ${dto.decision.toLowerCase()} by STATE — id=${id} by user=${user._id}`);

    if (newStatus === FORM_STATUS.RETURNED_BY_STATE) {
      void this.formReturnedNotification.notifyReturned({
        ulbId: record.ulb,
        formName: 'Detailed Utilisation Report',
        note: dto.note ?? null,
      });
    }

    return xviFcSuccess('DUR decision recorded.', {
      id: updated._id.toString(),
      currentFormStatus: updated.currentFormStatus,
      currentFormStatusLabel: updated.currentFormStatusLabel,
    });
  }

  /**
   * Reverses a STATE-level Approve decision — only legal while the form is exactly
   * APPROVED_BY_STATE. Mirrors BankAccountService.undoApproval: one atomic write straight back to
   * UNDER_REVIEW_BY_STATE — status UNDO (10) never actually lives on the main record, it appears
   * only as the `toStatus` of the first of two form-log entries this writes (UNDO, then
   * UNDER_REVIEW_BY_STATE).
   */
  async undoDurApproval(
    id: string,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<XviFcApiResponse<{ id: string; currentFormStatus: FormStatusType; currentFormStatusLabel: string }>> {
    const record = await this.durModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!record) throw new NotFoundException('DUR form not found');
    await this.assertCanUndoDurApproval(user, record);

    assertValidFormStatusTransition(record.currentFormStatus, FORM_STATUS.UNDER_REVIEW_BY_STATE);

    const updated = await this.durModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
            currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_STATE),
            stateDecision: null,
            // Restart the STATE review digest's dwell clock — an undone approval goes back on
            // the pending-review pile today, not however many days ago it first entered review.
            declaredAt: new Date(),
            lastReminderSentAt: null,
            modifiedBy: new Types.ObjectId(user._id),
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('DUR form not found');

    const logBase = {
      durId: new Types.ObjectId(id),
      ulb: record.ulb,
      designYear: record.design_year,
      action: 'UNDO' as const,
      actorStage: 'STATE' as const,
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
    };

    await this.formLogModel.create({
      ...logBase,
      toStatus: FORM_STATUS.UNDO,
      toStatusLabel: getFormStatusLabel(FORM_STATUS.UNDO),
    });
    await this.formLogModel.create({
      ...logBase,
      toStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      toStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_STATE),
    });

    this.logger.log(`DUR approval undone by STATE — id=${id} by user=${user._id}`);
    return xviFcSuccess('DUR approval undone.', {
      id: updated._id.toString(),
      currentFormStatus: updated.currentFormStatus,
      currentFormStatusLabel: updated.currentFormStatusLabel,
    });
  }

  private async assertCanStateDecideDur(
    user: AuthUser,
    record: { ulb: Types.ObjectId; currentFormStatus: FormStatusType },
  ): Promise<void> {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may decide DUR forms');
    }
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      const ulb = await this.ulbModel.findById(record.ulb, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!userStateId || !ulbStateId || userStateId !== ulbStateId) {
        throw new ForbiddenException('You can only decide DUR forms within your own state');
      }
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }
    if (record.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_STATE) {
      throw new ForbiddenException(
        `This form cannot be decided while its status is ${getFormStatusLabel(record.currentFormStatus)}.`,
      );
    }
  }

  private async assertCanUndoDurApproval(
    user: AuthUser,
    record: { ulb: Types.ObjectId; currentFormStatus: FormStatusType },
  ): Promise<void> {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may undo DUR decisions');
    }
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      const ulb = await this.ulbModel.findById(record.ulb, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!userStateId || !ulbStateId || userStateId !== ulbStateId) {
        throw new ForbiddenException('You can only decide DUR forms within your own state');
      }
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to approve ULB submissions');
    }
    if (record.currentFormStatus !== FORM_STATUS.APPROVED_BY_STATE) {
      throw new ForbiddenException(
        `This form's approval cannot be undone while its status is ${getFormStatusLabel(record.currentFormStatus)}.`,
      );
    }
  }

  // ─── Bulk STATE review decision ───────────────────────────────────────────────

  async bulkDecideDur(
    dto: BulkDurDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<XviFcApiResponse<BulkDecisionResult>> {
    const result = await runBulkDecision(dto.ids, (id, batchId) =>
      this.decideDur(id, { decision: dto.decision, note: dto.note }, user, ipAddress, userAgent, batchId),
    );

    this.logger.log(
      `Bulk DUR decision — batchId=${result.batchId} decision=${dto.decision} succeeded=${result.succeeded}/${dto.ids.length} by user=${user._id}`,
    );

    return xviFcSuccess('Bulk decision processed.', result);
  }

  // ─── State-scoped ULB submissions list ───────────────────────────────────────

  /**
   * Paginated list of every ULB in the requester's state for a given design year, joined against
   * that ULB's DUR status. ULB is the primary collection (left-joined to the DUR doc) so ULBs
   * that haven't started still appear, reported as NOT_STARTED. Mirrors
   * BankAccountService.listUlbBankAccounts exactly.
   */
  async listUlbSubmissions(
    dto: DurUlbSubmissionsQueryDto,
    user: AuthUser,
  ): Promise<
    XviFcApiResponse<{
      total: number;
      page: number;
      pageSize: number;
      rows: DurSubmissionRow[];
      counts: Record<FormStatusType, number>;
    }>
  > {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may list ULB submissions');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }

    const stateId = resolveStateScopeFilter(user, dto.stateId);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (stateId) matchStage.state = stateId;
    if (dto.search?.trim()) {
      const regex = new RegExp(escapeRegex(dto.search.trim()), 'i');
      matchStage.$or = [{ name: regex }, { code: regex }];
    }

    const sortField = dto.sortField ?? 'ulbName';
    const sortDirection = dto.sortDirection === 'desc' ? -1 : 1;
    const sortStage: Record<string, 1 | -1> =
      sortField === 'formStatus' ? { formStatus: sortDirection } : { name: sortDirection };

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const designYearObjectId = new Types.ObjectId(dto.designYearId);

    // xvi-fc dynamic year access: resolve exemption for the whole candidate set up front (not just
    // the current page) - see a correct formStatus for a ULB that's exempt but has never opened its
    // DUR form (no document exists yet to carry EXEMPTED_ACKNOWLEDGED). One extra Ulb query reusing
    // this same matchStage, never one query per ULB. Read-only - see ExemptionResolverService.
    const designYear = await this.yearModel
      .findById(designYearObjectId, { year: 1 })
      .lean<{ _id: Types.ObjectId; year: string }>()
      .exec();
    const candidateUlbs: UlbAccessInput[] = designYear
      ? await this.ulbModel.find(matchStage, { startYear: 1, yearAccess: 1 }).lean().exec()
      : [];
    const exemptionByUlbId: Map<string, ExemptionResolution> = designYear
      ? await this.exemptionResolverService.resolveBulk(candidateUlbs, designYear, DUR_FORM_ID)
      : new Map();
    const exemptUlbIds = candidateUlbs
      .filter((ulb) => exemptionByUlbId.get(String(ulb._id))?.exempted)
      .map((ulb) => ulb._id);

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'xvifc_dur_forms',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$ulb', '$$ulbId'] }, { $eq: ['$design_year', designYearObjectId] }] },
              },
            },
          ],
          as: 'dur',
        },
      },
      { $addFields: { dur: { $arrayElemAt: ['$dur', 0] } } },
      {
        $addFields: {
          // A joined doc that's a stale exemption stub (admin undid the exemption, nobody has
          // revisited the form yet) must not be trusted as-is - fall through to the same live
          // exemptUlbIds check used when no doc exists at all.
          formStatus: {
            $cond: [
              { $and: [{ $ne: ['$dur', null] }, { $ne: ['$dur.isExemptionStub', true] }] },
              '$dur.currentFormStatus',
              { $cond: [{ $in: ['$_id', exemptUlbIds] }, FORM_STATUS.EXEMPTED_ACKNOWLEDGED, FORM_STATUS.NOT_STARTED] },
            ],
          },
          lastUpdatedAt: { $ifNull: ['$dur.updatedAt', null] },
          enteredReviewAt: { $ifNull: ['$dur.declaredAt', null] },
        },
      },
    ];

    const statusMatch: PipelineStage.FacetPipelineStage[] =
      dto.status?.length ? [{ $match: { formStatus: { $in: dto.status } } }] : [];

    pipeline.push({
      $facet: {
        data: [
          ...statusMatch,
          { $sort: sortStage },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              ulbId: '$_id',
              ulbCode: '$code',
              censusCode: { $ifNull: ['$censusCode', '$sbCode'] },
              ulbName: '$name',
              formStatus: 1,
              lastUpdatedAt: 1,
              enteredReviewAt: 1,
              durId: { $ifNull: ['$dur._id', null] },
            },
          },
        ],
        totalCount: [...statusMatch, { $count: 'count' }],
        counts: [{ $group: { _id: '$formStatus', count: { $sum: 1 } } }],
      },
    });

    const [result] = await this.ulbModel.aggregate<DurSubmissionsFacetResult>(pipeline).exec();
    const rows = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    const counts = Object.fromEntries(
      Object.values(FORM_STATUS)
        .filter((status): status is FormStatusType => status !== FORM_STATUS.NO_STATUS)
        .map((status) => [status, result?.counts.find((c) => c._id === status)?.count ?? 0]),
    ) as Record<FormStatusType, number>;

    return xviFcSuccess('ULB DUR submissions fetched.', { total, page, pageSize, rows, counts });
  }

  // ─── Form log / audit trail ───────────────────────────────────────────────────

  async getDurFormLogs(id: string, user: AuthUser): Promise<XviFcApiResponse<DurFormLogEntry[]>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid DUR id.');
    }

    const record = await this.durModel.findById(id, 'ulb').lean().exec();
    if (!record) throw new NotFoundException('DUR form not found');
    await this.assertCanViewDurFormLogs(user, record);

    const logs = await this.formLogModel
      .find({ durId: new Types.ObjectId(id) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return xviFcSuccess(
      'DUR form log fetched.',
      logs.map((log) => ({
        action: log.action,
        toStatus: log.toStatus,
        toStatusLabel: log.toStatusLabel,
        actorStage: log.actorStage,
        actorRole: log.userInfo.role,
        note: log.note ?? null,
        batchId: log.batchId ?? null,
        createdAt: (log as unknown as { createdAt: Date }).createdAt,
      })),
    );
  }

  /** Read-only history view — STATE/MOHUA/ADMIN reviewers only, no form-status gating (unlike decide). */
  private async assertCanViewDurFormLogs(user: AuthUser, record: { ulb: Types.ObjectId }): Promise<void> {
    if (user.scope === Scope.ADMIN) return;

    const perms = getEffectivePermissions(user);

    if (user.scope === Scope.STATE) {
      if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
        throw new ForbiddenException('You do not have permission to review ULB submissions');
      }
      const userStateId = toObjectIdString(user.state);
      const ulb = await this.ulbModel.findById(record.ulb, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!userStateId || !ulbStateId || userStateId !== ulbStateId) {
        throw new ForbiddenException('You can only view DUR forms within your own state');
      }
      return;
    }

    if (user.scope === Scope.MOHUA) {
      if (!perms.includes(Permission.REVIEW_STATE_SUBMISSIONS)) {
        throw new ForbiddenException('You do not have permission to review state submissions');
      }
      return;
    }

    throw new ForbiddenException('Access denied.');
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async enqueueValidationJob(data: DurValidationJobData) {
    // DUR's financial year is a form-wide constant (see DUR_REPORTING_FINANCIAL_YEAR), never a
    // per-request value — overridden here, the one place both confirmUpload and retryUpload
    // funnel through before hitting the API, so any existing record still carrying a wrong or
    // "FY-"-prefixed value (client-supplied, pre-fix) self-heals on its next retry too.
    await this.durQueue.add(
      `dur-${data.docId}-${data.uploadId}`,
      { ...data, financialYear: DUR_REPORTING_FINANCIAL_YEAR },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }
}
