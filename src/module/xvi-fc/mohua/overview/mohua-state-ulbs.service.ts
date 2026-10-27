import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import ExcelJS from 'exceljs';
import { Model, Types } from 'mongoose';
import { getTimeStamp } from 'src/shared/utils/date.utils';
import { State } from 'src/schemas/state.schema';
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
import { ExpectedUlbSetService, type ExpectedUlb } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { DF_FORM_TYPE } from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import { MohuaOverviewUlbProgressService } from './mohua-overview-ulb-progress.service';
import {
  MOHUA_OVERVIEW_INSTALMENT,
  MOHUA_STATE_ULBS_DEFAULT_LIMIT,
  MOHUA_STATE_ULBS_EXPORT_NOT_SUBMITTED,
  MOHUA_STATE_ULBS_EXPORT_SUBMITTED,
  MOHUA_STATE_ULBS_ULB_FORM_TICK_STATUSES,
  MOHUA_STATE_ULBS_VISIBLE_STATE_FORM_STATUSES,
} from './mohua-overview.constants';
import { toCrore } from './mohua-overview.util';
import type { GetMohuaStateUlbsQueryDto } from './mohua-state-ulbs-query.dto';
import type { MohuaStateUlbRow, MohuaStateUlbs } from './mohua-state-ulbs.types';

type LeanForm = { _id: Types.ObjectId; currentFormStatus?: number; activeDatasetVersion?: number };

/** True when the state's form is far enough along for its per-ULB values to be shown in this table. */
const isVisible = (form: LeanForm | null): form is LeanForm =>
  !!form && MOHUA_STATE_ULBS_VISIBLE_STATE_FORM_STATUSES.has(form.currentFormStatus ?? -1);
