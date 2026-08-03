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

/** Selected-ULBs table for a claim — mirrors the FC Unspent Yes-branch table shape. */
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

  /**
   * Unpaginated sibling of `getUlbs()` for callers that need every ULB in the batch at once (e.g.
   * `ClaimLetterDocumentService` — a letter must list every recommended ULB, not one UI page of
   * them). Deliberately bypasses `CLAIM_LETTER_PAGINATION_MAX_LIMIT`, which exists to bound HTTP
   * query params, not internal service-to-service calls. Also returns the resolved
   * `ulbLevelEligibility` (not just the merged `eligible` flag baked into each row) so callers that
   * need per-criterion detail — e.g. Annexure 2's AFS/Provisional/FC-Disclosure/Elected-Body
   * checkmarks — don't have to re-resolve it a second time.
   */
  async getAllUlbRows(
    claimLetterId: string,
    user: AuthUser,
  ): Promise<{
    parent: ClaimLetterBatchParent;
    rows: ClaimLetterUlbRow[];
    ulbLevelEligibility: ClaimLetterUlbLevelEligibility;
  }> {
    const parent = await this.loadParentWithAccess(claimLetterId, user);
    const filter = this.buildSearchFilter(parent._id);

    const { rows, ulbLevelEligibility } = await this.fetchRowsWithEligibility(parent, filter);

    return { parent, rows, ulbLevelEligibility };
  }

  private async loadParentWithAccess(claimLetterId: string, user: AuthUser): Promise<ClaimLetterBatchParent> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .select('state year installment batchNumber ulbCount')
      .lean<ClaimLetterBatchParent>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    this.assertStateAccess(user, String(parent.state));
    return parent;
  }

  private buildSearchFilter(claimLetterId: Types.ObjectId, search?: string): FilterQuery<ClaimLetterBatchUlbDocument> {
    const filter: FilterQuery<ClaimLetterBatchUlbDocument> = { claimLetter: claimLetterId };
    if (search) {
      const regex = new RegExp(this.escapeRegExp(search), 'i');
      filter.$or = [
        { 'ulbSnapshot.name': regex },
        { 'ulbSnapshot.censusCode': regex },
        { 'ulbSnapshot.sbCode': regex },
      ];
    }
    return filter;
  }

  /**
   * Shared by `getUlbs()` (paginated) and `getAllUlbRows()` (unpaginated, `pagination` omitted) —
   * fetches the batch's ULB rows plus the state gate and per-ULB criteria, re-verified at read
   * time rather than trusted from the frozen snapshot alone (a ULB's Devolution/eligibility status
   * may have changed after being added but before final submit). This is a display-only read (the
   * `eligible` flag only drives a client-side warning badge — actual save/submit authorization is
   * independently, always-freshly re-verified server-side in ClaimLetterAssemblyService), so the
   * cached `*ForDisplay` variants are safe here.
   */
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

    // Extended re-verification to the per-ULB criteria (SLB, Annual Accounts, Elected Body/FC
    // Unspent rows) — only needs a verdict for the ULBs actually fetched above, not the full
    // state's expected set.
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
