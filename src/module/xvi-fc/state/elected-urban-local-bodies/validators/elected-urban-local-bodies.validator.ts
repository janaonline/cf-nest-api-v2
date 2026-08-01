import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { EulbRowError } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import type { FieldConfig, FormFieldOption } from 'src/module/xvi-fc/common/types/field-config.type';
import { getValidatorValue } from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';

export interface EulbDateValidationConfig {
  /** Static minDate for dateOfConstitution, parsed as UTC start-of-day. */
  constitutionMin: Date;
  constitutionMinMessage: string;
  /** Message for the TODAY upper-bound on dateOfConstitution (enforced via `today` param). */
  constitutionMaxMessage: string;
  /** Static maxDate for dateOfExpiry, parsed as UTC end-of-day. */
  expiryMax: Date;
  expiryMaxMessage: string;
  /** Message for the TODAY lower-bound on dateOfExpiry (enforced via `today` param). */
  expiryMinMessage: string;
  remarksMaxLength: number;
  remarksMaxLengthMessage: string;
  /** DB-driven — single source of truth for censusCode/ulbName length and the electedBodyStatus enum. */
  censusCodeMaxLength: number;
  censusCodeMaxLengthMessage: string;
  ulbNameMaxLength: number;
  ulbNameMaxLengthMessage: string;
  electedBodyStatuses: string[];
}