type LeanAllocationRow = { ulbId?: Types.ObjectId | null; totalGrantAllocation?: number };
type LeanElectedBodyRow = { ulbId?: Types.ObjectId; electedBodyStatus?: string };
type LeanUnspentRow = { ulbId?: Types.ObjectId; unspentAmount?: number | null };

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
    @InjectModel(XviFcUnspentStateForm.name) private readonly unspentFormModel: Model<XviFcUnspentStateForm>,
    @InjectModel(XviFcUnspentStateFormRow.name) private readonly unspentRowModel: Model<XviFcUnspentStateFormRow>,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly ulbProgressService: MohuaOverviewUlbProgressService,
  ) {}

  async list(stateId: string, yearId: string, query: GetMohuaStateUlbsQueryDto): Promise<MohuaStateUlbs> {
    if (!(await this.stateModel.exists({ _id: new Types.ObjectId(stateId) }))) {
      throw new NotFoundException(`State ${stateId} not found`);
    }

    const sorted = await this.resolveRows(stateId, yearId, query);

    const limit = query.limit ?? MOHUA_STATE_ULBS_DEFAULT_LIMIT;
    const totalPages = Math.max(1, Math.ceil(sorted.length / limit));
    const page = Math.min(query.page ?? 1, totalPages);

    return {
      items: sorted.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: sorted.length, totalPages },
    };
  }

  /**
   * The table as an Excel file: every ULB the table would list for the same search and sort (all pages, no paging),
   * with each form as "Submitted" / "Not submitted" instead of the table's tick and cross.
   */
  async exportToExcel(
    stateId: string,
    yearId: string,
    query: GetMohuaStateUlbsQueryDto,
  ): Promise<{ buffer: ExcelJS.Buffer; fileName: string }> {
    const state = await this.stateModel
      .findById(new Types.ObjectId(stateId))
      .select('name')
      .lean<{ name: string }>()
      .exec();
    if (!state) throw new NotFoundException(`State ${stateId} not found`);

    const rows = await this.resolveRows(stateId, yearId, query);
    const status = (submitted: boolean) =>
      submitted ? MOHUA_STATE_ULBS_EXPORT_SUBMITTED : MOHUA_STATE_ULBS_EXPORT_NOT_SUBMITTED;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ULB-wise progress');
    sheet.columns = [
      { header: 'ULB Name', key: 'name', width: 44 },
      { header: 'Census Code', key: 'censusCode', width: 14 },
      { header: 'Allocation (₹ cr)', key: 'allocation', width: 18, style: { numFmt: '0.00' } },
      { header: 'Unspent Balance (₹ cr)', key: 'unspentAmount', width: 22, style: { numFmt: '0.00' } },
      { header: 'Elected Body', key: 'electedBody', width: 18 },
      { header: 'Audited', key: 'audited', width: 16 },
      { header: 'Provisional', key: 'unaudited', width: 16 },
      { header: 'PFMS', key: 'pfms', width: 16 },
      { header: 'SLB', key: 'slb', width: 16 },
      { header: 'DUR', key: 'dur', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.addRows(
      rows.map((row) => ({
        name: row.name,
        censusCode: row.censusCode ?? '',
        allocation: row.allocation,
        unspentAmount: row.unspentAmount,
        electedBody: row.electedBody ?? '',
        audited: status(row.forms.audited),
        unaudited: status(row.forms.unaudited),
        pfms: status(row.forms.pfms),
        slb: status(row.forms.slb),
        dur: status(row.forms.dur),
      })),
    );

    const slug = state.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return {
      buffer: await workbook.xlsx.writeBuffer(),
      fileName: `${slug || 'state'}-ulb-progress_${getTimeStamp(false)}.xlsx`,
    };
  }

  /** The state's ULBs after search and sort — every page. Shared by the table (which then pages it) and the export. */
  private async resolveRows(
    stateId: string,
    yearId: string,
    query: GetMohuaStateUlbsQueryDto,
  ): Promise<MohuaStateUlbRow[]> {
    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const [allocationByUlb, unspentByUlb, electedBodyByUlb, submitted] = await Promise.all([
      this.loadAllocations(stateId, yearId),
      this.loadUnspentAmounts(stateId, yearId),
      this.loadElectedBodies(stateId, yearId),
      this.ulbProgressService.loadSubmittedUlbIdsByForm(
        yearId,
        expectedUlbs.map((ulb) => ulb.ulbId),
        MOHUA_STATE_ULBS_ULB_FORM_TICK_STATUSES,
      ),
    ]);

    const rows = expectedUlbs.map(
      (ulb): MohuaStateUlbRow => ({
        ulbId: ulb.ulbId,
        name: ulb.name,
        censusCode: ulb.censusCode ?? ulb.sbCode ?? null,
        allocation: allocationByUlb.has(ulb.ulbId) ? toCrore(allocationByUlb.get(ulb.ulbId)!) : null,
        unspentAmount: unspentByUlb.has(ulb.ulbId) ? toCrore(unspentByUlb.get(ulb.ulbId)!) : null,
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
    return this.sort(matching, query.sortBy ?? 'ulbName', query.sortDir ?? 'asc');
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
      .select('_id currentFormStatus activeDatasetVersion')
      .lean<LeanForm>()
      .exec();
    if (!isVisible(form)) return new Map();

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

  /**
   * ulbId -> the ULB's FC Unspent balance (rupees) from the state's FC Unspent declaration for the year: the form is found
   * by state and year, then its active rows by ULB. A ULB with no row, or a draft row whose figure is not entered yet
   * (`unspentAmount: null`), is left out.
   */
  private async loadUnspentAmounts(stateId: string, yearId: string): Promise<Map<string, number>> {
    const form = await this.unspentFormModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: FC_UNSPENT_STATE_FORM_TYPE,
        isDeleted: false,
      })
      .select('_id currentFormStatus')
      .lean<LeanForm>()
      .exec();
    if (!isVisible(form)) return new Map();

    const rows = await this.unspentRowModel
      .find({ form: form._id, isActive: true, ulbId: { $ne: null } })
      .select('ulbId unspentAmount')
      .lean<LeanUnspentRow[]>()
      .exec();

    return new Map(
      rows
        .filter((row): row is Required<LeanUnspentRow> & { unspentAmount: number } => !!row.ulbId && typeof row.unspentAmount === 'number')
        .map((row) => [String(row.ulbId), row.unspentAmount]),
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
      .select('_id currentFormStatus activeDatasetVersion')
      .lean<LeanForm>()
      .exec();
    if (!isVisible(form)) return new Map();

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
