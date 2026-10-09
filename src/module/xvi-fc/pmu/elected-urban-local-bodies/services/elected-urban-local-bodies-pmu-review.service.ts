import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { assertCanPmuMutateForm, canPmuViewForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import {
  assertPmuOrMohuaViewerAccess,
  assertPmuReviewerAccess,
} from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { buildPmuReviewerFormPermissions } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-permissions.util';
import { buildPmuWorklistRows } from 'src/module/xvi-fc/common/utils/pmu-worklist.util';
import type { GetPmuWorklistQueryDto } from 'src/module/xvi-fc/common/dto/get-pmu-worklist-query.dto';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
  EulbFormDocument,
  EulbValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesPmuRowReviewDomainService } from './elected-urban-local-bodies-pmu-row-review-domain.service';
import type { EulbPmuReviewData, EulbPmuSubmitData } from '../types/elected-urban-local-bodies-pmu-review.types';
import type { PmuWorklistData } from 'src/module/xvi-fc/common/types/pmu-worklist.type';

type PmuFormLeanWithPopulate = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
  currentFormStatus?: number;
  activeDatasetVersion?: number;
  checkboxConfirmation?: boolean;
  electedBodyExcelFile?: unknown;
  signedElectedbodyFile?: unknown;
  pmuRemarks?: string | null;
  validationStatus?: EulbValidationStatus;
};

/**
 * Form-level PMU review concerns: review metadata (GET) and complete-form approve/reject. EULB has
 * no MoHUA-reviewer precedent to mirror (unlike FC Unspent) — no MoHUA review module exists for
 * this form (see elected-urban-local-bodies/CLAUDE.md's "Row-level review status" section) — so
 * this is a genuinely new workflow, not a parallel stage. Simpler than FC Unspent's own review
 * service: EULB has no Yes/No branch, every submitted form has rows.
 */
@Injectable()
export class ElectedUrbanLocalBodiesPmuReviewService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly formModel: Model<EulbFormDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    private readonly domainService: ElectedUrbanLocalBodiesPmuRowReviewDomainService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly formQuestionHydrator: FormQuestionHydratorService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  /** Cross-state worklist: every active+published state left-joined against its EULB document (if
   *  any) for the year, with a synthesized `NOT_STARTED` row where none exists yet — see CLAUDE.md's
   *  "Worklist: left-join and synthesized NOT_STARTED" section. */
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
      extraFormFilter: { formType: EULB_FORM_TYPE },
      stateId: query.stateId,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      limit: query.limit,
    });

    return xviFcSuccess('Elected Urban Local Bodies PMU worklist fetched.', { rows }, { page, limit, total });
  }

  /** PMU review metadata only — no row list (see `ElectedUrbanLocalBodiesPmuRowsService.getRows`);
   *  view-gated by `canPmuViewForm`, 403s otherwise. */
  async getReviewMetadata(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbPmuReviewData>> {
    assertPmuOrMohuaViewerAccess(user);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const doc = await this.formModel
      .findOne({ state: stateOid, year: yearOid, formType: EULB_FORM_TYPE })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<PmuFormLeanWithPopulate>()
      .exec();

    if (!doc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }

    const currentFormStatus = doc.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    if (!canPmuViewForm(currentFormStatus)) {
      throw new ForbiddenException(
        `Form is not yet reviewable when status is ${getFormStatusLabel(currentFormStatus)}.`,
      );
    }

    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const rowSummary = await this.domainService.getRowSummary(doc._id, doc.activeDatasetVersion ?? 0);
    const permissions = buildPmuReviewerFormPermissions(user, currentFormStatus, { includeRowReview: true });

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new NotFoundException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }

    const savedData: Record<string, unknown> = {};
    if (doc.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;
    if (doc.electedBodyExcelFile !== undefined) savedData['electedBodyExcelFile'] = doc.electedBodyExcelFile;
    if (doc.signedElectedbodyFile !== undefined) savedData['signedElectedbodyFile'] = doc.signedElectedbodyFile;

    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const computedActiveUlbCount = await this.ulbModel.countDocuments(eligibleUlbFilter);

    const coreHydrated = this.formQuestionHydrator.hydrate(mainFormFields, savedData);
    const questions = coreHydrated.map((q) => (q.key === 'ulbCount' ? { ...q, value: computedActiveUlbCount } : q));

    const data: EulbPmuReviewData = {
      formId: String(doc._id),
      stateId,
      stateName,
      yearId,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      pmuRemarks: doc.pmuRemarks ?? null,
      questions,
      rowSummary,
      permissions,
      actors,
      validationStatus: doc.validationStatus ?? 'NOT_VALIDATED',
    };

    return xviFcSuccess('Elected Urban Local Bodies PMU review metadata fetched.', data);
  }

  /** Approves every currently-pending row and, once none remain pending/rejected/needing-update,
   *  settles the parent at `UNDER_REVIEW_BY_MOHUA` in the same transaction — mirrors FC Unspent's
   *  `approveCompleteForm` for the Yes-branch case. PMU has no status of its own once approved;
   *  rows and parent alike land on the same status MoHUA's own review already uses. */
  async approveCompleteForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<EulbPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const activeRows = await this.domainService.getActiveRows(form._id, form.activeDatasetVersion);
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

    const session = await this.formModel.db.startSession();
    let currentFormStatus = form.currentFormStatus;
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

      const result = await this.domainService.maybeSettleAfterBulkAction(form, userOid, ip, userAgent, session);
      currentFormStatus = result.currentFormStatus;

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('Elected Urban Local Bodies form approved.', {
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
    });
  }

  /** Requires a non-empty `pmuRemarks`. Blocks if any row has already been individually approved —
   *  mirrors FC Unspent's `rejectCompleteForm`. */
  async rejectCompleteForm(
    stateId: string,
    yearId: string,
    pmuRemarks: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<EulbPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const trimmedRemarks = pmuRemarks?.trim();
    if (!trimmedRemarks) {
      throwXviFcValidationError({
        pmuRemarks: [{ field: 'pmuRemarks', code: 'required', message: 'A rejection remark is required.' }],
      });
    }

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const activeRows = await this.domainService.getActiveRows(form._id, form.activeDatasetVersion);
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

    const toReject = activeRows.filter((r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.RETURNED_BY_PMU;

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

      await this.domainService.transitionParent(form._id, toStatus, trimmedRemarks, userOid, session);
      await this.domainService.insertParentHistory(
        form,
        fromStatus,
        toStatus,
        FormHistoryAction.PMU_REJECT,
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

    return xviFcSuccess('Elected Urban Local Bodies form rejected.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }
}
