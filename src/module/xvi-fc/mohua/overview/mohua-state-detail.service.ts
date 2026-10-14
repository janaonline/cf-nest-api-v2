import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { GrantAllocation } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { MohuaOverviewUlbProgressService } from './mohua-overview-ulb-progress.service';
import { MohuaStateConditionsService } from './mohua-state-conditions.service';
import { MOHUA_STATE_DETAIL_ULB_FORMS } from './mohua-overview.constants';
import { allocationRupees, toCrore } from './mohua-overview.util';
import type { MohuaStateDetail } from './mohua-state-detail.types';

type LeanState = { _id: Types.ObjectId; name: string; code: string; slug?: string };
type LeanAllocation = { basic: number; performance: number };

/** Single-state view for MoHUA: allocation, the five condition forms, and per-form ULB submission counts. */
@Injectable()
export class MohuaStateDetailService {
  constructor(
    @InjectModel(State.name) private readonly stateModel: Model<State>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    @InjectModel(GrantAllocation.name) private readonly grantAllocationModel: Model<GrantAllocation>,
    private readonly stateConditions: MohuaStateConditionsService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly ulbProgressService: MohuaOverviewUlbProgressService,
  ) {}

  async getDetail(stateId: string, yearId: string): Promise<MohuaStateDetail> {
    const [state, year] = await Promise.all([
      this.stateModel.findById(stateId).select('name code slug').lean<LeanState>().exec(),
      this.yearModel.findById(yearId).select('year').lean<{ year: string }>().exec(),
    ]);
    if (!state) throw new NotFoundException(`State ${stateId} not found`);
    if (!year) throw new NotFoundException(`Year ${yearId} not found`);

    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const ulbIds = expectedUlbs.map((ulb) => ulb.ulbId);

    const [allocation, conditions, submitted] = await Promise.all([
      this.grantAllocationModel
        .findOne({ stateId: new Types.ObjectId(stateId), yearId: new Types.ObjectId(yearId) })
        .select('basic performance')
        .lean<LeanAllocation>()
        .exec(),
      this.stateConditions.resolve(yearId, [stateId]),
      this.ulbProgressService.loadSubmittedUlbIdsByForm(yearId, ulbIds),
    ]);

    const stateConditions = conditions.get(stateId)!;

    return {
      year: { id: yearId, label: year.year },
      state: {
        id: stateId,
        code: state.code,
        name: state.name,
        slug: state.slug ?? '',
        stage: stateConditions.stage,
      },
      allocation: toCrore(allocation ? allocationRupees(allocation) : 0),
      forms: stateConditions.forms,
      formsDone: stateConditions.formsDone,
      ulbForms: {
        totalUlbs: ulbIds.length,
        items: MOHUA_STATE_DETAIL_ULB_FORMS.map((form) => ({
          key: form.key,
          label: form.label,
          completed: ulbIds.filter((ulbId) => submitted[form.source].has(ulbId)).length,
        })),
      },
    };
  }
}
