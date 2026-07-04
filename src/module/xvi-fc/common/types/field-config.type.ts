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

export type SupportingContentTone = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface SupportingContentAction {
  id: string;
  label: string;
  url?: string;
  icon?: string;
  tone?: SupportingContentTone;
  className?: string;
  iconClassName?: string;
  variant?: 'link' | 'button';
  visible?: boolean;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  meta?: Record<string, unknown>;
}

export interface SupportingContentBadge {
  label: string;
  icon?: string;
  tone?: SupportingContentTone;
  className?: string;
  visible?: boolean;
}

export interface FieldSupportingContent {
  type: string;
  position: string;
  title?: string;
  /** Display label for the supporting link/action (alternative to title) */
  label?: string;
  description?: string;
  /** URL for template-download or link-type supporting content */
  url?: string;
  layout?: 'inline' | 'stacked';
  separator?: 'dot' | 'none';
  actions?: SupportingContentAction[];
  badges?: SupportingContentBadge[];
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
  /** Centralized key used by the backend resolver to derive a runtime-contextual folderPath. */
  folderPathKey?: string;
  formFieldType: FieldType;
  key: string;
  label: string;
  /** Cosmetic flag consumed by section/grid renderers to show a required asterisk next to the label.
   *  Independent of `validations` — a 'required' validator is what's actually enforced. */
  required?: boolean;
  /** Default or current field value; hydrated from saved data on GET responses */
  value?: unknown;
  /** false → field is never rendered by the frontend */
  render?: boolean;
  /** false → field is excluded from frontend payload and backend validation */
  includeInPayload?: boolean;
  visibleWhen?: VisibleWhen;
  /** Controls whether the rendered field is enabled or disabled */
  enabledWhen?: VisibleWhen;
  /** Controls whether configured validations should be applied */
  validateWhen?: VisibleWhen;
  /** Clears/ignores the field value when enabledWhen evaluates false */
  clearValueWhenDisabled?: boolean;
  /** Optional UI hint for disabled state */
  disabledReason?: string;
  /** Array of validators matching the frontend Angular validator contract */
  validations?: Validator[];
  /** Radio fields: FormFieldOption[]; select fields: string[] */
  options?: FieldOptions;
  allowedFileTypes?: string[];
  maxFileSize?: number;
  /** For date fields: earliest selectable date as ISO string or 'TODAY' */
  minDate?: string;
  /** For date fields: latest selectable date as ISO string or 'TODAY' */
  maxDate?: string;
  placeholder?: string;
  folderPath?: string;
  layout?: FieldLayoutConfig;
  appearance?: FieldAppearanceConfig;
  supportingContent?: FieldSupportingContent[];
  radioLayout?: 'vertical' | 'horizontal' | 'inline';
}

// ─── Sectioned / resolved form config ──────────────────────────────────────────

/** Grid width and inline hints for one field's placement within a section. */
export interface SectionFieldPlacement {
  grid: string;
  labelHint?: string;
  hintText?: string;
}

/** A field fully resolved for rendering: its real definition merged with its section placement. */
export type ResolvedField = FieldConfig & SectionFieldPlacement;

/** One card-sectioned group of fully-resolved fields — a client can render this directly, with
 *  no further lookup or merging required. Reusable by any module that serves a sectioned,
 *  admin-configurable form (see `src/master/ulb` for the first consumer). */
export interface ResolvedSection {
  title: string;
  icon: string;
  fields: ResolvedField[];
}

/** FieldConfig with a guaranteed non-optional `value` after GET hydration */
export type HydratedFieldConfig = FieldConfig & { value: unknown };
