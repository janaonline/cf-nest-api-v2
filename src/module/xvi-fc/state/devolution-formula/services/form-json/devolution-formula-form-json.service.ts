import { Injectable } from '@nestjs/common';
import { FormJsonService } from 'src/form-json/form-json.service';
import { DF_FORM_ID, DF_FORM_TYPE } from '../../constants/devolution-formula.constants';
import { DfTypedFieldConfig, validateDfFormJsonData } from '../../helpers/devolution-formula-form-json.helpers';

@Injectable()
export class DfFormJsonConfigService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads and validates DF field config from the formJsons collection.
   * With yearId: uses Redis-backed findActiveByDesignYearAndFormId (same cache path as SFC/EULB).
   * Without yearId: falls back to findByType for routes without a year context.
   */
  async loadFields(yearId?: string): Promise<DfTypedFieldConfig[]> {
    const formJson = yearId
      ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, DF_FORM_ID)
      : await this.formJsonService.findByType(DF_FORM_TYPE);
    return validateDfFormJsonData(formJson.data);
  }
}
