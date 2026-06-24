import { Injectable } from '@nestjs/common';
import { FormJsonService } from 'src/form-json/form-json.service';
import { EULB_FORM_ID, EULB_FORM_JSON_TYPE } from './constants/elected-urban-local-bodies.constants';
import { EulbTypedFieldConfig, validateEulbFormJsonData } from './elected-urban-local-bodies-form-json.helpers';

@Injectable()
export class EulbFormJsonConfigService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads and validates EULB field config from the formJsons collection.
   * With yearId: uses Redis-backed findActiveByDesignYearAndFormId (same cache path as SFC).
   * Without yearId: falls back to findByType for routes without a year context (e.g. getQuestions).
   */
  async loadFields(yearId?: string): Promise<EulbTypedFieldConfig[]> {
    const formJson = yearId
      ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, EULB_FORM_ID)
      : await this.formJsonService.findByType(EULB_FORM_JSON_TYPE);
    return validateEulbFormJsonData(formJson.data);
  }
}
