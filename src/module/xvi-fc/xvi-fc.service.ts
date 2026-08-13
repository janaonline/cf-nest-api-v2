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
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { buildGetStateWiseDataPipeline } from './queries/get-state-wise-data.query';
import { SideMenuItemDto, SideMenuResponseDto } from './dto/side-menu.dto';
import { Year, YearDocument } from '../../schemas/year.schema';
import { Ulb, UlbDocument } from '../../schemas/ulb.schema';
import { State, StateDocument } from '../../schemas/state.schema';
import { SideMenu, SideMenuDocument, MenuRole } from '../../schemas/side-menu.schema';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from './cache/xvi-fc-cache.service';
import { FormJsonService } from '../../master/form-json/form-json.service';
import { UlbEligibilityService } from '../ulb-eligibility/ulb-eligibility.service';

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
    @InjectModel(SideMenu.name)
    private readonly sideMenuModel: Model<SideMenuDocument>,
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcUnspentBalanceDisclosure.name)
    private readonly disclosureModel: Model<XviFcUnspentBalanceDisclosureDocument>,
    @InjectModel(XviFcBankAccount.name)
    private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    private readonly cache: XviFcCacheService,
    private readonly formJsonService: FormJsonService,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  async getStateWiseData(stateId: string, requester: AuthUser): Promise<StateWiseResponseDto> {
    if (requester.scope === Scope.STATE && toObjectIdString(requester.state) !== stateId) {
      throw new ForbiddenException('You can only view your own state data');
    }

    const stateObjectId = new Types.ObjectId(stateId);
    const ineligibleUlbTypeIds = await this.ulbEligibilityService.getIneligibleUlbTypeIds('XVIFC');
    const pipeline = buildGetStateWiseDataPipeline(stateObjectId, ineligibleUlbTypeIds);
    const [result] = await this.grantAllocationModel.aggregate<StateWiseResponseDto>(pipeline);
    if (!result) {
      throw new NotFoundException('No grant allocation data found for this state');
    }
    return result;
  }

  async getSideMenu(role: MenuRole, yearId: string): Promise<SideMenuResponseDto> {
    if (!yearId) throw new NotFoundException('yearId is required');

    const docs = await this.sideMenuModel
      .find({ module: 'XVI-FC', role, year: new Types.ObjectId(yearId), isActive: true })
      .sort({ sequence: 1 })
      .lean()
      .exec();

    if (!docs.length) throw new NotFoundException(`No menu configured for role ${role}`);

    return this.buildMenuTree(docs);
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

  async clearFormJsonCache(
    user: AuthUser,
    designYearId?: string,
    formId?: number,
  ): Promise<{ message: string }> {
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

  private buildMenuTree(docs: Array<SideMenu & { _id: Types.ObjectId }>): SideMenuResponseDto {
    return {
      topModel: this.buildSection(docs, 'top'),
      bottomModel: this.buildSection(docs, 'bottom'),
    };
  }

  private buildSection(
    docs: Array<SideMenu & { _id: Types.ObjectId }>,
    section: 'top' | 'bottom',
  ): SideMenuItemDto[] {
    const sectionDocs = docs.filter((d) => d.section === section);
    const topLevel = sectionDocs.filter((d) => !d.parentId).sort((a, b) => a.sequence! - b.sequence!);
    const children = sectionDocs.filter((d) => d.parentId);

    return topLevel.map((doc) => {
      if (doc.type === 'separator') {
        return { label: '_', separator: true };
      }

      const item: SideMenuItemDto = { label: doc.name };
      if (doc.icon) item.icon = doc.icon;
      if (doc.routerLink?.length) item.routerLink = doc.routerLink;
      if (doc.featureKey) item.featureKey = doc.featureKey;

      if (doc.type === 'group') {
        item.items = children
          .filter((c) => c.parentId!.toString() === doc._id.toString())
          .sort((a, b) => a.sequence! - b.sequence!)
          .map((c) => {
            const child: SideMenuItemDto = { label: c.name };
            if (c.icon) child.icon = c.icon;
            if (c.featureKey) child.featureKey = c.featureKey;
            return child;
          });
      }

      return item;
    });
  }

  async getYears(): Promise<{ _id: string; year: string }[]> {
    const YEAR_RANGE = ['2026-27', '2027-28', '2028-29', '2029-30', '2030-31'];
    const results = await this.yearModel
      .find({ year: { $in: YEAR_RANGE } }, { _id: 1, year: 1 })
      .lean()
      .exec();
    return results.map((r) => ({ _id: r._id.toString(), year: r.year }));
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

  async getFormStatus(ulbId: string, designYearId: string) {
    const ulb = new Types.ObjectId(ulbId);
    const designYear = new Types.ObjectId(designYearId);

    const [annualAccounts, disclosure, bankAccount] = await Promise.all([
      this.annualAccountModel
        .find({ ulb, design_year: designYear })
        .select('sectionType form_status form_status_id')
        .lean()
        .exec(),
      this.disclosureModel.findOne({ ulb, designYear }).select('formStatus').lean().exec(),
      this.bankAccountModel.findOne({ ulb, designYear }).select('currentFormStatus').lean().exec(),
    ]);

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
    };
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
