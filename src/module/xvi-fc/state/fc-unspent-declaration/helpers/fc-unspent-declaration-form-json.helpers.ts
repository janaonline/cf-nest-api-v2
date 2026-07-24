import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID } from '../constants/fc-unspent-declaration.constants';

/** The 3 questions the DB-backed formJson document (formId 25) must define. */
const REQUIRED_FC_UNSPENT_FIELD_KEYS = ['isFcUnspent', 'fcDeclaration', 'checkboxConfirmation'] as const;

/**
 * `FC_UNSPENT_MAIN_FORM_FIELDS` — the 3 top-level questions (isFcUnspent, fcDeclaration,
 * checkboxConfirmation), hydrated and validated as today.
 * `FC_UNSPENT_ROW_EDIT_FIELDS` — DB-driven metadata for the 8 ULB row-table columns
 * (ulbId, unspentAmount, censusCode, sbCode, ulbName, allocationAmount, allocationPerc,
 * eligibility), mirroring DF_ROW_EDIT_FIELDS/EULB_ROW_EDIT_FIELDS. Exposed to the
 * frontend as `rowEditFields`; never passed to DynamicFormValidationService — the row
 * data (ulbId/unspentAmount) is validated by FcUnspentDeclarationRowService's own
 * business rules (ULB-must-be-active, allocation lookups), which this metadata layer
 * does not replace.
 */
export type FcUnspentFormJsonFieldType = 'FC_UNSPENT_MAIN_FORM_FIELDS' | 'FC_UNSPENT_ROW_EDIT_FIELDS';
export type FcUnspentTypedFieldConfig = FieldConfig & { fieldTypes: FcUnspentFormJsonFieldType[] };

const VALID_FC_UNSPENT_FIELD_TYPES = new Set<string>(['FC_UNSPENT_MAIN_FORM_FIELDS', 'FC_UNSPENT_ROW_EDIT_FIELDS']);

/** Filters fields by group and strips fieldTypes before returning FieldConfig[]. */
export function getFcUnspentFieldsByType(
  fields: FcUnspentTypedFieldConfig[],
  fieldType: FcUnspentFormJsonFieldType,
): FieldConfig[] {
  return fields
    .filter((f) => f.fieldTypes.includes(fieldType))
    .map(({ fieldTypes: _ft, ...rest }) => rest as FieldConfig);
}

/**
 * Validates the raw formJson.data structure and casts to FcUnspentTypedFieldConfig[].
 * Throws ISE (never silently falls back to hardcoded questions) when the DB document is
 * empty, malformed, missing one of the 3 required main-form field keys, missing/invalid
 * `fieldTypes` on any field, or when `fcDeclaration` is missing its `download-template`
 * supporting action (the hook the main service toggles `visible` on for the
 * declaration-template download).
 */
export function validateFcUnspentFormJsonData(data: unknown): FcUnspentTypedFieldConfig[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new InternalServerErrorException('FC Unspent Declaration form configuration data is missing or empty.');
  }

  const fields = data as Record<string, unknown>[];
  const keys = new Set(fields.map((f) => f['key']));
  for (const requiredKey of REQUIRED_FC_UNSPENT_FIELD_KEYS) {
    if (!keys.has(requiredKey)) {
      throw new InternalServerErrorException(
        `FC Unspent Declaration form configuration is missing required field '${requiredKey}'.`,
      );
    }
  }

  for (const field of fields) {
    const key = typeof field['key'] === 'string' ? field['key'] : '(unknown)';
    const fieldTypes = field['fieldTypes'];
    if (!Array.isArray(fieldTypes) || fieldTypes.length === 0) {
      throw new InternalServerErrorException(`FC Unspent Declaration form field '${key}' is missing fieldTypes.`);
    }
    for (const ft of fieldTypes as string[]) {
      if (!VALID_FC_UNSPENT_FIELD_TYPES.has(ft)) {
        throw new InternalServerErrorException(
          `FC Unspent Declaration form field '${key}' has unknown fieldType '${ft}'.`,
        );
      }
    }
  }

  const fcDeclarationField = fields.find((f) => f['key'] === 'fcDeclaration');
  if (!hasDownloadTemplateAction(fcDeclarationField)) {
    throw new InternalServerErrorException(
      `FC Unspent Declaration form configuration is missing the '${FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID}' action on 'fcDeclaration'.`,
    );
  }

  return data as unknown as FcUnspentTypedFieldConfig[];
}

/** Returns true when `fcDeclaration` has an `actions`-type supportingContent block with a `download-template` action. */
function hasDownloadTemplateAction(fcDeclarationField: Record<string, unknown> | undefined): boolean {
  const supportingContent = fcDeclarationField?.['supportingContent'];
  if (!Array.isArray(supportingContent)) return false;

  return supportingContent.some((block: unknown) => {
    const b = block as Record<string, unknown>;
    if (b?.['type'] !== 'actions' || !Array.isArray(b['actions'])) return false;
    return (b['actions'] as unknown[]).some(
      (action) => (action as Record<string, unknown>)?.['id'] === FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID,
    );
  });
}
