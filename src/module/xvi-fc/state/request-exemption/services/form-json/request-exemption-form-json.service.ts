import { Injectable } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import {
  REQUEST_EXEMPTION_FORM_ID,
  REQUEST_EXEMPTION_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import {
  RequestExemptionTypedFieldConfig,
  validateRequestExemptionFormJsonData,
} from 'src/module/xvi-fc/state/request-exemption/helpers/request-exemption-form-json.helpers';

@Injectable()
export class RequestExemptionFormJsonConfigService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads and validates Request Exemption field config from the formJsons collection.
   * With yearId: uses Redis-backed findActiveByDesignYearAndFormId (same cache path as SFC/EULB).
   * Without yearId: falls back to findByType for routes without a year context.
   */
  async loadFields(yearId?: string): Promise<RequestExemptionTypedFieldConfig[]> {
    const formJson = yearId
      ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, REQUEST_EXEMPTION_FORM_ID)
      : await this.formJsonService.findByType(REQUEST_EXEMPTION_FORM_TYPE);
    return validateRequestExemptionFormJsonData(formJson.data);
  }
}
