import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { FORM_STATUS, getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { resolveStateScopeFilter } from 'src/module/xvi-fc/common/utils/xvi-fc-scope-filter.util';
import { State, type StateDocument } from 'src/schemas/state.schema';
import { Ulb, type UlbDocument } from 'src/schemas/ulb.schema';
import { Year, type YearDocument } from 'src/schemas/year.schema';
import { XviFcAnnualAccount, type XviFcAnnualAccountDocument } from 'src/schemas/xvi-fc/annual-account.schema';
import { GrantAllocation, type GrantAllocationDocument } from 'src/schemas/xvi-fc/grant-allocation.schema';
import {
  DevolutionFormulaForm,
  type DevolutionFormulaFormDocument,
  DEVOLUTION_FORMULA_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
  type EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  SFC_STATUS_FORM_TYPE,
  XviFcSfcStatus,
  type XviFcSfcStatusDocument,
} from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcUnspentBalanceDisclosure,
  type XviFcUnspentBalanceDisclosureDocument,
} from 'src/schemas/xvi-fc/unspent-balance-disclosure.schema';
import { XviFcBankAccount, type XviFcBankAccountDocument } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { SlbForm, type SlbFormDocument } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import type { GetStateDashboardParamsDto } from './dto/get-state-dashboard-params.dto';
import type { ExportAllFormsQueryDto } from './dto/export-all-forms-query.dto';
import {
  STATE_DASHBOARD_AMOUNT_UNIT,
  STATE_DASHBOARD_CLAIM_LETTER_KEY,
  STATE_DASHBOARD_CLAIM_LETTER_ORDER,
  STATE_DASHBOARD_CLAIM_LETTER_STATUS,
  STATE_DASHBOARD_COMPLETED_STATE_FORM_STATUSES,
  STATE_DASHBOARD_COMPLETED_ULB_FORM_STATUSES,
  STATE_DASHBOARD_CURRENCY,
  STATE_DASHBOARD_ERROR_CODE,
  STATE_DASHBOARD_FINAL_ELIGIBLE_FORM_STATUS,
  STATE_DASHBOARD_FORM_KEY,
  STATE_DASHBOARD_FORM_LABELS,
  STATE_DASHBOARD_FORM_ORDER,
  STATE_DASHBOARD_IN_PROGRESS_FORM_STATUSES,
  STATE_DASHBOARD_KNOWN_FORM_STATUSES,
  STATE_DASHBOARD_NOT_STARTED_FORM_STATUSES,
  STATE_DASHBOARD_TASK_KEY,
  STATE_DASHBOARD_TASK_ORDER,
  STATE_DASHBOARD_TASK_STATUS,
  STATE_DASHBOARD_ULB_STATUS_CONTENT,
  STATE_DASHBOARD_ULB_STATUS_ORDER,
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS,
} from './state-dashboard.constants';
import type {
  StateDashboardClaimLetterKey,
  StateDashboardFormKey,
  StateDashboardTaskKey,
  StateDashboardUlbSubmissionStatus,
} from './state-dashboard.constants';
import type {
  StateDashboardApiResponse,
  StateDashboardClaimLetterItem,
  StateDashboardData,
  StateDashboardFormCompletionItem,
  StateDashboardTask,
  StateDashboardUlbSubmissionSummaryItem,
} from './state-dashboard.types';

interface StateContextRecord {
  _id: Types.ObjectId;
  name: string;
}

interface YearContextRecord {
  _id: Types.ObjectId;
  year: string;
}

interface GrantAllocationRecord {
  basic: number;
  performance: number;
}

interface StateFormStatusRecord {
  _id: Types.ObjectId;
  currentFormStatus: FormStatusType;
}

interface StateConditionSnapshot {
  sfcStatus: StateFormStatusRecord | null;
  electedBodyStatus: StateFormStatusRecord | null;
}

interface ActiveUlbRecord {
  _id: Types.ObjectId;
}

interface AnnualAccountStatusRecord {
  ulb: Types.ObjectId;
  sectionType: 'audited' | 'unaudited';
  form_status_id?: number | null;
}

interface PfmsBankAccountStatusRecord {
  ulb: Types.ObjectId;
  currentFormStatus?: FormStatusType | null;
}

type UnspentBalanceFormStatus = 'DRAFT' | 'SUBMITTED';

