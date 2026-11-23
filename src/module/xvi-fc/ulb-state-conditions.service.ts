import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusKey } from 'src/common/constants/form-status.constants';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcUnspentStateFormRow } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { SFC_FORM_ID, SFC_STATUS_FORM_TYPE, XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { DF_FORM_TYPE } from './state/devolution-formula/constants/devolution-formula.constants';
import { MOHUA_OVERVIEW_INSTALMENT } from './mohua/overview/mohua-overview.constants';

/**
 * State-form statuses at which the State's data is shown to its ULBs. Deliberately one list: widening
 * it is the only change needed. Until a form reaches
 * one of these (with PMU, under MoHUA review, or acknowledged) the ULB keeps seeing "Awaiting State
 * Upload", so a draft or a PMU-returned value never reaches the browser.
 */
export const ULB_VISIBLE_STATE_FORM_STATUSES: readonly number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_PMU,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

/** One State-supplied condition as the ULB sees it. `value`/`amount` are null unless `visible`. */
export interface UlbStateCondition {
  form_status: string;
  form_status_id: number;
  visible: boolean;
  /** Text answer (SFC, Elected Body). */
  value: string | null;
  /** Whole rupees (FC Unspent, ULB-wise allocation). */
  amount: number | null;
}

export interface UlbStateConditions {
  sfcStatus: UlbStateCondition;
  electedBody: UlbStateCondition;
  devolution: UlbStateCondition;
  fcUnspent: UlbStateCondition;
}

type LeanForm = { _id: Types.ObjectId; currentFormStatus?: number; activeDatasetVersion?: number };
type LeanSfc = { currentFormStatus?: number; data?: Record<string, unknown> };

/**
 * What the State has filed for one ULB — SFC, Elected Body, FC Unspent and the ULB-wise allocation —
 * for the ULB's "Conditions" page. Read-only; every row lookup is scoped to the one ULB so no other
 * ULB's figure is ever returned.
 */
@Injectable()
export class UlbStateConditionsService {
  constructor(
    @InjectModel(XviFcSfcStatus.name) private readonly sfcModel: Model<XviFcSfcStatus>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name) private readonly ebFormModel: Model<ElectedUrbanLocalBodiesForm>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name) private readonly ebRowModel: Model<ElectedUrbanLocalBodiesRow>,
    @InjectModel(DevolutionFormulaForm.name) private readonly dfFormModel: Model<DevolutionFormulaForm>,
    @InjectModel(DevolutionFormulaRow.name) private readonly dfRowModel: Model<DevolutionFormulaRow>,
    @InjectModel(XviFcUnspentStateForm.name) private readonly unspentFormModel: Model<XviFcUnspentStateForm>,
    @InjectModel(XviFcUnspentStateFormRow.name) private readonly unspentRowModel: Model<XviFcUnspentStateFormRow>,
    private readonly formJsonService: FormJsonService,
  ) {}

  async resolve(stateId: Types.ObjectId, ulbId: Types.ObjectId, yearId: Types.ObjectId): Promise<UlbStateConditions> {
    const [sfcStatus, electedBody, devolution, fcUnspent] = await Promise.all([
      this.sfc(stateId, yearId),
      this.electedBody(stateId, ulbId, yearId),
      this.devolution(stateId, ulbId, yearId),
      this.fcUnspent(stateId, ulbId, yearId),
    ]);
    return { sfcStatus, electedBody, devolution, fcUnspent };
  }

  private async sfc(stateId: Types.ObjectId, yearId: Types.ObjectId): Promise<UlbStateCondition> {
    const form = await this.sfcModel
      .findOne({ state: stateId, year: yearId, formType: SFC_STATUS_FORM_TYPE, isActive: true, isDeleted: { $ne: true } })
      .select('currentFormStatus data')
      .lean<LeanSfc>()
      .exec();
    const condition = this.base(form?.currentFormStatus);
    if (!condition.visible) return condition;

    const raw = form?.data?.['isActiveSfc'];
    return { ...condition, value: typeof raw === 'string' && raw ? await this.sfcLabel(yearId, raw) : null };
  }

  /** The stored answer is an option id; show its configured label, falling back to the id itself. */
  private async sfcLabel(yearId: Types.ObjectId, optionId: string): Promise<string> {
    try {
      const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(String(yearId), SFC_FORM_ID);
      const field = formJson.data?.find((q) => q.key === 'isActiveSfc');
      const option = (field?.options as { id: string; label: string }[] | undefined)?.find((o) => o.id === optionId);
      return option?.label ?? optionId;
    } catch {
      return optionId;
    }
  }

  private async electedBody(
    stateId: Types.ObjectId,
    ulbId: Types.ObjectId,
    yearId: Types.ObjectId,
  ): Promise<UlbStateCondition> {
    const form = await this.findForm(this.ebFormModel, {
      state: stateId,
      year: yearId,
      formType: EULB_FORM_TYPE,
      isActive: true,
      isDeleted: { $ne: true },
    });
    const condition = this.base(form?.currentFormStatus);
    if (!form || !condition.visible) return condition;

    const row = await this.ebRowModel
      .findOne({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true, ulbId })
      .select('electedBodyStatus')
      .lean<{ electedBodyStatus?: string }>()
      .exec();
    return { ...condition, value: row?.electedBodyStatus || null };
  }

  private async devolution(
    stateId: Types.ObjectId,
    ulbId: Types.ObjectId,
    yearId: Types.ObjectId,
  ): Promise<UlbStateCondition> {
    const form = await this.findForm(this.dfFormModel, {
      state: stateId,
      year: yearId,
      installment: MOHUA_OVERVIEW_INSTALMENT,
      formType: DF_FORM_TYPE,
      isActive: true,
    });
    const condition = this.base(form?.currentFormStatus);
    if (!form || !condition.visible) return condition;

    const row = await this.dfRowModel
      .findOne({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true, ulbId })
      .select('totalGrantAllocation')
      .lean<{ totalGrantAllocation?: number }>()
      .exec();
    return { ...condition, amount: typeof row?.totalGrantAllocation === 'number' ? row.totalGrantAllocation : null };
  }

  private async fcUnspent(
    stateId: Types.ObjectId,
    ulbId: Types.ObjectId,
    yearId: Types.ObjectId,
  ): Promise<UlbStateCondition> {
    const form = await this.findForm(this.unspentFormModel, {
      state: stateId,
      year: yearId,
      formType: FC_UNSPENT_STATE_FORM_TYPE,
      isDeleted: false,
    });
    const condition = this.base(form?.currentFormStatus);
    if (!form || !condition.visible) return condition;

    const row = await this.unspentRowModel
      .findOne({ form: form._id, isActive: true, ulbId })
      .select('unspentAmount')
      .lean<{ unspentAmount?: number | null }>()
      .exec();
    return { ...condition, amount: typeof row?.unspentAmount === 'number' ? row.unspentAmount : null };
  }

  private findForm<T>(model: Model<T>, filter: FilterQuery<T>): Promise<LeanForm | null> {
    return model.findOne(filter).select('_id currentFormStatus activeDatasetVersion').lean<LeanForm>().exec();
  }

  /** Status fields plus `visible`; no form yet reads as NO_STATUS, i.e. "Awaiting State Upload". */
  private base(statusCode: number | undefined): UlbStateCondition {
    const status = statusCode ?? FORM_STATUS.NO_STATUS;
    return {
      form_status: getFormStatusKey(status),
      form_status_id: status,
      visible: ULB_VISIBLE_STATE_FORM_STATUSES.includes(status),
      value: null,
      amount: null,
    };
  }
}
