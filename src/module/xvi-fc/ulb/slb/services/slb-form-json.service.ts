import { Injectable } from '@nestjs/common';
import { FormJsonService } from 'src/form-json/form-json.service';
import { SLB_FORM_ID, SLB_FORM_TYPE } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { SlbTypedFieldConfig, validateSlbFormJsonData } from '../helpers/slb-form-json.helpers';

@Injectable()
export class SlbFormJsonConfigService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads and validates SLB field config from the formJsons collection.
   * With yearId: uses Redis-backed findActiveByDesignYearAndFormId (same cache path as SFC/EULB/DF).
   * Without yearId: falls back to findByType for routes without a year context.
   */
  async loadFields(yearId?: string): Promise<SlbTypedFieldConfig[]> {
    const formJson = yearId
      ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, SLB_FORM_ID)
      : await this.formJsonService.findByType(SLB_FORM_TYPE);
    return validateSlbFormJsonData(formJson.data);
  }
}
