import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

export type DfFormJsonFieldType = 'DF_MAIN_FORM_FIELDS' | 'DF_ROW_EDIT_FIELDS';
export type DfTypedFieldConfig = FieldConfig & { fieldTypes: DfFormJsonFieldType[] };

const VALID_DF_FIELD_TYPES = new Set<string>(['DF_MAIN_FORM_FIELDS', 'DF_ROW_EDIT_FIELDS']);

/** Filters fields by group and strips fieldTypes before returning FieldConfig[]. */
export function getDfFieldsByType(fields: DfTypedFieldConfig[], fieldType: DfFormJsonFieldType): FieldConfig[] {
  return fields
    .filter((f) => f.fieldTypes.includes(fieldType))
    .map(({ fieldTypes: _ft, ...rest }) => rest as FieldConfig);
}

/** Validates raw formJson.data structure and casts to DfTypedFieldConfig[]. Throws ISE on structural errors. */
export function validateDfFormJsonData(data: unknown): DfTypedFieldConfig[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new InternalServerErrorException('DF form configuration data is missing or empty.');
  }
  for (const field of data as Record<string, unknown>[]) {
    if (typeof field['key'] !== 'string' || !field['key']) {
      throw new InternalServerErrorException('DF form field is missing a key.');
    }
    const key: string = field['key'];
    const fieldTypes = field['fieldTypes'];
    if (!Array.isArray(fieldTypes) || fieldTypes.length === 0) {
      throw new InternalServerErrorException(`DF form field '${key}' is missing fieldTypes.`);
    }
    for (const ft of fieldTypes as string[]) {
      if (!VALID_DF_FIELD_TYPES.has(ft)) {
        throw new InternalServerErrorException(`DF form field '${key}' has unknown fieldType '${ft}'.`);
      }
    }
  }
  return data as unknown as DfTypedFieldConfig[];
}
