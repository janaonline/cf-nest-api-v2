import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { CLAIM_LETTER_FORM_ID } from '../../constants/claim-letter.constants';
import {
  CLAIM_LETTER_VARIANCE_LOWER_META_KEY,
  CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
  CLAIM_LETTER_VARIANCE_UPPER_META_KEY,
  CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
} from '../../helpers/claim-letter-financial.helpers';

export interface ClaimLetterFormConfig {
  questions: FieldConfig[];
  varianceLowerPercent: number;
  varianceUpperPercent: number;
}

export interface ClaimLetterVarianceConfig {
  lowerPercent: number;
  upperPercent: number;
}

@Injectable()
export class ClaimLetterFormJsonService {
  private readonly logger = new Logger(ClaimLetterFormJsonService.name);

  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads Claim Letter's own form-json document (formId CLAIM_LETTER_FORM_ID) for a design year
   * exactly once and returns both the field config and the variance band derived from it. Callers
   * that need both must use this rather than chaining a separate variance lookup — that would fetch
   * the same document twice per request. Missing/unseeded is expected before the payload is pushed
   * (same as the old `loadQuestions`), so it degrades to empty questions + default variance with a
   * logged warning rather than throwing.
   */
  async loadFormConfig(yearId: string): Promise<ClaimLetterFormConfig> {
    try {
      const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, CLAIM_LETTER_FORM_ID);
      return {
        questions: formJson.data ?? [],
        varianceLowerPercent: this.resolvePercent(
          formJson.meta,
          CLAIM_LETTER_VARIANCE_LOWER_META_KEY,
          CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
        ),
        varianceUpperPercent: this.resolvePercent(
          formJson.meta,
          CLAIM_LETTER_VARIANCE_UPPER_META_KEY,
          CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
        ),
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.warn(`Claim Letter formjsons (formId ${CLAIM_LETTER_FORM_ID}) not seeded for year ${yearId}.`);
        return {
          questions: [],
          varianceLowerPercent: CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
          varianceUpperPercent: CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
        };
      }
      throw err;
    }
  }

  /** Convenience wrapper over loadFormConfig for callers that only need the variance band. */
  async loadVarianceConfig(yearId: string): Promise<ClaimLetterVarianceConfig> {
    const { varianceLowerPercent, varianceUpperPercent } = await this.loadFormConfig(yearId);
    return { lowerPercent: varianceLowerPercent, upperPercent: varianceUpperPercent };
  }

  private resolvePercent(meta: Record<string, unknown> | undefined, key: string, fallback: number): number {
    const raw = meta?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  }
}
