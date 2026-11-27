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
import { XviFcGtc } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { SFC_FORM_ID, SFC_STATUS_FORM_TYPE, XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { ExemptionResolverService } from './common/services/exemption-resolver.service';
import { DF_FORM_TYPE } from './state/devolution-formula/constants/devolution-formula.constants';
import { resolveSfcExemptionStatus } from './state/claim-letter/helpers/claim-letter-sfc-exemption.helpers';
import {
  MOHUA_OVERVIEW_INSTALMENT,
  MOHUA_STATE_FORM_APPROVED_STATUSES,
} from './mohua/overview/mohua-overview.constants';

/**
 * State-form statuses that count as "approved by PMU": PMU approved it (under SO review, 15) or it went further (under
 * MoHUA review 5, acknowledged 7). The ULB sees the State's data only once **all five** State forms (SFC, Elected
 * Body, Devolution, FC Unspent, GTC) are here; until then every value reads "Awaiting State Upload", so nothing PMU
 * hasn't approved reaches the browser. A whole-State SFC exemption (under review or approved) counts as SFC done.
 */
export const ULB_VISIBLE_STATE_FORM_STATUSES: readonly number[] = [...MOHUA_STATE_FORM_APPROVED_STATUSES];

/** Shown as the SFC value when the State is exempt from SFC rather than filing it. */
const SFC_EXEMPTED_VALUE = 'Exempted';

/** The ULB sees only whether it has a 14th FC unspent balance, never the amount the State filed. */
const FC_UNSPENT_YES = 'Yes';
const FC_UNSPENT_NO = 'No';

/** One State-supplied condition as the ULB sees it. `value`/`amount` are null unless `visible`. */
export interface UlbStateCondition {
  form_status: string;
  form_status_id: number;
  visible: boolean;
  /** Text answer (SFC, Elected Body, FC Unspent Yes / No). */
  value: string | null;
  /** Whole rupees (ULB-wise allocation). */
  amount: number | null;
}

export interface UlbStateConditions {
  sfcStatus: UlbStateCondition;
  electedBody: UlbStateCondition;
  devolution: UlbStateCondition;
  fcUnspent: UlbStateCondition;
}

type LeanForm = { _id: Types.ObjectId; currentFormStatus?: number; activeDatasetVersion?: number };
type LeanUnspentForm = LeanForm & { isFcUnspent?: boolean | null };
type LeanSfc = { currentFormStatus?: number; data?: Record<string, unknown> };

/**
 * What the State has filed for one ULB — SFC, Elected Body, FC Unspent and the ULB-wise allocation —
 * for the ULB's "Conditions" page. Read-only; every row lookup is scoped to the one ULB so no other
 * ULB's figure is ever returned. All four show together, and only once PMU has approved all five
 * State forms (see ULB_VISIBLE_STATE_FORM_STATUSES).
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
    @InjectModel(XviFcGtc.name) private readonly gtcModel: Model<XviFcGtc>,
    private readonly formJsonService: FormJsonService,
    private readonly exemptionResolver: ExemptionResolverService,
  ) {}

  async resolve(stateId: Types.ObjectId, ulbId: Types.ObjectId, yearId: Types.ObjectId): Promise<UlbStateConditions> {
    const live = { state: stateId, year: yearId };
    const [sfcForm, ebForm, dfForm, unspentForm, gtcForm, sfcExemption] = await Promise.all([
      this.sfcModel
        .findOne({ ...live, formType: SFC_STATUS_FORM_TYPE, isActive: true, isDeleted: { $ne: true } })
        .select('currentFormStatus data')
        .lean<LeanSfc>()
        .exec(),
      this.findForm(this.ebFormModel, { ...live, formType: EULB_FORM_TYPE, isActive: true, isDeleted: { $ne: true } }),
      this.findForm(this.dfFormModel, {
        ...live,
        installment: MOHUA_OVERVIEW_INSTALMENT,
        formType: DF_FORM_TYPE,
        isActive: true,
      }),
      this.unspentFormModel
        .findOne({ ...live, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
        .select('_id currentFormStatus isFcUnspent')
        .lean<LeanUnspentForm>()
        .exec(),
      this.findForm(this.gtcModel, {
        ...live,
        installment: MOHUA_OVERVIEW_INSTALMENT,
        isActive: true,
        isDeleted: { $ne: true },
      }),
      resolveSfcExemptionStatus(this.exemptionResolver, stateId, yearId),
    ]);

    const approved = (status: number | undefined) =>
      status !== undefined && ULB_VISIBLE_STATE_FORM_STATUSES.includes(status);
    const sfcExempt = sfcExemption !== null;
    // One gate for all four values: every State form approved by PMU (SFC may be exempt instead).
    const visible =
      (approved(sfcForm?.currentFormStatus) || sfcExempt) &&
      approved(ebForm?.currentFormStatus) &&
      approved(dfForm?.currentFormStatus) &&
      approved(unspentForm?.currentFormStatus) &&
      approved(gtcForm?.currentFormStatus);

    const [sfcStatus, electedBody, devolution, fcUnspent] = await Promise.all([
      this.sfc(sfcForm, yearId, visible, sfcExempt),
      this.electedBody(ebForm, ulbId, visible),
      this.devolution(dfForm, ulbId, visible),
      this.fcUnspent(unspentForm, ulbId, visible),
    ]);
    return { sfcStatus, electedBody, devolution, fcUnspent };
  }

  private async sfc(
    form: LeanSfc | null,
    yearId: Types.ObjectId,
    visible: boolean,
    exempt: boolean,
  ): Promise<UlbStateCondition> {
    const condition = this.base(form?.currentFormStatus, visible);
    if (!visible) return condition;
    // An exempt State has no SFC answer to show (or one it filed before asking for the exemption).
    if (exempt && !approvedSfcAnswer(form)) return { ...condition, value: SFC_EXEMPTED_VALUE };

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
    form: LeanForm | null,
    ulbId: Types.ObjectId,
    visible: boolean,
  ): Promise<UlbStateCondition> {
    const condition = this.base(form?.currentFormStatus, visible);
    if (!form || !visible) return condition;

    const row = await this.ebRowModel
      .findOne({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true, ulbId })
      .select('electedBodyStatus')
      .lean<{ electedBodyStatus?: string }>()
      .exec();
    return { ...condition, value: row?.electedBodyStatus || null };
  }

  private async devolution(form: LeanForm | null, ulbId: Types.ObjectId, visible: boolean): Promise<UlbStateCondition> {
    const condition = this.base(form?.currentFormStatus, visible);
    if (!form || !visible) return condition;

    const row = await this.dfRowModel
      .findOne({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true, ulbId })
      .select('totalGrantAllocation')
      .lean<{ totalGrantAllocation?: number }>()
      .exec();
    return { ...condition, amount: typeof row?.totalGrantAllocation === 'number' ? row.totalGrantAllocation : null };
  }

  /**
   * Yes when the State declared an unspent balance (isFcUnspent) and listed this ULB with an amount above 0; No
   * otherwise (a nil declaration, the ULB not listed, or no amount). The amount itself is never sent to the ULB.
   */
  private async fcUnspent(
    form: LeanUnspentForm | null,
    ulbId: Types.ObjectId,
    visible: boolean,
  ): Promise<UlbStateCondition> {
    const condition = this.base(form?.currentFormStatus, visible);
    if (!form || !visible) return condition;
    if (form.isFcUnspent !== true) return { ...condition, value: FC_UNSPENT_NO };

    const row = await this.unspentRowModel
      .findOne({ form: form._id, isActive: true, ulbId })
      .select('unspentAmount')
      .lean<{ unspentAmount?: number | null }>()
      .exec();
    return { ...condition, value: (row?.unspentAmount ?? 0) > 0 ? FC_UNSPENT_YES : FC_UNSPENT_NO };
  }

  private findForm<T>(model: Model<T>, filter: FilterQuery<T>): Promise<LeanForm | null> {
    return model.findOne(filter).select('_id currentFormStatus activeDatasetVersion').lean<LeanForm>().exec();
  }

  /** Status fields plus `visible`; no form yet reads as NO_STATUS, i.e. "Awaiting State Upload". */
  private base(statusCode: number | undefined, visible: boolean): UlbStateCondition {
    const status = statusCode ?? FORM_STATUS.NO_STATUS;
    return {
      form_status: getFormStatusKey(status),
      form_status_id: status,
      visible,
      value: null,
      amount: null,
    };
  }
}

/** True when the State filed an SFC answer that PMU approved, so it can be shown rather than "Exempted". */
function approvedSfcAnswer(form: LeanSfc | null): boolean {
  return (
    form?.currentFormStatus !== undefined &&
    ULB_VISIBLE_STATE_FORM_STATUSES.includes(form.currentFormStatus) &&
    typeof form.data?.['isActiveSfc'] === 'string'
  );
}
