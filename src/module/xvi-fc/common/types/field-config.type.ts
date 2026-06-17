// ─── Condition / visibility ───────────────────────────────────────────────────

export type ConditionOperator = 'equals' | 'notEquals' | 'in' | 'notIn';
export type VisibleWhenMode = 'all' | 'any';

export interface VisibilityCondition {
  key: string;
  operator: ConditionOperator;
  /** Scalar for equals/notEquals; array for in/notIn */
  value: string | string[] | boolean | number;
}

export interface VisibleWhen {
  mode: VisibleWhenMode;
  conditions: VisibilityCondition[];
}

// ─── Validators ───────────────────────────────────────────────────────────────

export interface YearRangeValidatorConfig {
  startYearMin: number;
  startYearMax: number;
  endYearMin: number;
  endYearMax: number;
  requireEndGreaterThanStart: boolean;
  allowedDurations: number[];
  /** If set, the period [startYear, endYear] must include this year */
  requiredIncludedYear?: number;
}

export type ValidatorValue = string | number | boolean | YearRangeValidatorConfig | null;

export interface Validator {
  /** Validator name matching frontend Angular validators: 'required', 'requiredTrue', 'nullValidator',
   *  'pattern', 'email', 'minlength', 'maxlength', 'min', 'max',
   *  'minDate', 'maxDate', 'yearRange' */
  name: string;
  /** Null for boolean validators (required, requiredTrue, email, nullValidator);
   *  number for minlength/maxlength/min/max; string for pattern/minDate/maxDate;
   *  YearRangeValidatorConfig for yearRange */
  validator: ValidatorValue;
  message: string;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface FormFieldOption {
  label: string;
  id: string;
}

/** Select fields use string[], radio fields use FormFieldOption[] */
export type FieldOptions = string[] | FormFieldOption[];

// ─── Appearance / layout / supporting content ─────────────────────────────────

export interface FieldAppearanceConfig {
  color?: string;
  variant?: string;
}

export interface FieldLayoutConfig {
  variant?: string;
  labelWidth?: string;
}

export interface FieldSupportingContent {
  type: string;
  position: string;
  title?: string;
  /** Display label for the supporting link/action (alternative to title) */
  label?: string;
  description: string;
  /** URL for template-download or link-type supporting content */
  url?: string;
}

// ─── File value shape ─────────────────────────────────────────────────────────

export interface UploadedFileValue {
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string;
}

// ─── Field config ─────────────────────────────────────────────────────────────

export type FieldType = 'radio' | 'text' | 'file' | 'date' | 'checkbox' | 'textarea' | 'number' | 'select';

export interface FieldConfig {
  formFieldType: FieldType;
  key: string;
  label: string;
  /** Default or current field value; hydrated from saved data on GET responses */
  value?: unknown;
  /** false → field is never rendered by the frontend */
  render?: boolean;
  /** false → field is excluded from frontend payload and backend validation */
  includeInPayload?: boolean;
  visibleWhen?: VisibleWhen;
  /** Array of validators matching the frontend Angular validator contract */
  validations?: Validator[];
  /** Radio fields: FormFieldOption[]; select fields: string[] */
  options?: FieldOptions;
  allowedFileTypes?: string[];
  maxFileSize?: number;
  placeholder?: string;
  folderPath?: string;
  layout?: FieldLayoutConfig;
  appearance?: FieldAppearanceConfig;
  supportingContent?: FieldSupportingContent[];
  radioLayout?: 'vertical' | 'horizontal' | 'inline';
}

/** FieldConfig with a guaranteed non-optional `value` after GET hydration */
export type HydratedFieldConfig = FieldConfig & { value: unknown };
