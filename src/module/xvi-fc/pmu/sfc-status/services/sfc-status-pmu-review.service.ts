import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { assertCanPmuMutateForm, canPmuViewForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertPmuReviewerAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { buildPmuReviewerFormPermissions } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-permissions.util';
import { buildPmuWorklistRows } from 'src/module/xvi-fc/common/utils/pmu-worklist.util';
import type { GetPmuWorklistQueryDto } from 'src/module/xvi-fc/common/dto/get-pmu-worklist-query.dto';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  SFC_FORM_ID,
  SFC_STATUS_FORM_TYPE,
  XviFcSfcStatus,
  XviFcSfcStatusDocument,
} from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcSfcStatusHistory,
  XviFcSfcStatusHistoryDocument,
} from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import type {
  SfcStatusPmuFormLean,
  SfcStatusPmuReviewData,
  SfcStatusPmuSubmitData,
} from '../types/sfc-status-pmu-review.types';
import type { PmuWorklistData } from 'src/module/xvi-fc/common/types/pmu-worklist.type';

type PmuFormLeanWithPopulate = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
  currentFormStatus?: number;
  data?: Record<string, unknown>;
  pmuRemarks?: string | null;
};

/**
 * Form-level PMU review for SFC Status — approve/reject only, no rows. See this folder's
 * CLAUDE.md for why there's no domain-service layer and no ADRs here.
 */
@Injectable()
export class SfcStatusPmuReviewService {
  constructor(
    @InjectModel(XviFcSfcStatus.name)
    private readonly formModel: Model<XviFcSfcStatusDocument>,
    @InjectModel(XviFcSfcStatusHistory.name)
    private readonly historyModel: Model<XviFcSfcStatusHistoryDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    private readonly pmuReviewHelper: StateFormPmuReviewHelper,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly formQuestionHydrator: FormQuestionHydratorService,
    private readonly formJsonService: FormJsonService,
  ) {}

  /** Cross-state PMU worklist for a year — see `buildPmuWorklistRows` for the join/synthesis
   *  logic. Must stay declared before `getReviewMetadata` — see CLAUDE.md's "Route ordering"
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
      extraFormFilter: { formType: SFC_STATUS_FORM_TYPE },
      stateId: query.stateId,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      limit: query.limit,
    });

    return xviFcSuccess('SFC Status PMU worklist fetched.', { rows }, { page, limit, total });
  }

  async getReviewMetadata(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<SfcStatusPmuReviewData>> {
    assertPmuReviewerAccess(user);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const doc = await this.formModel
      .findOne({ state: stateOid, year: yearOid, formType: SFC_STATUS_FORM_TYPE })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<PmuFormLeanWithPopulate>()
      .exec();

    if (!doc) {
      throw new NotFoundException('SFC Status form not found for this state and year.');
    }

    const currentFormStatus = doc.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    if (!canPmuViewForm(currentFormStatus)) {
      throw new ForbiddenException(
        `Form is not yet reviewable when status is ${getFormStatusLabel(currentFormStatus)}.`,
      );
    }

    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const permissions = buildPmuReviewerFormPermissions(user, currentFormStatus);

    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, SFC_FORM_ID);
    if (!formJson.data?.length) throw new NotFoundException('SFC Status form configuration not found');
    const questions = this.formQuestionHydrator.hydrate(formJson.data, doc.data ?? {});

    const data: SfcStatusPmuReviewData = {
      formId: String(doc._id),
      stateId,
      stateName,
      yearId,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      pmuRemarks: doc.pmuRemarks ?? null,
      questions,
      permissions,
      actors,
    };

    return xviFcSuccess('SFC Status PMU review metadata fetched.', data);
  }

  async approveCompleteForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<SfcStatusPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const form = await this.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('SFC Status form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    // No PMU-specific "approved" status — see CLAUDE.md's "Status handling" section.
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;

    await this.transition(form, fromStatus, toStatus, undefined, FormHistoryAction.PMU_APPROVE, userOid, ip, userAgent);

    return xviFcSuccess('SFC Status form approved.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  async rejectCompleteForm(
    stateId: string,
    yearId: string,
    pmuRemarks: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<SfcStatusPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const trimmedRemarks = pmuRemarks?.trim();
    if (!trimmedRemarks) {
      throwXviFcValidationError({
        pmuRemarks: [{ field: 'pmuRemarks', code: 'required', message: 'A rejection remark is required.' }],
      });
    }

    const form = await this.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('SFC Status form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.RETURNED_BY_PMU;

    await this.transition(
      form,
      fromStatus,
      toStatus,
      trimmedRemarks,
      FormHistoryAction.PMU_REJECT,
      userOid,
      ip,
      userAgent,
    );

    return xviFcSuccess('SFC Status form rejected.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findForm(stateId: string, yearId: string): Promise<SfcStatusPmuFormLean | null> {
    return this.formModel
      .findOne({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), formType: SFC_STATUS_FORM_TYPE })
      .select('state year currentFormStatus data')
      .lean<SfcStatusPmuFormLean>()
      .exec();
  }

  /** Non-transactional, two sequential writes — same accepted tradeoff as state/sfc-status's own
   *  writes (see that module's CLAUDE.md, "The one tradeoff worth knowing before touching
   *  writes"). */
  private async transition(
    form: SfcStatusPmuFormLean,
    fromStatus: number,
    toStatus: number,
    pmuRemarks: string | undefined,
    action: FormHistoryAction,
    userOid: Types.ObjectId,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    const setFields: Record<string, unknown> = { currentFormStatus: toStatus, updatedBy: userOid };
    if (pmuRemarks !== undefined) setFields['pmuRemarks'] = pmuRemarks;

    await this.pmuReviewHelper.transitionForm<XviFcSfcStatusDocument>({
      formModel: this.formModel,
      formId: form._id,
      setFields,
      notFoundMessage: 'SFC Status form not found.',
    });

    await this.pmuReviewHelper.writeHistoryIfChanged<XviFcSfcStatusHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      buildDocument: () => ({
        sfcStatusForm: form._id,
        state: form.state,
        year: form.year,
        action,
        fromStatus,
        toStatus,
        changedBy: userOid,
        changedAt: new Date(),
        ip,
        userAgent,
        remarks: pmuRemarks,
      }),
    });
  }
}
