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
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { XviFcGtc, XviFcGtcDocument } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory, XviFcGtcHistoryDocument } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import {
  GTC_FORM_ID,
  GTC_INSTALLMENTS,
  type GtcInstallment,
} from 'src/module/xvi-fc/state/gtc/constants/gtc.constants';
import type { GtcPmuFormLean, GtcPmuReviewData, GtcPmuSubmitData } from '../types/gtc-pmu-review.types';
import type { PmuWorklistData } from 'src/module/xvi-fc/common/types/pmu-worklist.type';
import { State, StateDocument } from 'src/schemas/state.schema';

type PmuFormLeanWithPopulate = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
  currentFormStatus?: number;
  data?: Record<string, unknown>;
  pmuRemarks?: string | null;
};

/**
 * Form-level PMU review for GTC — approve/reject only, no rows, installment-scoped. Same shape as
 * SFC Status's PMU reviewer (see that module's own class docblock for the full rationale on why
 * the shared `StateFormPmuReviewHelper` is called directly here rather than through a per-form
 * "domain service" layer, and why writes stay non-transactional) — the only difference is the
 * extra `installment` dimension threaded through every query/response.
 */
@Injectable()
export class GtcPmuReviewService {
  constructor(
    @InjectModel(XviFcGtc.name)
    private readonly formModel: Model<XviFcGtcDocument>,
    @InjectModel(XviFcGtcHistory.name)
    private readonly historyModel: Model<XviFcGtcHistoryDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    private readonly pmuReviewHelper: StateFormPmuReviewHelper,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly formQuestionHydrator: FormQuestionHydratorService,
    private readonly formJsonService: FormJsonService,
  ) {}

  /** See `buildPmuWorklistRows` (`common/utils/pmu-worklist.util.ts`) for the cross-state/
   *  installment join and `NOT_STARTED`-synthesis logic — shared verbatim by all 5 PMU review
   *  services. */
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
      installments: GTC_INSTALLMENTS,
      stateId: query.stateId,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      limit: query.limit,
    });

    return xviFcSuccess('GTC PMU worklist fetched.', { rows }, { page, limit, total });
  }

  async getReviewMetadata(
    stateId: string,
    yearId: string,
    installment: GtcInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse<GtcPmuReviewData>> {
    assertPmuOrMohuaViewerAccess(user);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const doc = await this.formModel
      .findOne({ state: stateOid, year: yearOid, installment })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<PmuFormLeanWithPopulate>()
      .exec();

    if (!doc) {
      throw new NotFoundException('GTC form not found for this state, year, and installment.');
    }

    const currentFormStatus = doc.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    if (!canPmuViewForm(currentFormStatus)) {
      throw new ForbiddenException(
        `Form is not yet reviewable when status is ${getFormStatusLabel(currentFormStatus)}.`,
      );
    }

    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const permissions = buildPmuReviewerFormPermissions(user, currentFormStatus);

    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, GTC_FORM_ID);
    if (!formJson.data?.length) throw new NotFoundException('GTC form configuration not found');
    const questions = this.formQuestionHydrator.hydrate(formJson.data, (doc.data ?? {}) as Record<string, unknown>);

    const data: GtcPmuReviewData = {
      formId: String(doc._id),
      stateId,
      stateName,
      yearId,
      installment,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      pmuRemarks: doc.pmuRemarks ?? null,
      questions,
      permissions,
      actors,
    };

    return xviFcSuccess('GTC PMU review metadata fetched.', data);
  }

  async approveCompleteForm(
    stateId: string,
    yearId: string,
    installment: GtcInstallment,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<GtcPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const form = await this.findForm(stateId, yearId, installment);
    if (!form) throw new NotFoundException('GTC form not found for this state, year, and installment.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    // PMU is an internal pre-screen for MoHUA, not a status-bearing stage of its own once
    // approved — the form lands directly on UNDER_REVIEW_BY_MOHUA.
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;

    await this.transition(form, fromStatus, toStatus, undefined, FormHistoryAction.PMU_APPROVE, userOid, ip, userAgent);

    return xviFcSuccess('GTC form approved.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  async rejectCompleteForm(
    stateId: string,
    yearId: string,
    installment: GtcInstallment,
    pmuRemarks: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<GtcPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const trimmedRemarks = pmuRemarks?.trim();
    if (!trimmedRemarks) {
      throwXviFcValidationError({
        pmuRemarks: [{ field: 'pmuRemarks', code: 'required', message: 'A rejection remark is required.' }],
      });
    }

    const form = await this.findForm(stateId, yearId, installment);
    if (!form) throw new NotFoundException('GTC form not found for this state, year, and installment.');
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

    return xviFcSuccess('GTC form rejected.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findForm(stateId: string, yearId: string, installment: GtcInstallment): Promise<GtcPmuFormLean | null> {
    return this.formModel
      .findOne({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), installment })
      .select('state year installment currentFormStatus data')
      .lean<GtcPmuFormLean>()
      .exec();
  }

  /** Non-transactional, two sequential writes — matches GTC's own established convention; see
   *  `../../state/gtc/CLAUDE.md`'s "The one tradeoff worth knowing before touching writes". */
  private async transition(
    form: GtcPmuFormLean,
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

    await this.pmuReviewHelper.transitionForm<XviFcGtcDocument>({
      formModel: this.formModel,
      formId: form._id,
      setFields,
      notFoundMessage: 'GTC form not found.',
    });

    await this.pmuReviewHelper.writeHistoryIfChanged<XviFcGtcHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      buildDocument: () => ({
        gtcForm: form._id,
        state: form.state,
        year: form.year,
        installment: form.installment,
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
