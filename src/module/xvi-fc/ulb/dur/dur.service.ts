import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { canUlbEditForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { S3Service } from 'src/core/s3/s3.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { XviFcDur, XviFcDurDocument, DUR_DOC_IDS, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';
import { XviFcDurFormLog, XviFcDurFormLogDocument } from 'src/schemas/xvi-fc/dur-form-log.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';
import { DUR_VALIDATION_QUEUE } from 'src/core/constants/queues';
import { DocumentActionGatesService } from 'src/module/xvi-fc/common/services/document-action-gates.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import {
  isAwaitingManualReviewDecision,
  isUploadBlocked,
  UPLOAD_BLOCKED_MESSAGE,
} from 'src/common/utils/manual-review-cooldown.util';
import { ConfirmDurUploadDto } from './dto/confirm-dur-upload.dto';
import { SubmitDurDto } from './dto/submit-dur.dto';
import type { DurValidationJobData } from './dto/dur-validation-job.dto';
import { DUR_DOC_LABELS, DUR_FORM_ID, DUR_REPORTING_FINANCIAL_YEAR } from './constants/dur-form.constants';

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

    private readonly s3Service: S3Service,

    @InjectQueue(DUR_VALIDATION_QUEUE)
    private readonly durQueue: Queue<DurValidationJobData>,

    private readonly ulbEligibilityService: UlbEligibilityService,

    private readonly documentActionGates: DocumentActionGatesService,

    private readonly formJsonService: FormJsonService,
  ) {}

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
      documents: dur.documents.map((d) => ({
        docId: d.docId,
        label: DUR_DOC_LABELS[d.docId as 'tiedGrant' | 'untiedGrant'],
        uploadStatus: d.uploadStatus,
        processingStatus: d.processingStatus,
        currentUpload: d.currentUpload,
        stateDecision: d.stateDecision,
        manualReviewDecision: d.manualReviewDecision,
        postRejectionAttemptsUsed: d.postRejectionAttemptsUsed,
        manualReviewRejectionCount: d.manualReviewRejectionCount,
        uploadBlockedUntil: d.uploadBlockedUntil,
      })),
    };
  }

  async findByUlbAndYear(ulbId: string, designYearId: string, user: AuthUser) {
    const dur = await this.durModel
      .findOne({ ulb: new Types.ObjectId(ulbId), design_year: new Types.ObjectId(designYearId) })
      .lean()
      .exec();
    if (!dur) return null;
    await this.validateViewAccess(dur, user);
    return this.getProcessingStatus(dur._id.toString(), user);
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