function parseDateBoundary(iso: string, mode: 'min' | 'max'): Date {
  const parts = iso.split('-').map(Number);
  const [y, m, d] = parts;
  return mode === 'min'
    ? new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    : new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

/**
 * Derives EulbDateValidationConfig from the DB-backed ROW_EDIT_FIELDS group (dates, remarks,
 * electedBodyStatus enum) and EXTRA_ULB_PORTAL_FIELDS group (censusCode/ulbName max length —
 * these two keys aren't tagged ROW_EDIT_FIELDS in the DB document). Single source of truth for
 * every limit here; nothing in this function is hardcoded.
 */
export function extractDateConfig(
  rowEditFields: FieldConfig[],
  extraUlbPortalFields: FieldConfig[],
): EulbDateValidationConfig {
  const cField = rowEditFields.find((f) => f.key === 'dateOfConstitution');
  const eField = rowEditFields.find((f) => f.key === 'dateOfExpiry');
  const rField = rowEditFields.find((f) => f.key === 'remarks');
  const statusField = rowEditFields.find((f) => f.key === 'electedBodyStatus');
  const censusCodeField = extraUlbPortalFields.find((f) => f.key === 'censusCode');
  const ulbNameField = extraUlbPortalFields.find((f) => f.key === 'ulbName');
  if (!cField || !eField || !rField || !statusField || !censusCodeField || !ulbNameField) {
    throw new InternalServerErrorException(
      'EULB ROW_EDIT_FIELDS/EXTRA_ULB_PORTAL_FIELDS is missing required date/remarks/status/census/ulbName fields.',
    );
  }
  const cMinV = cField.validations?.find((v) => v.name === 'minDate');
  const cMaxV = cField.validations?.find((v) => v.name === 'maxDate');
  const eMaxV = eField.validations?.find((v) => v.name === 'maxDate');
  const eMinV = eField.validations?.find((v) => v.name === 'minDate');
  const rMaxV = rField.validations?.find((v) => v.name === 'maxlength');
  if (!cMinV?.validator || !cMaxV || !eMaxV?.validator || !eMinV || !rMaxV?.validator) {
    throw new InternalServerErrorException('EULB ROW_EDIT_FIELDS date/remarks validations are incomplete.');
  }
  if (typeof cMinV.validator !== 'string' || typeof eMaxV.validator !== 'string') {
    throw new InternalServerErrorException('EULB ROW_EDIT_FIELDS date validators must be ISO date strings.');
  }
  if (typeof rMaxV.validator !== 'number') {
    throw new InternalServerErrorException('EULB ROW_EDIT_FIELDS maxlength validator must be a number.');
  }

  const censusMaxV = getValidatorValue<number>(censusCodeField, 'maxlength');
  const censusMaxMessage = censusCodeField.validations?.find((v) => v.name.toLowerCase() === 'maxlength')?.message;
  const ulbNameMaxV = getValidatorValue<number>(ulbNameField, 'maxlength');
  const ulbNameMaxMessage = ulbNameField.validations?.find((v) => v.name.toLowerCase() === 'maxlength')?.message;
  if (censusMaxV === undefined || !censusMaxMessage || ulbNameMaxV === undefined || !ulbNameMaxMessage) {
    throw new InternalServerErrorException(
      'EULB EXTRA_ULB_PORTAL_FIELDS censusCode/ulbName maxlength validations are incomplete.',
    );
  }

  const statusOptions = statusField.options;
  if (!statusOptions || statusOptions.length === 0) {
    throw new InternalServerErrorException('EULB ROW_EDIT_FIELDS electedBodyStatus is missing its options list.');
  }
  const electedBodyStatuses = statusOptions.map((o) => (typeof o === 'string' ? o : (o as FormFieldOption).id));

  const cMinIso: string = cMinV.validator;
  const eMaxIso: string = eMaxV.validator;
  const remarksMax: number = rMaxV.validator;
  return {
    constitutionMin: parseDateBoundary(cMinIso, 'min'),
    constitutionMinMessage: cMinV.message,
    constitutionMaxMessage: cMaxV.message,
    expiryMax: parseDateBoundary(eMaxIso, 'max'),
    expiryMaxMessage: eMaxV.message,
    expiryMinMessage: eMinV.message,
    remarksMaxLength: remarksMax,
    remarksMaxLengthMessage: rMaxV.message,
    censusCodeMaxLength: censusMaxV,
    censusCodeMaxLengthMessage: censusMaxMessage,
    ulbNameMaxLength: ulbNameMaxV,
    ulbNameMaxLengthMessage: ulbNameMaxMessage,
    electedBodyStatuses,
  };
}

export interface ParsedExcelRow {
  censusCode?: string;
  ulbName: string;
  electedBodyStatus?: string;
  dateOfConstitution?: Date | string;
  dateOfExpiry?: Date | string;
  remarks?: string;
  rawExcelData?: Record<string, unknown>;
  rowNumber: number;
}

export interface DbUlbEntry {
  _id: unknown;
  name: string;
  censusCode?: string | number | null;
  sbCode?: string | number | null;
}

@Injectable()
export class ElectedUrbanLocalBodiesValidator {
  validateDbUlbRow(
    row: ParsedExcelRow,
    dbUlb: DbUlbEntry,
    today: Date,
    dateConfig: EulbDateValidationConfig,
  ): EulbRowError[] {
    const errors: EulbRowError[] = [];
    const dbCode = String(dbUlb.censusCode ?? dbUlb.sbCode ?? '').trim();

    // censusCode required and must match DB
    if (!row.censusCode || row.censusCode.trim() === '') {
      errors.push({ field: 'censusCode', code: 'required', message: 'Census code is required.' });
    } else if (row.censusCode.trim().toLowerCase() !== dbCode.toLowerCase()) {
      errors.push({
        field: 'censusCode',
        code: 'mismatch',
        message: 'Census code does not match the database record.',
        value: row.censusCode,
      });
    }

    // ulbName required and must match DB
    if (!row.ulbName || row.ulbName.trim() === '') {
      errors.push({ field: 'ulbName', code: 'required', message: 'ULB name is required.' });
    } else if (row.ulbName.trim().toLowerCase() !== dbUlb.name.trim().toLowerCase()) {
      errors.push({
        field: 'ulbName',
        code: 'mismatch',
        message: 'ULB name does not match the database record.',
        value: row.ulbName,
      });
    }

    errors.push(...this.validateCommonFields(row, today, dateConfig));
    return errors;
  }

  validateExtraUlbRow(row: ParsedExcelRow, today: Date, dateConfig: EulbDateValidationConfig): EulbRowError[] {
    const errors: EulbRowError[] = [];

    // censusCode required for EXTRA_ULB rows
    if (!row.censusCode || row.censusCode.trim() === '') {
      errors.push({ field: 'censusCode', code: 'required', message: 'Census code is required.' });
    } else if (row.censusCode.trim().length > dateConfig.censusCodeMaxLength) {
      errors.push({
        field: 'censusCode',
        code: 'maxlength',
        message: dateConfig.censusCodeMaxLengthMessage,
        value: row.censusCode,
      });
    }

    // ulbName required, max length enforced
    if (!row.ulbName || row.ulbName.trim() === '') {
      errors.push({ field: 'ulbName', code: 'required', message: 'ULB name is required.' });
    } else if (row.ulbName.trim().length > dateConfig.ulbNameMaxLength) {
      errors.push({
        field: 'ulbName',
        code: 'maxlength',
        message: dateConfig.ulbNameMaxLengthMessage,
        value: row.ulbName,
      });
    }

    errors.push(...this.validateCommonFields(row, today, dateConfig));
    return errors;
  }

  /**
   * Validates only the editable fields submitted via a portal PATCH update.
   * Returns structured errors so the service can throw a uniform 400 response.
   * All fields are optional — only provided fields are validated.
   */
  validatePortalUpdateFields(
    dto: {
      censusCode?: string;
      ulbName?: string;
      electedBodyStatus?: string;
      dateOfConstitution?: string;
      dateOfExpiry?: string;
      remarks?: string;
    },
    today: Date,
    dateConfig: EulbDateValidationConfig,
  ): EulbRowError[] {
    const errors: EulbRowError[] = [];

    if (dto.censusCode !== undefined) {
      if (!dto.censusCode || dto.censusCode.trim() === '') {
        errors.push({ field: 'censusCode', code: 'required', message: 'Census code is required.' });
      } else if (dto.censusCode.trim().length > dateConfig.censusCodeMaxLength) {
        errors.push({
          field: 'censusCode',
          code: 'maxlength',
          message: dateConfig.censusCodeMaxLengthMessage,
          value: dto.censusCode,
        });
      }
    }

    if (dto.ulbName !== undefined) {
      if (!dto.ulbName || dto.ulbName.trim() === '') {
        errors.push({ field: 'ulbName', code: 'required', message: 'ULB name is required.' });
      } else if (dto.ulbName.trim().length > dateConfig.ulbNameMaxLength) {
        errors.push({
          field: 'ulbName',
          code: 'maxlength',
          message: dateConfig.ulbNameMaxLengthMessage,
          value: dto.ulbName,
        });
      }
    }

    if (dto.electedBodyStatus !== undefined) {
      if (dto.electedBodyStatus.trim() === '') {
        errors.push({ field: 'electedBodyStatus', code: 'required', message: 'Elected body status is required.' });
      } else if (!dateConfig.electedBodyStatuses.includes(dto.electedBodyStatus.trim())) {
        errors.push({
          field: 'electedBodyStatus',
          code: 'invalid_enum',
          message: `Elected Body Status must be one of: ${dateConfig.electedBodyStatuses.join(', ')}.`,
          value: dto.electedBodyStatus,
        });
      }
    }

    if (dto.dateOfConstitution !== undefined) {
      const doc = this.parseDate(dto.dateOfConstitution);
      if (!doc) {
        errors.push({
          field: 'dateOfConstitution',
          code: 'invalidDate',
          message: 'Date of constitution must be a valid date.',
          value: dto.dateOfConstitution,
        });
      } else {
        const docNorm = this.normalizeDate(doc);
        if (docNorm < this.normalizeDate(dateConfig.constitutionMin)) {
          errors.push({
            field: 'dateOfConstitution',
            code: 'minDate',
            message: dateConfig.constitutionMinMessage,
            value: doc.toISOString(),
          });
        } else if (docNorm > this.normalizeDate(today)) {
          errors.push({
            field: 'dateOfConstitution',
            code: 'maxDate',
            message: dateConfig.constitutionMaxMessage,
            value: doc.toISOString(),
          });
        }
      }
    }

    if (dto.dateOfExpiry !== undefined) {
      const doe = this.parseDate(dto.dateOfExpiry);
      if (!doe) {
        errors.push({
          field: 'dateOfExpiry',
          code: 'invalidDate',
          message: 'Date of expiry must be a valid date.',
          value: dto.dateOfExpiry,
        });
      } else {
        const doeNorm = this.normalizeDate(doe);
        if (doeNorm < this.normalizeDate(today)) {
          errors.push({
            field: 'dateOfExpiry',
            code: 'minDate',
            message: dateConfig.expiryMinMessage,
            value: doe.toISOString(),
          });
        } else if (doeNorm > this.normalizeDate(dateConfig.expiryMax)) {
          errors.push({
            field: 'dateOfExpiry',
            code: 'maxDate',
            message: dateConfig.expiryMaxMessage,
            value: doe.toISOString(),
          });
        }
      }
    }

    if (dto.remarks !== undefined && dto.remarks.trim().length > dateConfig.remarksMaxLength) {
      errors.push({
        field: 'remarks',
        code: 'maxlength',
        message: dateConfig.remarksMaxLengthMessage,
        value: dto.remarks,
      });
    }

    return errors;
  }

  /**
   * Validates the editable fields for a post-submission row update.
   * Unlike validatePortalUpdateFields (which treats all fields as optional partial updates),
   * this treats electedBodyStatus as required and always enforces cross-field rules:
   * Constituted status requires both dateOfConstitution and dateOfExpiry.
   */
  validatePostSubmissionRowUpdate(
    dto: {
      electedBodyStatus: string;
      dateOfConstitution?: string | null;
      dateOfExpiry?: string | null;
      remarks?: string | null;
    },
    today: Date,
    dateConfig: EulbDateValidationConfig,
  ): EulbRowError[] {
    return this.validateCommonFields(
      {
        rowNumber: 0,
        ulbName: '',
        electedBodyStatus: dto.electedBodyStatus,
        dateOfConstitution: dto.dateOfConstitution ?? undefined,
        dateOfExpiry: dto.dateOfExpiry ?? undefined,
        remarks: dto.remarks ?? undefined,
      },
      today,
      dateConfig,
    );
  }

  /**
   * Re-validates a single row after a portal update. Every persisted row is registry-backed, so
   * `dbUlb` should always resolve — the no-dbUlb fallback is defensive, not an expected path.
   */
  revalidateRow(
    row: ParsedExcelRow,
    dbUlb: DbUlbEntry | null,
    today: Date,
    dateConfig: EulbDateValidationConfig,
  ): EulbRowError[] {
    if (dbUlb) {
      return this.validateDbUlbRow(row, dbUlb, today, dateConfig);
    }
    return this.validateExtraUlbRow(row, today, dateConfig);
  }

  /** Shared validation rules for both `validateDbUlbRow` and `validateExtraUlbRow`. */
  private validateCommonFields(row: ParsedExcelRow, today: Date, dateConfig: EulbDateValidationConfig): EulbRowError[] {
    const errors: EulbRowError[] = [];

    // electedBodyStatus required and enum — invalid value is persisted; validation error carries the raw value
    if (!row.electedBodyStatus || row.electedBodyStatus.trim() === '') {
      errors.push({ field: 'electedBodyStatus', code: 'required', message: 'Elected body status is required.' });
    } else if (!dateConfig.electedBodyStatuses.includes(row.electedBodyStatus.trim())) {
      errors.push({
        field: 'electedBodyStatus',
        code: 'invalidValue',
        message: `Elected body status must be one of: ${dateConfig.electedBodyStatuses.join(', ')}.`,
        value: row.electedBodyStatus,
      });
    }

    // dateOfConstitution and dateOfExpiry are only required and validated when status is Constituted
    const isConstituted = row.electedBodyStatus?.trim() === 'Constituted';

    if (isConstituted) {
      // dateOfConstitution required, valid date, min from config, max=today
      if (!row.dateOfConstitution) {
        errors.push({ field: 'dateOfConstitution', code: 'required', message: 'Date of constitution is required.' });
      } else {
        const doc = this.parseDate(row.dateOfConstitution);
        if (!doc) {
          errors.push({
            field: 'dateOfConstitution',
            code: 'invalidDate',
            message: 'Date of constitution must be a valid date.',
            value:
              row.dateOfConstitution instanceof Date ? row.dateOfConstitution.toISOString() : row.dateOfConstitution,
          });
        } else {
          const docNorm = this.normalizeDate(doc);
          if (docNorm < this.normalizeDate(dateConfig.constitutionMin)) {
            errors.push({
              field: 'dateOfConstitution',
              code: 'minDate',
              message: dateConfig.constitutionMinMessage,
              value: doc.toISOString(),
            });
          } else if (docNorm > this.normalizeDate(today)) {
            errors.push({
              field: 'dateOfConstitution',
              code: 'maxDate',
              message: dateConfig.constitutionMaxMessage,
              value: doc.toISOString(),
            });
          }
        }
      }

      // dateOfExpiry required, valid date, min=today, max from config
      if (!row.dateOfExpiry) {
        errors.push({ field: 'dateOfExpiry', code: 'required', message: 'Date of expiry is required.' });
      } else {
        const doe = this.parseDate(row.dateOfExpiry);
        if (!doe) {
          errors.push({
            field: 'dateOfExpiry',
            code: 'invalidDate',
            message: 'Date of expiry must be a valid date.',
            value: row.dateOfExpiry instanceof Date ? row.dateOfExpiry.toISOString() : row.dateOfExpiry,
          });
        } else {
          const doeNorm = this.normalizeDate(doe);
          if (doeNorm < this.normalizeDate(today)) {
            errors.push({
              field: 'dateOfExpiry',
              code: 'minDate',
              message: dateConfig.expiryMinMessage,
              value: doe.toISOString(),
            });
          } else if (doeNorm > this.normalizeDate(dateConfig.expiryMax)) {
            errors.push({
              field: 'dateOfExpiry',
              code: 'maxDate',
              message: dateConfig.expiryMaxMessage,
              value: doe.toISOString(),
            });
          }
        }
      }
    }

    // remarks optional, max length from config
    if (row.remarks && row.remarks.trim() !== '') {
      const len = row.remarks.trim().length;
      if (len > dateConfig.remarksMaxLength) {
        errors.push({
          field: 'remarks',
          code: 'maxlength',
          message: dateConfig.remarksMaxLengthMessage,
          value: row.remarks,
        });
      }
    }

    return errors;
  }

  private parseDate(value: Date | string | undefined | null): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Strips time component for date-only comparisons. */
  private normalizeDate(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}
