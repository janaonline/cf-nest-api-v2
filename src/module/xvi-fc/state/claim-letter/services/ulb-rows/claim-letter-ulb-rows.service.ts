import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { escapeRegex } from 'src/common/utils/regex.util';
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
import {
  ClaimLetterEligibilityService,
  ClaimLetterUlbLevelEligibility,
} from '../eligibility/claim-letter-eligibility.service';
import type { GetClaimLetterUlbRowsQueryDto } from '../../dto/get-claim-letter-ulb-rows-query.dto';
import type { ClaimLetterUlbRow } from '../../types/claim-letter.types';

interface ClaimLetterBatchParent {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: 1 | 2;
  batchNumber: number;
  ulbCount: number;
}

interface ClaimLetterBatchUlbRaw {
  ulbId: Types.ObjectId;
  ulbSnapshot: { name: string; censusCode: string | null; sbCode: string | null };
  allocatedAmount: number;
  claimedAmount: number;
  differencePercentageBasisPoints: number;
}

/** Selected-ULBs table for a claim; same shape as the FC Unspent Yes-branch table. */
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
    const parent = await this.loadParentWithAccess(claimLetterId, user);
    const filter = this.buildSearchFilter(parent._id, query.search);

    const page = query.page ?? CLAIM_LETTER_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT;

    const { rows, total } = await this.fetchRowsWithEligibility(parent, filter, { skip: (page - 1) * limit, limit });

    return xviFcSuccess('Claim letter ULBs fetched.', rows, { page, limit, total });
  }

  private async loadParentWithAccess(claimLetterId: string, user: AuthUser): Promise<ClaimLetterBatchParent> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .select('state year installment batchNumber ulbCount')
      .lean<ClaimLetterBatchParent>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    assertStateAccess(user, String(parent.state));
    return parent;
  }

  private buildSearchFilter(claimLetterId: Types.ObjectId, search?: string): FilterQuery<ClaimLetterBatchUlbDocument> {
    const filter: FilterQuery<ClaimLetterBatchUlbDocument> = { claimLetter: claimLetterId };
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { 'ulbSnapshot.name': regex },
        { 'ulbSnapshot.censusCode': regex },
        { 'ulbSnapshot.sbCode': regex },
      ];
    }
    return filter;
  }

  /** Re-checks eligibility on read, since it can change after a ULB is added. Display-only (a warning
   *  badge), so the cached variants are fine; save and submit re-check fresh. */
  private async fetchRowsWithEligibility(
    parent: Pick<ClaimLetterBatchParent, 'state' | 'year' | 'installment'>,
    filter: FilterQuery<ClaimLetterBatchUlbDocument>,
    pagination?: { skip: number; limit: number },
  ): Promise<{ rows: ClaimLetterUlbRow[]; total: number; ulbLevelEligibility: ClaimLetterUlbLevelEligibility }> {
    let rowsQuery = this.batchUlbModel.find(filter).sort({ 'ulbSnapshot.name': 1 });
    if (pagination) rowsQuery = rowsQuery.skip(pagination.skip).limit(pagination.limit);

    const [rawRows, total, gate] = await Promise.all([
      rowsQuery.lean<ClaimLetterBatchUlbRaw[]>().exec(),
      this.batchUlbModel.countDocuments(filter).exec(),
      this.eligibilityService.evaluateStateLevelGateForDisplay(
        String(parent.state),
        String(parent.year),
        parent.installment,
      ),
    ]);

    // Verdicts for this page's ULBs only.
    const rowUlbIds = rawRows.map((r) => String(r.ulbId));
    const ulbLevelEligibility = await this.eligibilityService.resolveUlbLevelEligibilityForDisplay(
      String(parent.state),
      String(parent.year),
      parent.installment,
      rowUlbIds,
    );

    const rows: ClaimLetterUlbRow[] = rawRows.map((r) => ({
      ulbId: String(r.ulbId),
      ulbName: r.ulbSnapshot.name,
      censusCode: r.ulbSnapshot.censusCode,
      sbCode: r.ulbSnapshot.sbCode,
      allocationAmount: r.allocatedAmount,
      claimAmount: r.claimedAmount,
      differencePercentage: r.differencePercentageBasisPoints / 100,
      eligible: gate.passed && (ulbLevelEligibility.perUlbEligible.get(String(r.ulbId)) ?? true),
    }));

    return { rows, total, ulbLevelEligibility };
  }
}
