import type { FieldConfig } from '../types/field-config.type';
import type { XviFcValidationErrorMap } from '../response/xvi-fc-api-response';

// Re-export all frontend-compatible types from the shared type file.
// Import from field-config.type.ts for new code; these re-exports exist
// so existing imports (HydratedFieldConfig, FormData, FormJson) continue to resolve.
export type {
  ConditionOperator,
  FieldConfig,
  FieldOptions,
  FieldType,
  FormFieldOption,
  HydratedFieldConfig,
  UploadedFileValue,
  Validator,
  ValidatorValue,
  VisibilityCondition,
  VisibleWhen,
  VisibleWhenMode,
  YearRangeValidatorConfig,
} from '../types/field-config.type';
export type { FieldAppearanceConfig, FieldLayoutConfig, FieldSupportingContent } from '../types/field-config.type';

/** Alias for callers that still import FormFieldConfig */
export type { FieldConfig as FormFieldConfig } from '../types/field-config.type';
/** Alias for callers that still import FormFieldType */
export type { FieldType as FormFieldType } from '../types/field-config.type';

// Re-export validation error types so consumers import from one place.
export type { XviFcValidationError, XviFcValidationErrorMap } from '../response/xvi-fc-api-response';

// ─── Backend-only types ───────────────────────────────────────────────────────

export type FormData = Record<string, unknown>;

export interface FormJson {
  design_year: string;
  formId: number;
  type: string;
  data: FieldConfig[];
  isActive: boolean;
}

/** Returned by validateDraft / validateFull. Errors are keyed by field key for O(1) frontend access. */
export interface ValidationResult {
  isValid: boolean;
  errors: XviFcValidationErrorMap;
}
