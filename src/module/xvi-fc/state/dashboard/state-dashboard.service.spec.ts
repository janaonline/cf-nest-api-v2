import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { XviFcAnnualAccount } from 'src/schemas/xvi-fc/annual-account.schema';
import { GrantAllocation } from 'src/schemas/xvi-fc/grant-allocation.schema';
import {
  DevolutionFormulaForm,
  DEVOLUTION_FORMULA_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { SFC_STATUS_FORM_TYPE, XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { XviFcUnspentBalanceDisclosure } from 'src/schemas/xvi-fc/unspent-balance-disclosure.schema';
import { XviFcBankAccount } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import {
  STATE_DASHBOARD_AMOUNT_UNIT,
  STATE_DASHBOARD_CLAIM_LETTER_KEY,
  STATE_DASHBOARD_CLAIM_LETTER_ORDER,
  STATE_DASHBOARD_CLAIM_LETTER_STATUS,
  STATE_DASHBOARD_CURRENCY,
  STATE_DASHBOARD_ERROR_CODE,
  STATE_DASHBOARD_FORM_KEY,
  STATE_DASHBOARD_FORM_ORDER,
  STATE_DASHBOARD_TASK_KEY,
  STATE_DASHBOARD_TASK_ORDER,
  STATE_DASHBOARD_TASK_STATUS,
  STATE_DASHBOARD_ULB_STATUS_ORDER,
  STATE_DASHBOARD_ULB_SUBMISSION_STATUS,
  type StateDashboardClaimLetterKey,
  type StateDashboardFormKey,
  type StateDashboardTaskKey,
  type StateDashboardUlbSubmissionStatus,
} from './state-dashboard.constants';
import { StateDashboardService } from './state-dashboard.service';
import type {
  StateDashboardApiResponse,
  StateDashboardClaimLetterItem,
  StateDashboardData,
  StateDashboardFormCompletionItem,
  StateDashboardTask,
  StateDashboardUlbSubmissionSummaryItem,
} from './state-dashboard.types';

interface MockQuery<T> {
  select: jest.Mock;
  lean: jest.Mock;
  exec: jest.Mock<Promise<T>, []>;
}

interface TestUlbFormSnapshot {
  ulbId: string;
  annualAccountsStatus: FormStatusType | null;
  provisionalAccountsStatus: FormStatusType | null;
  pfmsBankAccountStatus: FormStatusType | null;
  fcUnspentBalanceStatus: FormStatusType | null;
  serviceLevelBenchmarkStatus: FormStatusType | null;
  exemptionRequested: boolean;
}

function queryResult<T>(value: T): MockQuery<T> {
  const query = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn<Promise<T>, []>().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
}

function rejectedQuery(error: Error): MockQuery<never> {
  const query = queryResult<never>(undefined as never);
  query.exec.mockRejectedValue(error);
  return query;
}

describe('StateDashboardService', () => {
  const stateId = new Types.ObjectId().toHexString();
  const otherStateId = new Types.ObjectId().toHexString();
  const yearId = new Types.ObjectId().toHexString();

  const stateRecord = {
    _id: new Types.ObjectId(stateId),
    name: 'Database State Name',
    isActive: true,
  };
  const yearRecord = {
    _id: new Types.ObjectId(yearId),
    year: '2030-31',
    isActive: true,
  };
  const allocationRecord = {
    basic: 15_600_000_000,
    performance: 20_000_000,
  };
  const completedStateFormRecord = {
    _id: new Types.ObjectId(),
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  };
  const activeUlbIds = Array.from({ length: 7 }, () => new Types.ObjectId());
  const activeUlbRecords = activeUlbIds.map((_id) => ({ _id }));
  const makeActiveUlbRecords = (count: number): Array<{ _id: Types.ObjectId }> =>
    Array.from({ length: count }, () => ({ _id: new Types.ObjectId() }));

  const stateModel = { findOne: jest.fn() };
  const yearModel = { findOne: jest.fn() };
  const ulbModel = { find: jest.fn() };
  const grantAllocationModel = { findOne: jest.fn() };
  const devolutionFormulaModel = { findOne: jest.fn() };
  const sfcStatusModel = { findOne: jest.fn() };
  const electedBodyModel = { findOne: jest.fn() };
  const annualAccountModel = { find: jest.fn() };
  const bankAccountModel = { find: jest.fn() };
  const unspentBalanceModel = { find: jest.fn() };

  let service: StateDashboardService;

  const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
    _id: new Types.ObjectId().toHexString(),
    role: UserRole.STATE,
    scope: Scope.STATE,
    accessLevel: AccessLevel.ADMIN,
    state: stateId,
    ...overrides,
  });

  const fetchDashboard = async (
    user: AuthUser = makeUser(),
  ): Promise<{ response: StateDashboardApiResponse; data: StateDashboardData }> => {
    const response = await service.getDashboard({ stateId, yearId }, user);
    if (!response.data) throw new Error('Expected dashboard response data');
    return { response, data: response.data };
  };

  const findTask = (data: StateDashboardData, key: StateDashboardTaskKey): StateDashboardTask => {
    const task = data.stateDataTasks.find((item) => item.key === key);
    if (!task) throw new Error(`Expected dashboard task ${key}`);
    return task;
  };

  const findSummaryItem = (
    data: StateDashboardData,
    key: StateDashboardUlbSubmissionStatus,
  ): StateDashboardUlbSubmissionSummaryItem => {
    const item = data.ulbSubmissionSummary.find((summaryItem) => summaryItem.key === key);
    if (!item) throw new Error(`Expected ULB submission summary item ${key}`);
    return item;
  };

  const findCompletionItem = (
    data: StateDashboardData,
    key: StateDashboardFormKey,
  ): StateDashboardFormCompletionItem => {
    const item = data.formCompletion.find((completionItem) => completionItem.key === key);
    if (!item) throw new Error(`Expected form completion item ${key}`);
    return item;
  };

  const buildClaimLetters = (eligibleUlbs: number): StateDashboardClaimLetterItem[] => {
    const builder = service as unknown as {
      buildClaimLetters(count: number): StateDashboardClaimLetterItem[];
    };
    return builder.buildClaimLetters(eligibleUlbs);
  };

  const findClaimLetter = (
    claimLetters: StateDashboardClaimLetterItem[],
    key: StateDashboardClaimLetterKey,
  ): StateDashboardClaimLetterItem => {
    const item = claimLetters.find((claimLetter) => claimLetter.key === key);
    if (!item) throw new Error(`Expected claim-letter item ${key}`);
    return item;
  };

  const classifySnapshot = (overrides: Partial<TestUlbFormSnapshot> = {}): StateDashboardUlbSubmissionStatus => {
    const classifier = service as unknown as {
      classifyUlbSubmission(snapshot: TestUlbFormSnapshot): StateDashboardUlbSubmissionStatus;
    };
    return classifier.classifyUlbSubmission({
      ulbId: activeUlbIds[0].toHexString(),
      annualAccountsStatus: null,
      provisionalAccountsStatus: null,
      pfmsBankAccountStatus: null,
      fcUnspentBalanceStatus: null,
      serviceLevelBenchmarkStatus: null,
      exemptionRequested: false,
      ...overrides,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    stateModel.findOne.mockReturnValue(queryResult(stateRecord));
    yearModel.findOne.mockReturnValue(queryResult(yearRecord));
    ulbModel.find.mockReturnValue(queryResult(activeUlbRecords));
    grantAllocationModel.findOne.mockReturnValue(queryResult(allocationRecord));
    devolutionFormulaModel.findOne.mockReturnValue(queryResult(completedStateFormRecord));
    sfcStatusModel.findOne.mockReturnValue(queryResult(completedStateFormRecord));
    electedBodyModel.findOne.mockReturnValue(queryResult(completedStateFormRecord));
    annualAccountModel.find.mockReturnValue(queryResult([]));
    bankAccountModel.find.mockReturnValue(queryResult([]));
    unspentBalanceModel.find.mockReturnValue(queryResult([]));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateDashboardService,
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(GrantAllocation.name), useValue: grantAllocationModel },
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: devolutionFormulaModel },
        { provide: getModelToken(XviFcSfcStatus.name), useValue: sfcStatusModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: electedBodyModel },
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: annualAccountModel },
        { provide: getModelToken(XviFcBankAccount.name), useValue: bankAccountModel },
        { provide: getModelToken(XviFcUnspentBalanceDisclosure.name), useValue: unspentBalanceModel },
      ],
    }).compile();

    service = module.get<StateDashboardService>(StateDashboardService);
  });

  describe('Phase 4 access and entity validation', () => {
    it('allows a State user to access their assigned State', async () => {
      const { response } = await fetchDashboard();
      expect(response.success).toBe(true);
    });

    it('rejects a State user requesting another State', async () => {
      try {
        await service.getDashboard({ stateId: otherStateId, yearId }, makeUser());
        throw new Error('Expected getDashboard to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toEqual({
          code: STATE_DASHBOARD_ERROR_CODE.STATE_ACCESS_DENIED,
          message: 'The selected State is not assigned to the current user.',
        });
      }
      expect(stateModel.findOne).not.toHaveBeenCalled();
      expect(yearModel.findOne).not.toHaveBeenCalled();
      expect(ulbModel.find).not.toHaveBeenCalled();
      expect(grantAllocationModel.findOne).not.toHaveBeenCalled();
    });

    it('rejects a State editor requesting another State', async () => {
      const user = makeUser({ accessLevel: AccessLevel.EDITOR, xviFcSubrole: 'reviewer' });
      await expect(service.getDashboard({ stateId: otherStateId, yearId }, user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects a State viewer requesting another State', async () => {
      const user = makeUser({ accessLevel: AccessLevel.VIEWER, xviFcSubrole: 'viewer' });
      await expect(service.getDashboard({ stateId: otherStateId, yearId }, user)).rejects.toThrow(ForbiddenException);
    });

    it('allows a State editor to access their assigned State', async () => {
      const user = makeUser({ accessLevel: AccessLevel.EDITOR, xviFcSubrole: 'reviewer' });
      const { response } = await fetchDashboard(user);
      expect(response.success).toBe(true);
    });

    it('allows a State viewer to access their assigned State', async () => {
      const user = makeUser({ accessLevel: AccessLevel.VIEWER, xviFcSubrole: 'viewer' });
      const { response } = await fetchDashboard(user);
      expect(response.success).toBe(true);
    });

    it('allows ADMIN to access an explicit State', async () => {
      const user = makeUser({
        role: UserRole.ADMIN,
        scope: Scope.ADMIN,
        accessLevel: AccessLevel.ADMIN,
        state: null,
      });
      const { response } = await fetchDashboard(user);
      expect(response.success).toBe(true);
    });

    it('rejects a ULB user', async () => {
      const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, state: null });
      await expect(service.getDashboard({ stateId, yearId }, user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects an unsupported MoHUA scope', async () => {
      const user = makeUser({ role: UserRole.MoHUA, scope: Scope.MOHUA, state: null });
      await expect(service.getDashboard({ stateId, yearId }, user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects a missing or unsupported scope', async () => {
      const user = makeUser({ scope: null });
      await expect(service.getDashboard({ stateId, yearId }, user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects a State user without authenticated State context', async () => {
      await expect(service.getDashboard({ stateId, yearId }, makeUser({ state: null }))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns STATE_NOT_FOUND when no active State record exists', async () => {
      stateModel.findOne.mockReturnValue(queryResult(null));

      try {
        await service.getDashboard({ stateId, yearId }, makeUser());
        throw new Error('Expected getDashboard to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: STATE_DASHBOARD_ERROR_CODE.STATE_NOT_FOUND,
          message: 'State dashboard data is unavailable because the selected State was not found.',
        });
      }
      expect(ulbModel.find).not.toHaveBeenCalled();
      expect(grantAllocationModel.findOne).not.toHaveBeenCalled();
    });

    it('returns YEAR_NOT_FOUND when no active Year record exists', async () => {
      yearModel.findOne.mockReturnValue(queryResult(null));

      try {
        await service.getDashboard({ stateId, yearId }, makeUser());
        throw new Error('Expected getDashboard to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: STATE_DASHBOARD_ERROR_CODE.YEAR_NOT_FOUND,
          message: 'State dashboard data is unavailable because the selected XVI-FC year was not found.',
        });
      }
      expect(ulbModel.find).not.toHaveBeenCalled();
      expect(grantAllocationModel.findOne).not.toHaveBeenCalled();
    });

    it('validates existing State and Year before metric queries', async () => {
      await fetchDashboard();
      expect(stateModel.findOne).toHaveBeenCalledTimes(1);
      expect(yearModel.findOne).toHaveBeenCalledTimes(1);
      expect(ulbModel.find).toHaveBeenCalledTimes(1);
      expect(grantAllocationModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('queries State using the active filter and minimal projection', async () => {
      await fetchDashboard();

      expect(stateModel.findOne).toHaveBeenCalledWith({ _id: new Types.ObjectId(stateId), isActive: true });
      const stateQuery = stateModel.findOne.mock.results[0].value as MockQuery<typeof stateRecord>;
      expect(stateQuery.select).toHaveBeenCalledWith({ _id: 1, name: 1, isActive: 1 });
    });

    it('queries Year using the active filter and minimal projection', async () => {
      await fetchDashboard();

      expect(yearModel.findOne).toHaveBeenCalledWith({ _id: new Types.ObjectId(yearId), isActive: true });
      const yearQuery = yearModel.findOne.mock.results[0].value as MockQuery<typeof yearRecord>;
      expect(yearQuery.select).toHaveBeenCalledWith({ _id: 1, year: 1, isActive: 1 });
    });
  });

  describe('Phase 5 dashboard context', () => {
    it('returns State ID and State name from MongoDB', async () => {
      const { data } = await fetchDashboard();
      expect(data.context.stateId).toBe(stateRecord._id.toString());
      expect(data.context.stateName).toBe(stateRecord.name);
    });

    it('returns Year ID and financial year from MongoDB', async () => {
      const { data } = await fetchDashboard();
      expect(data.context.yearId).toBe(yearRecord._id.toString());
      expect(data.context.financialYear).toBe(yearRecord.year);
    });

    it('returns the authenticated user role', async () => {
      const user = makeUser({ role: UserRole.STATE });
      const { data } = await fetchDashboard(user);
      expect(data.context.userRole).toBe(UserRole.STATE);
    });

    it('returns null grant type while no authoritative source exists', async () => {
      const { data } = await fetchDashboard();
      expect(data.context.grantType).toBeNull();
    });

    it('does not replace database State or year values with hardcoded display values', async () => {
      const { data } = await fetchDashboard();
      expect(data.context.stateName).toBe('Database State Name');
      expect(data.context.financialYear).toBe('2030-31');
    });
  });

  describe('Phase 5 metric cards', () => {
    it('counts active ULBs belonging to the requested State', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.totalUlbs).toBe(7);
      expect(ulbModel.find).toHaveBeenCalledWith({
        state: new Types.ObjectId(stateId),
        isActive: true,
      });
    });

    it('uses only the confirmed State and active ULB filters', async () => {
      await fetchDashboard();
      expect(ulbModel.find).toHaveBeenCalledWith({
        state: new Types.ObjectId(stateId),
        isActive: true,
      });
    });

    it('returns zero when no active ULBs exist', async () => {
      ulbModel.find.mockReturnValue(queryResult([]));
      const { data } = await fetchDashboard();
      expect(data.metrics.totalUlbs).toBe(0);
    });

    it('calculates allocated amount as basic plus performance grant', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.allocatedAmount).toBe(15_620_000_000);
    });

    it('uses State and year filters for the allocation record', async () => {
      await fetchDashboard();
      expect(grantAllocationModel.findOne).toHaveBeenCalledWith({
        stateId: new Types.ObjectId(stateId),
        yearId: new Types.ObjectId(yearId),
      });
    });

    it('selects only allocation fields needed by the metric', async () => {
      await fetchDashboard();
      const allocationQuery = grantAllocationModel.findOne.mock.results[0].value as MockQuery<typeof allocationRecord>;
      expect(allocationQuery.select).toHaveBeenCalledWith({ _id: 0, basic: 1, performance: 1 });
    });

    it('returns the allocation numeric value unchanged', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.allocatedAmount).toBe(15_620_000_000);
    });

    it('does not divide allocation by 10,000,000', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.allocatedAmount).not.toBe(1_562);
      expect(data.metrics.allocatedAmount).toBe(15_620_000_000);
    });

    it('returns zero when no allocation record exists', async () => {
      grantAllocationModel.findOne.mockReturnValue(queryResult(null));
      const { data } = await fetchDashboard();
      expect(data.metrics.allocatedAmount).toBe(0);
    });

    it('returns zero claimed amount while the claim-letter source is unavailable', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.claimedAmount).toBe(0);
    });

    it('returns zero compliant ULBs and compliance rate', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.compliance.compliantUlbs).toBe(0);
      expect(data.metrics.compliance.rate).toBe(0);
    });

    it('uses the real ULB count as the compliance denominator', async () => {
      ulbModel.find.mockReturnValue(queryResult(makeActiveUlbRecords(11)));
      const { data } = await fetchDashboard();
      expect(data.metrics.compliance.totalUlbs).toBe(11);
    });

    it('handles a zero-ULB compliance denominator without division', async () => {
      ulbModel.find.mockReturnValue(queryResult([]));
      const { data } = await fetchDashboard();
      expect(data.metrics.compliance).toEqual({ rate: 0, compliantUlbs: 0, totalUlbs: 0 });
    });

    it('returns the CRORE amount unit constant', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.amountUnit).toBe(STATE_DASHBOARD_AMOUNT_UNIT.CRORE);
    });

    it('returns the INR currency constant', async () => {
      const { data } = await fetchDashboard();
      expect(data.metrics.currency).toBe(STATE_DASHBOARD_CURRENCY.INR);
    });
  });

  describe('Phase 5 response', () => {
    it('uses the XVI-FC success response convention', async () => {
      const { response } = await fetchDashboard();
      expect(response.success).toBe(true);
      expect(response.message).toBe('State dashboard fetched successfully');
      expect(typeof response.timestamp).toBe('string');
      expect(response.data).toBeDefined();
    });

    it('returns the Phase 7 and Phase 8 sections', async () => {
      const { data } = await fetchDashboard();
      expect(data.ulbSubmissionSummary).toHaveLength(5);
      expect(data.formCompletion).toHaveLength(5);
      expect(data.claimLetters).toHaveLength(2);
    });

    it('returns success instead of a NotImplementedException after access validation', async () => {
      await expect(service.getDashboard({ stateId, yearId }, makeUser())).resolves.toMatchObject({ success: true });
    });

    it('preserves State access restrictions before metric queries', async () => {
      await expect(service.getDashboard({ stateId: otherStateId, yearId }, makeUser())).rejects.toThrow(
        ForbiddenException,
      );
      expect(ulbModel.find).not.toHaveBeenCalled();
      expect(grantAllocationModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('Phase 6 State data tasks', () => {
    describe('ULB registration', () => {
      it('marks the task DONE when at least one active ULB exists', async () => {
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION).status).toBe(STATE_DASHBOARD_TASK_STATUS.DONE);
      });

      it('marks the task PENDING when no active ULB exists', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.PENDING,
        );
      });

      it('includes the real ULB count in the subtitle', async () => {
        ulbModel.find.mockReturnValue(queryResult(makeActiveUlbRecords(13)));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION).subtitle).toBe(
          'Keep the state master list of 13 ULBs up to date',
        );
      });

      it('returns the stable ULB registration task contract', async () => {
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION)).toEqual({
          key: STATE_DASHBOARD_TASK_KEY.ULB_REGISTRATION,
          title: 'Register new ULBs',
          subtitle: 'Keep the state master list of 7 ULBs up to date',
          status: STATE_DASHBOARD_TASK_STATUS.DONE,
          actionLabel: null,
          route: null,
        });
      });
    });

    describe('Devolution formula', () => {
      it('marks the task DONE when the active installment-1 formula is submitted', async () => {
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.DONE,
        );
      });

      it('marks the task PENDING when no formula record exists', async () => {
        devolutionFormulaModel.findOne.mockReturnValue(queryResult(null));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA)).toMatchObject({
          status: STATE_DASHBOARD_TASK_STATUS.PENDING,
          actionLabel: 'Continue',
          route: null,
        });
      });

      it('marks a submitted formula DONE when the allocation contains zero values', async () => {
        grantAllocationModel.findOne.mockReturnValue(queryResult({ basic: 0, performance: 0 }));
        const { data } = await fetchDashboard();
        expect(data.metrics.allocatedAmount).toBe(0);
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.DONE,
        );
      });

      it('queries installment 1 with State, year, form type, and active filters', async () => {
        await fetchDashboard();
        expect(devolutionFormulaModel.findOne).toHaveBeenCalledWith({
          state: new Types.ObjectId(stateId),
          year: new Types.ObjectId(yearId),
          installment: 1,
          formType: DEVOLUTION_FORMULA_FORM_TYPE,
          isActive: true,
        });
      });

      it('reuses the single GrantAllocation lookup for the allocation metric', async () => {
        const { data } = await fetchDashboard();
        expect(grantAllocationModel.findOne).toHaveBeenCalledTimes(1);
        expect(data.metrics.allocatedAmount).toBe(15_620_000_000);
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.DEVOLUTION_FORMULA).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.DONE,
        );
      });
    });

    describe('State conditions', () => {
      it('marks the task DONE when all confirmed State forms are completed', async () => {
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(STATE_DASHBOARD_TASK_STATUS.DONE);
      });

      it('marks the task PENDING when SFC Status is missing', async () => {
        sfcStatusModel.findOne.mockReturnValue(queryResult(null));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.PENDING,
        );
      });

      it('marks the task PENDING when Elected Body Status is missing', async () => {
        electedBodyModel.findOne.mockReturnValue(queryResult(null));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.PENDING,
        );
      });

      it('marks the task PENDING when one form is IN_PROGRESS', async () => {
        sfcStatusModel.findOne.mockReturnValue(
          queryResult({ _id: new Types.ObjectId(), currentFormStatus: FORM_STATUS.IN_PROGRESS }),
        );
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.PENDING,
        );
      });

      it('marks the task PENDING when one form is RETURNED_BY_MOHUA', async () => {
        electedBodyModel.findOne.mockReturnValue(
          queryResult({ _id: new Types.ObjectId(), currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA }),
        );
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(
          STATE_DASHBOARD_TASK_STATUS.PENDING,
        );
      });

      it('accepts UNDER_REVIEW_BY_MOHUA for every required form', async () => {
        const underReview = {
          _id: new Types.ObjectId(),
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        };
        sfcStatusModel.findOne.mockReturnValue(queryResult(underReview));
        electedBodyModel.findOne.mockReturnValue(queryResult(underReview));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(STATE_DASHBOARD_TASK_STATUS.DONE);
      });

      it('accepts SUBMISSION_ACKNOWLEDGED_BY_MOHUA for every required form', async () => {
        const acknowledged = {
          _id: new Types.ObjectId(),
          currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        };
        sfcStatusModel.findOne.mockReturnValue(queryResult(acknowledged));
        electedBodyModel.findOne.mockReturnValue(queryResult(acknowledged));
        const { data } = await fetchDashboard();
        expect(findTask(data, STATE_DASHBOARD_TASK_KEY.STATE_CONDITIONS).status).toBe(STATE_DASHBOARD_TASK_STATUS.DONE);
      });

      it('queries both State forms with State, year, form type, and active filters', async () => {
        await fetchDashboard();
        expect(sfcStatusModel.findOne).toHaveBeenCalledWith({
          state: new Types.ObjectId(stateId),
          year: new Types.ObjectId(yearId),
          formType: SFC_STATUS_FORM_TYPE,
          isActive: true,
          isDeleted: false,
        });
        expect(electedBodyModel.findOne).toHaveBeenCalledWith({
          state: new Types.ObjectId(stateId),
          year: new Types.ObjectId(yearId),
          formType: EULB_FORM_TYPE,
          isActive: true,
          isDeleted: false,
        });
      });

      it('uses minimal status projections for all State-form queries', async () => {
        await fetchDashboard();
        const expectedProjection = { _id: 1, currentFormStatus: 1 };
        const devolutionQuery = devolutionFormulaModel.findOne.mock.results[0].value as MockQuery<
          typeof completedStateFormRecord
        >;
        const sfcQuery = sfcStatusModel.findOne.mock.results[0].value as MockQuery<typeof completedStateFormRecord>;
        const electedQuery = electedBodyModel.findOne.mock.results[0].value as MockQuery<
          typeof completedStateFormRecord
        >;
        expect(devolutionQuery.select).toHaveBeenCalledWith(expectedProjection);
        expect(sfcQuery.select).toHaveBeenCalledWith(expectedProjection);
        expect(electedQuery.select).toHaveBeenCalledWith(expectedProjection);
      });
    });

    describe('response', () => {
      it('returns exactly three State tasks', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks).toHaveLength(3);
      });

      it('returns State tasks in the stable configured order', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks.map((task) => task.key)).toEqual([...STATE_DASHBOARD_TASK_ORDER]);
      });

      it('preserves Phase 5 metrics', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics).toMatchObject({
          totalUlbs: 7,
          allocatedAmount: 15_620_000_000,
          claimedAmount: 0,
          amountUnit: STATE_DASHBOARD_AMOUNT_UNIT.CRORE,
          currency: STATE_DASHBOARD_CURRENCY.INR,
          compliance: { rate: 0, compliantUlbs: 0, totalUlbs: 7 },
        });
      });

      it('retains the Phase 7 and Phase 8 sections', async () => {
        const { data } = await fetchDashboard();
        expect(data.ulbSubmissionSummary).toHaveLength(5);
        expect(data.formCompletion).toHaveLength(5);
        expect(data.claimLetters).toHaveLength(2);
      });

      it('keeps task routes null when no frontend route is confirmed', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks.every((task) => task.route === null)).toBe(true);
      });

      it('preserves State access enforcement before State-task queries', async () => {
        await expect(service.getDashboard({ stateId: otherStateId, yearId }, makeUser())).rejects.toThrow(
          ForbiddenException,
        );
        expect(devolutionFormulaModel.findOne).not.toHaveBeenCalled();
        expect(sfcStatusModel.findOne).not.toHaveBeenCalled();
        expect(electedBodyModel.findOne).not.toHaveBeenCalled();
      });
    });
  });

  describe('Phase 7 ULB submission summary and form completion', () => {
    describe('active ULB loading', () => {
      it('loads only active ULB IDs for the requested State', async () => {
        await fetchDashboard();
        expect(ulbModel.find).toHaveBeenCalledWith({
          state: new Types.ObjectId(stateId),
          isActive: true,
        });
      });

      it('uses the minimal active ULB projection', async () => {
        await fetchDashboard();
        const query = ulbModel.find.mock.results[0].value as MockQuery<typeof activeUlbRecords>;
        expect(query.select).toHaveBeenCalledWith({ _id: 1 });
      });

      it('derives the total ULB count from loaded IDs', async () => {
        ulbModel.find.mockReturnValue(queryResult(makeActiveUlbRecords(9)));
        const { data } = await fetchDashboard();
        expect(data.metrics.totalUlbs).toBe(9);
      });

      it('handles no active ULBs without running form queries', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        const { data } = await fetchDashboard();
        expect(data.metrics.totalUlbs).toBe(0);
        expect(annualAccountModel.find).not.toHaveBeenCalled();
        expect(bankAccountModel.find).not.toHaveBeenCalled();
        expect(unspentBalanceModel.find).not.toHaveBeenCalled();
      });
    });

    describe('annual and provisional accounts', () => {
      it('extracts the audited annual status from the sectionType: audited record', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS).completed).toBe(1);
      });

      it('extracts the provisional status from the sectionType: unaudited record', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'unaudited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PROVISIONAL_ACCOUNTS).completed).toBe(1);
      });

      it('counts one annual-account record at most once per row', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
            { ulb: activeUlbIds[0], sectionType: 'unaudited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS).completed).toBe(1);
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PROVISIONAL_ACCOUNTS).completed).toBe(1);
      });

      it('treats a missing audited section as incomplete', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'unaudited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS).completed).toBe(0);
      });

      it('treats a missing provisional section as incomplete', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PROVISIONAL_ACCOUNTS).completed).toBe(0);
      });

      it('does not count a returned annual section as completed', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.RETURNED_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS).completed).toBe(0);
      });
    });

    describe('PFMS bank account', () => {
      it('counts qualifying PFMS bank-account records', async () => {
        bankAccountModel.find.mockReturnValue(
          queryResult([{ ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT).completed).toBe(1);
      });

      it('filters PFMS records by active ULB IDs and design year', async () => {
        await fetchDashboard();
        expect(bankAccountModel.find).toHaveBeenCalledWith({
          ulb: { $in: activeUlbIds },
          designYear: new Types.ObjectId(yearId),
        });
      });

      it('selects no PFMS account or security fields', async () => {
        await fetchDashboard();
        const query = bankAccountModel.find.mock.results[0].value as MockQuery<unknown[]>;
        expect(query.select).toHaveBeenCalledWith({ _id: 0, ulb: 1, currentFormStatus: 1 });
      });

      it('does not double-count duplicate PFMS records for one ULB', async () => {
        bankAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE },
            { ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT).completed).toBe(1);
      });
    });

    describe('FC Unspent Balance', () => {
      it('counts submitted ULB unspent-balance records', async () => {
        unspentBalanceModel.find.mockReturnValue(queryResult([{ ulb: activeUlbIds[0], formStatus: 'SUBMITTED' }]));
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.FC_UNSPENT_BALANCE).completed).toBe(1);
      });

      it('queries the ULB-level source by active ULB IDs and design year', async () => {
        await fetchDashboard();
        expect(unspentBalanceModel.find).toHaveBeenCalledWith({
          ulb: { $in: activeUlbIds },
          designYear: new Types.ObjectId(yearId),
        });
      });

      it('treats a missing ULB unspent-balance record as incomplete', async () => {
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.FC_UNSPENT_BALANCE).completed).toBe(0);
      });
    });

    describe('Service Level Benchmarks source gap', () => {
      it('returns zero completed SLB forms when no source exists', async () => {
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.SERVICE_LEVEL_BENCHMARKS)).toEqual({
          key: STATE_DASHBOARD_FORM_KEY.SERVICE_LEVEL_BENCHMARKS,
          label: 'Service Level Benchmarks',
          completed: 0,
          total: 7,
        });
      });

      it('keeps the eligible count at zero while SLB is unavailable', async () => {
        const { data } = await fetchDashboard();
        expect(findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE).count).toBe(0);
      });

      it('prevents false eligibility when all four available forms are completed', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
            { ulb: activeUlbIds[0], sectionType: 'unaudited', form_status_id: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
          ]),
        );
        bankAccountModel.find.mockReturnValue(
          queryResult([{ ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }]),
        );
        unspentBalanceModel.find.mockReturnValue(queryResult([{ ulb: activeUlbIds[0], formStatus: 'SUBMITTED' }]));
        const { data } = await fetchDashboard();
        expect(findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE).count).toBe(0);
        expect(data.metrics.compliance.compliantUlbs).toBe(0);
      });
    });

    describe('form completion', () => {
      it('returns exactly five rows', async () => {
        const { data } = await fetchDashboard();
        expect(data.formCompletion).toHaveLength(5);
      });

      it('returns rows in the stable configured order', async () => {
        const { data } = await fetchDashboard();
        expect(data.formCompletion.map((item) => item.key)).toEqual([...STATE_DASHBOARD_FORM_ORDER]);
      });

      it('uses unique ULB counts', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.ANNUAL_ACCOUNTS).completed).toBe(1);
      });

      it('uses total active ULBs for every row total', async () => {
        ulbModel.find.mockReturnValue(queryResult(makeActiveUlbRecords(4)));
        const { data } = await fetchDashboard();
        expect(data.formCompletion.every((item) => item.total === 4)).toBe(true);
      });

      it('does not return percentages in completion rows', async () => {
        const { data } = await fetchDashboard();
        expect(data.formCompletion.every((item) => !('percentage' in item))).toBe(true);
      });

      it('counts under-review statuses as form completion', async () => {
        bankAccountModel.find.mockReturnValue(
          queryResult([{ ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT).completed).toBe(1);
      });

      it('does not count returned or in-progress statuses as completed', async () => {
        bankAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.IN_PROGRESS },
            { ulb: activeUlbIds[1], currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.PFMS_BANK_ACCOUNT).completed).toBe(0);
      });
    });

    describe('ULB classification', () => {
      it('classifies all missing forms as NOT_STARTED', () => {
        expect(classifySnapshot()).toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED);
      });

      it('classifies one IN_PROGRESS form as IN_PROGRESS', () => {
        expect(classifySnapshot({ annualAccountsStatus: FORM_STATUS.IN_PROGRESS })).toBe(
          STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS,
        );
      });

      it('classifies one returned form as IN_PROGRESS', () => {
        expect(classifySnapshot({ pfmsBankAccountStatus: FORM_STATUS.RETURNED_BY_STATE })).toBe(
          STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS,
        );
      });

      it('keeps one form under State review as IN_PROGRESS until all required forms are submitted', () => {
        expect(classifySnapshot({ annualAccountsStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE })).toBe(
          STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS,
        );
      });

      it('classifies all required forms under State review as UNDER_REVIEW', () => {
        expect(
          classifySnapshot({
            annualAccountsStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
            provisionalAccountsStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
            pfmsBankAccountStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
          }),
        ).toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.UNDER_REVIEW);
      });

      it('does not classify a MoHUA-reviewed form as State UNDER_REVIEW', () => {
        expect(classifySnapshot({ pfmsBankAccountStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })).toBe(
          STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS,
        );
      });

      it('classifies all five final-cleared forms as ELIGIBLE', () => {
        const finalStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
        expect(
          classifySnapshot({
            annualAccountsStatus: finalStatus,
            provisionalAccountsStatus: finalStatus,
            pfmsBankAccountStatus: finalStatus,
            fcUnspentBalanceStatus: finalStatus,
            serviceLevelBenchmarkStatus: finalStatus,
          }),
        ).toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE);
      });

      it('does not classify four cleared forms and one missing form as eligible', () => {
        const finalStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
        expect(
          classifySnapshot({
            annualAccountsStatus: finalStatus,
            provisionalAccountsStatus: finalStatus,
            pfmsBankAccountStatus: finalStatus,
            fcUnspentBalanceStatus: finalStatus,
          }),
        ).not.toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE);
      });

      it('keeps four cleared forms and one unrelated form under review as IN_PROGRESS', () => {
        const finalStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
        expect(
          classifySnapshot({
            annualAccountsStatus: finalStatus,
            provisionalAccountsStatus: finalStatus,
            pfmsBankAccountStatus: finalStatus,
            fcUnspentBalanceStatus: finalStatus,
            serviceLevelBenchmarkStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
          }),
        ).toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.IN_PROGRESS);
      });

      it('keeps EXEMPTION_REQUESTED at zero without a source', async () => {
        const { data } = await fetchDashboard();
        expect(findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED).count).toBe(0);
      });

      it('counts every active ULB in exactly one summary bucket', async () => {
        const { data } = await fetchDashboard();
        expect(data.ulbSubmissionSummary.filter((item) => item.count > 0)).toHaveLength(1);
      });

      it('makes exemption classification higher priority than eligibility', () => {
        const finalStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
        expect(
          classifySnapshot({
            annualAccountsStatus: finalStatus,
            provisionalAccountsStatus: finalStatus,
            pfmsBankAccountStatus: finalStatus,
            fcUnspentBalanceStatus: finalStatus,
            serviceLevelBenchmarkStatus: finalStatus,
            exemptionRequested: true,
          }),
        ).toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED);
      });

      it('keeps the sum of all buckets equal to total active ULBs', async () => {
        const { data } = await fetchDashboard();
        const summaryTotal = data.ulbSubmissionSummary.reduce((sum, item) => sum + item.count, 0);
        expect(summaryTotal).toBe(data.metrics.totalUlbs);
      });
    });

    describe('compliance', () => {
      it('sets compliant ULB count equal to the eligible count', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics.compliance.compliantUlbs).toBe(
          findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE).count,
        );
      });

      it('rounds the compliance rate to the nearest whole number', () => {
        const calculator = service as unknown as {
          calculateComplianceRate(compliantUlbs: number, totalUlbs: number): number;
        };
        expect(calculator.calculateComplianceRate(2, 3)).toBe(67);
      });

      it('returns a zero compliance rate for zero ULBs', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        const { data } = await fetchDashboard();
        expect(data.metrics.compliance).toEqual({ rate: 0, compliantUlbs: 0, totalUlbs: 0 });
      });

      it('does not average individual form completion percentages', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
            { ulb: activeUlbIds[0], sectionType: 'unaudited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE },
          ]),
        );
        const { data } = await fetchDashboard();
        expect(data.formCompletion.some((item) => item.completed > 0)).toBe(true);
        expect(data.metrics.compliance.rate).toBe(0);
      });

      it('keeps a ULB non-compliant when a required form is missing', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics.compliance.compliantUlbs).toBe(0);
      });
    });

    describe('response preservation and query bounds', () => {
      it('preserves the Phase 5 context', async () => {
        const { data } = await fetchDashboard();
        expect(data.context).toMatchObject({
          stateId,
          yearId,
          stateName: stateRecord.name,
          financialYear: yearRecord.year,
        });
      });

      it('preserves the Phase 5 amount metrics', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics).toMatchObject({
          allocatedAmount: 15_620_000_000,
          claimedAmount: 0,
          amountUnit: STATE_DASHBOARD_AMOUNT_UNIT.CRORE,
          currency: STATE_DASHBOARD_CURRENCY.INR,
        });
      });

      it('preserves the Phase 6 State tasks', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks.map((task) => task.key)).toEqual([...STATE_DASHBOARD_TASK_ORDER]);
      });

      it('keeps the Phase 8 claim-letter display contract', async () => {
        const { data } = await fetchDashboard();
        expect(data.claimLetters).toHaveLength(2);
      });

      it('preserves State access restrictions before Phase 7 queries', async () => {
        await expect(service.getDashboard({ stateId: otherStateId, yearId }, makeUser())).rejects.toThrow(
          ForbiddenException,
        );
        expect(annualAccountModel.find).not.toHaveBeenCalled();
        expect(bankAccountModel.find).not.toHaveBeenCalled();
        expect(unspentBalanceModel.find).not.toHaveBeenCalled();
      });

      it('uses the existing success envelope', async () => {
        const { response } = await fetchDashboard();
        expect(response).toMatchObject({ success: true, message: 'State dashboard fetched successfully' });
      });

      it('uses one bounded query per available Phase 7 form model', async () => {
        await fetchDashboard();
        expect(annualAccountModel.find).toHaveBeenCalledTimes(1);
        expect(bankAccountModel.find).toHaveBeenCalledTimes(1);
        expect(unspentBalanceModel.find).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Phase 8 claim-letter display aggregation', () => {
    describe('first claim-letter row', () => {
      it('returns AVAILABLE when the eligible ULB count is greater than zero', () => {
        const first = findClaimLetter(buildClaimLetters(1), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.status).toBe(STATE_DASHBOARD_CLAIM_LETTER_STATUS.AVAILABLE);
      });

      it('returns LOCKED when the eligible ULB count is zero', () => {
        const first = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.status).toBe(STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED);
      });

      it('uses the exact eligible ULB count in the subtitle', () => {
        const first = findClaimLetter(buildClaimLetters(12), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.subtitle).toBe('Instalment 1 · Batch 1 — 12 approved ULBs ready to include');
      });

      it('uses the approved first claim-letter title', () => {
        const first = findClaimLetter(buildClaimLetters(1), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.title).toBe('Generate the first Claim Letter');
      });

      it('uses numeric installment value 1', () => {
        const first = findClaimLetter(buildClaimLetters(1), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.installment).toBe(1);
      });

      it('returns Start only when the first claim letter is available', () => {
        const available = findClaimLetter(buildClaimLetters(2), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(available.actionLabel).toBe('Start');
      });

      it('returns a null action when the first claim letter is locked', () => {
        const locked = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(locked.actionLabel).toBeNull();
      });

      it('returns a null lock reason when the first claim letter is available', () => {
        const available = findClaimLetter(buildClaimLetters(2), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(available.lockReason).toBeNull();
      });

      it('returns the expected no-eligible-ULB lock reason', () => {
        const locked = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(locked.lockReason).toBe('No eligible ULBs are available for the first claim letter.');
      });

      it('keeps the first claim-letter route null', () => {
        const first = findClaimLetter(buildClaimLetters(1), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.route).toBeNull();
      });
    });

    describe('second claim-letter row', () => {
      it('always returns LOCKED while no persisted source exists', () => {
        const second = findClaimLetter(buildClaimLetters(5), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.status).toBe(STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED);
      });

      it('uses the approved second claim-letter title', () => {
        const second = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.title).toBe('Instalment 2 Claim Letter');
      });

      it('uses numeric installment value 2', () => {
        const second = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.installment).toBe(2);
      });

      it('uses the approved second claim-letter subtitle', () => {
        const second = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.subtitle).toBe('Opens after the first Instalment 1 Claim Letter is generated');
      });

      it('returns a null action for the second claim letter', () => {
        const second = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.actionLabel).toBeNull();
      });

      it('returns the expected second claim-letter lock reason', () => {
        const second = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.lockReason).toBe('The first Instalment 1 Claim Letter has not been generated.');
      });

      it('keeps the second claim-letter route null', () => {
        const second = findClaimLetter(buildClaimLetters(0), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second.route).toBeNull();
      });

      it('does not unlock Instalment 2 merely because eligible ULBs exist', () => {
        const second = findClaimLetter(buildClaimLetters(20), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2);
        expect(second).toMatchObject({
          status: STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED,
          actionLabel: null,
        });
      });
    });

    describe('array contract', () => {
      it('returns exactly two claim-letter items', () => {
        expect(buildClaimLetters(0)).toHaveLength(2);
      });

      it('returns claim letters in the configured stable order', () => {
        expect(buildClaimLetters(0).map((item) => item.key)).toEqual([...STATE_DASHBOARD_CLAIM_LETTER_ORDER]);
      });

      it('uses the configured claim-letter keys', () => {
        expect(buildClaimLetters(1).map((item) => item.key)).toEqual([
          STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1,
          STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_2,
        ]);
      });

      it('uses only AVAILABLE and LOCKED statuses', () => {
        const allowedStatuses = new Set<string>([
          STATE_DASHBOARD_CLAIM_LETTER_STATUS.AVAILABLE,
          STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED,
        ]);
        expect(buildClaimLetters(1).every((item) => allowedStatuses.has(item.status))).toBe(true);
      });

      it('does not return a GENERATED status', () => {
        expect(buildClaimLetters(1).some((item) => (item.status as string) === 'GENERATED')).toBe(false);
      });

      it('does not omit locked rows', () => {
        const claimLetters = buildClaimLetters(0);
        expect(claimLetters).toHaveLength(2);
        expect(claimLetters.every((item) => item.status === STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED)).toBe(true);
      });
    });

    describe('integration with Phase 7', () => {
      it('uses the eligible ULB count already calculated by Phase 7', async () => {
        const { data } = await fetchDashboard();
        const first = findClaimLetter(data.claimLetters, STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.subtitle).toContain(`${data.metrics.compliance.compliantUlbs} approved ULBs`);
      });

      it('does not rerun Annual Account queries', async () => {
        await fetchDashboard();
        expect(annualAccountModel.find).toHaveBeenCalledTimes(1);
      });

      it('does not rerun PFMS queries', async () => {
        await fetchDashboard();
        expect(bankAccountModel.find).toHaveBeenCalledTimes(1);
      });

      it('does not rerun FC Unspent Balance queries', async () => {
        await fetchDashboard();
        expect(unspentBalanceModel.find).toHaveBeenCalledTimes(1);
      });

      it('adds no model query when building claim-letter rows', () => {
        jest.clearAllMocks();
        buildClaimLetters(3);
        expect(stateModel.findOne).not.toHaveBeenCalled();
        expect(yearModel.findOne).not.toHaveBeenCalled();
        expect(ulbModel.find).not.toHaveBeenCalled();
        expect(annualAccountModel.find).not.toHaveBeenCalled();
        expect(bankAccountModel.find).not.toHaveBeenCalled();
        expect(unspentBalanceModel.find).not.toHaveBeenCalled();
      });

      it('keeps the first claim letter locked when four forms are acknowledged but SLB is missing', async () => {
        annualAccountModel.find.mockReturnValue(
          queryResult([
            { ulb: activeUlbIds[0], sectionType: 'audited', form_status_id: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
            { ulb: activeUlbIds[0], sectionType: 'unaudited', form_status_id: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
          ]),
        );
        bankAccountModel.find.mockReturnValue(
          queryResult([{ ulb: activeUlbIds[0], currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }]),
        );
        unspentBalanceModel.find.mockReturnValue(queryResult([{ ulb: activeUlbIds[0], formStatus: 'SUBMITTED' }]));
        const { data } = await fetchDashboard();
        const first = findClaimLetter(data.claimLetters, STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.status).toBe(STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED);
      });

      it('makes the first claim letter available for an all-five-acknowledged eligible result', () => {
        const finalStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
        expect(
          classifySnapshot({
            annualAccountsStatus: finalStatus,
            provisionalAccountsStatus: finalStatus,
            pfmsBankAccountStatus: finalStatus,
            fcUnspentBalanceStatus: finalStatus,
            serviceLevelBenchmarkStatus: finalStatus,
          }),
        ).toBe(STATE_DASHBOARD_ULB_SUBMISSION_STATUS.ELIGIBLE);
        const first = findClaimLetter(buildClaimLetters(1), STATE_DASHBOARD_CLAIM_LETTER_KEY.INSTALLMENT_1_BATCH_1);
        expect(first.status).toBe(STATE_DASHBOARD_CLAIM_LETTER_STATUS.AVAILABLE);
      });

      it('returns both claim letters locked when there are zero active ULBs', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        const { data } = await fetchDashboard();
        expect(data.claimLetters.every((item) => item.status === STATE_DASHBOARD_CLAIM_LETTER_STATUS.LOCKED)).toBe(
          true,
        );
      });
    });

    describe('response preservation', () => {
      it('keeps claimed amount at zero', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics.claimedAmount).toBe(0);
      });

      it('preserves dashboard context', async () => {
        const { data } = await fetchDashboard();
        expect(data.context).toMatchObject({
          stateId,
          yearId,
          stateName: stateRecord.name,
          financialYear: yearRecord.year,
        });
      });

      it('preserves raw metric amount handling', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics.allocatedAmount).toBe(15_620_000_000);
      });

      it('preserves State-data tasks', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks.map((task) => task.key)).toEqual([...STATE_DASHBOARD_TASK_ORDER]);
      });

      it('preserves the ULB submission summary', async () => {
        const { data } = await fetchDashboard();
        expect(findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED).count).toBe(7);
        expect(data.ulbSubmissionSummary).toHaveLength(5);
      });

      it('preserves form-completion rows', async () => {
        const { data } = await fetchDashboard();
        expect(data.formCompletion.map((item) => item.key)).toEqual([...STATE_DASHBOARD_FORM_ORDER]);
      });

      it('preserves compliance calculation', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics.compliance).toEqual({ rate: 0, compliantUlbs: 0, totalUlbs: 7 });
      });

      it('preserves State access restrictions', async () => {
        await expect(service.getDashboard({ stateId: otherStateId, yearId }, makeUser())).rejects.toThrow(
          ForbiddenException,
        );
        expect(annualAccountModel.find).not.toHaveBeenCalled();
      });

      it('preserves the existing success envelope', async () => {
        const { response } = await fetchDashboard();
        expect(response).toMatchObject({ success: true, message: 'State dashboard fetched successfully' });
      });
    });
  });

  describe('Phase 9 response, error handling, and performance', () => {
    describe('success envelope and data shape', () => {
      it('returns success true', async () => {
        const { response } = await fetchDashboard();
        expect(response.success).toBe(true);
      });

      it('returns the exact dashboard success message', async () => {
        const { response } = await fetchDashboard();
        expect(response.message).toBe('State dashboard fetched successfully');
      });

      it('returns dashboard content under data', async () => {
        const { response } = await fetchDashboard();
        expect(response.data?.context.stateId).toBe(stateId);
      });

      it('does not double-wrap the response', async () => {
        const { response } = await fetchDashboard();
        const data = response.data as unknown as Record<string, unknown>;
        expect(data['success']).toBeUndefined();
        expect(data['data']).toBeUndefined();
      });

      it('always returns all six dashboard data sections', async () => {
        const { data } = await fetchDashboard();
        expect(Object.keys(data).sort()).toEqual(
          ['context', 'metrics', 'stateDataTasks', 'ulbSubmissionSummary', 'formCompletion', 'claimLetters'].sort(),
        );
      });

      it('keeps zero-value sections present', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        grantAllocationModel.findOne.mockReturnValue(queryResult(null));
        const { data } = await fetchDashboard();
        expect(data.metrics.totalUlbs).toBe(0);
        expect(data.metrics.allocatedAmount).toBe(0);
        expect(data.ulbSubmissionSummary).toHaveLength(5);
        expect(data.formCompletion).toHaveLength(5);
        expect(data.claimLetters).toHaveLength(2);
      });

      it('returns amount values as numbers rather than formatted strings', async () => {
        const { data } = await fetchDashboard();
        expect(typeof data.metrics.allocatedAmount).toBe('number');
        expect(typeof data.metrics.claimedAmount).toBe('number');
      });

      it('keeps allocatedAmount exactly unchanged', async () => {
        const { data } = await fetchDashboard();
        expect(data.metrics.allocatedAmount).toBe(15_620_000_000);
      });

      it('returns the required array item counts', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks).toHaveLength(3);
        expect(data.ulbSubmissionSummary).toHaveLength(5);
        expect(data.formCompletion).toHaveLength(5);
        expect(data.claimLetters).toHaveLength(2);
      });

      it('preserves configured ordering for every dashboard array', async () => {
        const { data } = await fetchDashboard();
        expect(data.stateDataTasks.map((item) => item.key)).toEqual([...STATE_DASHBOARD_TASK_ORDER]);
        expect(data.ulbSubmissionSummary.map((item) => item.key)).toEqual([...STATE_DASHBOARD_ULB_STATUS_ORDER]);
        expect(data.formCompletion.map((item) => item.key)).toEqual([...STATE_DASHBOARD_FORM_ORDER]);
        expect(data.claimLetters.map((item) => item.key)).toEqual([...STATE_DASHBOARD_CLAIM_LETTER_ORDER]);
      });
    });

    describe('structured errors and normal empty states', () => {
      it('preserves HTTP 403 for State access denial', async () => {
        try {
          await service.getDashboard({ stateId: otherStateId, yearId }, makeUser());
          throw new Error('Expected access denial');
        } catch (error) {
          expect(error).toBeInstanceOf(ForbiddenException);
          expect((error as ForbiddenException).getStatus()).toBe(403);
        }
      });

      it('uses STATE_ACCESS_DENIED for State access denial', async () => {
        try {
          await service.getDashboard({ stateId: otherStateId, yearId }, makeUser());
          throw new Error('Expected access denial');
        } catch (error) {
          expect((error as ForbiddenException).getResponse()).toMatchObject({
            code: STATE_DASHBOARD_ERROR_CODE.STATE_ACCESS_DENIED,
          });
        }
      });

      it('preserves HTTP 404 for a missing active State', async () => {
        stateModel.findOne.mockReturnValue(queryResult(null));
        try {
          await fetchDashboard();
          throw new Error('Expected missing State');
        } catch (error) {
          expect(error).toBeInstanceOf(NotFoundException);
          expect((error as NotFoundException).getStatus()).toBe(404);
        }
      });

      it('uses STATE_NOT_FOUND for a missing active State', async () => {
        stateModel.findOne.mockReturnValue(queryResult(null));
        try {
          await fetchDashboard();
          throw new Error('Expected missing State');
        } catch (error) {
          expect((error as NotFoundException).getResponse()).toMatchObject({
            code: STATE_DASHBOARD_ERROR_CODE.STATE_NOT_FOUND,
          });
        }
      });

      it('preserves HTTP 404 for a missing active year', async () => {
        yearModel.findOne.mockReturnValue(queryResult(null));
        try {
          await fetchDashboard();
          throw new Error('Expected missing year');
        } catch (error) {
          expect(error).toBeInstanceOf(NotFoundException);
          expect((error as NotFoundException).getStatus()).toBe(404);
        }
      });

      it('uses YEAR_NOT_FOUND for a missing active year', async () => {
        yearModel.findOne.mockReturnValue(queryResult(null));
        try {
          await fetchDashboard();
          throw new Error('Expected missing year');
        } catch (error) {
          expect((error as NotFoundException).getResponse()).toMatchObject({
            code: STATE_DASHBOARD_ERROR_CODE.YEAR_NOT_FOUND,
          });
        }
      });

      it('treats a missing allocation as a valid zero value', async () => {
        grantAllocationModel.findOne.mockReturnValue(queryResult(null));
        const { response, data } = await fetchDashboard();
        expect(response.success).toBe(true);
        expect(data.metrics.allocatedAmount).toBe(0);
      });

      it('returns a valid dashboard when no active ULBs exist', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        const { response, data } = await fetchDashboard();
        expect(response.success).toBe(true);
        expect(data.metrics.compliance).toEqual({ rate: 0, compliantUlbs: 0, totalUlbs: 0 });
      });

      it('treats missing form records as not started and incomplete', async () => {
        const { response, data } = await fetchDashboard();
        expect(response.success).toBe(true);
        expect(findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.NOT_STARTED).count).toBe(7);
        expect(data.formCompletion.every((item) => item.completed === 0)).toBe(true);
      });

      it('does not convert a State database rejection into a zero dashboard', async () => {
        const databaseError = new Error('state query failed');
        stateModel.findOne.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates a year query rejection', async () => {
        const databaseError = new Error('year query failed');
        yearModel.findOne.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates an active ULB query rejection', async () => {
        const databaseError = new Error('ULB query failed');
        ulbModel.find.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates a Grant Allocation query rejection', async () => {
        const databaseError = new Error('allocation query failed');
        grantAllocationModel.findOne.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates a Devolution Formula query rejection', async () => {
        const databaseError = new Error('devolution query failed');
        devolutionFormulaModel.findOne.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates an Annual Account query rejection', async () => {
        const databaseError = new Error('annual account query failed');
        annualAccountModel.find.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates a PFMS query rejection', async () => {
        const databaseError = new Error('PFMS query failed');
        bankAccountModel.find.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates an FC Unspent Balance query rejection', async () => {
        const databaseError = new Error('unspent query failed');
        unspentBalanceModel.find.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates a State-condition query rejection', async () => {
        const databaseError = new Error('SFC query failed');
        sfcStatusModel.findOne.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });

      it('propagates an Elected ULB condition query rejection', async () => {
        const databaseError = new Error('elected ULB query failed');
        electedBodyModel.findOne.mockReturnValue(rejectedQuery(databaseError));
        await expect(fetchDashboard()).rejects.toBe(databaseError);
      });
    });

    describe('bounded query execution', () => {
      it('executes the active ULB query once', async () => {
        await fetchDashboard();
        expect(ulbModel.find).toHaveBeenCalledTimes(1);
      });

      it('executes the Grant Allocation query once', async () => {
        await fetchDashboard();
        expect(grantAllocationModel.findOne).toHaveBeenCalledTimes(1);
      });

      it('executes the Annual Account query at most once', async () => {
        await fetchDashboard();
        expect(annualAccountModel.find).toHaveBeenCalledTimes(1);
      });

      it('executes the PFMS query at most once', async () => {
        await fetchDashboard();
        expect(bankAccountModel.find).toHaveBeenCalledTimes(1);
      });

      it('executes the FC Unspent Balance query at most once', async () => {
        await fetchDashboard();
        expect(unspentBalanceModel.find).toHaveBeenCalledTimes(1);
      });

      it('skips all ULB form queries for an empty active ULB list', async () => {
        ulbModel.find.mockReturnValue(queryResult([]));
        await fetchDashboard();
        expect(annualAccountModel.find).not.toHaveBeenCalled();
        expect(bankAccountModel.find).not.toHaveBeenCalled();
        expect(unspentBalanceModel.find).not.toHaveBeenCalled();
      });

      it('builds claim-letter rows without a database query', () => {
        jest.clearAllMocks();
        buildClaimLetters(4);
        expect(ulbModel.find).not.toHaveBeenCalled();
        expect(grantAllocationModel.findOne).not.toHaveBeenCalled();
        expect(annualAccountModel.find).not.toHaveBeenCalled();
      });

      it('uses the SLB source-gap fallback without a fourth ULB form query', async () => {
        const { data } = await fetchDashboard();
        expect(findCompletionItem(data, STATE_DASHBOARD_FORM_KEY.SERVICE_LEVEL_BENCHMARKS).completed).toBe(0);
        expect(annualAccountModel.find).toHaveBeenCalledTimes(1);
        expect(bankAccountModel.find).toHaveBeenCalledTimes(1);
        expect(unspentBalanceModel.find).toHaveBeenCalledTimes(1);
      });

      it('uses the exemption source-gap fallback without another query', async () => {
        const { data } = await fetchDashboard();
        expect(findSummaryItem(data, STATE_DASHBOARD_ULB_SUBMISSION_STATUS.EXEMPTION_REQUESTED).count).toBe(0);
        expect(annualAccountModel.find).toHaveBeenCalledTimes(1);
        expect(bankAccountModel.find).toHaveBeenCalledTimes(1);
        expect(unspentBalanceModel.find).toHaveBeenCalledTimes(1);
      });

      it('does not execute one form query per active ULB', async () => {
        ulbModel.find.mockReturnValue(queryResult(makeActiveUlbRecords(50)));
        await fetchDashboard();
        expect(annualAccountModel.find).toHaveBeenCalledTimes(1);
        expect(bankAccountModel.find).toHaveBeenCalledTimes(1);
        expect(unspentBalanceModel.find).toHaveBeenCalledTimes(1);
      });

      it('reuses the Grant Allocation result for the response amount', async () => {
        const { data } = await fetchDashboard();
        expect(grantAllocationModel.findOne).toHaveBeenCalledTimes(1);
        expect(data.metrics.allocatedAmount).toBe(allocationRecord.basic + allocationRecord.performance);
      });

      it('runs form-source queries with $in over active ULB IDs', async () => {
        await fetchDashboard();
        expect(annualAccountModel.find).toHaveBeenCalledWith({
          ulb: { $in: activeUlbIds },
          design_year: new Types.ObjectId(yearId),
        });
        expect(bankAccountModel.find).toHaveBeenCalledWith({
          ulb: { $in: activeUlbIds },
          designYear: new Types.ObjectId(yearId),
        });
        expect(unspentBalanceModel.find).toHaveBeenCalledWith({
          ulb: { $in: activeUlbIds },
          designYear: new Types.ObjectId(yearId),
        });
      });

      it('uses a minimal PFMS projection that excludes sensitive fields', async () => {
        await fetchDashboard();
        const query = bankAccountModel.find.mock.results[0].value as MockQuery<unknown[]>;
        expect(query.select).toHaveBeenCalledWith({ _id: 0, ulb: 1, currentFormStatus: 1 });
      });

      it('makes no HTTP fetch calls', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');
        try {
          await fetchDashboard();
          expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });

    describe('response-data security', () => {
      it('does not return account-number fields', async () => {
        const { data } = await fetchDashboard();
        expect(JSON.stringify(data)).not.toContain('accountNumber');
      });

      it('does not return proof-file fields', async () => {
        const { data } = await fetchDashboard();
        expect(JSON.stringify(data)).not.toContain('proofFile');
      });

      it('does not return authenticated user details', async () => {
        const user = makeUser();
        const { data } = await fetchDashboard(user);
        expect(JSON.stringify(data)).not.toContain(user._id);
        expect((data as unknown as Record<string, unknown>)['user']).toBeUndefined();
      });

      it('does not return raw MongoDB documents or form payloads', async () => {
        const { data } = await fetchDashboard();
        const serialized = JSON.stringify(data);
        expect(serialized).not.toContain('auditedData');
        expect(serialized).not.toContain('currentFormStatus');
        expect(serialized).not.toContain('bankDetails');
      });

      it('does not return stack traces', async () => {
        const { data } = await fetchDashboard();
        expect(JSON.stringify(data)).not.toContain('stack');
      });
    });
  });
});
