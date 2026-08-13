import { Injectable } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import {
  FC_UNSPENT_ELIGIBILITY_THRESHOLD_META_KEY,
  FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT,
  FC_UNSPENT_FORM_ID,
} from '../../constants/fc-unspent-declaration.constants';
import {
  FcUnspentTypedFieldConfig,
  validateFcUnspentFormJsonData,
} from '../../helpers/fc-unspent-declaration-form-json.helpers';

export interface FcUnspentFormConfig {
  fields: FcUnspentTypedFieldConfig[];
  thresholdPercent: number;
}

@Injectable()
export class FcUnspentDeclarationFormJsonService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads the FC Unspent Declaration form-json document for a design year exactly once
   * (Redis-cached, same path as SFC/EULB/DF) and returns both the validated field config and the
   * eligibility threshold derived from it.
   */
  async loadFormConfig(yearId: string): Promise<FcUnspentFormConfig> {
    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, FC_UNSPENT_FORM_ID);
    return {
      fields: validateFcUnspentFormJsonData(formJson.data),
      thresholdPercent: this.resolveThresholdPercent(formJson.meta),
    };
  }

  /** Convenience wrapper over loadFormConfig for callers that only need field config. */
  async loadFields(yearId: string): Promise<FcUnspentTypedFieldConfig[]> {
    return (await this.loadFormConfig(yearId)).fields;
  }

  /**
   * DB-driven eligibility threshold override at `formJson.meta.eligibilityThresholdPercent`,
   * falling back to FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT when absent or not a valid
   * non-negative number.
   */
  private resolveThresholdPercent(meta: Record<string, unknown> | undefined): number {
    const raw = meta?.[FC_UNSPENT_ELIGIBILITY_THRESHOLD_META_KEY];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT;
  }
}
