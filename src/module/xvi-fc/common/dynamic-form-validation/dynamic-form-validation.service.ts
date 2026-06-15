import { Injectable } from '@nestjs/common';
import type { FormData, ValidationResult } from './dynamic-form-validation.types';
import type { XviFcValidationError, XviFcValidationErrorMap } from '../response/xvi-fc-api-response';
import type {
  ConditionOperator,
  FieldConfig,
  Validator,
  VisibilityCondition,
  YearRangeValidatorConfig,
} from '../types/field-config.type';

@Injectable()
export class DynamicFormValidationService {
  /**
   * Draft validation: skips absent fields ONLY when their sole blocking constraint is a
   * plain `required` validator. Fields with `requiredTrue` are still enforced even when
   * absent — a false/missing checkbox must block save. All other validators (maxlength,
   * pattern, yearRange, etc.) fire normally when a value is present.
   *
   * Returns a ValidationResult with `isValid` and an error map keyed by field key.
   */
  validateDraft(questions: FieldConfig[], data: FormData): ValidationResult {
    const enriched = this.injectComputedFields(data);
    const visibilityMap = this.buildVisibilityMap(questions, enriched);
    const errors: XviFcValidationErrorMap = {};

    for (const field of questions) {
      if (!this.shouldValidate(field, visibilityMap)) continue;
      const value = enriched[field.key];
      // Skip absent fields unless the field requires a truthy checkbox (requiredTrue)
      if (this.isEmptyValue(value) && !this.hasRequiredTrue(field)) continue;
      this.accumulateErrors(errors, this.validateField(field, value, false));
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Full validation: validates all visible, payload-included fields.
   * Required and requiredTrue fields must be present and satisfied.
   * Used on final submit.
   *
   * Returns a ValidationResult with `isValid` and an error map keyed by field key.
   */
  validateFull(questions: FieldConfig[], data: FormData): ValidationResult {
    const enriched = this.injectComputedFields(data);
    const visibilityMap = this.buildVisibilityMap(questions, enriched);
    const errors: XviFcValidationErrorMap = {};

    for (const field of questions) {
      if (!this.shouldValidate(field, visibilityMap)) continue;
      const value = enriched[field.key];
      this.accumulateErrors(errors, this.validateField(field, value, true));
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Builds the payload that should be persisted in the database.
   * Only includes fields that are visible, renderable, and marked for payload inclusion.
   * Hidden fields and fields with `includeInPayload: false` are stripped out.
   * Computed server-side fields (e.g. `awardPeriodDuration`) are never included because
   * they carry `includeInPayload: false` in the question config.
   *
   * @param questions - The canonical question config array.
   * @param data      - Raw incoming data from the request body.
   */
  buildSanitizedPayload(questions: FieldConfig[], data: FormData): FormData {
    const enriched = this.injectComputedFields(data);
    const visibilityMap = this.buildVisibilityMap(questions, enriched);
    const payload: FormData = {};

    for (const field of questions) {
      if (field.render === false) continue;
      if (field.includeInPayload === false) continue;
      if (visibilityMap.get(field.key) !== true) continue;
      if (Object.prototype.hasOwnProperty.call(data, field.key)) {
        payload[field.key] = data[field.key];
      }
    }

    return payload;
  }

  // ─── Visibility ────────────────────────────────────────────────────────────

  private buildVisibilityMap(questions: FieldConfig[], data: FormData): Map<string, boolean> {
    const map = new Map<string, boolean>();
    for (const field of questions) {
      map.set(field.key, this.isVisible(field, data));
    }
    return map;
  }

  private isVisible(field: FieldConfig, data: FormData): boolean {
    if (!field.visibleWhen) return true;
    const { mode, conditions } = field.visibleWhen;
    const results = conditions.map((c) => this.evaluateCondition(c, data));
    return mode === 'all' ? results.every(Boolean) : results.some(Boolean);
  }

  private evaluateCondition(condition: VisibilityCondition, data: FormData): boolean {
    const fieldValue = data[condition.key];
    const { operator, value } = condition;

    const OPS: Record<ConditionOperator, () => boolean> = {
      equals: () => fieldValue === value,
      notEquals: () => fieldValue !== value,
      in: () => Array.isArray(value) && value.includes(fieldValue as string),
      notIn: () => Array.isArray(value) && !value.includes(fieldValue as string),
    };

    return OPS[operator]?.() ?? false;
  }

  private shouldValidate(field: FieldConfig, visibilityMap: Map<string, boolean>): boolean {
    if (field.render === false) return false;
    if (field.includeInPayload === false) return false;
    return visibilityMap.get(field.key) === true;
  }

  // ─── Field-level validation ────────────────────────────────────────────────

  private validateField(field: FieldConfig, value: unknown, isFull: boolean): XviFcValidationError[] {
    const errors: XviFcValidationError[] = [];
    const { key, validations, formFieldType } = field;

    if (!validations || validations.length === 0) return errors;

    const findV = (name: string): Validator | undefined => validations.find((v) => v.name === name);

    if (findV('nullValidator')) return errors;

    const isEmpty = this.isEmptyValue(value);

    // requiredTrue (checkbox) — always enforced: absent = fail, present but not true = fail.
    // This is intentionally stricter than plain `required` in draft mode.
    const reqTrueV = findV('requiredTrue');
    if (reqTrueV) {
      if (isEmpty) {
        return [{ field: key, message: reqTrueV.message, code: 'required' }];
      }
      if (value !== true) {
        return [{ field: key, message: reqTrueV.message, code: 'requiredTrue' }];
      }
      return errors;
    }

    // required — only enforced in full mode; draft allows absent values
    const reqV = findV('required');
    if (isFull && reqV && isEmpty) {
      return [{ field: key, message: reqV.message, code: 'required' }];
    }

    if (isEmpty) return errors;

    // file fields — delegate to dedicated validator
    if (formFieldType === 'file') {
      return this.validateFileField(field, value, isFull, findV);
    }

    // pattern
    const patternV = findV('pattern');
    if (patternV) {
      if (!new RegExp(patternV.validator as string).test(String(value))) {
        errors.push({ field: key, message: patternV.message, code: 'pattern' });
      }
    }

    // email
    const emailV = findV('email');
    if (emailV) {
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRx.test(String(value))) {
        errors.push({ field: key, message: emailV.message, code: 'email' });
      }
    }

    // string length
    if (typeof value === 'string') {
      const minLenV = findV('minlength');
      if (minLenV && value.length < (minLenV.validator as number)) {
        errors.push({ field: key, message: minLenV.message, code: 'minlength' });
      }
      const maxLenV = findV('maxlength');
      if (maxLenV && value.length > (maxLenV.validator as number)) {
        errors.push({ field: key, message: maxLenV.message, code: 'maxlength' });
      }
    }

    // numeric range
    if (typeof value === 'number') {
      const minV = findV('min');
      if (minV && value < (minV.validator as number)) {
        errors.push({ field: key, message: minV.message, code: 'min' });
      }
      const maxV = findV('max');
      if (maxV && value > (maxV.validator as number)) {
        errors.push({ field: key, message: maxV.message, code: 'max' });
      }
    }

    // date range
    const minDateV = findV('minDate');
    if (minDateV) {
      const dateVal = new Date(String(value));
      if (!isNaN(dateVal.getTime()) && dateVal < this.resolveDate(minDateV.validator as string)) {
        errors.push({ field: key, message: minDateV.message, code: 'minDate' });
      }
    }
    const maxDateV = findV('maxDate');
    if (maxDateV) {
      const dateVal = new Date(String(value));
      if (!isNaN(dateVal.getTime()) && dateVal > this.resolveDate(maxDateV.validator as string)) {
        errors.push({ field: key, message: maxDateV.message, code: 'maxDate' });
      }
    }

    // year range (SFC award period)
    const yearRangeV = findV('yearRange');
    if (yearRangeV) {
      errors.push(
        ...this.validateYearRange(
          key,
          String(value),
          yearRangeV.validator as YearRangeValidatorConfig,
          yearRangeV.message,
        ),
      );
    }

    return errors;
  }

  // ─── File validation ───────────────────────────────────────────────────────

  private validateFileField(
    field: FieldConfig,
    value: unknown,
    isFull: boolean,
    findV: (name: string) => Validator | undefined,
  ): XviFcValidationError[] {
    const errors: XviFcValidationError[] = [];
    const { key, allowedFileTypes, maxFileSize } = field;
    const reqMsg = findV('required')?.message ?? 'This field is required.';

    if (typeof value !== 'object' || value === null) {
      return [{ field: key, message: reqMsg, code: 'invalidFile' }];
    }

    const file = value as Record<string, unknown>;

    if (isFull) {
      if (!file['fileName']) {
        errors.push({ field: key, message: reqMsg, code: 'missingFileName' });
      }
      if (!file['fileUrl']) {
        errors.push({ field: key, message: reqMsg, code: 'missingFileUrl' });
      }
    }

    if (allowedFileTypes && allowedFileTypes.length > 0) {
      const fileName = typeof file['fileName'] === 'string' ? file['fileName'].toLowerCase() : '';
      const mimeType = typeof file['mimeType'] === 'string' ? file['mimeType'].toLowerCase() : '';
      const allowed = allowedFileTypes.some(
        (ft) =>
          fileName.endsWith(`.${ft}`) ||
          mimeType === `application/${ft}` ||
          mimeType === `image/${ft}` ||
          mimeType === ft,
      );
      if (!allowed) {
        errors.push({
          field: key,
          message: `Only ${allowedFileTypes.join(', ')} files are allowed.`,
          code: 'invalidFileType',
        });
      }
    }

    if (maxFileSize !== undefined && typeof file['fileSize'] === 'number') {
      const sizeMb = file['fileSize'] / (1024 * 1024);
      if (sizeMb > maxFileSize) {
        errors.push({ field: key, message: `File must not exceed ${maxFileSize} MB.`, code: 'maxFileSize' });
      }
    }

    return errors;
  }

  // ─── Year range validation ─────────────────────────────────────────────────

  private validateYearRange(
    key: string,
    value: string,
    config: YearRangeValidatorConfig,
    message: string,
  ): XviFcValidationError[] {
    if (!/^\d{4}-\d{4}$/.test(value)) {
      return [{ field: key, message, code: 'yearRangeFormat' }];
    }

    const [startStr, endStr] = value.split('-');
    const startYear = parseInt(startStr, 10);
    const endYear = parseInt(endStr, 10);
    const duration = endYear - startYear;

    if (config.requireEndGreaterThanStart && endYear <= startYear) {
      return [{ field: key, message, code: 'yearRangeEndBeforeStart' }];
    }
    if (startYear < config.startYearMin || startYear > config.startYearMax) {
      return [{ field: key, message, code: 'yearRangeStartOutOfRange' }];
    }
    if (endYear < config.endYearMin || endYear > config.endYearMax) {
      return [{ field: key, message, code: 'yearRangeEndOutOfRange' }];
    }
    if (!config.allowedDurations.includes(duration)) {
      return [{ field: key, message, code: 'yearRangeInvalidDuration' }];
    }
    if (
      config.requiredIncludedYear !== undefined &&
      (startYear > config.requiredIncludedYear || endYear <= config.requiredIncludedYear)
    ) {
      return [{ field: key, message, code: 'yearRangeMissingRequiredYear' }];
    }

    return [];
  }

  // ─── Date resolution ───────────────────────────────────────────────────────

  private resolveDate(dateStr: string): Date {
    const rel = /^TODAY([+-]\d+)D$/i.exec(dateStr);
    if (rel) {
      const offset = parseInt(rel[1], 10);
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + offset);
      return d;
    }
    return new Date(dateStr);
  }

  // ─── Computed field injection ──────────────────────────────────────────────

  /**
   * Injects server-side computed fields so visibility conditions can reference them.
   * `awardPeriodDuration` is derived from `awardPeriod` to gate sfcConstitutedForInterim
   * and sfcAwardPeriodExtended. The frontend never sends this value; backend always overwrites it.
   */
  private injectComputedFields(data: FormData): FormData {
    const enriched: FormData = { ...data };

    if (typeof enriched['awardPeriod'] === 'string' && /^\d{4}-\d{4}$/.test(enriched['awardPeriod'])) {
      const [s, e] = enriched['awardPeriod'].split('-');
      enriched['awardPeriodDuration'] = parseInt(e, 10) - parseInt(s, 10);
    }

    return enriched;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Merges field-level errors from a validateField call into the shared error map.
   * Uses direct key lookup (O(1)) — no array search.
   */
  private accumulateErrors(map: XviFcValidationErrorMap, fieldErrors: XviFcValidationError[]): void {
    for (const err of fieldErrors) {
      const key = err.field ?? '_form';
      if (!map[key]) map[key] = [];
      map[key].push(err);
    }
  }

  /** Returns true if the field has a `requiredTrue` validator in its validations array. */
  private hasRequiredTrue(field: FieldConfig): boolean {
    return field.validations?.some((v) => v.name === 'requiredTrue') ?? false;
  }

  private isEmptyValue(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  }
}
