import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanMohuaMutateForm,
  canMohuaMutateForm,
  canMohuaViewForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { FileInfo } from 'src/schemas/common/file.schema';
import { YearIdToLabel } from 'src/core/constants/years';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  ApplicableFc,
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL } from 'src/module/xvi-fc/state/fc-unspent-declaration/constants/fc-unspent-declaration.constants';
import { FcUnspentRowReviewDomainService } from './fc-unspent-row-review-domain.service';
import type {
  FcUnspentMohuaFormLean,
  FcUnspentMohuaReviewData,
  FcUnspentMohuaReviewPermissions,
  FcUnspentMohuaSubmitData,
} from '../types/fc-unspent-mohua-review.types';

type MohuaFormLeanWithPopulate = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
  currentFormStatus?: number;
  isFcUnspent?: boolean | null;
  fcDeclaration?: FileInfo | null;
  checkboxConfirmation?: boolean;
};

/**
 * FC Unspent Declaration MoHUA review — form-level concerns: review metadata (GET) and complete-
 * form approve/reject. Row-level concerns (paginated list, bulk approve/reject) live in
 * `FcUnspentMohuaRowsService`. Both delegate row transitions/history/parent-completion to the
 * shared `FcUnspentRowReviewDomainService`.
 */
@Injectable()
export class FcUnspentMohuaReviewService {
  constructor(
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly formModel: Model<XviFcUnspentStateFormDocument>,
    private readonly domainService: FcUnspentRowReviewDomainService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
  ) {}

