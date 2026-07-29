import { Injectable } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { FC_UNSPENT_FORM_ID } from '../../constants/fc-unspent-declaration.constants';
import {
  FcUnspentTypedFieldConfig,
  validateFcUnspentFormJsonData,
} from '../../helpers/fc-unspent-declaration-form-json.helpers';

@Injectable()
export class FcUnspentDeclarationFormJsonService {
  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads and validates the FC Unspent Declaration field config from the formJsons
   * collection (Redis-cached, same path as SFC/EULB/DF). Throws NotFoundException
   * when no active document exists for the given year — never falls back to the
   * in-code constant.
   */
  async loadFields(yearId: string): Promise<FcUnspentTypedFieldConfig[]> {
    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, FC_UNSPENT_FORM_ID);
    return validateFcUnspentFormJsonData(formJson.data);
  }
}
