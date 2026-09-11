/* eslint-disable prettier/prettier */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { FORM_STATUS, getFormStatusKey, type FormStatusType } from 'src/common/constants/form-status.constants';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { GrantAllocation, GrantAllocationDocument } from '../../schemas/xvi-fc/grant-allocation.schema';
import {
  XviFcAnnualAccount,
  XviFcAnnualAccountDocument,
  AnnualAccountFormStatus,
  FORM_STATUS_ID,
} from '../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcUnspentBalanceDisclosure,
  XviFcUnspentBalanceDisclosureDocument,
} from '../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import {
  XviFcBankAccount,
  XviFcBankAccountDocument,
} from '../../schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { SlbForm, SlbFormDocument, SLB_FORM_TYPE, SLB_FORM_ID } from '../../schemas/xvi-fc/ulb/slb-form.schema';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { buildGetStateWiseDataPipeline } from './queries/get-state-wise-data.query';
import { SideMenuResponseDto } from './dto/side-menu.dto';
import { Year, YearDocument } from '../../schemas/year.schema';
import { Ulb, UlbDocument } from '../../schemas/ulb.schema';
import { State, StateDocument } from '../../schemas/state.schema';
import type { MenuRole } from '../../schemas/side-menu.schema';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from './cache/xvi-fc-cache.service';
import { FormJsonService } from '../../master/form-json/form-json.service';
import { UlbEligibilityService } from '../ulb-eligibility/ulb-eligibility.service';
import { SideMenuService } from './side-menu/side-menu.service';
import { isWithinXvifcCycle, hasDesignYearStarted } from './common/constants/xvifc-cycle.constants';
import { ExemptionResolverService } from './common/services/exemption-resolver.service';
import { FormJsonConfigService } from '../../master/form-json-config/form-json-config.service';
import type { SubmissionScope } from '../../schemas/form-json-config.schema';
import { BANK_ACCOUNT_FORM_ID } from './ulb/bank-account/constants/bank-account-form.constants';

