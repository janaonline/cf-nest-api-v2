import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusKey } from 'src/common/constants/form-status.constants';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcGtc } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { SFC_STATUS_FORM_TYPE, XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { DF_FORM_TYPE } from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import { canPmuViewForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { MOHUA_OVERVIEW_FORMS, MOHUA_OVERVIEW_INSTALMENT, MOHUA_OVERVIEW_STAGE } from './mohua-overview.constants';
import { deriveStage, getStateFormStatusLabel, isFormCompleted } from './mohua-overview-stage.util';
import type { MohuaOverviewForm, MohuaOverviewStage } from './mohua-overview.types';

type LeanFormStatus = { state: Types.ObjectId; currentFormStatus: number; submittedAt?: Date | null };
type FormRecord = { statusCode: number; submittedAt: Date | null };

export interface StateConditions {
  forms: MohuaOverviewForm[];
  formsDone: number;
  stage: MohuaOverviewStage;
  /** Set only for under-review states: when their five condition forms were all submitted (ISO). */
  underReviewSince: string | null;
}

/**
 * The five state-condition forms (SFC status, elected bodies, devolution, FC unspent, GTC) for a set
 * of states in a year: each form's status, how many are completed, and the stage derived from them.
 * Shared by the cross-state Overview and the single-state detail page.
 */
@Injectable()
export class MohuaStateConditionsService {
  constructor(
    @InjectModel(XviFcSfcStatus.name) private readonly sfcModel: Model<XviFcSfcStatus>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly electedBodiesModel: Model<ElectedUrbanLocalBodiesForm>,
    @InjectModel(DevolutionFormulaForm.name) private readonly devolutionModel: Model<DevolutionFormulaForm>,
    @InjectModel(XviFcUnspentStateForm.name) private readonly fcUnspentModel: Model<XviFcUnspentStateForm>,
    @InjectModel(XviFcGtc.name) private readonly gtcModel: Model<XviFcGtc>,
  ) {}

  /** stateId -> conditions, for every requested state (a state with no form documents is "not started"). */
  async resolve(yearId: string, stateIds: string[]): Promise<Map<string, StateConditions>> {
    const live = {
      year: new Types.ObjectId(yearId),
      state: { $in: stateIds.map((id) => new Types.ObjectId(id)) },
      isActive: true,
      isDeleted: { $ne: true },
    };

    // Same order as MOHUA_OVERVIEW_FORMS — results are zipped back by index below.
    const statusMaps = await Promise.all([
      this.statusByState(this.sfcModel, { ...live, formType: SFC_STATUS_FORM_TYPE }),
      this.statusByState(this.electedBodiesModel, { ...live, formType: EULB_FORM_TYPE }),
      this.statusByState(this.devolutionModel, {
        ...live,
        formType: DF_FORM_TYPE,
        installment: MOHUA_OVERVIEW_INSTALMENT,
      }),
      this.statusByState(this.fcUnspentModel, { ...live, formType: FC_UNSPENT_STATE_FORM_TYPE }),
      this.statusByState(this.gtcModel, { ...live, installment: MOHUA_OVERVIEW_INSTALMENT }),
    ]);

    return new Map(
      stateIds.map((id): [string, StateConditions] => {
        const forms = MOHUA_OVERVIEW_FORMS.map((def, index): MohuaOverviewForm => {
          const statusCode = statusMaps[index].get(id)?.statusCode ?? FORM_STATUS.NO_STATUS;
          return {
            key: def.key,
            label: def.label,
            status: getFormStatusKey(statusCode),
            statusCode,
            statusLabel: getStateFormStatusLabel(statusCode),
            completed: isFormCompleted(statusCode),
            canView: canPmuViewForm(statusCode),
          };
        });
        const stage = deriveStage(forms.map((form) => form.statusCode));
        return [
          id,
          {
            forms,
            formsDone: forms.filter((form) => form.completed).length,
            stage,
            underReviewSince:
              stage === MOHUA_OVERVIEW_STAGE.UNDER_REVIEW ? this.latestSubmittedAt(statusMaps, id) : null,
          },
        ];
      }),
    );
  }

  /** stateId -> status and submit date for one form collection; a state without a document is simply absent. */
  private async statusByState<T>(model: Model<T>, filter: FilterQuery<T>): Promise<Map<string, FormRecord>> {
    const docs = await model.find(filter).select('state currentFormStatus submittedAt').lean<LeanFormStatus[]>().exec();
    return new Map(
      docs.map((doc): [string, FormRecord] => [
        String(doc.state),
        { statusCode: doc.currentFormStatus, submittedAt: doc.submittedAt ?? null },
      ]),
    );
  }

  /** The latest submit date among the five forms (ISO), or null if none carries one. */
  private latestSubmittedAt(statusMaps: Map<string, FormRecord>[], stateId: string): string | null {
    const times = statusMaps
      .map((map) => map.get(stateId)?.submittedAt)
      .filter((date): date is Date => !!date)
      .map((date) => new Date(date).getTime());
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }
}
