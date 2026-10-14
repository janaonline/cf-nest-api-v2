import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

export type RequestExemptionFormJsonFieldType = 'RE_MAIN_FORM_FIELDS';

export type RequestExemptionTypedFieldConfig = FieldConfig & { fieldTypes: RequestExemptionFormJsonFieldType[] };

const VALID_RE_FIELD_TYPES = new Set<string>(['RE_MAIN_FORM_FIELDS']);

/** Also strips the `fieldTypes` prop off each returned field. */
export function getFieldsByType(
  fields: RequestExemptionTypedFieldConfig[],
  fieldType: RequestExemptionFormJsonFieldType,
): FieldConfig[] {
  return fields
    .filter((f) => f.fieldTypes.includes(fieldType))
    .map(({ fieldTypes: _ft, ...rest }) => rest as FieldConfig);
}

/** Enforces: non-empty array; every field has a string `key`; every field has non-empty
 *  `fieldTypes`, each value one of VALID_RE_FIELD_TYPES. */
export function validateRequestExemptionFormJsonData(data: unknown): RequestExemptionTypedFieldConfig[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new InternalServerErrorException('Request Exemption form configuration data is missing or empty.');
  }
  for (const field of data as Record<string, unknown>[]) {
    if (typeof field['key'] !== 'string' || !field['key']) {
      throw new InternalServerErrorException('Request Exemption form field is missing a key.');
    }
    const key: string = field['key'];
    const fieldTypes = field['fieldTypes'];
    if (!Array.isArray(fieldTypes) || fieldTypes.length === 0) {
      throw new InternalServerErrorException(`Request Exemption form field '${key}' is missing fieldTypes.`);
    }
    for (const ft of fieldTypes as string[]) {
      if (!VALID_RE_FIELD_TYPES.has(ft)) {
        throw new InternalServerErrorException(`Request Exemption form field '${key}' has unknown fieldType '${ft}'.`);
      }
    }
  }
  return data as unknown as RequestExemptionTypedFieldConfig[];
}
