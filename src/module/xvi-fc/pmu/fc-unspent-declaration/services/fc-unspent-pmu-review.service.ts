import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { assertCanPmuMutateForm, canPmuViewForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import {
  assertPmuOrMohuaViewerAccess,
  assertPmuReviewerAccess,
} from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { buildPmuReviewerFormPermissions } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-permissions.util';
import { buildPmuWorklistRows } from 'src/module/xvi-fc/common/utils/pmu-worklist.util';
import type { GetPmuWorklistQueryDto } from 'src/module/xvi-fc/common/dto/get-pmu-worklist-query.dto';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { FileInfo } from 'src/schemas/common/file.schema';
import { YearIdToLabel } from 'src/core/constants/years';
import { FcUnspentDeclarationFormJsonService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/form-json/fc-unspent-declaration-form-json.service';
import { getFcUnspentFieldsByType } from 'src/module/xvi-fc/state/fc-unspent-declaration/helpers/fc-unspent-declaration-form-json.helpers';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  ApplicableFc,
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL } from 'src/module/xvi-fc/state/fc-unspent-declaration/constants/fc-unspent-declaration.constants';
import { FcUnspentPmuRowReviewDomainService } from './fc-unspent-pmu-row-review-domain.service';
import type {
  FcUnspentPmuFormLean,
  FcUnspentPmuReviewData,
  FcUnspentPmuSubmitData,
} from '../types/fc-unspent-pmu-review.types';
import type { PmuWorklistData } from 'src/module/xvi-fc/common/types/pmu-worklist.type';
import { State, StateDocument } from 'src/schemas/state.schema';

type PmuFormLeanWithPopulate = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
  currentFormStatus?: number;
  isFcUnspent?: boolean | null;
  fcDeclaration?: FileInfo | null;
  fcUnspentDeclaration?: FileInfo | null;
  checkboxConfirmation?: boolean;
  pmuRemarks?: string | null;
};

/** Form-level PMU review concerns: review metadata (GET) and complete-form approve/reject. See
 *  CLAUDE.md's "Layout" and "PMU vs MoHUA" sections for how this relates to the untouched
 *  mohua/fc-unspent-declaration module. */
@Injectable()
export class FcUnspentPmuReviewService {
  constructor(
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly formModel: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    private readonly domainService: FcUnspentPmuRowReviewDomainService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
    private readonly formQuestionHydrator: FormQuestionHydratorService,
    private readonly formJsonConfigService: FcUnspentDeclarationFormJsonService,
  ) {}

  /** Cross-state worklist backing the PMU worklist page — join/NOT_STARTED mechanics live in the
   *  shared `buildPmuWorklistRows()` (see that function's own docblock). Declared before
   *  `getReviewMetadata` for the same controller route-ordering reason — see CLAUDE.md's "Layout"
   *  section. */
  async getWorklist(
    yearId: string,
    query: GetPmuWorklistQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<PmuWorklistData>> {
    assertPmuReviewerAccess(user);

    const { rows, page, limit, total } = await buildPmuWorklistRows({
      stateModel: this.stateModel,
      formModel: this.formModel,
      yearId,
      extraFormFilter: { formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false },
      stateId: query.stateId,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      limit: query.limit,
    });

    return xviFcSuccess('FC Unspent Declaration PMU worklist fetched.', { rows }, { page, limit, total });
  }

  /** PMU review metadata only — no row list (see `FcUnspentPmuRowsService.getRows`); view-gated by
   *  `canPmuViewForm`, 403s otherwise. */
  async getReviewMetadata(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentPmuReviewData>> {
    assertPmuOrMohuaViewerAccess(user);

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
      .lean<PmuFormLeanWithPopulate>()
      .exec();

    if (!doc) {
      throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    }

    const currentFormStatus = doc.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    if (!canPmuViewForm(currentFormStatus)) {
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

    const permissions = buildPmuReviewerFormPermissions(user, currentFormStatus, { includeRowReview: true });

    const { fields: allFields, thresholdPercent: threshold } = await this.formJsonConfigService.loadFormConfig(yearId);
    const questionsConfig = getFcUnspentFieldsByType(allFields, 'FC_UNSPENT_MAIN_FORM_FIELDS');

    const savedData: Record<string, unknown> = {};
    // Convert the stored boolean to 'yes'/'no' for display, mirroring state-side getForm's hydration.
    if (doc.isFcUnspent !== undefined) {
      savedData['isFcUnspent'] = doc.isFcUnspent === true ? 'yes' : doc.isFcUnspent === false ? 'no' : null;
    }
    if (doc.fcDeclaration !== undefined) savedData['fcDeclaration'] = doc.fcDeclaration;
    if (doc.fcUnspentDeclaration !== undefined) savedData['fcUnspentDeclaration'] = doc.fcUnspentDeclaration;
    if (doc.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;

    const questions = this.formQuestionHydrator.hydrate(questionsConfig, savedData);

    const data: FcUnspentPmuReviewData = {
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
      pmuRemarks: doc.pmuRemarks ?? null,
      threshold,
      questions,
      rowSummary,
      permissions,
      actors,
    };

    return xviFcSuccess('FC Unspent Declaration PMU review metadata fetched.', data);
  }

  /** See CLAUDE.md's "The complete-form approve/reject branch logic" section — mirrors
   *  `FcUnspentMohuaReviewService.approveCompleteForm` one stage earlier. */
  async approveCompleteForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    if (form.isFcUnspent === false) {
      if (!form.fcDeclaration) {
        throwXviFcValidationError({
          _form: [{ code: 'declarationMissing', message: 'The stored declaration file could not be found.' }],
        });
      }
      return this.approveDirectly(form, applicableFc, user, ip, userAgent);
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
      (r) => r.rowStatus !== FORM_STATUS.UNDER_REVIEW_BY_PMU && r.rowStatus !== FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
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

    const toApprove = activeRows.filter((r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    // PMU has no status of its own once approved — see CLAUDE.md's "PMU vs MoHUA" section.
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const newAuditRevision = form.auditRevision + 1;

    const session = await this.formModel.db.startSession();
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        toApprove.map((row) => ({ row, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null })),
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

  /** Requires a non-empty `pmuRemarks`. See CLAUDE.md's "The complete-form approve/reject branch
   *  logic" section for the already-approved-rows block. */
  async rejectCompleteForm(
    stateId: string,
    yearId: string,
    pmuRemarks: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const trimmedRemarks = pmuRemarks?.trim();
    if (!trimmedRemarks) {
      throwXviFcValidationError({
        pmuRemarks: [{ field: 'pmuRemarks', code: 'required', message: 'A rejection remark is required.' }],
      });
    }

    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.RETURNED_BY_PMU;
    const newAuditRevision = form.auditRevision + 1;

    let toReject: Awaited<ReturnType<FcUnspentPmuRowReviewDomainService['getActiveRows']>> = [];
    if (form.isFcUnspent === true) {
      const activeRows = await this.domainService.getActiveRows(form._id);
      const alreadyActive = activeRows.filter((r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
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
      toReject = activeRows.filter((r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU);
    }

    const session = await this.formModel.db.startSession();
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        toReject.map((row) => ({ row, newStatus: FORM_STATUS.RETURNED_BY_PMU, rejectionRemark: trimmedRemarks })),
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
        trimmedRemarks,
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

  private async approveDirectly(
    form: FcUnspentPmuFormLean,
    applicableFc: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentPmuSubmitData>> {
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    // PMU has no status of its own once approved — see CLAUDE.md's "PMU vs MoHUA" section.
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
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
}
