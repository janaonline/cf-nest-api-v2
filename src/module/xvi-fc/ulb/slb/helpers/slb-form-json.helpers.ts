import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

export type SlbFormJsonFieldType = 'SLB_MAIN_FORM_FIELDS';
export type SlbTypedFieldConfig = FieldConfig & { fieldTypes: SlbFormJsonFieldType[] };

const VALID_SLB_FIELD_TYPES = new Set<string>(['SLB_MAIN_FORM_FIELDS']);

/** Filters fields by group and strips fieldTypes before returning FieldConfig[]. */
export function getSlbFieldsByType(fields: SlbTypedFieldConfig[], fieldType: SlbFormJsonFieldType): FieldConfig[] {
  return fields
    .filter((f) => f.fieldTypes.includes(fieldType))
    .map(({ fieldTypes: _ft, ...rest }) => rest as FieldConfig);
}

/** Validates raw formJson.data structure and casts to SlbTypedFieldConfig[]. Throws ISE on structural errors. */
export function validateSlbFormJsonData(data: unknown): SlbTypedFieldConfig[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new InternalServerErrorException('SLB form configuration data is missing or empty.');
  }
  for (const field of data as Record<string, unknown>[]) {
    if (typeof field['key'] !== 'string' || !field['key']) {
      throw new InternalServerErrorException('SLB form field is missing a key.');
    }
    const key: string = field['key'];
    const fieldTypes = field['fieldTypes'];
    if (!Array.isArray(fieldTypes) || fieldTypes.length === 0) {
      throw new InternalServerErrorException(`SLB form field '${key}' is missing fieldTypes.`);
    }
    for (const ft of fieldTypes as string[]) {
      if (!VALID_SLB_FIELD_TYPES.has(ft)) {
        throw new InternalServerErrorException(`SLB form field '${key}' has unknown fieldType '${ft}'.`);
      }
    }
  }
  return data as unknown as SlbTypedFieldConfig[];
}
