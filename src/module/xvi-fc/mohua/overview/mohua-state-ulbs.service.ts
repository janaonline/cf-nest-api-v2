import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { State } from 'src/schemas/state.schema';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { ExpectedUlbSetService, type ExpectedUlb } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { DF_FORM_TYPE } from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import { MohuaOverviewUlbProgressService } from './mohua-overview-ulb-progress.service';
import { MOHUA_OVERVIEW_INSTALMENT, MOHUA_STATE_ULBS_DEFAULT_LIMIT } from './mohua-overview.constants';
import { toCrore } from './mohua-overview.util';
import type { GetMohuaStateUlbsQueryDto } from './mohua-state-ulbs-query.dto';
import type { MohuaStateUlbRow, MohuaStateUlbs } from './mohua-state-ulbs.types';

type LeanForm = { _id: Types.ObjectId; activeDatasetVersion?: number };
type LeanAllocationRow = { ulbId?: Types.ObjectId | null; totalGrantAllocation?: number };
type LeanElectedBodyRow = { ulbId?: Types.ObjectId; electedBodyStatus?: string };

/** ULB-wise progress for one state: the state's expected ULBs with allocation, elected body and per-form submission. */
@Injectable()
export class MohuaStateUlbsService {
  constructor(
    @InjectModel(State.name) private readonly stateModel: Model<State>,
    @InjectModel(DevolutionFormulaForm.name) private readonly devolutionFormModel: Model<DevolutionFormulaForm>,
    @InjectModel(DevolutionFormulaRow.name) private readonly devolutionRowModel: Model<DevolutionFormulaRow>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly electedBodyFormModel: Model<ElectedUrbanLocalBodiesForm>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly electedBodyRowModel: Model<ElectedUrbanLocalBodiesRow>,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly ulbProgressService: MohuaOverviewUlbProgressService,
  ) {}

  async list(stateId: string, yearId: string, query: GetMohuaStateUlbsQueryDto): Promise<MohuaStateUlbs> {
    if (!(await this.stateModel.exists({ _id: new Types.ObjectId(stateId) }))) {
      throw new NotFoundException(`State ${stateId} not found`);
    }

    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const [allocationByUlb, electedBodyByUlb, submitted] = await Promise.all([
      this.loadAllocations(stateId, yearId),
      this.loadElectedBodies(stateId, yearId),
      this.ulbProgressService.loadSubmittedUlbIdsByForm(
        yearId,
        expectedUlbs.map((ulb) => ulb.ulbId),
      ),
    ]);

    const rows = expectedUlbs.map(
      (ulb): MohuaStateUlbRow => ({
        ulbId: ulb.ulbId,
        name: ulb.name,
        censusCode: ulb.censusCode ?? ulb.sbCode ?? null,
        allocation: allocationByUlb.has(ulb.ulbId) ? toCrore(allocationByUlb.get(ulb.ulbId)!) : null,
        electedBody: electedBodyByUlb.get(ulb.ulbId) ?? null,
        forms: {
          audited: submitted.audited.has(ulb.ulbId),
          unaudited: submitted.unaudited.has(ulb.ulbId),
          pfms: submitted.pfms.has(ulb.ulbId),
          slb: submitted.slb.has(ulb.ulbId),
          dur: submitted.dur.has(ulb.ulbId),
        },
      }),
    );

    const matching = this.search(rows, expectedUlbs, query.search);
    const sorted = this.sort(matching, query.sortBy ?? 'ulbName', query.sortDir ?? 'asc');

    const limit = query.limit ?? MOHUA_STATE_ULBS_DEFAULT_LIMIT;
    const totalPages = Math.max(1, Math.ceil(sorted.length / limit));
    const page = Math.min(query.page ?? 1, totalPages);

    return {
      items: sorted.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: sorted.length, totalPages },
    };
  }

  /** ulbId -> the ULB's total grant allocation (rupees) from the state's instalment-1 Devolution Formula active dataset. */
  private async loadAllocations(stateId: string, yearId: string): Promise<Map<string, number>> {
    const form = await this.devolutionFormModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment: MOHUA_OVERVIEW_INSTALMENT,
        formType: DF_FORM_TYPE,
        isActive: true,
      })
      .select('_id activeDatasetVersion')
      .lean<LeanForm>()
      .exec();
    if (!form) return new Map();

    const rows = await this.devolutionRowModel
      .find({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true, ulbId: { $ne: null } })
      .select('ulbId totalGrantAllocation')
      .lean<LeanAllocationRow[]>()
      .exec();

    return new Map(
      rows
        .filter(
          (row): row is Required<LeanAllocationRow> => !!row.ulbId && typeof row.totalGrantAllocation === 'number',
        )
        .map((row) => [String(row.ulbId), row.totalGrantAllocation]),
    );
  }

  /** ulbId -> the elected-body status as uploaded by the state (active dataset). */
  private async loadElectedBodies(stateId: string, yearId: string): Promise<Map<string, string>> {
    const form = await this.electedBodyFormModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isActive: true,
        isDeleted: { $ne: true },
      })
      .select('_id activeDatasetVersion')
      .lean<LeanForm>()
      .exec();
    if (!form) return new Map();

    const rows = await this.electedBodyRowModel
      .find({ form: form._id, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true, ulbId: { $ne: null } })
      .select('ulbId electedBodyStatus')
      .lean<LeanElectedBodyRow[]>()
      .exec();

    return new Map(
      rows
        .filter((row): row is Required<LeanElectedBodyRow> => !!row.ulbId && !!row.electedBodyStatus)
        .map((row) => [String(row.ulbId), row.electedBodyStatus]),
    );
  }

  /** Case-insensitive match on ULB name, census code or SB code. */
  private search(rows: MohuaStateUlbRow[], expectedUlbs: ExpectedUlb[], search?: string): MohuaStateUlbRow[] {
    const term = search?.trim().toLowerCase();
    if (!term) return rows;

    const sbCodeById = new Map(expectedUlbs.map((ulb) => [ulb.ulbId, ulb.sbCode?.toLowerCase() ?? '']));
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(term) ||
        (row.censusCode ?? '').toLowerCase().includes(term) ||
        (sbCodeById.get(row.ulbId) ?? '').includes(term),
    );
  }

  /** Allocation sort puts ULBs without an allocation last in both directions; ties fall back to name. */
  private sort(
    rows: MohuaStateUlbRow[],
    sortBy: 'ulbName' | 'allocation',
    sortDir: 'asc' | 'desc',
  ): MohuaStateUlbRow[] {
    const direction = sortDir === 'asc' ? 1 : -1;
    const byName = (a: MohuaStateUlbRow, b: MohuaStateUlbRow) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

    return [...rows].sort((a, b) => {
      if (sortBy === 'ulbName') return direction * byName(a, b);
      if (a.allocation === null && b.allocation === null) return byName(a, b);
      if (a.allocation === null) return 1;
      if (b.allocation === null) return -1;
      return direction * (a.allocation - b.allocation) || byName(a, b);
    });
  }
}
