import { Injectable } from '@nestjs/common';
import type { FormData, ValidationWithPayloadResult } from './dynamic-form-validation.types';
import type { XviFcValidationError, XviFcValidationErrorMap } from '../response/xvi-fc-api-response';
import type {
  ConditionOperator,
  FieldConfig,
  UploadedFileValue,
  Validator,
  VisibilityCondition,
  VisibleWhen,
  YearRangeValidatorConfig,
} from '../types/field-config.type';
import { FileUrlNormalizerService } from '../services/file-url-normalizer.service';

@Injectable()
export class DynamicFormValidationService {
  constructor(private readonly fileUrlNormalizer: FileUrlNormalizerService) {}

  /**
   * Draft validation + payload sanitization in one O(n) pass.
   * Skips absent normal-required fields; still enforces requiredTrue and all other
   * validators when a value is present.
   */
  validateDraftAndBuildPayload(questions: FieldConfig[], data: FormData): ValidationWithPayloadResult {
    return this.validateAndBuildPayload(questions, data, false);
  }

  /**
   * Full validation + payload sanitization in one O(n) pass.
   * All visible required fields must be present and valid before submit.
   */
  validateFinalSubmitAndBuildPayload(questions: FieldConfig[], data: FormData): ValidationWithPayloadResult {
    return this.validateAndBuildPayload(questions, data, true);
  }

