import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { MohuaStateConditionsService } from 'src/module/xvi-fc/mohua/overview/mohua-state-conditions.service';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcDur, XviFcDurDocument } from 'src/schemas/xvi-fc/dur.schema';
import { XviFcBankAccount, XviFcBankAccountDocument } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import type { StateNotificationsData } from './state-notifications.types';

/**
 * Feeds the State bell and the sidebar dots: where each of the five State forms stands, plus how
 * many ULB forms are waiting on the State. Stateless and read-only — nothing is stored, so an item
 * clears itself once the underlying form moves on. Kept cheap (6 small queries) because the navbar
 * calls it on every State page.
 */
@Injectable()
export class StateNotificationsService {
  constructor(
    private readonly stateConditions: MohuaStateConditionsService,
    @InjectModel(XviFcAnnualAccount.name) private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcBankAccount.name) private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    @InjectModel(XviFcDur.name) private readonly durModel: Model<XviFcDurDocument>,
  ) {}

  async getNotifications(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<StateNotificationsData>> {
    assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const [conditions, ulbSubmissionsAwaitingReview] = await Promise.all([
      this.stateConditions.resolve(yearId, [stateId]),
      this.countUlbFormsAwaitingReview(stateOid, yearOid),
    ]);

    const forms = (conditions.get(stateId)?.forms ?? []).map(({ key, statusCode }) => ({ key, statusCode }));
    return xviFcSuccess('State notifications fetched.', { forms, ulbSubmissionsAwaitingReview });
  }

  /** Audited + Provisional sections, PFMS bank accounts and DURs sitting at UNDER_REVIEW_BY_STATE.
   *  SLB is left out — it has no State review step. The bank account is a once-ever form, so it is
   *  counted by state alone rather than by design year. */
  private async countUlbFormsAwaitingReview(stateOid: Types.ObjectId, yearOid: Types.ObjectId): Promise<number> {
    const status = FORM_STATUS.UNDER_REVIEW_BY_STATE;
    const counts = await Promise.all([
      this.annualAccountModel.countDocuments({ state: stateOid, design_year: yearOid, form_status_id: status }).exec(),
      this.bankAccountModel.countDocuments({ state: stateOid, currentFormStatus: status }).exec(),
      this.durModel.countDocuments({ state: stateOid, design_year: yearOid, currentFormStatus: status }).exec(),
    ]);
    return counts.reduce((sum, n) => sum + n, 0);
  }
}
