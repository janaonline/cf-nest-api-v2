export interface XviFcValidationError {
  field?: string;
  message: string;
  code?: string;
}

/** Validation errors keyed by field key. One field may carry multiple errors. Use `_form` for non-field errors. */
export type XviFcValidationErrorMap = Record<string, XviFcValidationError[]>;

export interface XviFcApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: XviFcValidationErrorMap;
  meta?: Record<string, unknown>;
  timestamp?: string;
  requestId?: string;
}
