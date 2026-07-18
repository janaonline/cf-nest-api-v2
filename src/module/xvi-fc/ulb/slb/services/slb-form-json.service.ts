import { Injectable, Logger } from '@nestjs/common';
import { FormJsonService } from 'src/form-json/form-json.service';
import { SLB_FORM_ID, SLB_FORM_TYPE } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { DEFAULT_SLB_FIELDS } from '../constants/slb-form.constants';
import { SlbTypedFieldConfig, validateSlbFormJsonData } from '../helpers/slb-form-json.helpers';

@Injectable()
export class SlbFormJsonConfigService {
  private readonly logger = new Logger(SlbFormJsonConfigService.name);

  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads and validates SLB field config.
   * Tries the admin-configured FormJson document first (with yearId: Redis-backed
   * findActiveByDesignYearAndFormId, same cache path as SFC/EULB/DF; without yearId:
   * findByType for routes without a year context). Falls back to the bundled
   * DEFAULT_SLB_FIELDS (mirrors the ULB master pattern) when no document has been
   * seeded yet, or the document exists but has no data — so the form works out of the
   * box and only needs the DB record once an admin actually wants to override it.
   */
  async loadFields(yearId?: string): Promise<SlbTypedFieldConfig[]> {
    try {
      const formJson = yearId
        ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, SLB_FORM_ID)
        : await this.formJsonService.findByType(SLB_FORM_TYPE);
      // return formJson.data?.length ? validateSlbFormJsonData(formJson.data) : DEFAULT_SLB_FIELDS;
      return DEFAULT_SLB_FIELDS;
    } catch (error) {
      this.logger.debug(`No SLB FormJson configured yet (yearId=${yearId ?? 'none'}); using bundled defaults.`, error);
      return DEFAULT_SLB_FIELDS;
    }
  }
}
