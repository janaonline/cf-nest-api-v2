import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { FormFieldOption } from 'src/module/xvi-fc/common/types/field-config.type';
import {
  REQUEST_EXEMPTION_FORM_ID,
  REQUEST_EXEMPTION_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import {
  getFieldsByType,
  RequestExemptionTypedFieldConfig,
  validateRequestExemptionFormJsonData,
} from 'src/module/xvi-fc/state/request-exemption/helpers/request-exemption-form-json.helpers';
import type { RequestExemptionReasonOption } from 'src/module/xvi-fc/state/request-exemption/request-exemption.types';

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

  /**
   * A reason field's own `{id, label}` options for `yearId` — see CLAUDE.md's "Reason options are
   * sourced live" section. `required` defaults to `true` (missing field is a real config error,
   * throws); callers pass `required: false` for `REASON_FIELD_KEY_STATE` only, so the backend can
   * deploy before `formjsons` gains that field. `REASON_FIELD_KEY_ULB` has always existed, so its
   * absence stays an error.
   */
  async loadReasonOptions(yearId: string, fieldKey: string, required = true): Promise<RequestExemptionReasonOption[]> {
    const fields = await this.loadFields(yearId);
    const reasonField = getFieldsByType(fields, 'RE_MAIN_FORM_FIELDS').find((field) => field.key === fieldKey);
    if (!reasonField) {
      if (!required) return [];
      throw new InternalServerErrorException(
        `Request Exemption form configuration is missing the '${fieldKey}' field.`,
      );
    }

    const options = reasonField.options;
    if (!Array.isArray(options) || options.some((option) => typeof option !== 'object' || option === null)) {
      throw new InternalServerErrorException(`Request Exemption form field '${fieldKey}' has malformed options.`);
    }

    return (options as FormFieldOption[]).map((option) => ({ id: Number(option.id), label: option.label }));
  }
}
