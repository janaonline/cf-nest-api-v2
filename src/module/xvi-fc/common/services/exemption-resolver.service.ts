import { Injectable } from '@nestjs/common';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';
import { UlbAccessInput, YearAccessInput, YearAccessService } from './year-access.service';

/** 'AUTOMATIC' (dynamic year access) is the only real source today. A future discretionary
 *  STATE→MoHUA exemption-request mechanism will add more - kept as a union instead of a bare
 *  boolean so that addition won't be a breaking signature change for callers of this service. */
export type ExemptionSource = 'AUTOMATIC';

export interface ExemptionResolution {
  exempted: boolean;
  source: ExemptionSource | null;
}

const NOT_EXEMPT: ExemptionResolution = { exempted: false, source: null };

/**
 * Centralizes read-only exemption checks for (ulb, formId, designYear).
 * Returns exemption status and reason without duplicating lookup logic.
 * Uses YearAccessService.peekEntry only; never persists or materializes yearAccess entries.
 */
@Injectable()
export class ExemptionResolverService {
  constructor(
    private readonly yearAccessService: YearAccessService,
    private readonly formJsonConfigService: FormJsonConfigService,
  ) {}

  /**
   * Resolves exemptions in bulk for multiple ULBs for one (year, formId) pair.
   * Reuses one formJsonConfig lookup and performs one read-only peekEntry per ULB.
   * Callers must batch-load ULBs rather than invoke this per ULB.
   */
  async resolveBulk(
    ulbs: UlbAccessInput[],
    year: YearAccessInput,
    formId: number,
  ): Promise<Map<string, ExemptionResolution>> {
    const result = new Map<string, ExemptionResolution>();
    if (ulbs.length === 0) return result;

    const formConfig = await this.formJsonConfigService.findByFormId(formId);
    if (!formConfig?.isApplicableForExemption) {
      for (const ulb of ulbs) result.set(String(ulb._id), NOT_EXEMPT);
      return result;
    }

    for (const ulb of ulbs) {
      const entry = await this.yearAccessService.peekEntry(ulb, year);
      const exempted = entry.yearEnabled && entry.disabledFormIds.includes(formId);
      result.set(String(ulb._id), exempted ? { exempted: true, source: 'AUTOMATIC' } : NOT_EXEMPT);
    }
    return result;
  }
}