  /**
   * Returns MoHUA review metadata for a state/year FC Unspent Declaration. Never includes the
   * full row list — that is served by `FcUnspentMohuaRowsService.getRows`. Only forms at
   * `UNDER_REVIEW_BY_MOHUA` or `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` are viewable; anything earlier
   * (never yet submitted to MoHUA) 404s.
   */
  async getReviewMetadata(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentMohuaReviewData>> {
    this.assertReviewAccess(user);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const doc = await this.formModel
      .findOne({ state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<MohuaFormLeanWithPopulate>()
      .exec();

    if (!doc) {
      throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    }

    const currentFormStatus = doc.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    if (!canMohuaViewForm(currentFormStatus)) {
      throw new ForbiddenException(
        `Form is not yet reviewable when status is ${getFormStatusLabel(currentFormStatus)}.`,
      );
    }

    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);

    const rowSummary =
      doc.isFcUnspent === true
        ? await this.domainService.getRowSummary(doc._id)
        : { total: 0, active: 0, updatePending: 0, rejected: 0, needsUpdate: 0, eligible: 0, ineligible: 0 };

    const hydratedDeclaration = this.fileInfoNormalizer.hydrateFileInfoForResponse(doc.fcDeclaration ?? null, (p) =>
      this.signStorageFileUrl(p),
    );

    const permissions = this.buildPermissions(user, currentFormStatus);

    const data: FcUnspentMohuaReviewData = {
      formId: String(doc._id),
      stateId,
      stateName,
      yearId,
      designYear,
      applicableFc,
      isFcUnspent: doc.isFcUnspent ?? null,
      fcDeclaration: hydratedDeclaration,
      checkboxConfirmation: doc.checkboxConfirmation ?? false,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      threshold: 10,
      rowSummary,
      permissions,
      actors,
    };

    return xviFcSuccess('FC Unspent Declaration MoHUA review metadata fetched.', data);
  }

  /**
   * Approves the complete form. No-branch: requires the persisted declaration to still exist,
   * then acknowledges directly (no rows). Yes-branch: requires at least one active row, blocks if
   * any active row is REJECTED/NEEDS_UPDATE/null, transitions the remaining UPDATE_PENDING rows to
   * ACTIVE (already-ACTIVE rows untouched, no duplicate history), then acknowledges.
   */
  async approveCompleteForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentMohuaSubmitData>> {
    this.assertReviewAccess(user);

    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanMohuaMutateForm(form.currentFormStatus);

    if (form.isFcUnspent === false) {
      if (!form.fcDeclaration) {
        throwXviFcValidationError({
          _form: [{ code: 'declarationMissing', message: 'The stored declaration file could not be found.' }],
        });
      }
      return this.acknowledgeDirectly(form, applicableFc, user, ip, userAgent);
    }

    if (form.isFcUnspent !== true) {
      throwXviFcValidationError({
        _form: [{ code: 'branchUndecided', message: 'Form has no decided Yes/No branch to approve.' }],
      });
    }

    const activeRows = await this.domainService.getActiveRows(form._id);
    if (activeRows.length === 0) {
      throwXviFcValidationError({
        _form: [{ code: 'noRows', message: 'This form has no active rows to approve.' }],
      });
    }

    const blocking = activeRows.filter(
      (r) => r.rowStatus !== FORM_STATUS.UNDER_REVIEW_BY_MOHUA && r.rowStatus !== FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    );
    if (blocking.length > 0) {
      throwXviFcValidationError({
        _form: [
          {
            code: 'rowsNotApprovable',
            message:
              'One or more rows are rejected, need update, or have not been submitted for review. Resolve them via row-level review before approving the complete form.',
          },
        ],
      });
    }

    const toApprove = activeRows.filter((r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
    const newAuditRevision = form.auditRevision + 1;

    const session = await this.formModel.db.startSession();
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        toApprove.map((row) => ({ row, newStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, rejectionRemark: null })),
        userOid,
        ip,
        userAgent,
        session,
      );

      await this.domainService.transitionParent(form._id, toStatus, undefined, newAuditRevision, userOid, session);
      await this.domainService.insertParentHistory(
        form,
        fromStatus,
        toStatus,
        newAuditRevision,
        applicableFc,
        userOid,
        ip,
        userAgent,
        session,
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('FC Unspent Declaration form approved.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  /**
   * Rejects the complete form (requires a non-empty `mohuaRemarks`). No-branch: returns directly
   * to RETURNED_BY_MOHUA. Yes-branch: allowed only when no active row has already reached ACTIVE
   * (to avoid regressing independently-approved rows) — remaining UPDATE_PENDING rows transition
   * to REJECTED with the same remark; already-REJECTED rows are left untouched (no duplicate history).
   */
  async rejectCompleteForm(
    stateId: string,
    yearId: string,
    mohuaRemarks: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentMohuaSubmitData>> {
    this.assertReviewAccess(user);

    const trimmedRemarks = mohuaRemarks?.trim();
    if (!trimmedRemarks) {
      throwXviFcValidationError({
        mohuaRemarks: [{ field: 'mohuaRemarks', code: 'required', message: 'A rejection remark is required.' }],
      });
    }

    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanMohuaMutateForm(form.currentFormStatus);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.RETURNED_BY_MOHUA;
    const newAuditRevision = form.auditRevision + 1;

    let toReject: Awaited<ReturnType<FcUnspentRowReviewDomainService['getActiveRows']>> = [];
    if (form.isFcUnspent === true) {
      const activeRows = await this.domainService.getActiveRows(form._id);
      const alreadyActive = activeRows.filter((r) => r.rowStatus === FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
      if (alreadyActive.length > 0) {
        throwXviFcValidationError({
          _form: [
            {
              code: 'rowsAlreadyApproved',
              message:
                'One or more rows have already been approved. Use row-level review to reject the remaining pending rows instead of rejecting the complete form.',
            },
          ],
        });
      }
      toReject = activeRows.filter((r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    }

    const session = await this.formModel.db.startSession();
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        toReject.map((row) => ({ row, newStatus: FORM_STATUS.RETURNED_BY_MOHUA, rejectionRemark: trimmedRemarks })),
        userOid,
        ip,
        userAgent,
        session,
      );

      await this.domainService.transitionParent(form._id, toStatus, trimmedRemarks, newAuditRevision, userOid, session);
      await this.domainService.insertParentHistory(
        form,
        fromStatus,
        toStatus,
        newAuditRevision,
        applicableFc,
        userOid,
        ip,
        userAgent,
        session,
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('FC Unspent Declaration form rejected.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async acknowledgeDirectly(
    form: FcUnspentMohuaFormLean,
    applicableFc: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentMohuaSubmitData>> {
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
    const newAuditRevision = form.auditRevision + 1;

    const session = await this.formModel.db.startSession();
    try {
      session.startTransaction();
      await this.domainService.transitionParent(form._id, toStatus, undefined, newAuditRevision, userOid, session);
      await this.domainService.insertParentHistory(
        form,
        fromStatus,
        toStatus,
        newAuditRevision,
        applicableFc,
        userOid,
        ip,
        userAgent,
        session,
      );
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('FC Unspent Declaration form approved.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  private buildPermissions(user: AuthUser, status: number): FcUnspentMohuaReviewPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const canView = perms.has(Permission.REVIEW_STATE_SUBMISSIONS) && canMohuaViewForm(status);
    const canMutate = perms.has(Permission.APPROVE_STATE_SUBMISSIONS) && canMohuaMutateForm(status);
    return {
      canView,
      canApproveForm: canMutate,
      canRejectForm: canMutate,
      canReviewRows: canMutate,
    };
  }

  private resolveApplicableFc(designYear: string): ApplicableFc {
    const applicableFc = FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYear];
    if (!applicableFc) throw new NotFoundException(`No applicable FC mapping for design year: ${designYear}`);
    return applicableFc;
  }

  /** Never persisted — GET-only signed URL for the stored raw S3-relative path. */
  private signStorageFileUrl(path: string): string {
    try {
      return this.fileTokenService.signFileUrl(path);
    } catch {
      return path;
    }
  }

  private assertReviewAccess(user: AuthUser): void {
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only MoHUA or admin users may review state submissions.');
    }
  }
}
