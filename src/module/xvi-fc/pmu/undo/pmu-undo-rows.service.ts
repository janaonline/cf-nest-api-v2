import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { PmuRowReviewHelper } from 'src/module/xvi-fc/common/services/pmu-row-review.helper';
import {
  MOHUA_DECIDED_ROW_STATUSES,
  PmuUndoEligibilityService,
} from 'src/module/xvi-fc/common/services/pmu-undo-eligibility.service';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { assertCanPmuUndoForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { YearIdToLabel } from 'src/core/constants/years';
import { FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL } from 'src/module/xvi-fc/state/fc-unspent-declaration/constants/fc-unspent-declaration.constants';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  EulbFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  ElectedUrbanLocalBodiesRowHistory,
  EulbRowHistoryDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row-history.schema';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  XviFcUnspentStateFormRowHistory,
  XviFcUnspentStateFormRowHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import {
  buildEulbRowSnapshot,
  ROW_LEAN_SELECT as EULB_ROW_LEAN_SELECT,
} from '../elected-urban-local-bodies/services/elected-urban-local-bodies-pmu-row-review-domain.service';
import type { EulbPmuFormLean, EulbPmuRowLean } from '../elected-urban-local-bodies/types/elected-urban-local-bodies-pmu-review.types';
import {
  buildFcUnspentRowSnapshot,
  ROW_LEAN_SELECT as FC_UNSPENT_ROW_LEAN_SELECT,
} from '../fc-unspent-declaration/services/fc-unspent-pmu-row-review-domain.service';
import type { FcUnspentPmuFormLean, FcUnspentPmuRowLean } from '../fc-unspent-declaration/types/fc-unspent-pmu-review.types';
import type { PmuUndoResult } from './pmu-undo.service';

interface UndoContext {
  user: AuthUser;
  ip: string;
  userAgent: string;
}

/**
 * The undo for the two row-bearing forms (Elected Body, FC Unspent): the form and every PMU-decided row
 * (5 or 14) go back to 13 together, in one transaction, logged `5|14 -> 10 -> 13` on the form and per row.
 * The status writes are conditional, so a decision made in the meantime aborts the whole thing with a 409.
 * Called by `PmuUndoService`, which has already checked the caller's PMU access.
 */
@Injectable()
export class PmuUndoRowFormsService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name) private readonly eulbFormModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesFormHistory.name)
    private readonly eulbHistoryModel: Model<EulbFormHistoryDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name) private readonly eulbRowModel: Model<EulbRowDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRowHistory.name)
    private readonly eulbRowHistoryModel: Model<EulbRowHistoryDocument>,
    @InjectModel(XviFcUnspentStateForm.name) private readonly fcFormModel: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(XviFcUnspentStateFormHistory.name)
    private readonly fcHistoryModel: Model<XviFcUnspentStateFormHistoryDocument>,
    @InjectModel(XviFcUnspentStateFormRow.name) private readonly fcRowModel: Model<XviFcUnspentStateFormRowDocument>,
    @InjectModel(XviFcUnspentStateFormRowHistory.name)
    private readonly fcRowHistoryModel: Model<XviFcUnspentStateFormRowHistoryDocument>,
    private readonly formHelper: StateFormPmuReviewHelper,
    private readonly rowHelper: PmuRowReviewHelper,
    private readonly eligibility: PmuUndoEligibilityService,
  ) {}

  async undoElectedBody(
    state: Types.ObjectId,
    year: Types.ObjectId,
    ctx: UndoContext,
  ): Promise<XviFcApiResponse<PmuUndoResult>> {
    const form = await this.eulbFormModel
      .findOne({ state, year, formType: EULB_FORM_TYPE })
      .select('state year currentFormStatus activeDatasetVersion pmuRemarks')
      .lean<EulbPmuFormLean>()
      .exec();
    if (!form) throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');

    assertCanPmuUndoForm(form.currentFormStatus);
    await this.eligibility.assertNoClaimLetterLocks(form.state, form.year);

    const activeRows = await this.rowHelper.getActiveRows<EulbRowDocument, EulbPmuRowLean>({
      rowModel: this.eulbRowModel,
      formId: form._id,
      datasetVersion: form.activeDatasetVersion,
      select: EULB_ROW_LEAN_SELECT,
    });
    const toReopen = this.pmuDecidedRows(activeRows);

    const userOid = new Types.ObjectId(ctx.user._id);
    const fromStatus = form.currentFormStatus;

    return this.inTransaction<EulbFormDocument, XviFcApiResponse<PmuUndoResult>>(this.eulbFormModel, async (session) => {
      const moved = await this.rowHelper.undoRows<EulbRowDocument, EulbRowHistoryDocument, EulbPmuRowLean>({
        rowModel: this.eulbRowModel,
        rowHistoryModel: this.eulbRowHistoryModel,
        formId: form._id,
        stateOid: form.state,
        yearOid: form.year,
        rows: toReopen,
        userOid,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        session,
        buildSnapshot: buildEulbRowSnapshot,
      });
      this.assertAllRowsMoved(moved, toReopen.length);

      await this.formHelper.transitionForm<EulbFormDocument>({
        formModel: this.eulbFormModel,
        formId: form._id,
        setFields: { currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, updatedBy: userOid, pmuRemarks: null },
        session,
        expectedStatus: fromStatus,
        notFoundMessage: 'Elected Urban Local Bodies form not found.',
      });
      await this.formHelper.writeUndoHistory<EulbFormHistoryDocument>({
        historyModel: this.eulbHistoryModel,
        fromStatus,
        session,
        buildDocument: (step) => ({
          eulbForm: form._id,
          state: form.state,
          year: form.year,
          action: FormHistoryAction.PMU_UNDO,
          fromStatus: step.fromStatus,
          toStatus: step.toStatus,
          changedBy: userOid,
          changedAt: step.changedAt,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          snapshot: null,
          remarks: step.toStatus === FORM_STATUS.UNDO ? (form.pmuRemarks ?? undefined) : undefined,
        }),
      });

      return this.result('Elected Urban Local Bodies');
    });
  }

  /** Like Elected Body, plus: refused once MoHUA has decided any row (those decisions must not be wiped out
   *  from under it), and only Yes-branch forms have rows to reopen. */
  async undoFcUnspent(
    state: Types.ObjectId,
    year: Types.ObjectId,
    ctx: UndoContext,
  ): Promise<XviFcApiResponse<PmuUndoResult>> {
    const designYear = YearIdToLabel[year.toString()];
    const applicableFc = designYear ? FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYear] : undefined;
    if (!applicableFc) throw new NotFoundException(`No applicable FC mapping for yearId: ${year.toString()}`);

    const form = await this.fcFormModel
      .findOne({ state, year, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .lean<FcUnspentPmuFormLean>()
      .exec();
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');

    assertCanPmuUndoForm(form.currentFormStatus);
    await this.eligibility.assertNoClaimLetterLocks(form.state, form.year);

    let toReopen: FcUnspentPmuRowLean[] = [];
    if (form.isFcUnspent === true) {
      const activeRows = await this.rowHelper.getActiveRows<XviFcUnspentStateFormRowDocument, FcUnspentPmuRowLean>({
        rowModel: this.fcRowModel,
        formId: form._id,
        select: FC_UNSPENT_ROW_LEAN_SELECT,
      });
      if (activeRows.some((r) => MOHUA_DECIDED_ROW_STATUSES.includes(r.rowStatus as number))) {
        throwXviFcValidationError({
          _form: [
            {
              code: 'mohuaAlreadyDecided',
              message: 'MoHUA has already decided one or more rows, so this decision can no longer be undone.',
            },
          ],
        });
      }
      toReopen = this.pmuDecidedRows(activeRows);
    }

    const userOid = new Types.ObjectId(ctx.user._id);
    const fromStatus = form.currentFormStatus;
    const newAuditRevision = form.auditRevision + 1;

    return this.inTransaction<XviFcUnspentStateFormDocument, XviFcApiResponse<PmuUndoResult>>(this.fcFormModel, async (session) => {
      const moved = await this.rowHelper.undoRows<
        XviFcUnspentStateFormRowDocument,
        XviFcUnspentStateFormRowHistoryDocument,
        FcUnspentPmuRowLean
      >({
        rowModel: this.fcRowModel,
        rowHistoryModel: this.fcRowHistoryModel,
        formId: form._id,
        stateOid: form.state,
        yearOid: form.year,
        rows: toReopen,
        userOid,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        session,
        buildSnapshot: buildFcUnspentRowSnapshot,
      });
      this.assertAllRowsMoved(moved, toReopen.length);

      await this.formHelper.transitionForm<XviFcUnspentStateFormDocument>({
        formModel: this.fcFormModel,
        formId: form._id,
        setFields: {
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          auditRevision: newAuditRevision,
          updatedBy: userOid,
          pmuRemarks: null,
        },
        session,
        expectedStatus: fromStatus,
        notFoundMessage: 'FC Unspent Declaration form not found.',
      });
      await this.formHelper.writeUndoHistory<XviFcUnspentStateFormHistoryDocument>({
        historyModel: this.fcHistoryModel,
        fromStatus,
        session,
        buildDocument: (step) => ({
          fcUnspentForm: form._id,
          state: form.state,
          year: form.year,
          fromStatus: step.fromStatus,
          toStatus: step.toStatus,
          auditRevision: newAuditRevision,
          applicableFc,
          data: {
            isFcUnspent: form.isFcUnspent,
            fcDeclaration: form.fcDeclaration ?? null,
            fcUnspentDeclaration: form.fcUnspentDeclaration ?? null,
            checkboxConfirmation: form.checkboxConfirmation,
          },
          snapshot: [],
          remarks: step.toStatus === FORM_STATUS.UNDO ? (form.pmuRemarks ?? undefined) : undefined,
          changedBy: userOid,
          changedAt: step.changedAt,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        }),
      });

      return this.result('FC Unspent Declaration');
    });
  }

  /** The rows PMU had decided: approved onward (5) or returned (14). Anything else is left exactly as it is. */
  private pmuDecidedRows<TRow extends { rowStatus: number | null }>(rows: TRow[]): TRow[] {
    return rows.filter(
      (r) => r.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA || r.rowStatus === FORM_STATUS.RETURNED_BY_PMU,
    );
  }

  /** A short count means a row's status changed between the read and the write — abort rather than half-undo. */
  private assertAllRowsMoved(moved: number, expected: number): void {
    if (moved !== expected) {
      throw new ConflictException('A row changed while you were working. Refresh and try again.');
    }
  }

  private result(label: string): XviFcApiResponse<PmuUndoResult> {
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_PMU;
    return xviFcSuccess(`${label} decision undone.`, {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  /** Runs `work` in a Mongo transaction on `model`'s connection, always ending the session. */
  private async inTransaction<T, R>(
    model: Model<T>,
    work: (session: ClientSession) => Promise<R>,
  ): Promise<R> {
    const session = await model.db.startSession();
    try {
      session.startTransaction();
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
