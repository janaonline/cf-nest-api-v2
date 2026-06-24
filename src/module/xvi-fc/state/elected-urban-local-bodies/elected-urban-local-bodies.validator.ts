import { Injectable } from '@nestjs/common';
import {
  DATE_OF_CONSTITUTION_MIN,
  DATE_OF_EXPIRY_MAX,
  ELECTED_BODY_STATUSES,
  EULB_CENSUS_CODE_MAX_LENGTH,
  EULB_ULB_NAME_MAX_LENGTH,
} from './constants/elected-urban-local-bodies.constants';
import type { EulbRowError } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';

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
  validateDbUlbRow(row: ParsedExcelRow, dbUlb: DbUlbEntry, today: Date): EulbRowError[] {
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

    errors.push(...this.validateCommonFields(row, today));
    return errors;
  }

  validateExtraUlbRow(row: ParsedExcelRow, today: Date): EulbRowError[] {
    const errors: EulbRowError[] = [];

    // censusCode required for EXTRA_ULB rows
    if (!row.censusCode || row.censusCode.trim() === '') {
      errors.push({ field: 'censusCode', code: 'required', message: 'Census code is required.' });
    } else if (row.censusCode.trim().length > EULB_CENSUS_CODE_MAX_LENGTH) {
      errors.push({
        field: 'censusCode',
        code: 'maxlength',
        message: `Census code must not exceed ${EULB_CENSUS_CODE_MAX_LENGTH} characters.`,
        value: row.censusCode,
      });
    }

    // ulbName required, max length enforced
    if (!row.ulbName || row.ulbName.trim() === '') {
      errors.push({ field: 'ulbName', code: 'required', message: 'ULB name is required.' });
    } else if (row.ulbName.trim().length > EULB_ULB_NAME_MAX_LENGTH) {
      errors.push({
        field: 'ulbName',
        code: 'maxlength',
        message: `ULB name must not exceed ${EULB_ULB_NAME_MAX_LENGTH} characters.`,
        value: row.ulbName,
      });
    }

    errors.push(...this.validateCommonFields(row, today));
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
  ): EulbRowError[] {
    const errors: EulbRowError[] = [];

    if (dto.censusCode !== undefined) {
      if (!dto.censusCode || dto.censusCode.trim() === '') {
        errors.push({ field: 'censusCode', code: 'required', message: 'Census code is required.' });
      } else if (dto.censusCode.trim().length > EULB_CENSUS_CODE_MAX_LENGTH) {
        errors.push({
          field: 'censusCode',
          code: 'maxlength',
          message: `Census code must not exceed ${EULB_CENSUS_CODE_MAX_LENGTH} characters.`,
          value: dto.censusCode,
        });
      }
    }

    if (dto.ulbName !== undefined) {
      if (!dto.ulbName || dto.ulbName.trim() === '') {
        errors.push({ field: 'ulbName', code: 'required', message: 'ULB name is required.' });
      } else if (dto.ulbName.trim().length > EULB_ULB_NAME_MAX_LENGTH) {
        errors.push({
          field: 'ulbName',
          code: 'maxlength',
          message: `ULB name must not exceed ${EULB_ULB_NAME_MAX_LENGTH} characters.`,
          value: dto.ulbName,
        });
      }
    }

    if (dto.electedBodyStatus !== undefined) {
      if (dto.electedBodyStatus.trim() === '') {
        errors.push({ field: 'electedBodyStatus', code: 'required', message: 'Elected body status is required.' });
      } else if (!(ELECTED_BODY_STATUSES as readonly string[]).includes(dto.electedBodyStatus.trim())) {
        errors.push({
          field: 'electedBodyStatus',
          code: 'invalid_enum',
          message: `Elected Body Status must be one of: ${ELECTED_BODY_STATUSES.join(', ')}.`,
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
        if (docNorm < this.normalizeDate(DATE_OF_CONSTITUTION_MIN)) {
          errors.push({
            field: 'dateOfConstitution',
            code: 'minDate',
            message: 'Date of constitution cannot be before 31 May 2021.',
            value: doc.toISOString(),
          });
        } else if (docNorm > this.normalizeDate(today)) {
          errors.push({
            field: 'dateOfConstitution',
            code: 'maxDate',
            message: 'Date of constitution cannot be in the future.',
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
            message: 'Date of expiry cannot be in the past.',
            value: doe.toISOString(),
          });
        } else if (doeNorm > this.normalizeDate(DATE_OF_EXPIRY_MAX)) {
          errors.push({
            field: 'dateOfExpiry',
            code: 'maxDate',
            message: 'Date of expiry cannot be after 31 March 2030.',
            value: doe.toISOString(),
          });
        }
      }
    }

    if (dto.remarks !== undefined && dto.remarks.trim().length > 250) {
      errors.push({
        field: 'remarks',
        code: 'maxlength',
        message: 'Remarks must not exceed 250 characters.',
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
    );
  }

  /** Re-validates a single row after a portal update. Delegates to the appropriate validator based on rowType. */
  revalidateRow(
    row: ParsedExcelRow & { rowType: 'DB_ULB' | 'EXTRA_ULB' },
    dbUlb: DbUlbEntry | null,
    today: Date,
  ): EulbRowError[] {
    if (row.rowType === 'DB_ULB' && dbUlb) {
      return this.validateDbUlbRow(row, dbUlb, today);
    }
    return this.validateExtraUlbRow(row, today);
  }

  /** Shared validation rules for both DB_ULB and EXTRA_ULB rows. */
  private validateCommonFields(row: ParsedExcelRow, today: Date): EulbRowError[] {
    const errors: EulbRowError[] = [];

    // electedBodyStatus required and enum — invalid value is persisted; validation error carries the raw value
    if (!row.electedBodyStatus || row.electedBodyStatus.trim() === '') {
      errors.push({ field: 'electedBodyStatus', code: 'required', message: 'Elected body status is required.' });
    } else if (!(ELECTED_BODY_STATUSES as readonly string[]).includes(row.electedBodyStatus.trim())) {
      errors.push({
        field: 'electedBodyStatus',
        code: 'invalidValue',
        message: `Elected body status must be one of: ${ELECTED_BODY_STATUSES.join(', ')}.`,
        value: row.electedBodyStatus,
      });
    }

    // dateOfConstitution and dateOfExpiry are only required and validated when status is Constituted
    const isConstituted = row.electedBodyStatus?.trim() === 'Constituted';

    if (isConstituted) {
      // dateOfConstitution required, valid date, min=2021-05-31, max=today
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
          if (docNorm < this.normalizeDate(DATE_OF_CONSTITUTION_MIN)) {
            errors.push({
              field: 'dateOfConstitution',
              code: 'minDate',
              message: 'Date of constitution cannot be before 31 May 2021.',
              value: doc.toISOString(),
            });
          } else if (docNorm > this.normalizeDate(today)) {
            errors.push({
              field: 'dateOfConstitution',
              code: 'maxDate',
              message: 'Date of constitution cannot be in the future.',
              value: doc.toISOString(),
            });
          }
        }
      }

      // dateOfExpiry required, valid date, min=today, max=2030-03-31
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
              message: 'Date of expiry cannot be in the past.',
              value: doe.toISOString(),
            });
          } else if (doeNorm > this.normalizeDate(DATE_OF_EXPIRY_MAX)) {
            errors.push({
              field: 'dateOfExpiry',
              code: 'maxDate',
              message: 'Date of expiry cannot be after 31 March 2030.',
              value: doe.toISOString(),
            });
          }
        }
      }
    }

    // remarks optional, max 250 chars if provided
    if (row.remarks && row.remarks.trim() !== '') {
      const len = row.remarks.trim().length;
      if (len > 250) {
        errors.push({
          field: 'remarks',
          code: 'maxlength',
          message: 'Remarks must not exceed 250 characters.',
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
