import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
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

/**
 * ULB picker for the claim-letter select dialog (plan §6.1) — deliberately does NOT reuse FC
 * Unspent's `ulb-options` filtering semantics (that endpoint inner-joins to only ULBs that already
 * have an allocation row, so ineligible ULBs are simply absent). Here every expected ULB is
 * returned, annotated `eligible`/`ineligibleReasonCode`, sorted eligible-first, so the dialog can
 * render ineligible rows visible-but-disabled.
 */
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
    this.assertStateAccess(user, stateId);
    assertInstallmentSupported(installment);

    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const expectedUlbIds = expectedUlbs.map((u) => u.ulbId);

    // Display-only read (this dialog never authorizes a build) — cached, so repeated searches/
    // filters/page-flips within one picker session don't each recompute eligibility from scratch.
    const [gate, allocationByUlbId, lockedElsewhereUlbIds, ulbLevelEligibility] = await Promise.all([
      this.eligibilityService.evaluateStateLevelGateForDisplay(stateId, yearId, installment),
      this.eligibilityService.resolveDevolutionAllocations(stateId, yearId, installment),
      this.resolveLockedElsewhereUlbIds(stateId, yearId, installment, query.claimLetterId),
      this.eligibilityService.resolveUlbLevelEligibilityForDisplay(
        stateId,
        yearId,
        installment as 1 | 2,
        expectedUlbIds,
      ),
    ]);

    const stateGateFailureReason = gate.sources.find((s) => s.result === 'FAILED')?.reasonCode ?? 'STATE_GATE_FAILED';

    let options: ClaimLetterUlbOption[] = expectedUlbs.map((ulb) => {
      const allocation = allocationByUlbId.get(ulb.ulbId);
      const alreadyLocked = lockedElsewhereUlbIds.has(ulb.ulbId);
      const passesUlbLevelCriteria = ulbLevelEligibility.perUlbEligible.get(ulb.ulbId) ?? true;

      let ineligibleReasonCode: string | null = null;
      let ineligibleReasonDetail: string | null = null;
      if (!gate.passed) ineligibleReasonCode = stateGateFailureReason;
      else if (!allocation) ineligibleReasonCode = 'NO_DEVOLUTION_ALLOCATION';
      else if (alreadyLocked) ineligibleReasonCode = 'ALREADY_LOCKED_IN_ANOTHER_CLAIM';
      else if (!passesUlbLevelCriteria) {
        ineligibleReasonCode = 'ULB_LEVEL_ELIGIBILITY_CRITERIA_NOT_MET';
        const failedCriteria = ulbLevelEligibility.perUlbFailedCriteria.get(ulb.ulbId) ?? [];
        if (failedCriteria.length) ineligibleReasonDetail = `${failedCriteria.join(', ')} eligibility criteria not met`;
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
      };
    });

    if (query.search) {
      // TODO: use efficient way? check if regex is slow on large data sets?
      const regex = new RegExp(this.escapeRegExp(query.search), 'i');
      options = options.filter(
        (o) =>
          regex.test(o.ulbName) || (o.censusCode && regex.test(o.censusCode)) || (o.sbCode && regex.test(o.sbCode)),
      );
    }

    if (query.eligibilityFilter === 'ELIGIBLE') options = options.filter((o) => o.eligible);
    else if (query.eligibilityFilter === 'INELIGIBLE') options = options.filter((o) => !o.eligible);

    // Eligible-first, then alphabetical (plan §6.1: "sort by eligible").
    options.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return a.ulbName.localeCompare(b.ulbName);
    });

    const page = query.page ?? CLAIM_LETTER_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT;
    const total = options.length;
    const paged = options.slice((page - 1) * limit, (page - 1) * limit + limit);

    return xviFcSuccess('ULB options fetched.', paged, { page, limit, total });
  }

  private resolveLockedElsewhereUlbIds(
    stateId: string,
    yearId: string,
    installment: number,
    excludeClaimLetterId?: string,
  ): Promise<Set<string>> {
    return this.eligibilityService.resolveClaimedUlbIds(stateId, yearId, installment, excludeClaimLetterId);
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
