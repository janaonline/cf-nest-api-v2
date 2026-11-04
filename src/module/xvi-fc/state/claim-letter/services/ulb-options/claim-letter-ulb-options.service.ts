import { Injectable } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import {
  CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT,
  CLAIM_LETTER_PAGINATION_DEFAULT_PAGE,
} from '../../constants/claim-letter.constants';
import { assertInstallmentSupported } from '../../helpers/claim-letter-installment.helpers';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import type { GetClaimLetterUlbOptionsQueryDto } from '../../dto/get-claim-letter-ulb-options-query.dto';
import type { ClaimLetterUlbOption } from '../../types/claim-letter.types';

/** Every expected ULB, sorted eligible, ineligible, then in another batch, so the dialog shows the
 *  last two disabled (FC Unspent's picker omits them instead). */
@Injectable()
export class ClaimLetterUlbOptionsService {
  constructor(
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly eligibilityService: ClaimLetterEligibilityService,
  ) {}

  async getOptions(
    stateId: string,
    yearId: string,
    installment: number,
    query: GetClaimLetterUlbOptionsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterUlbOption[]>> {
    assertStateAccess(user, stateId);
    assertInstallmentSupported(installment);

    // Display-only, so the cached eligibility is fine; create re-checks fresh.
    const expectedUlbsPromise = this.expectedUlbSetService.resolve(stateId, yearId);
    const [expectedUlbs, gate, allocationByUlbId, claimedBatchByUlbId, ulbLevelEligibility] = await Promise.all([
      expectedUlbsPromise,
      this.eligibilityService.evaluateStateLevelGateForDisplay(stateId, yearId, installment),
      this.eligibilityService.resolveDevolutionAllocations(stateId, yearId, installment),
      // Leaves out this draft's own locks, so its picks stay selectable.
      this.eligibilityService.resolveClaimedUlbBatches(stateId, yearId, installment, query.claimLetterId),
      expectedUlbsPromise.then((ulbs) => {
        const ids = ulbs.map((u) => u.ulbId);
        return this.eligibilityService.resolveUlbLevelEligibilityForDisplay(
          stateId,
          yearId,
          installment as 1 | 2,
          ids,
          ids,
        );
      }),
    ]);

    const stateGateFailureReason = gate.sources.find((s) => s.result === 'FAILED')?.reasonCode ?? 'STATE_GATE_FAILED';

    let options: ClaimLetterUlbOption[] = expectedUlbs.map((ulb) => {
      const allocation = allocationByUlbId.get(ulb.ulbId);
      const claimedInBatch = claimedBatchByUlbId.get(ulb.ulbId) ?? null;
      const passesUlbLevelCriteria = ulbLevelEligibility.perUlbEligible.get(ulb.ulbId) ?? true;

      // A claimed ULB stays claimed whatever its eligibility, so that reason comes first.
      let ineligibleReasonCode: string | null = null;
      let ineligibleReasonDetail: string | null = null;
      if (claimedInBatch) ineligibleReasonCode = 'ALREADY_LOCKED_IN_ANOTHER_CLAIM';
      else if (!gate.passed) ineligibleReasonCode = stateGateFailureReason;
      else if (!allocation) ineligibleReasonCode = 'NO_DEVOLUTION_ALLOCATION';
      else if (!passesUlbLevelCriteria) {
        ineligibleReasonCode = 'ULB_LEVEL_ELIGIBILITY_CRITERIA_NOT_MET';
        const failedCriteria = ulbLevelEligibility.perUlbFailedCriteria.get(ulb.ulbId) ?? [];
        if (failedCriteria.length)
          ineligibleReasonDetail = `${failedCriteria.map((f) => f.label).join(', ')} eligibility criteria not met`;
      }

      return {
        ulbId: ulb.ulbId,
        ulbName: ulb.name,
        censusCode: ulb.censusCode,
        sbCode: ulb.sbCode,
        allocationAmount: allocation ? allocation.allocatedAmount : null,
        eligible: ineligibleReasonCode === null,
        ineligibleReasonCode,
        ineligibleReasonDetail,
        exemptionNotes: ulbLevelEligibility.perUlbExemptionNotes.get(ulb.ulbId) ?? [],
        claimedInBatch,
      };
    });

    if (query.search) {
      // In-memory scan; fine at current per-State ULB counts.
      const regex = new RegExp(escapeRegex(query.search), 'i');
      options = options.filter(
        (o) =>
          regex.test(o.ulbName) || (o.censusCode && regex.test(o.censusCode)) || (o.sbCode && regex.test(o.sbCode)),
      );
    }

    if (query.eligibilityFilter === 'ELIGIBLE') options = options.filter((o) => o.eligible);
    else if (query.eligibilityFilter === 'INELIGIBLE')
      options = options.filter((o) => !o.eligible && !o.claimedInBatch);
    else if (query.eligibilityFilter === 'IN_OTHER_BATCH') options = options.filter((o) => o.claimedInBatch !== null);

    options.sort((a, b) => sortGroup(a) - sortGroup(b) || a.ulbName.localeCompare(b.ulbName));

    const page = query.page ?? CLAIM_LETTER_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT;
    const total = options.length;
    const paged = options.slice((page - 1) * limit, (page - 1) * limit + limit);

    return xviFcSuccess('ULB options fetched.', paged, { page, limit, total });
  }
}

/** Eligible 0, ineligible 1, in another batch 2. */
function sortGroup(option: ClaimLetterUlbOption): number {
  if (option.eligible) return 0;
  return option.claimedInBatch ? 2 : 1;
}