  /**
   * Shared implementation for validateDraftAndBuildPayload / validateFinalSubmitAndBuildPayload.
   * Injects computed fields once, then iterates questions once: validates each visible field
   * and accumulates the sanitized payload in the same pass.
   */
  private validateAndBuildPayload(
    questions: FieldConfig[],
    data: FormData,
    isFull: boolean,
  ): ValidationWithPayloadResult {
    const enriched = this.injectComputedFields(data);
    const errors: XviFcValidationErrorMap = {};
    const sanitizedPayload: FormData = {};

    for (const field of questions) {
      if (!this.shouldValidateField(field, enriched)) continue;

      // Disabled + clearValueWhenDisabled: skip both validation and value inclusion
      if (field.clearValueWhenDisabled && !this.evaluateConditions(field.enabledWhen, (k) => enriched[k])) {
        continue;
      }

      const value = enriched[field.key];
      const validationEnabled = this.evaluateConditions(field.validateWhen, (k) => enriched[k]);

      if (validationEnabled) {
        if (isFull) {
          this.accumulateErrors(errors, this.validateField(field, value, true));
        } else if (!this.isEmptyValue(value) /* || this.hasRequiredTrue(field) */) {
          // Draft: skip absent fields. requiredTrue mandatory-on-draft enforcement is
          // temporarily disabled for now — see the reqTrueV block in validateField below.
          this.accumulateErrors(errors, this.validateField(field, value, false));
        }
      }

      if (Object.prototype.hasOwnProperty.call(data, field.key)) {
        const raw = data[field.key];
        sanitizedPayload[field.key] = field.formFieldType === 'file' ? this.normalizeFileForPayload(raw) : raw;
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors, sanitizedPayload };
  }

  // ─── File normalization ────────────────────────────────────────────────────

  private normalizeFileForPayload(value: unknown): unknown {
    const file = value as (UploadedFileValue & { path?: string }) | null | undefined;
    if (file?.fileUrl) {
      return { ...file, fileUrl: this.fileUrlNormalizer.toRawStoragePath(file.fileUrl) };
    }
    // CommonFile shape (e.g. ULB's gazetteNotificationFile) stores the storage path as `path`.
    if (file?.path) {
      return { ...file, path: this.fileUrlNormalizer.toRawStoragePath(file.path) };
    }
    return value;
  }

  // ─── Condition evaluation ──────────────────────────────────────────────────

  /**
   * Evaluates a VisibleWhen condition block against a value lookup.
   * Returns true when the condition is undefined (no restriction).
   */
  private evaluateConditions(vw: VisibleWhen | undefined, valueLookup: (key: string) => unknown): boolean {
    if (!vw) return true;
    const { mode, conditions } = vw;
    const results = conditions.map((c) => this.evaluateCondition(c, valueLookup));
    return mode === 'all' ? results.every(Boolean) : results.some(Boolean);
  }

  private evaluateCondition(condition: VisibilityCondition, valueLookup: (key: string) => unknown): boolean {
    const fieldValue = valueLookup(condition.key);
    const { operator, value } = condition;

    const OPS: Record<ConditionOperator, () => boolean> = {
      equals: () => fieldValue === value,
      notEquals: () => fieldValue !== value,
      in: () => Array.isArray(value) && value.includes(fieldValue as string),
      notIn: () => Array.isArray(value) && !value.includes(fieldValue as string),
    };

    return OPS[operator]?.() ?? false;
  }

  private isVisible(field: FieldConfig, data: FormData): boolean {
    return this.evaluateConditions(field.visibleWhen, (k) => data[k]);
  }

  /** Returns true when a field should be validated or included in the payload: renderable, payload-included, and currently visible. */
  private shouldValidateField(field: FieldConfig, data: FormData): boolean {
    if (field.render === false) return false;
    if (field.includeInPayload === false) return false;
    return this.isVisible(field, data);
  }

  // ─── Field-level validation ────────────────────────────────────────────────

  private validateField(field: FieldConfig, value: unknown, isFull: boolean): XviFcValidationError[] {
    const errors: XviFcValidationError[] = [];
    const { key, validations, formFieldType } = field;

    if (!validations || validations.length === 0) return errors;

    const findV = (name: string): Validator | undefined => validations.find((v) => v.name === name);

    if (findV('nullValidator')) return errors;

    // actualTarget carries an object value ({actual, target}) — never itself "empty" by the
    // generic scalar isEmptyValue check, so it must be dispatched before that check runs.
    if (formFieldType === 'actualTarget') {
      return this.validateActualTargetField(field, value, isFull, findV);
    }

    const isEmpty = this.isEmptyValue(value);

    // requiredTrue (checkbox) — mandatory-on-draft enforcement temporarily disabled for now
    // (was: enforced in both draft and final submit). Still enforced on final submit.
    const reqTrueV = findV('requiredTrue');
    if (reqTrueV && isFull) {
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
    // File values arrive in one of two shapes: the standalone `{ fileName, fileUrl }` contract
    // (most xvi-fc file fields) or the `CommonFile` contract `{ originalName, path }` (e.g.
    // ULB's gazetteNotificationFile). Accept either so this shared validator works for both.
    const fileNameValue = file['fileName'] ?? file['originalName'];
    const fileUrlValue = file['fileUrl'] ?? file['path'];

    if (isFull) {
      if (!fileNameValue) {
        errors.push({ field: key, message: reqMsg, code: 'missingFileName' });
      }
      if (!fileUrlValue) {
        errors.push({ field: key, message: reqMsg, code: 'missingFileUrl' });
      }
    }

    if (allowedFileTypes && allowedFileTypes.length > 0) {
      const fileName = typeof fileNameValue === 'string' ? fileNameValue.toLowerCase() : '';
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

    if (maxFileSize !== undefined) {
      const sizeMb =
        typeof file['fileSize'] === 'number'
          ? file['fileSize'] / (1024 * 1024)
          : typeof file['sizeKb'] === 'number'
            ? file['sizeKb'] / 1024
            : undefined;
      if (sizeMb !== undefined && sizeMb > maxFileSize) {
        errors.push({ field: key, message: `File must not exceed ${maxFileSize} MB.`, code: 'maxFileSize' });
      }
    }

    return errors;
  }

  // ─── Actual/Target validation ──────────────────────────────────────────────

  /**
   * Validates a `formFieldType: 'actualTarget'` field's `{ actual, target }` value.
   * The same `validations` array (required/min/max) is applied independently to both
   * sub-values, producing errors keyed `<key>.actual` / `<key>.target` so the frontend's
   * Angular dot-path `form.get('key.actual')` resolves directly to the nested sub-control.
   */
  private validateActualTargetField(
    field: FieldConfig,
    value: unknown,
    isFull: boolean,
    findV: (name: string) => Validator | undefined,
  ): XviFcValidationError[] {
    const { key } = field;
    const pair = (typeof value === 'object' && value !== null ? value : {}) as {
      actual?: unknown;
      target?: unknown;
    };
    const errors: XviFcValidationError[] = [];
    const reqV = findV('required');
    const minV = findV('min');
    const maxV = findV('max');

    for (const sub of ['actual', 'target'] as const) {
      const subValue = pair[sub];
      const subKey = `${key}.${sub}`;
      const subIsEmpty = this.isEmptyValue(subValue);

      if (isFull && reqV && subIsEmpty) {
        errors.push({ field: subKey, message: reqV.message, code: 'required' });
        continue;
      }
      if (subIsEmpty) continue;

      if (typeof subValue === 'number') {
        if (minV && subValue < (minV.validator as number)) {
          errors.push({ field: subKey, message: minV.message, code: 'min' });
        }
        if (maxV && subValue > (maxV.validator as number)) {
          errors.push({ field: subKey, message: maxV.message, code: 'max' });
        }
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

  /** Mirrors the frontend's `date-constraint-resolver.ts` — same `TODAY±ND` / `±NM` / `±NY` grammar,
   *  kept in sync so a `minDate`/`maxDate` config resolves identically on both sides. */
  private resolveDate(dateStr: string): Date {
    const rel = /^TODAY(?:([+-])(\d+)([DMY]))?$/i.exec(dateStr);
    if (rel) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (rel[1]) {
        const amount = parseInt(rel[2], 10) * (rel[1] === '-' ? -1 : 1);
        switch (rel[3].toUpperCase()) {
          case 'D':
            d.setDate(d.getDate() + amount);
            break;
          case 'M':
            d.setMonth(d.getMonth() + amount);
            break;
          case 'Y':
            d.setFullYear(d.getFullYear() + amount);
            break;
        }
      }
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
