import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import {
  CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT,
  CLAIM_LETTER_PAGINATION_DEFAULT_PAGE,
} from '../../constants/claim-letter.constants';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import type { GetClaimLetterUlbRowsQueryDto } from '../../dto/get-claim-letter-ulb-rows-query.dto';
import type { ClaimLetterFinancialSummaryDisplay, ClaimLetterUlbRow } from '../../types/claim-letter.types';

/** Selected-ULBs table for a claim (plan §6.2) — mirrors the FC Unspent Yes-branch table shape. */
@Injectable()
export class ClaimLetterUlbRowsService {
  constructor(
    private readonly eligibilityService: ClaimLetterEligibilityService,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name)
    private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
  ) {}

  async getUlbs(
    claimLetterId: string,
    query: GetClaimLetterUlbRowsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterUlbRow[]>> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<{
        _id: Types.ObjectId;
        state: Types.ObjectId;
        year: Types.ObjectId;
        installment: 1 | 2;
        financialSummary: ClaimLetterFinancialSummaryDisplay;
      }>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    this.assertStateAccess(user, String(parent.state));

    const filter: FilterQuery<ClaimLetterBatchUlbDocument> = { claimLetter: parent._id };
    if (query.search) {
      const regex = new RegExp(this.escapeRegExp(query.search), 'i');
      filter.$or = [
        { 'ulbSnapshot.name': regex },
        { 'ulbSnapshot.censusCode': regex },
        { 'ulbSnapshot.sbCode': regex },
      ];
    }

    const page = query.page ?? CLAIM_LETTER_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT;

    const [rows, total, gate] = await Promise.all([
      this.batchUlbModel
        .find(filter)
        .sort({ 'ulbSnapshot.name': 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<
          {
            ulbId: Types.ObjectId;
            ulbSnapshot: { name: string; censusCode: string | null; sbCode: string | null };
            allocatedAmount: number;
            claimedAmount: number;
            differencePercentageBasisPoints: number;
          }[]
        >()
        .exec(),
      this.batchUlbModel.countDocuments(filter).exec(),
      // Re-verified at read time (plan §6.2), not trusted from the frozen snapshot alone — a
      // ULB's Devolution status may have changed after being added but before final submit. This
      // is a display-only read (the `eligible` flag only drives a client-side warning badge —
      // actual save/submit authorization is independently, always-freshly re-verified server-side
      // in ClaimLetterAssemblyService), so the cached variant is safe here.
      this.eligibilityService.evaluateStateLevelGateForDisplay(
        String(parent.state),
        String(parent.year),
        parent.installment,
      ),
    ]);

    // Same re-verification, extended to the per-ULB criteria (SLB, Annual Accounts, Elected
    // Body/FC Unspent rows) — this endpoint previously only rechecked the state gate, unlike
    // getOptions()/buildChildren(), which already checked per-ULB data. Only needs a verdict for
    // the ULBs on this page, not the full state's expected set.
    const rowUlbIds = rows.map((r) => String(r.ulbId));
    const ulbLevelEligibility = await this.eligibilityService.resolveUlbLevelEligibilityForDisplay(
      String(parent.state),
      String(parent.year),
      parent.installment,
      rowUlbIds,
    );

    const data: ClaimLetterUlbRow[] = rows.map((r) => ({
      ulbId: String(r.ulbId),
      ulbName: r.ulbSnapshot.name,
      censusCode: r.ulbSnapshot.censusCode,
      sbCode: r.ulbSnapshot.sbCode,
      allocationAmount: r.allocatedAmount,
      claimAmount: r.claimedAmount,
      differencePercentage: r.differencePercentageBasisPoints / 100,
      eligible: gate.passed && (ulbLevelEligibility.perUlbEligible.get(String(r.ulbId)) ?? true),
    }));

    return xviFcSuccess('Claim letter ULBs fetched.', data, {
      page,
      limit,
      total,
      financialSummary: parent.financialSummary,
    });
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
