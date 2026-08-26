import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig, ValidatorValue } from '../types/field-config.type';

/**
 * Builds a key → FieldConfig map from a DB-loaded field group, so callers get O(1)
 * lookups instead of repeated `fields.find(f => f.key === ...)` scans.
 */
export function keyByFieldKey(fields: FieldConfig[]): Map<string, FieldConfig> {
  return new Map(fields.map((field) => [field.key, field]));
}

/**
 * Looks up a field by key and throws if the DB-loaded form-json config is missing it —
 * same guard style used across the xvi-fc state-form services when a required field group
 * is malformed, so a broken DB document fails loudly instead of silently validating nothing.
 */
export function requireField(map: Map<string, FieldConfig>, key: string, context: string): FieldConfig {
  const field = map.get(key);
  if (!field) {
    throw new InternalServerErrorException(`${context}: form-json config is missing the '${key}' field.`);
  }
  return field;
}

/**
 * Reads a validator's value off `field.validations` by name. Matches case-insensitively —
 * the frontend/backend convention is lowercase (`'maxlength'`, `'minDate'` casing varies),
 * but DB documents aren't guaranteed to be authored consistently, so this stays robust to
 * either casing rather than depending on the DB document being edited to match.
 */
export function getValidatorValue<T extends ValidatorValue>(field: FieldConfig, name: string): T | undefined {
  const validator = field.validations?.find((v) => v.name.toLowerCase() === name.toLowerCase());
  return validator?.validator as T | undefined;
}
