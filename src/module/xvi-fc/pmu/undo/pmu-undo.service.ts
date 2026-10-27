import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { PmuUndoEligibilityService } from 'src/module/xvi-fc/common/services/pmu-undo-eligibility.service';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { assertCanPmuUndoForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertPmuReviewerAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import { XviFcGtc, XviFcGtcDocument } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory, XviFcGtcHistoryDocument } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import { SFC_STATUS_FORM_TYPE, XviFcSfcStatus, XviFcSfcStatusDocument } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcSfcStatusHistory,
  XviFcSfcStatusHistoryDocument,
} from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { PmuUndoRowFormsService } from './pmu-undo-rows.service';
import type { PmuUndoDto } from './pmu-undo.dto';

export interface PmuUndoResult {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}

/** What every form-level undo needs off the form: where it sits, who it belongs to, and the remark that
 *  is about to be cleared. `installment` is only set on the installment-scoped forms. */
interface FormLevelLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment?: number;
  currentFormStatus: number;
  pmuRemarks?: string | null;
}

/**
 * Everything about "undo my PMU approve/return", in one place — the controller's single entry point.
 * Reverses PMU's own approve (`UNDER_REVIEW_BY_MOHUA`, 5) or return (`RETURNED_BY_PMU`, 14) back to
 * `UNDER_REVIEW_BY_PMU` (13), logged `5|14 -> 10 (UNDO) -> 13`. The three whole-form reviewers (SFC Status,
 * GTC, Devolution Formula) share one generic path here; the two row-bearing ones live in
 * `PmuUndoRowFormsService`. See common/services/CLAUDE.md, "Undoing a PMU decision".
 */
@Injectable()
export class PmuUndoService {
  constructor(
    @InjectModel(XviFcSfcStatus.name) private readonly sfcModel: Model<XviFcSfcStatusDocument>,
    @InjectModel(XviFcSfcStatusHistory.name) private readonly sfcHistoryModel: Model<XviFcSfcStatusHistoryDocument>,
    @InjectModel(XviFcGtc.name) private readonly gtcModel: Model<XviFcGtcDocument>,
    @InjectModel(XviFcGtcHistory.name) private readonly gtcHistoryModel: Model<XviFcGtcHistoryDocument>,
    @InjectModel(DevolutionFormulaForm.name) private readonly dfModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaFormHistory.name)
    private readonly dfHistoryModel: Model<DevolutionFormulaFormHistoryDocument>,
    private readonly rowForms: PmuUndoRowFormsService,
    private readonly formHelper: StateFormPmuReviewHelper,
    private readonly eligibility: PmuUndoEligibilityService,
  ) {}

  async undo(dto: PmuUndoDto, user: AuthUser, ip: string, userAgent: string): Promise<XviFcApiResponse<PmuUndoResult>> {
    assertPmuReviewerAccess(user);

    const state = new Types.ObjectId(dto.stateId);
    const year = new Types.ObjectId(dto.yearId);
    const ctx = { user, ip, userAgent };

    switch (dto.type) {
      case 'SFC_STATUS':
        return this.undoFormLevel<XviFcSfcStatusDocument, XviFcSfcStatusHistoryDocument>(
          {
            label: 'SFC Status',
            formModel: this.sfcModel,
            historyModel: this.sfcHistoryModel,
            historyFormField: 'sfcStatusForm',
            filter: { state, year, formType: SFC_STATUS_FORM_TYPE },
          },
          ctx,
        );
      case 'GTC': {
        const installment = this.requireInstallment(dto);
        return this.undoFormLevel<XviFcGtcDocument, XviFcGtcHistoryDocument>(
          {
            label: 'GTC',
            formModel: this.gtcModel,
            historyModel: this.gtcHistoryModel,
            historyFormField: 'gtcForm',
            filter: { state, year, installment },
          },
          ctx,
        );
      }
      case 'DEVOLUTION_FORMULA': {
        const installment = this.requireInstallment(dto);
        return this.undoFormLevel<DevolutionFormulaFormDocument, DevolutionFormulaFormHistoryDocument>(
          {
            label: 'ULB-wise Allocation',
            formModel: this.dfModel,
            historyModel: this.dfHistoryModel,
            historyFormField: 'devolutionFormulaForm',
            filter: { state, year, installment },
          },
          ctx,
        );
      }
      case 'ELECTED_BODY':
        return this.rowForms.undoElectedBody(state, year, ctx);
      case 'FC_UNSPENT':
        return this.rowForms.undoFcUnspent(state, year, ctx);
    }
  }

  /** The generic whole-form path: load, gate (status + claim letter), conditional write, two history entries.
   *  Non-transactional, like the form's own approve/reject — the conditional status write is what stops a
   *  concurrent decision from being overwritten, and the history only follows a write that matched. */
  private async undoFormLevel<TForm, THistory>(
    cfg: {
      label: string;
      formModel: Model<TForm>;
      historyModel: Model<THistory>;
      /** Field on this form's history document that points back at the form (differs per form). */
      historyFormField: string;
      filter: Record<string, unknown>;
    },
    ctx: { user: AuthUser; ip: string; userAgent: string },
  ): Promise<XviFcApiResponse<PmuUndoResult>> {
    const form = await cfg.formModel
      .findOne(cfg.filter as FilterQuery<TForm>)
      .select('state year installment currentFormStatus pmuRemarks')
      .lean<FormLevelLean>()
      .exec();
    if (!form) throw new NotFoundException(`${cfg.label} form not found for this state and year.`);

    assertCanPmuUndoForm(form.currentFormStatus);
    await this.eligibility.assertNoClaimLetterLocks(form.state, form.year);

    const userOid = new Types.ObjectId(ctx.user._id);
    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_PMU;

    await this.formHelper.transitionForm<TForm>({
      formModel: cfg.formModel,
      formId: form._id,
      setFields: { currentFormStatus: toStatus, updatedBy: userOid, pmuRemarks: null },
      expectedStatus: fromStatus,
      notFoundMessage: `${cfg.label} form not found.`,
    });

    await this.formHelper.writeUndoHistory<THistory>({
      historyModel: cfg.historyModel,
      fromStatus,
      buildDocument: (step) => ({
        [cfg.historyFormField]: form._id,
        state: form.state,
        year: form.year,
        ...(form.installment !== undefined && { installment: form.installment }),
        action: FormHistoryAction.PMU_UNDO,
        fromStatus: step.fromStatus,
        toStatus: step.toStatus,
        changedBy: userOid,
        changedAt: step.changedAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        // The remark being cleared is kept on the first entry so the reason survives in history.
        remarks: step.toStatus === FORM_STATUS.UNDO ? (form.pmuRemarks ?? null) : null,
      }),
    });

    return xviFcSuccess(`${cfg.label} decision undone.`, {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  /** GTC and Devolution Formula are installment-scoped — a missing one is a client error, not a default. */
  private requireInstallment(dto: PmuUndoDto): 1 | 2 {
    if (dto.installment === undefined) {
      throwXviFcValidationError({
        installment: [{ field: 'installment', code: 'required', message: `installment is required for ${dto.type}.` }],
      });
    }
    return dto.installment;
  }
}
