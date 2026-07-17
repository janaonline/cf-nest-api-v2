import { InternalServerErrorException } from '@nestjs/common';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID } from '../constants/fc-unspent-declaration.constants';

/** The 3 questions the DB-backed formJson document (formId 25) must define. */
const REQUIRED_FC_UNSPENT_FIELD_KEYS = ['isFcUnspent', 'fcDeclaration', 'checkboxConfirmation'] as const;

/**
 * Validates the raw formJson.data structure and casts to FieldConfig[]. Throws ISE
 * (never silently falls back to hardcoded questions) when the DB document is empty,
 * malformed, or missing one of the 3 required fields, or when `fcDeclaration` is
 * missing its `download-template` supporting action (the hook the main service
 * toggles `visible` on for the declaration-template download).
 */
export function validateFcUnspentFormJsonData(data: unknown): FieldConfig[] {
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

  const fcDeclarationField = fields.find((f) => f['key'] === 'fcDeclaration');
  if (!hasDownloadTemplateAction(fcDeclarationField)) {
    throw new InternalServerErrorException(
      `FC Unspent Declaration form configuration is missing the '${FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID}' action on 'fcDeclaration'.`,
    );
  }

  return data as unknown as FieldConfig[];
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
