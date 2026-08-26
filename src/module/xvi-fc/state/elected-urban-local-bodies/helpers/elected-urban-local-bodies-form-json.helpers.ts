import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { EulbFormJsonFieldType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';

export type EulbTypedFieldConfig = FieldConfig & { fieldTypes: EulbFormJsonFieldType[] };

const VALID_EULB_FIELD_TYPES = new Set<string>([
  'EULB_MAIN_FORM_FIELDS',
  'EULB_ROW_EDIT_FIELDS',
  'EULB_EXTRA_ULB_PORTAL_FIELDS',
  'EULB_POST_SUBMIT_UPDATE_FIELDS',
]);

/** Filters fields by group and strips fieldTypes before returning FieldConfig[]. */
export function getFieldsByType(fields: EulbTypedFieldConfig[], fieldType: EulbFormJsonFieldType): FieldConfig[] {
  return fields
    .filter((f) => f.fieldTypes.includes(fieldType))
    .map(({ fieldTypes: _ft, ...rest }) => rest as FieldConfig);
}

/** Validates raw formJson.data structure and casts to EulbTypedFieldConfig[]. Throws ISE on structural errors. */
export function validateEulbFormJsonData(data: unknown): EulbTypedFieldConfig[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new InternalServerErrorException('EULB form configuration data is missing or empty.');
  }
  for (const field of data as Record<string, unknown>[]) {
    if (typeof field['key'] !== 'string' || !field['key']) {
      throw new InternalServerErrorException('EULB form field is missing a key.');
    }
    const key: string = field['key'];
    const fieldTypes = field['fieldTypes'];
    if (!Array.isArray(fieldTypes) || fieldTypes.length === 0) {
      throw new InternalServerErrorException(`EULB form field '${key}' is missing fieldTypes.`);
    }
    for (const ft of fieldTypes as string[]) {
      if (!VALID_EULB_FIELD_TYPES.has(ft)) {
        throw new InternalServerErrorException(`EULB form field '${key}' has unknown fieldType '${ft}'.`);
      }
    }
  }
  return data as unknown as EulbTypedFieldConfig[];
}