@Injectable()
export class XviFcService {
  constructor(
    @InjectModel(GrantAllocation.name)
    private readonly grantAllocationModel: Model<GrantAllocationDocument>,
    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcUnspentBalanceDisclosure.name)
    private readonly disclosureModel: Model<XviFcUnspentBalanceDisclosureDocument>,
    @InjectModel(XviFcBankAccount.name)
    private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    @InjectModel(SlbForm.name)
    private readonly slbFormModel: Model<SlbFormDocument>,
    private readonly cache: XviFcCacheService,
    private readonly formJsonService: FormJsonService,
    private readonly ulbEligibilityService: UlbEligibilityService,
    private readonly sideMenuService: SideMenuService,
    private readonly exemptionResolverService: ExemptionResolverService,
    private readonly formJsonConfigService: FormJsonConfigService,
  ) {}

  async getStateWiseData(stateId: string, requester: AuthUser): Promise<StateWiseResponseDto> {
    // Only that state's own STATE user may view its financial data — ADMIN is the sole exception
    // (same "ADMIN bypasses, STATE must match own state, everyone else denied" convention as
    // ClaimLetterUlbOptionsService.hasStateAccess). Any other scope (ULB, MoHUA, or a STATE user
    // requesting a different state) is rejected outright, not just left unchecked.
    const hasStateAccess =
      requester.scope === Scope.ADMIN ||
      (requester.scope === Scope.STATE && toObjectIdString(requester.state) === stateId);
    if (!hasStateAccess) {
      throw new ForbiddenException('You can only view your own state data');
    }

    const stateObjectId = new Types.ObjectId(stateId);
    const ineligibleUlbTypeIds = await this.ulbEligibilityService.getIneligibleUlbTypeIds('XVIFC');
    const pipeline = buildGetStateWiseDataPipeline(stateObjectId, ineligibleUlbTypeIds);
    const [result] = await this.grantAllocationModel.aggregate<StateWiseResponseDto>(pipeline);
    if (!result) {
      throw new NotFoundException('No grant allocation data found for this state');
    }
    return this.roundStateWiseAmounts(result);
  }

  // Defensive rounding — GrantAllocation is externally written and unconstrained (see
  // grant-allocation.schema.ts). Rounds each year's basic/performance first, then re-derives
  // totalAllocation from the rounded rows, so the displayed total always matches the sum of the
  // displayed per-year figures rather than drifting from them by a rounding remainder.
  private roundStateWiseAmounts(data: StateWiseResponseDto): StateWiseResponseDto {
    const tableData = data.tableData.map((row) => ({
      ...row,
      basic: Math.round(row.basic),
      performance: Math.round(row.performance),
    }));
    const totalAllocation = tableData.reduce((sum, row) => sum + row.basic + row.performance, 0);
    return { ...data, tableData, totalAllocation };
  }

  getSideMenu(role: MenuRole, yearId: string): Promise<SideMenuResponseDto> {
    return this.sideMenuService.getSideMenu(role, yearId);
  }

  async clearPageCache(user: AuthUser, pattern?: string): Promise<{ message: string }> {
    if (user.scope !== Scope.ADMIN) throw new ForbiddenException('Only admins can clear the cache.');
    // Cache keys are `xvifc:cache:<full request URL>`, which includes the app's global
    // route prefix (e.g. /api/v2/xvi-fc/sidebar/STATE?yearId=...) — a caller passing just
    // "/xvi-fc/sidebar" has no way to know that prefix. Wrap the pattern as a "contains"
    // glob match instead of an anchored one, so it matches regardless of the prefix or
    // whether the caller already added their own wildcards.
    const redisPattern = pattern
      ? `${XVIFC_CACHE_KEY_PREFIX}:*${pattern.replace(/^\/+|\*+/g, '')}*`
      : `${XVIFC_CACHE_KEY_PREFIX}:*`;
    const deletedCount = await this.cache.deleteByPattern(redisPattern);
    return {
      message:
        deletedCount > 0
          ? `Cleared ${deletedCount} cache ${deletedCount === 1 ? 'entry' : 'entries'}${pattern ? ` for pattern: ${pattern}` : ''}.`
          : `No cached entries matched${pattern ? ` pattern: ${pattern}` : ''} — nothing was cleared.`,
    };
  }

  async clearFormJsonCache(user: AuthUser, designYearId?: string, formId?: number): Promise<{ message: string }> {
    if (user.scope !== Scope.ADMIN) throw new ForbiddenException('Only admins can clear the cache.');
    const deletedCount = await this.formJsonService.clearCache(designYearId, formId);
    const scope = [designYearId ? `designYearId: ${designYearId}` : null, formId ? `formId: ${formId}` : null]
      .filter(Boolean)
      .join(', ');
    return {
      message:
        deletedCount > 0
          ? `Cleared ${deletedCount} FormJson cache ${deletedCount === 1 ? 'entry' : 'entries'}${scope ? ` for ${scope}` : ''}.`
          : `No matching FormJson cache entries${scope ? ` for ${scope}` : ''} — nothing was cleared.`,
    };
  }

  async clearSideMenuCache(user: AuthUser, role?: string, yearId?: string): Promise<{ message: string }> {
    if (user.scope !== Scope.ADMIN) throw new ForbiddenException('Only admins can clear the cache.');
    const deletedCount = await this.sideMenuService.clearCache(role, yearId);
    const scope = [role ? `role: ${role}` : null, yearId ? `yearId: ${yearId}` : null].filter(Boolean).join(', ');
    return {
      message:
        deletedCount > 0
          ? `Cleared ${deletedCount} side-menu cache ${deletedCount === 1 ? 'entry' : 'entries'}${scope ? ` for ${scope}` : ''}.`
          : `No matching side-menu cache entries${scope ? ` for ${scope}` : ''} — nothing was cleared.`,
    };
  }

  /**

  * Returns all 16th FC award years (2026-27 to 2030-31) in ascending order.
  * Excludes 14th/15th FC years. Every year is returned with isEnabled so callers
  can distinguish selectable and locked years without inferring from omissions.
  *For ULBs, isEnabled directly reflects yearAccess[year].yearEnabled; missing
  entries are treated as false and are never materialized - EXCEPT when
  ulb.startYear is null, which is itself the documented "no restriction, sees
  every year" signal (already in hand from the same read, no YearAccessService
  call), so a missing entry there means unrestricted-and-enabled rather than
  locked. A ULB with a non-null startYear still gets false for any year it
  hasn't been materialized for, same as before. STATE/ADMIN can access all
  in-cycle years.

  A year whose starting calendar year hasn't arrived yet is always isEnabled: false, for every
  caller - e.g. while the current calendar year is 2026, "2026-27" is enabled but "2027-28" through
  "2030-31" are not, regardless of yearAccess or scope. This future-year gate is a hard override on
  top of everything else; it can only turn a year off, never on.
  */
  async getYears(user?: AuthUser): Promise<{ _id: string; year: string; isEnabled: boolean }[]> {
    const activeYears = (
      await this.yearModel.find({ isActive: true }, { _id: 1, year: 1 }).sort({ year: 1 }).lean().exec()
    ).filter((y) => isWithinXvifcCycle(y.year));

    if (user?.scope === Scope.ULB) {
      const ulbId = toObjectIdString(user.ulb);
      const ulb = ulbId ? await this.ulbModel.findById(ulbId, { startYear: 1, yearAccess: 1 }).lean().exec() : null;

      if (ulb) {
        return activeYears.map((r) => ({
          _id: r._id.toString(),
          year: r.year,
          isEnabled:
            hasDesignYearStarted(r.year) &&
            (ulb.startYear == null || ulb.yearAccess?.[r.year]?.yearEnabled === true),
        }));
      }
    }

    return activeYears.map((r) => ({
      _id: r._id.toString(),
      year: r.year,
      isEnabled: hasDesignYearStarted(r.year),
    }));
  }

  async getUlbById(ulbId: string): Promise<{ ulbName: string; stateId: string; stateName: string }> {
    const ulb = await this.ulbModel
      .findById(ulbId)
      .select('name state')
      .populate<{ state: { _id: Types.ObjectId; name: string } }>('state', 'name')
      .lean()
      .exec();

    if (!ulb) throw new NotFoundException('ULB not found');
    return { ulbName: ulb.name, stateId: ulb.state?._id?.toString() ?? '', stateName: ulb.state?.name ?? '' };
  }

  async getStateById(stateId: string): Promise<{ stateName: string }> {
    const state = await this.stateModel.findById(stateId).select('name').lean().exec();
    if (!state) throw new NotFoundException('State not found');
    return { stateName: state.name };
  }

  async getYearLabelById(yearId: string): Promise<{ yearLabel: string }> {
    const year = await this.yearModel.findById(yearId).select('year').lean().exec();
    if (!year) throw new NotFoundException('Year not found');
    return { yearLabel: year.year };
  }

  async getFormStatus(ulbId: string, designYearId: string) {
    const ulb = new Types.ObjectId(ulbId);
    const designYear = new Types.ObjectId(designYearId);

    const [annualAccounts, disclosure, bankAccountByYear, slbForm, bankFormConfig] = await Promise.all([
      this.annualAccountModel
        .find({ ulb, design_year: designYear })
        .select('sectionType form_status form_status_id')
        .lean()
        .exec(),
      this.disclosureModel.findOne({ ulb, designYear }).select('formStatus').lean().exec(),
      this.bankAccountModel.findOne({ ulb, designYear }).select('currentFormStatus').lean().exec(),
      this.slbFormModel
        .findOne({ ulb, year: designYear, formType: SLB_FORM_TYPE, isDeleted: false })
        .select('currentFormStatus')
        .lean()
        .exec(),
      this.formJsonConfigService.findByFormId(BANK_ACCOUNT_FORM_ID),
    ]);

    // ONCE_EVER (Bank Account's actual scope): the record can live in an earlier design year than
    // the one being requested here. Mirrors BankAccountService.getBankAccount's own ONCE_EVER
    // branch. Only fires the extra query when the fast, common-case lookup above came up empty -
    // no added latency for a ULB whose record already belongs to the current year.
    const bankSubmissionScope: SubmissionScope = bankFormConfig?.submissionScope ?? 'PER_YEAR';
    const bankAccount =
      bankAccountByYear ??
      (bankSubmissionScope === 'ONCE_EVER'
        ? await this.bankAccountModel.findOne({ ulb }).select('currentFormStatus').lean().exec()
        : null);

    // 'audited' is always the {ulb, design_year} anchor — its _id is what every other
    // annual-account endpoint hands back as annualAccountId (see AnnualAccountsService).
    const auditedDoc = annualAccounts.find((a) => a.sectionType === 'audited');
    const unauditedDoc = annualAccounts.find((a) => a.sectionType === 'unaudited');

    const sectionStatus = (section: Record<string, unknown> | undefined | null) => ({
      form_status: (section?.['form_status'] ?? AnnualAccountFormStatus.NOT_STARTED) as AnnualAccountFormStatus,
      form_status_id: (section?.['form_status_id'] ?? FORM_STATUS_ID[AnnualAccountFormStatus.NOT_STARTED]) as number,
    });

    const isSubmitted = (disclosure as Record<string, unknown> | null)?.['formStatus'] === 'SUBMITTED';
    const bankAccountStatus =
      ((bankAccount as Record<string, unknown> | null)?.['currentFormStatus'] as FormStatusType | undefined) ??
      FORM_STATUS.NOT_STARTED;
    const slbStatus = await this.resolveSlbStatus(
      ulb,
      designYear,
      slbForm as { currentFormStatus?: FormStatusType } | null,
    );

    return {
      annualAccountId: auditedDoc?._id?.toString() ?? null,
      auditedData: sectionStatus(auditedDoc as Record<string, unknown> | undefined),
      unauditedData: sectionStatus(unauditedDoc as Record<string, unknown> | undefined),
      unspentBalanceDisclosure: {
        form_status: isSubmitted ? 'SUBMITTED' : 'NOT_STARTED',
        form_status_id: null,
      },
      xviFcBankAccount: {
        form_status: getFormStatusKey(bankAccountStatus),
        form_status_id: bankAccountStatus,
      },
      serviceLevelBenchmarks: {
        form_status: getFormStatusKey(slbStatus),
        form_status_id: slbStatus,
      },
    };
  }

  /**
   * SLB's status for the "Conditions Progress" dashboard. If a real SLB document already exists,
   * its own currentFormStatus is authoritative (golden rule — never overridden, matches
   * SlbService.getForm's own precedence). Only when no document exists yet does this check
   * exemption (read-only, via the same ExemptionResolverService the STATE review table uses) so
   * an exempted ULB that has never opened /slb still sees EXEMPTED_ACKNOWLEDGED here instead of
   * the misleading default NOT_STARTED.
   */
  private async resolveSlbStatus(
    ulbId: Types.ObjectId,
    designYearId: Types.ObjectId,
    slbForm: { currentFormStatus?: FormStatusType } | null,
  ): Promise<FormStatusType> {
    if (slbForm?.currentFormStatus != null) return slbForm.currentFormStatus;

    const [ulb, year] = await Promise.all([
      this.ulbModel.findById(ulbId, { startYear: 1, yearAccess: 1 }).lean().exec(),
      this.yearModel.findById(designYearId, { year: 1 }).lean().exec(),
    ]);
    if (!ulb || !year) return FORM_STATUS.NOT_STARTED;

    const resolution = await this.exemptionResolverService.resolveBulk([ulb], year, SLB_FORM_ID);
    return resolution.get(String(ulb._id))?.exempted ? FORM_STATUS.EXEMPTED_ACKNOWLEDGED : FORM_STATUS.NOT_STARTED;
  }

  getSupportHours(): {
    nextSupportHour: { date: string; description: string; time: string; hostedBy: string };
    upcomingSupportHours: { date: string; details: string; status: 'UPCOMING' | 'SCHEDULED' }[];
  } {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);

    const dayOfWeek = istNow.getUTCDay();
    const istMinutesOfDay = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

    // Thursday = 4; if today is Thursday but past 4 PM IST, roll to next week
    let daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    if (dayOfWeek === 4 && istMinutesOfDay >= 16 * 60) {
      daysUntilThursday = 7;
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const thursdays = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(istNow);
      d.setUTCDate(istNow.getUTCDate() + daysUntilThursday + i * 7);
      return d;
    });

    const formatLong = (d: Date) => `Thursday, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const formatShort = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const NEXT_DETAILS =
      'Open Q&A session for ULB teams. Bring your questions about audited financial statements, submissions, or validation errors.';

    return {
      nextSupportHour: {
        date: formatLong(thursdays[0]),
        description: NEXT_DETAILS,
        time: '3:00 PM - 4:00 PM IST',
        hostedBy: 'CityFinance Product & PMU Team',
      },
      upcomingSupportHours: thursdays.slice(1).map((d, i) => ({
        date: formatShort(d),
        details: 'Open support hour',
        status: i === 0 ? 'UPCOMING' : 'SCHEDULED',
      })),
    };
  }
}
