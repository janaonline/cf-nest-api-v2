import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { assertCanPmuMutateForm, canPmuViewForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertPmuReviewerAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { buildPmuReviewerFormPermissions } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-permissions.util';
import { buildPmuWorklistRows } from 'src/module/xvi-fc/common/utils/pmu-worklist.util';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import {
  DF_INSTALLMENTS,
  type DfInstallment,
} from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import type {
  DevolutionFormulaPmuFormLean,
  DevolutionFormulaPmuReviewData,
  DevolutionFormulaPmuRow,
  DevolutionFormulaPmuRowsData,
  DevolutionFormulaPmuSubmitData,
} from '../types/devolution-formula-pmu-review.types';
import type { PmuWorklistData } from 'src/module/xvi-fc/common/types/pmu-worklist.type';
import { State, StateDocument } from 'src/schemas/state.schema';

type PmuFormLeanWithPopulate = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
  currentFormStatus?: number;
  pmuRemarks?: string | null;
};

/**
 * Form-level PMU review for Devolution Formula — approve/reject only, whole-form, installment-
 * scoped like GTC's. See this folder's CLAUDE.md for why it writes directly to the State's own
 * form/history documents (no side-channel collection) and why row access stays read-only.
 */
@Injectable()
export class DevolutionFormulaPmuReviewService {
  constructor(
    @InjectModel(DevolutionFormulaForm.name)
    private readonly formModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaFormHistory.name)
    private readonly historyModel: Model<DevolutionFormulaFormHistoryDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly rowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    private readonly pmuReviewHelper: StateFormPmuReviewHelper,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
  ) {}

  /** Cross-state PMU worklist — see CLAUDE.md's "Worklist synthesis" section. */
  async getWorklist(yearId: string, user: AuthUser): Promise<XviFcApiResponse<PmuWorklistData>> {
    assertPmuReviewerAccess(user);

    const rows = await buildPmuWorklistRows({
      stateModel: this.stateModel,
      formModel: this.formModel,
      yearId,
      installments: DF_INSTALLMENTS,
    });

    return xviFcSuccess('ULB-wise Allocation PMU worklist fetched.', { rows });
  }

  async getReviewMetadata(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DevolutionFormulaPmuReviewData>> {
    assertPmuReviewerAccess(user);

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
      throw new NotFoundException('ULB-wise Allocation form not found for this state, year, and installment.');
    }

    const currentFormStatus = doc.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    if (!canPmuViewForm(currentFormStatus)) {
      throw new ForbiddenException(
        `Form is not yet reviewable when status is ${getFormStatusLabel(currentFormStatus)}.`,
      );
    }

    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const permissions = buildPmuReviewerFormPermissions(user, currentFormStatus);

    const data: DevolutionFormulaPmuReviewData = {
      formId: String(doc._id),
      stateId,
      stateName,
      yearId,
      installment,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      pmuRemarks: doc.pmuRemarks ?? null,
      permissions,
      actors,
    };

    return xviFcSuccess('ULB-wise Allocation PMU review metadata fetched.', data);
  }

  /** Read-only — see CLAUDE.md's "Read-only row access" section. */
  async getRows(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DevolutionFormulaPmuRowsData>> {
    assertPmuReviewerAccess(user);

    const form = await this.findForm(stateId, yearId, installment);
    if (!form) throw new NotFoundException('ULB-wise Allocation form not found for this state, year, and installment.');
    if (!canPmuViewForm(form.currentFormStatus)) {
      throw new ForbiddenException(
        `Form is not yet reviewable when status is ${getFormStatusLabel(form.currentFormStatus)}.`,
      );
    }

    const rows = await this.rowModel
      .find({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true })
      .sort({ rowNumber: 1 })
      .select(
        'rowNumber censusCode ulbName totalGrantAllocation installment1Amount installment2Amount devolutionFormula',
      )
      .limit(200)
      .lean<DevolutionFormulaPmuRow[]>()
      .exec();

    return xviFcSuccess('ULB-wise Allocation rows fetched.', { rows });
  }

  async approveCompleteForm(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<DevolutionFormulaPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const form = await this.findForm(stateId, yearId, installment);
    if (!form) throw new NotFoundException('ULB-wise Allocation form not found for this state, year, and installment.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const userOid = new Types.ObjectId(user._id);
    const fromStatus = form.currentFormStatus;
    // No status of its own once approved — see CLAUDE.md's "Approve lands directly on
    // UNDER_REVIEW_BY_MOHUA" section.
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;

    await this.transition(form, fromStatus, toStatus, undefined, FormHistoryAction.PMU_APPROVE, userOid, ip, userAgent);

    return xviFcSuccess('ULB-wise Allocation form approved.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  async rejectCompleteForm(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    pmuRemarks: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<DevolutionFormulaPmuSubmitData>> {
    assertPmuReviewerAccess(user);

    const trimmedRemarks = pmuRemarks?.trim();
    if (!trimmedRemarks) {
      throwXviFcValidationError({
        pmuRemarks: [{ field: 'pmuRemarks', code: 'required', message: 'A rejection remark is required.' }],
      });
    }

    const form = await this.findForm(stateId, yearId, installment);
    if (!form) throw new NotFoundException('ULB-wise Allocation form not found for this state, year, and installment.');
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

    return xviFcSuccess('ULB-wise Allocation form rejected.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findForm(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
  ): Promise<DevolutionFormulaPmuFormLean | null> {
    return this.formModel
      .findOne({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), installment })
      .select('state year installment currentFormStatus activeDatasetVersion')
      .lean<DevolutionFormulaPmuFormLean>()
      .exec();
  }

  /** Non-transactional, two sequential writes — matches Devolution's own established convention
   *  (same as SFC Status's/GTC's, see devolution-formula/CLAUDE.md "Form status history log"). */
  private async transition(
    form: DevolutionFormulaPmuFormLean,
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

    await this.pmuReviewHelper.transitionForm<DevolutionFormulaFormDocument>({
      formModel: this.formModel,
      formId: form._id,
      setFields,
      notFoundMessage: 'ULB-wise Allocation form not found.',
    });

    await this.pmuReviewHelper.writeHistoryIfChanged<DevolutionFormulaFormHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      buildDocument: () => ({
        devolutionFormulaForm: form._id,
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
