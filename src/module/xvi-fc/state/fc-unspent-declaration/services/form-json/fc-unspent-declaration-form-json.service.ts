import { Injectable } from '@nestjs/common';
import { YearIdToLabel } from 'src/core/constants/years';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import {
  FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL,
  FC_UNSPENT_FORM_ID,
} from '../../constants/fc-unspent-declaration.constants';
import {
  FcUnspentTypedFieldConfig,
  validateFcUnspentFormJsonData,
} from '../../helpers/fc-unspent-declaration-form-json.helpers';
import {
  FcUnspentPolicy,
  policyThresholdPercent,
  resolveFcUnspentPolicy,
} from '../../helpers/fc-unspent-policy.helpers';

export interface FcUnspentFormConfig {
  fields: FcUnspentTypedFieldConfig[];
  /** The percent threshold clients display: the percent-of-allocation rule's own, otherwise 0. */
  thresholdPercent: number;
  /** Per-design-year rules: whether the form is linked to Devolution, and how eligibility is decided. */
  policy: FcUnspentPolicy;
}

@Injectable()
export class FcUnspentDeclarationFormJsonService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads the FC Unspent Declaration form-json document for a design year exactly once
   * (Redis-cached, same path as SFC/EULB/DF) and returns the validated field config plus the
   * year's policy (FC-cycle defaults overridden by `formJson.meta`, see `resolveFcUnspentPolicy`).
   */
  async loadFormConfig(yearId: string): Promise<FcUnspentFormConfig> {
    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, FC_UNSPENT_FORM_ID);
    const policy = this.resolvePolicy(yearId, formJson.meta);
    return {
      fields: validateFcUnspentFormJsonData(formJson.data),
      thresholdPercent: policyThresholdPercent(policy),
      policy,
    };
  }

  /** Convenience wrapper over loadFormConfig for callers that only need field config. */
  async loadFields(yearId: string): Promise<FcUnspentTypedFieldConfig[]> {
    return (await this.loadFormConfig(yearId)).fields;
  }

  /**
   * Year -> FC cycle through the existing map, then the policy for that cycle. Every caller already
   * resolves the cycle (and 404s on an unmapped year) before loading config, so the 14th-FC fallback
   * here, the same one `resolvePriorFcCycleLabel` uses, is only a safety net.
   */
  private resolvePolicy(yearId: string, meta: Record<string, unknown> | undefined): FcUnspentPolicy {
    const designYear = YearIdToLabel[yearId];
    const applicableFc = (designYear && FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYear]) || '14TH_FC';
    return resolveFcUnspentPolicy(applicableFc, meta);
  }
}
