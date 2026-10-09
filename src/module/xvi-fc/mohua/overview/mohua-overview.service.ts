import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { GrantAllocation } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { MohuaOverviewUlbProgressService } from './mohua-overview-ulb-progress.service';
import { MohuaStateConditionsService } from './mohua-state-conditions.service';
import {
  MOHUA_OVERVIEW_ANNUAL_ALLOCATION_CRORE,
  MOHUA_OVERVIEW_INSTALMENT_1_CRORE,
  MOHUA_OVERVIEW_STAGE,
} from './mohua-overview.constants';
import { allocationRupees, toCrore } from './mohua-overview.util';
import type { MohuaOverview, MohuaOverviewState } from './mohua-overview.types';

type LeanState = { _id: Types.ObjectId; name: string; code: string; slug?: string };
type LeanAllocation = { stateId: Types.ObjectId; basic: number; performance: number };

/**
 * Cross-state overview for MoHUA: every active state (union territories excluded) with its five condition-form statuses,
 * allocation (basic + performance) and expected-ULB count, merged from the `states` collection.
 */
@Injectable()
export class MohuaOverviewService {
  constructor(
    @InjectModel(State.name) private readonly stateModel: Model<State>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    @InjectModel(GrantAllocation.name) private readonly grantAllocationModel: Model<GrantAllocation>,
    private readonly stateConditions: MohuaStateConditionsService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly ulbProgressService: MohuaOverviewUlbProgressService,
  ) {}

  async getOverview(yearId: string): Promise<MohuaOverview> {
    const year = await this.yearModel.findById(yearId).select('year').lean<{ year: string }>().exec();
    if (!year) throw new NotFoundException(`Year ${yearId} not found`);

    const [states, allocations, ulbIdsByState, submittedUlbs] = await Promise.all([
      this.stateModel
        .find({ isActive: true, isUT: { $ne: true }, accessToXVFC: { $ne: false } })
        .select('name code slug')
        .sort({ name: 1 })
        .lean<LeanState[]>()
        .exec(),
      this.grantAllocationModel
        .find({ yearId: new Types.ObjectId(yearId) })
        .select('stateId basic performance')
        .lean<LeanAllocation[]>()
        .exec(),
      this.expectedUlbSetService.idsByState(yearId),
      this.ulbProgressService.loadSubmittedUlbIdsByForm(yearId),
    ]);

    const conditions = await this.stateConditions.resolve(
      yearId,
      states.map((state) => String(state._id)),
    );
    const allocationByState = new Map(allocations.map((a) => [String(a.stateId), allocationRupees(a)]));

    const rows = states.map((state): MohuaOverviewState => {
      const id = String(state._id);
      const stateConditions = conditions.get(id)!;
      const ulbIds = ulbIdsByState.get(id) ?? [];

      return {
        id,
        code: state.code,
        name: state.name,
        slug: state.slug ?? '',
        stage: stateConditions.stage,
        underReviewSince: stateConditions.underReviewSince,
        allocation: toCrore(allocationByState.get(id) ?? 0),
        eligible: null,
        ulbsDone: ulbIds.filter((ulbId) => submittedUlbs.all.has(ulbId)).length,
        ulbsTotal: ulbIds.length,
        formsDone: stateConditions.formsDone,
        forms: stateConditions.forms,
      };
    });

    const stageCounts = {
      [MOHUA_OVERVIEW_STAGE.NOT_STARTED]: 0,
      [MOHUA_OVERVIEW_STAGE.IN_PROGRESS]: 0,
      [MOHUA_OVERVIEW_STAGE.UNDER_REVIEW]: 0,
    };
    for (const row of rows) stageCounts[row.stage]++;

    return {
      year: { id: yearId, label: year.year },
      totals: {
        stateCount: rows.length,
        ulbsCovered: rows.reduce((sum, row) => sum + row.ulbsTotal, 0),
        allocation: MOHUA_OVERVIEW_ANNUAL_ALLOCATION_CRORE,
        instalment1: MOHUA_OVERVIEW_INSTALMENT_1_CRORE,
        stageCounts,
      },
      states: rows,
    };
  }
}
