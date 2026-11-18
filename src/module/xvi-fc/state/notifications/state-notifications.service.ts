import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { MohuaStateConditionsService } from 'src/module/xvi-fc/mohua/overview/mohua-state-conditions.service';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { RETURNED_CLAIM_LETTER_STATUSES } from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-returned.helpers';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcDur, XviFcDurDocument } from 'src/schemas/xvi-fc/dur.schema';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { XviFcBankAccount, XviFcBankAccountDocument } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import type { StateNotificationsData } from './state-notifications.types';

/**
 * Feeds the State bell and the sidebar dots: where each of the five State forms stands, how many
 * ULB forms are waiting on the State, and how many claim letters MoHUA returned that still need a
 * new letter. Stateless and read-only — nothing is stored, so an item clears itself once the
 * underlying form or letter moves on. Kept cheap (7 small queries) because the navbar calls it on
 * every State page.
 */
@Injectable()
export class StateNotificationsService {
  constructor(
    private readonly stateConditions: MohuaStateConditionsService,
    @InjectModel(XviFcAnnualAccount.name) private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcBankAccount.name) private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    @InjectModel(XviFcDur.name) private readonly durModel: Model<XviFcDurDocument>,
    @InjectModel(ClaimLetterBatch.name) private readonly claimLetterModel: Model<ClaimLetterBatchDocument>,
  ) {}

  async getNotifications(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<StateNotificationsData>> {
    assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const [conditions, ulbSubmissionsAwaitingReview, claimLettersReturned] = await Promise.all([
      this.stateConditions.resolve(yearId, [stateId]),
      this.countUlbFormsAwaitingReview(stateOid, yearOid),
      this.countOpenClaimLetterReturns(stateOid, yearOid),
    ]);

    const forms = (conditions.get(stateId)?.forms ?? []).map(({ key, statusCode }) => ({ key, statusCode }));
    return xviFcSuccess('State notifications fetched.', { forms, ulbSubmissionsAwaitingReview, claimLettersReturned });
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

  /** Returned claim letters (RETURNED_CLAIM_LETTER_STATUSES) with no letter submitted in the same slot
   *  (installment + batch number) after the return. A returned letter is closed and the State builds a
   *  new one, so the item stays until that new letter is submitted, not merely drafted. */
  private async countOpenClaimLetterReturns(stateOid: Types.ObjectId, yearOid: Types.ObjectId): Promise<number> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          state: stateOid,
          year: yearOid,
          currentFormStatus: { $in: [...RETURNED_CLAIM_LETTER_STATUSES] },
        },
      },
      {
        $lookup: {
          from: this.claimLetterModel.collection.name,
          let: { installment: '$installment', batchNumber: '$batchNumber', returnedAt: '$resolvedAt' },
          pipeline: [
            { $match: { state: stateOid, year: yearOid } },
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$installment', '$$installment'] },
                    { $eq: ['$batchNumber', '$$batchNumber'] },
                    { $gt: ['$submittedAt', '$$returnedAt'] },
                  ],
                },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: 'resubmitted',
        },
      },
      { $match: { resubmitted: { $size: 0 } } },
      { $count: 'open' },
    ];
    const [result] = await this.claimLetterModel.aggregate<{ open: number }>(pipeline).exec();
    return result?.open ?? 0;
  }
}