interface UnspentBalanceStatusRecord {
  ulb: Types.ObjectId;
  formStatus?: UnspentBalanceFormStatus | null;
}

interface StateDashboardUlbFormStatusMaps {
  annualAccounts: Map<string, FormStatusType | null>;
  provisionalAccounts: Map<string, FormStatusType | null>;
  pfmsBankAccount: Map<string, FormStatusType | null>;
  fcUnspentBalance: Map<string, FormStatusType | null>;
  serviceLevelBenchmarks: Map<string, FormStatusType | null>;
}

interface StateDashboardUlbFormSnapshot {
  ulbId: string;
  annualAccountsStatus: FormStatusType | null;
  provisionalAccountsStatus: FormStatusType | null;
  pfmsBankAccountStatus: FormStatusType | null;
  fcUnspentBalanceStatus: FormStatusType | null;
  serviceLevelBenchmarkStatus: FormStatusType | null;
  exemptionRequested: boolean;
}

interface ResolvedState {
  stateId: string;
  stateName: string;
}

interface ResolvedYear {
  yearId: string;
  financialYear: string;
}

interface ResolvedStateDashboardAccessContext extends ResolvedState, ResolvedYear {
  userRole: string;
}

@Injectable()
export class StateDashboardService {
  constructor(
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(GrantAllocation.name)
    private readonly grantAllocationModel: Model<GrantAllocationDocument>,
    @InjectModel(DevolutionFormulaForm.name)
    private readonly devolutionFormulaModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(XviFcSfcStatus.name)
    private readonly sfcStatusModel: Model<XviFcSfcStatusDocument>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly electedBodyModel: Model<EulbFormDocument>,
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcBankAccount.name)
    private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    @InjectModel(XviFcUnspentBalanceDisclosure.name)
    private readonly unspentBalanceModel: Model<XviFcUnspentBalanceDisclosureDocument>,
    @InjectModel(SlbForm.name)
    private readonly slbFormModel: Model<SlbFormDocument>,
  ) {}

  async getDashboard(params: GetStateDashboardParamsDto, user: AuthUser): Promise<StateDashboardApiResponse> {
    const accessContext = await this.resolveAccessContext(params, user);
    const [activeUlbIds, grantAllocation, devolutionFormula, stateConditionSnapshot] = await Promise.all([
      this.loadActiveUlbIds(accessContext.stateId),
      this.loadGrantAllocation(accessContext.stateId, accessContext.yearId),
      this.loadDevolutionFormula(accessContext.stateId, accessContext.yearId),
      this.loadStateConditionSnapshot(accessContext.stateId, accessContext.yearId),
    ]);

    const totalUlbs = activeUlbIds.length;
    const formStatusMaps = await this.loadUlbFormStatusMaps(activeUlbIds, accessContext.yearId);
    const ulbFormSnapshots = this.buildUlbFormSnapshots(activeUlbIds, formStatusMaps);
    const ulbSubmissionSummary = this.buildUlbSubmissionSummary(ulbFormSnapshots);
    const formCompletion = this.buildFormCompletion(ulbFormSnapshots, totalUlbs);
    const eligibleUlbs = this.getEligibleUlbCount(ulbSubmissionSummary);
    const compliance = {
      rate: this.calculateComplianceRate(eligibleUlbs, totalUlbs),
      compliantUlbs: eligibleUlbs,
      totalUlbs,
    };
    const claimLetters = this.buildClaimLetters(eligibleUlbs);

    const allocatedAmount = this.calculateAllocatedAmount(grantAllocation);
    const stateDataTasks = this.buildStateDataTasks(totalUlbs, devolutionFormula, stateConditionSnapshot);

    // TODO: Replace with claim-letter aggregation when the claim-letter model is implemented.
    const claimedAmount = 0;

    // TODO: Populate grant type when an authoritative source is implemented.
    const grantType = null;

    const dashboardData: StateDashboardData = {
      context: {
        ...accessContext,
        grantType,
      },
      metrics: {
        totalUlbs,
        allocatedAmount,
        claimedAmount,
        amountUnit: STATE_DASHBOARD_AMOUNT_UNIT.RUPEE,
        currency: STATE_DASHBOARD_CURRENCY.INR,
        compliance,
      },
      stateDataTasks,
      ulbSubmissionSummary,
      formCompletion,
      claimLetters,
    };

    return xviFcSuccess('State dashboard fetched successfully', dashboardData);
  }

  /**
   * Combined "every ULB × every ULB-facing form" Excel workbook — one row per ULB with its status
   * on each of Audited/Provisional Annual Account, PFMS Bank Account, and SLB, for the "Export
   * Data" button on the Review ULB Submissions page. Always the full, unfiltered ULB list for the
   * state/year — unlike the per-form exports it replaces, this ignores the page's own
   * form/bucket/search state.
   */
  async exportAllFormsCsv(dto: ExportAllFormsQueryDto, user: AuthUser): Promise<{ fileName: string; buffer: Buffer }> {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may export ULB submissions');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }

    const stateId = resolveStateScopeFilter(user, dto.stateId);
    const yearObjectId = new Types.ObjectId(dto.designYearId);

    const ulbMatch: Record<string, unknown> = { isActive: true };
    if (stateId) ulbMatch.state = stateId;

    const [ulbs, stateDoc, yearDoc] = await Promise.all([
      this.ulbModel
        .find(ulbMatch)
        .select({ _id: 1, name: 1, censusCode: 1, sbCode: 1 })
        .sort({ name: 1 })
        .lean<Array<{ _id: Types.ObjectId; name: string; censusCode?: string; sbCode?: string }>>()
        .exec(),
      stateId
        ? this.stateModel.findOne({ _id: stateId, isActive: true }).select({ name: 1 }).lean<{ name: string }>().exec()
        : null,
      this.yearModel.findOne({ _id: yearObjectId }).select({ year: 1 }).lean<{ year: string }>().exec(),
    ]);

    // stateId is only non-null when it was actually resolved (the STATE user's own state, or an
    // ADMIN-supplied stateId) — a miss here means that state no longer exists/is inactive, not
    // "no state was requested". Left unchecked, the report would silently mislabel itself "State:
    // All States" instead of surfacing that the requester's own state record is gone.
    if (stateId && !stateDoc) {
      throw new NotFoundException('The requested State was not found.');
    }
    if (!yearDoc) {
      throw new NotFoundException('The requested XVI-FC design year was not found.');
    }

    const ulbIds = ulbs.map((ulb) => ulb._id);

    const [annualAccountRecords, bankAccountRecords, slbRecords] = await Promise.all([
      this.annualAccountModel
        .find({ ulb: { $in: ulbIds }, design_year: yearObjectId })
        .select({ _id: 0, ulb: 1, sectionType: 1, form_status_id: 1 })
        .lean<Array<{ ulb: Types.ObjectId; sectionType: 'audited' | 'unaudited'; form_status_id?: number | null }>>()
        .exec(),
      this.bankAccountModel
        .find({ ulb: { $in: ulbIds }, designYear: yearObjectId })
        .select({ _id: 0, ulb: 1, currentFormStatus: 1 })
        .lean<Array<{ ulb: Types.ObjectId; currentFormStatus?: number | null }>>()
        .exec(),
      this.slbFormModel
        .find({ ulb: { $in: ulbIds }, year: yearObjectId })
        .select({ _id: 0, ulb: 1, currentFormStatus: 1 })
        .lean<Array<{ ulb: Types.ObjectId; currentFormStatus?: number | null }>>()
        .exec(),
    ]);

    const auditedByUlb = new Map<string, number>();
    const provisionalByUlb = new Map<string, number>();
    for (const record of annualAccountRecords) {
      const map = record.sectionType === 'audited' ? auditedByUlb : provisionalByUlb;
      map.set(record.ulb.toString(), record.form_status_id ?? FORM_STATUS.NOT_STARTED);
    }
    const bankAccountByUlb = new Map(
      bankAccountRecords.map((r) => [r.ulb.toString(), r.currentFormStatus ?? FORM_STATUS.NOT_STARTED]),
    );
    const slbByUlb = new Map(slbRecords.map((r) => [r.ulb.toString(), r.currentFormStatus ?? FORM_STATUS.NOT_STARTED]));

    const headers = ['ULB Name', 'Census Code', 'Audited Form', 'Provisional Form', 'PFMS Bank Account', 'SLB Form'];
    const rows = ulbs.map((ulb) => {
      const id = ulb._id.toString();
      return [
        ulb.name,
        ulb.censusCode || ulb.sbCode || '',
        getFormStatusLabel(auditedByUlb.get(id) ?? FORM_STATUS.NOT_STARTED),
        getFormStatusLabel(provisionalByUlb.get(id) ?? FORM_STATUS.NOT_STARTED),
        getFormStatusLabel(bankAccountByUlb.get(id) ?? FORM_STATUS.NOT_STARTED),
        getFormStatusLabel(slbByUlb.get(id) ?? FORM_STATUS.NOT_STARTED),
      ];
    });

    const stateName = stateDoc?.name ?? 'All States';
    const fyLabel = yearDoc?.year ? `FY ${yearDoc.year}` : '';
    const now = new Date();

    const buffer = await this.buildAllFormsWorkbookBuffer(headers, rows, stateName, fyLabel, now);
    const fileName = `${this.slugifyForFileName(stateName)}_all_ulb_submissions_${this.formatFileDate(now)}.xlsx`;

    return { fileName, buffer };
  }

  /** Title block (brand colors) + colored header row + footer contact strip, around the plain
   *  ULB × form-status table — kept as its own method since exportAllFormsCsv's own body is
   *  already long enough without the styling detail mixed in. */
  private async buildAllFormsWorkbookBuffer(
    headers: string[],
    rows: string[][],
    stateName: string,
    fyLabel: string,
    now: Date,
  ): Promise<Buffer> {
    const columnWidths = [32, 16, 20, 20, 20, 16];
    const lastColLetter = String.fromCharCode('A'.charCodeAt(0) + columnWidths.length - 1);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ULB Submissions');
    sheet.columns = columnWidths.map((width) => ({ width }));

    // Every row number below is tracked explicitly (never via addRow's own auto-increment) so the
    // title/subtitle/meta block, the blank spacer rows, and the data table can't drift relative
    // to each other regardless of how ExcelJS internally accounts for touched-but-empty rows.
    let rowNum = 1;

    sheet.mergeCells(`A${rowNum}:${lastColLetter}${rowNum}`);
    const titleCell = sheet.getCell(`A${rowNum}`);
    titleCell.value = `City Finance - 16th Finance Commission${fyLabel ? ` - ${fyLabel}` : ''}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(rowNum).height = 26;
    rowNum++;

    sheet.mergeCells(`A${rowNum}:${lastColLetter}${rowNum}`);
    const subtitleCell = sheet.getCell(`A${rowNum}`);
    subtitleCell.value = 'ULB Submissions - All Forms';
    subtitleCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B6EA5' } };
    subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(rowNum).height = 20;
    rowNum++;

    sheet.mergeCells(`A${rowNum}:${lastColLetter}${rowNum}`);
    const metaCell = sheet.getCell(`A${rowNum}`);
    metaCell.value = `State: ${stateName}  |  Generated on: ${this.formatIstTimestamp(now)}`;
    metaCell.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    rowNum++;

    rowNum++; // blank spacer row before the table

    headers.forEach((label, colIndex) => {
      const cell = sheet.getCell(rowNum, colIndex + 1);
      cell.value = label;
      cell.font = { bold: true, color: { argb: 'FF0D6EFD' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F1FF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    rowNum++;

    for (const row of rows) {
      row.forEach((value, colIndex) => {
        sheet.getCell(rowNum, colIndex + 1).value = value;
      });
      rowNum++;
    }

    rowNum++; // blank spacer row before the footer

    sheet.mergeCells(`A${rowNum}:${lastColLetter}${rowNum}`);
    const footerCell = sheet.getCell(`A${rowNum}`);
    footerCell.value =
      'This is a system-generated report. For questions on the data, please contact: 16fc.grant@cityfinance.in';
    footerCell.font = { italic: true, size: 9, color: { argb: 'FF777777' } };
    footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F9' } };
    footerCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const excelBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(excelBuffer as ArrayBuffer);
  }

  /** "16-Sep-2026 8:00AM" — IST, matching every other reminder/digest email's timezone convention. */
  private formatIstTimestamp(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const meridiem = (byType['dayPeriod'] ?? '').toUpperCase();
    return `${byType['day']}-${byType['month']}-${byType['year']} ${byType['hour']}:${byType['minute']}${meridiem}`;
  }

  /** "25_02_2026" (IST) — the date component of the dynamic filename. */
  private formatFileDate(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${byType['day']}_${byType['month']}_${byType['year']}`;
  }

  /** "Andhra Pradesh" → "andhra_pradesh", for the dynamic filename's state segment. */
  private slugifyForFileName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private hasStateAccess(user: AuthUser, requestedStateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope !== Scope.STATE) return false;

    const userStateId = toObjectIdString(user.state);
    return userStateId !== null && userStateId === requestedStateId;
  }

  private assertStateAccess(user: AuthUser, requestedStateId: string): void {
    if (this.hasStateAccess(user, requestedStateId)) return;

    const message =
      user.scope === Scope.STATE
        ? 'The selected State is not assigned to the current user.'
        : 'State dashboard access is not permitted for the current user.';

    throw new ForbiddenException({
      code: STATE_DASHBOARD_ERROR_CODE.STATE_ACCESS_DENIED,
      message,
    });
  }

  private async loadState(stateId: string): Promise<ResolvedState> {
    const state = await this.stateModel
      .findOne({ _id: new Types.ObjectId(stateId), isActive: true })
      .select({ _id: 1, name: 1, isActive: 1 })
      .lean<StateContextRecord>()
      .exec();

    if (!state) {
      throw new NotFoundException({
        code: STATE_DASHBOARD_ERROR_CODE.STATE_NOT_FOUND,
        message: 'State dashboard data is unavailable because the selected State was not found.',
      });
    }

    return {
      stateId: state._id.toString(),
      stateName: state.name,
    };
  }

  private async loadYear(yearId: string): Promise<ResolvedYear> {
    const year = await this.yearModel
      .findOne({ _id: new Types.ObjectId(yearId), isActive: true })
      .select({ _id: 1, year: 1, isActive: 1 })
      .lean<YearContextRecord>()
      .exec();

    if (!year) {
      throw new NotFoundException({
        code: STATE_DASHBOARD_ERROR_CODE.YEAR_NOT_FOUND,
        message: 'State dashboard data is unavailable because the selected XVI-FC year was not found.',
      });
    }

    return {
      yearId: year._id.toString(),
      financialYear: year.year,
    };
  }

  private async loadActiveUlbIds(stateId: string): Promise<string[]> {
    const records = await this.ulbModel
      .find({ state: new Types.ObjectId(stateId), isActive: true })
      .select({ _id: 1 })
      .lean<ActiveUlbRecord[]>()
      .exec();

    return records.map((record) => record._id.toString());
  }

  private loadGrantAllocation(stateId: string, yearId: string): Promise<GrantAllocationRecord | null> {
    return this.grantAllocationModel
      .findOne({
        stateId: new Types.ObjectId(stateId),
        yearId: new Types.ObjectId(yearId),
      })
      .select({ _id: 0, basic: 1, performance: 1 })
      .lean<GrantAllocationRecord>()
      .exec();
  }

  private calculateAllocatedAmount(allocation: GrantAllocationRecord | null): number {
    // Defensive rounding — GrantAllocation is externally written and unconstrained (see
    // grant-allocation.schema.ts).
    return allocation ? Math.round(allocation.basic + allocation.performance) : 0;
  }

  private async loadUlbFormStatusMaps(
    activeUlbIds: string[],
    yearId: string,
  ): Promise<StateDashboardUlbFormStatusMaps> {
    const emptyMaps = this.createEmptyUlbFormStatusMaps();
    if (activeUlbIds.length === 0) return emptyMaps;

    const activeUlbObjectIds = activeUlbIds.map((ulbId) => new Types.ObjectId(ulbId));
    const yearObjectId = new Types.ObjectId(yearId);
    const [annualAccountRecords, pfmsRecords, unspentBalanceRecords] = await Promise.all([
      this.annualAccountModel
        .find({
          ulb: { $in: activeUlbObjectIds },
          design_year: yearObjectId,
        })
        .select({
          _id: 0,
          ulb: 1,
          sectionType: 1,
          form_status_id: 1,
        })
        .lean<AnnualAccountStatusRecord[]>()
        .exec(),
      this.bankAccountModel
        .find({
          ulb: { $in: activeUlbObjectIds },
          designYear: yearObjectId,
        })
        .select({ _id: 0, ulb: 1, currentFormStatus: 1 })
        .lean<PfmsBankAccountStatusRecord[]>()
        .exec(),
      this.unspentBalanceModel
        .find({
          ulb: { $in: activeUlbObjectIds },
          designYear: yearObjectId,
        })
        .select({ _id: 0, ulb: 1, formStatus: 1 })
        .lean<UnspentBalanceStatusRecord[]>()
        .exec(),
    ]);

    for (const record of annualAccountRecords) {
      const ulbId = record.ulb.toString();
      const map = record.sectionType === 'audited' ? emptyMaps.annualAccounts : emptyMaps.provisionalAccounts;
      map.set(ulbId, this.normalizeFormStatus(record.form_status_id));
    }

    for (const record of pfmsRecords) {
      emptyMaps.pfmsBankAccount.set(record.ulb.toString(), this.normalizeFormStatus(record.currentFormStatus));
    }

    for (const record of unspentBalanceRecords) {
      emptyMaps.fcUnspentBalance.set(record.ulb.toString(), this.mapUnspentBalanceStatus(record.formStatus));
    }

    // No executable Service Level Benchmark model exists; the map stays empty until a source is implemented.
    return emptyMaps;
  }

  private createEmptyUlbFormStatusMaps(): StateDashboardUlbFormStatusMaps {
    return {
      annualAccounts: new Map<string, FormStatusType | null>(),
      provisionalAccounts: new Map<string, FormStatusType | null>(),
      pfmsBankAccount: new Map<string, FormStatusType | null>(),
      fcUnspentBalance: new Map<string, FormStatusType | null>(),
      serviceLevelBenchmarks: new Map<string, FormStatusType | null>(),
    };
  }

  private normalizeFormStatus(status: number | null | undefined): FormStatusType | null {
    if (status === undefined || status === null) return null;
    return STATE_DASHBOARD_KNOWN_FORM_STATUSES.has(status) ? (status as FormStatusType) : null;
  }

  private mapUnspentBalanceStatus(status: UnspentBalanceFormStatus | null | undefined): FormStatusType | null {
    if (status === 'SUBMITTED') return FORM_STATUS.UNDER_REVIEW_BY_STATE;
    if (status === 'DRAFT') return FORM_STATUS.IN_PROGRESS;
    return null;
  }

  private buildUlbFormSnapshots(
    activeUlbIds: string[],
    statusMaps: StateDashboardUlbFormStatusMaps,
  ): StateDashboardUlbFormSnapshot[] {
    return activeUlbIds.map((ulbId) => ({
      ulbId,
      annualAccountsStatus: statusMaps.annualAccounts.get(ulbId) ?? null,
      provisionalAccountsStatus: statusMaps.provisionalAccounts.get(ulbId) ?? null,
      pfmsBankAccountStatus: statusMaps.pfmsBankAccount.get(ulbId) ?? null,
      fcUnspentBalanceStatus: statusMaps.fcUnspentBalance.get(ulbId) ?? null,
      serviceLevelBenchmarkStatus: statusMaps.serviceLevelBenchmarks.get(ulbId) ?? null,
      // TODO: Aggregate exemptions when an executable exemption-request source is implemented.
      exemptionRequested: false,
    }));
  }

  private classifyUlbSubmission(snapshot: StateDashboardUlbFormSnapshot): StateDashboardUlbSubmissionStatus {
    if (snapshot.exemptionRequested) return STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED;

    const statuses = this.getUlbFormStatuses(snapshot);
    if (statuses.every((status) => status === STATE_DASHBOARD_FINAL_ELIGIBLE_FORM_STATUS)) {
      return STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE;
    }

    const requiredStatuses = [
      snapshot.annualAccountsStatus,
      snapshot.provisionalAccountsStatus,
      snapshot.pfmsBankAccountStatus,
    ];
    if (requiredStatuses.every((status) => status === FORM_STATUS.UNDER_REVIEW_BY_STATE)) {
      return STATE_DASHBOARD_ULB_SUBMISSION_STATUS.UNDER_REVIEW;
    }
    if (
      statuses.some((status) => status !== null && STATE_DASHBOARD_IN_PROGRESS_FORM_STATUSES.has(status)) ||
      statuses.some((status) => status !== null && !STATE_DASHBOARD_NOT_STARTED_FORM_STATUSES.has(status))
    ) {
      return STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS;
    }
    return STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED;
  }

  private getUlbFormStatuses(snapshot: StateDashboardUlbFormSnapshot): Array<FormStatusType | null> {
    return [
      snapshot.annualAccountsStatus,
      snapshot.provisionalAccountsStatus,
      snapshot.pfmsBankAccountStatus,
      snapshot.fcUnspentBalanceStatus,
      snapshot.serviceLevelBenchmarkStatus,
    ];
  }

  private buildUlbSubmissionSummary(
    snapshots: StateDashboardUlbFormSnapshot[],
  ): StateDashboardUlbSubmissionSummaryItem[] {
    const counts: Record<StateDashboardUlbSubmissionStatus, number> = {
      [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED]: 0,
      [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS]: 0,
      [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.UNDER_REVIEW]: 0,
      [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE]: 0,
      [STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED]: 0,
    };

    for (const snapshot of snapshots) {
      counts[this.classifyUlbSubmission(snapshot)] += 1;
    }

    return STATE_DASHBOARD_ULB_STATUS_ORDER.map((key) => ({
      key,
      ...STATE_DASHBOARD_ULB_STATUS_CONTENT[key],
      count: counts[key],
    }));
  }

  private buildFormCompletion(
    snapshots: StateDashboardUlbFormSnapshot[],
    totalUlbs: number,
  ): StateDashboardFormCompletionItem[] {
    return STATE_DASHBOARD_FORM_ORDER.map((key) => ({
      key,
      label: STATE_DASHBOARD_FORM_LABELS[key],
      completed: snapshots.filter((snapshot) => {
        const status = this.getFormStatus(snapshot, key);
        return status !== null && STATE_DASHBOARD_COMPLETED_ULB_FORM_STATUSES.has(status);
      }).length,
      total: totalUlbs,
    }));
  }

  private getFormStatus(snapshot: StateDashboardUlbFormSnapshot, key: StateDashboardFormKey): FormStatusType | null {
    switch (key) {
      case STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS:
        return snapshot.annualAccountsStatus;
      case STATE_DASHBOARD_FORM_KEY.PROVISIONAL_ACCOUNTS:
        return snapshot.provisionalAccountsStatus;
      case STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT:
        return snapshot.pfmsBankAccountStatus;
      case STATE_DASHBOARD_FORM_KEY.FC_UNSPENT_BALANCE:
        return snapshot.fcUnspentBalanceStatus;
      case STATE_DASHBOARD_FORM_KEY.SERVICE_LEVEL_BENCHMARKS:
        return snapshot.serviceLevelBenchmarkStatus;
    }
  }

  private getEligibleUlbCount(summary: StateDashboardUlbSubmissionSummaryItem[]): number {
    return summary.find((item) => item.key === STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE)?.count ?? 0;
  }

  private calculateComplianceRate(compliantUlbs: number, totalUlbs: number): number {
    return totalUlbs === 0 ? 0 : Math.round((compliantUlbs / totalUlbs) * 100);
  }

  private buildClaimLetters(eligibleUlbs: number): StateDashboardClaimLetterItem[] {
    const itemsByKey: Record<StateDashboardClaimLetterKey, StateDashboardClaimLetterItem> = {
      [STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1]: this.buildFirstClaimLetter(eligibleUlbs),
      [STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2]: this.buildSecondClaimLetter(),
    };

    return STATE_DASHBOARD_CLAIM_LETTER_ORDER.map((key) => itemsByKey[key]);
  }

  private buildFirstClaimLetter(eligibleUlbs: number): StateDashboardClaimLetterItem {
    const isAvailable = eligibleUlbs > 0;

    return {
      key: STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1,
      title: 'Generate the first Claim Letter',
      subtitle: `Instalment 1 · Batch 1 — ${eligibleUlbs} approved ULBs ready to include`,
      installment: 1,
      status: isAvailable ? STATE_DASHBOARD_CLAIM_LETTER_STATUS.AVAILABLE : STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED,
      actionLabel: isAvailable ? 'Start' : null,
      lockReason: isAvailable ? null : 'No eligible ULBs are available for the first claim letter.',
      route: null,
    };
  }

  private buildSecondClaimLetter(): StateDashboardClaimLetterItem {
    // TODO: Derive Instalment 2 availability from persisted claim-letter records when that workflow is implemented.
    return {
      key: STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2,
      title: 'Instalment 2 Claim Letter',
      subtitle: 'Opens after the first Instalment 1 Claim Letter is generated',
      installment: 2,
      status: STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED,
      actionLabel: null,
      lockReason: 'The first Instalment 1 Claim Letter has not been generated.',
      route: null,
    };
  }

  private loadDevolutionFormula(stateId: string, yearId: string): Promise<StateFormStatusRecord | null> {
    return this.devolutionFormulaModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment: 1,
        formType: DEVOLUTION_FORMULA_FORM_TYPE,
        isActive: true,
      })
      .select({ _id: 1, currentFormStatus: 1 })
      .lean<StateFormStatusRecord>()
      .exec();
  }

  private async loadStateConditionSnapshot(stateId: string, yearId: string): Promise<StateConditionSnapshot> {
    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const [sfcStatus, electedBodyStatus] = await Promise.all([
      this.sfcStatusModel
        .findOne({
          state: stateOid,
          year: yearOid,
          formType: SFC_STATUS_FORM_TYPE,
          isActive: true,
          isDeleted: false,
        })
        .select({ _id: 1, currentFormStatus: 1 })
        .lean<StateFormStatusRecord>()
        .exec(),
      this.electedBodyModel
        .findOne({
          state: stateOid,
          year: yearOid,
          formType: EULB_FORM_TYPE,
          isActive: true,
          isDeleted: false,
        })
        .select({ _id: 1, currentFormStatus: 1 })
        .lean<StateFormStatusRecord>()
        .exec(),
    ]);

    return { sfcStatus, electedBodyStatus };
  }

  private buildStateDataTasks(
    totalUlbs: number,
    devolutionFormula: StateFormStatusRecord | null,
    stateConditionSnapshot: StateConditionSnapshot,
  ): StateDashboardTask[] {
    const tasksByKey: Record<StateDashboardTaskKey, StateDashboardTask> = {
      [STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION]: this.buildUlbRegistrationTask(totalUlbs),
      [STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA]: this.buildDevolutionFormulaTask(devolutionFormula),
      [STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS]: this.buildStateConditionsTask(stateConditionSnapshot),
    };

    return STATE_DASHBOARD_TASK_ORDER.map((key) => tasksByKey[key]);
  }

  private buildUlbRegistrationTask(totalUlbs: number): StateDashboardTask {
    // Provisional rule: the master-data task is complete when the State has at least one active ULB.
    const status = totalUlbs > 0 ? STATE_DASHBOARD_TASK_STATUS.DONE : STATE_DASHBOARD_TASK_STATUS.PENDING;

    return {
      key: STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION,
      title: 'Register new ULBs',
      subtitle: `Keep the state master list of ${totalUlbs} ULBs up to date`,
      status,
      actionLabel: null,
      route: null,
    };
  }

  private buildDevolutionFormulaTask(devolutionFormula: StateFormStatusRecord | null): StateDashboardTask {
    const status = this.isCompletedStateForm(devolutionFormula)
      ? STATE_DASHBOARD_TASK_STATUS.DONE
      : STATE_DASHBOARD_TASK_STATUS.PENDING;

    return {
      key: STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA,
      title: 'Fill in the ULB-wise allocation',
      subtitle: 'Allocation and instalment split for each ULB',
      status,
      actionLabel: status === STATE_DASHBOARD_TASK_STATUS.PENDING ? 'Continue' : null,
      route: null,
    };
  }

  private buildStateConditionsTask(snapshot: StateConditionSnapshot): StateDashboardTask {
    const allConditionsCompleted =
      this.isCompletedStateForm(snapshot.sfcStatus) && this.isCompletedStateForm(snapshot.electedBodyStatus);
    const status = allConditionsCompleted ? STATE_DASHBOARD_TASK_STATUS.DONE : STATE_DASHBOARD_TASK_STATUS.PENDING;

    return {
      key: STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS,
      title: 'Submit other state conditions',
      subtitle: 'SFC status and elected body confirmation',
      status,
      actionLabel: status === STATE_DASHBOARD_TASK_STATUS.PENDING ? 'Continue' : null,
      route: null,
    };
  }

  private isCompletedStateForm(form: StateFormStatusRecord | null): boolean {
    return form !== null && STATE_DASHBOARD_COMPLETED_STATE_FORM_STATUSES.has(form.currentFormStatus);
  }

  private async resolveAccessContext(
    params: GetStateDashboardParamsDto,
    user: AuthUser,
  ): Promise<ResolvedStateDashboardAccessContext> {
    this.assertStateAccess(user, params.stateId);

    const [state, year] = await Promise.all([this.loadState(params.stateId), this.loadYear(params.yearId)]);

    return {
      ...state,
      ...year,
      userRole: user.role,
    };
  }
}
