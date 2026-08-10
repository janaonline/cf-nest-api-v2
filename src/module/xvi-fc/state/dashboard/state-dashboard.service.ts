import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
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
import { xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import type { GetStateDashboardParamsDto } from './dto/get-state-dashboard-params.dto';
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
  auditedData?: { form_status_id?: number | null } | null;
  unauditedData?: { form_status_id?: number | null } | null;
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
        amountUnit: STATE_DASHBOARD_AMOUNT_UNIT.CRORE,
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
    return allocation ? allocation.basic + allocation.performance : 0;
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
          'auditedData.form_status_id': 1,
          'unauditedData.form_status_id': 1,
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
      emptyMaps.annualAccounts.set(ulbId, this.normalizeFormStatus(record.auditedData?.form_status_id));
      emptyMaps.provisionalAccounts.set(ulbId, this.normalizeFormStatus(record.unauditedData?.form_status_id));
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
