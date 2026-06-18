import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { S3Service } from 'src/core/s3/s3.service';
import { ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { assertCanStateEditForm } from '../../common/utils/xvi-fc-form-status-access.util';
import { throwXviFcValidationError, xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
  EulbValidationStatus,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
  EulbRowError,
  EulbRowValidationStatus,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { EXCEL_HEADER_MAP, ERROR_EXCEL_HEADERS } from './constants/elected-urban-local-bodies.constants';
import type { ValidateElectedUrbanLocalBodiesExcelDto } from './dto/validate-elected-urban-local-bodies-excel.dto';
import { ElectedUrbanLocalBodiesValidator, ParsedExcelRow } from './elected-urban-local-bodies.validator';
import type {
  EulbFileRefData,
  EulbRevalidateExcelResponseData,
  EulbRowValidationError,
  EulbValidateExcelResponseData,
  EulbValidationSummary,
} from './elected-urban-local-bodies.types';

interface UlbLean {
  _id: Types.ObjectId;
  name: string;
  censusCode?: string | null;
  sbCode?: string | null;
}

interface ProcessedRow extends ParsedExcelRow {
  rowType: 'DB_ULB' | 'EXTRA_ULB';
  ulbId?: Types.ObjectId;
  dbCensusCode?: string;
  dbUlbName?: string;
  validationRowStatus: 'VALID' | 'INVALID';
  rowErrors: Array<{ field: string; code: string; message: string; value?: unknown }>;
}

@Injectable()
export class ElectedUrbanLocalBodiesExcelService {
  private readonly logger = new Logger(ElectedUrbanLocalBodiesExcelService.name);

  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly formModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly s3Service: S3Service,
    private readonly excelService: ExcelService,
    private readonly eulbValidator: ElectedUrbanLocalBodiesValidator,
    private readonly config: ConfigService,
  ) {}

  async validateExcel(
    dto: ValidateElectedUrbanLocalBodiesExcelDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbValidateExcelResponseData>> {
    this.assertStateAccess(user, dto.stateId);
    this.assertEditPermission(user);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    // 1. File metadata validation
    this.validateFileMetadata(dto.electedBodyExcelFile);

    // 2. Load active DB ULBs for state
    const dbUlbs = (await this.ulbModel
      .find({ state: stateOid, isActive: true })
      .select('_id name censusCode sbCode')
      .lean()
      .exec()) as UlbLean[];

    const dbUlbCount = dbUlbs.length;
    const maxAllowedExcelRows = dbUlbCount * 2;

    // 3. Read and parse Excel from S3
    const buffer = await this.s3Service.getBuffer(dto.electedBodyExcelFile.fileUrl);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throwXviFcValidationError({
        electedBodyExcelFile: [
          { field: 'electedBodyExcelFile', code: 'emptyWorkbook', message: 'The uploaded Excel file has no sheets.' },
        ],
      });
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

    if (rawRows.length < 2) {
      throwXviFcValidationError({
        electedBodyExcelFile: [
          {
            field: 'electedBodyExcelFile',
            code: 'emptySheet',
            message: 'The uploaded Excel file has no data rows.',
          },
        ],
      });
    }

    // 4. Parse and normalize headers
    const headerRow = (rawRows[0] as string[]).map((h) => String(h).trim());
    const colIndexMap = this.buildColIndexMap(headerRow);

    const missingHeaders = this.findMissingRequiredHeaders(colIndexMap);
    if (missingHeaders.length > 0) {
      throwXviFcValidationError({
        electedBodyExcelFile: [
          {
            field: 'electedBodyExcelFile',
            code: 'missingHeaders',
            message: `Missing required columns: ${missingHeaders.join(', ')}.`,
          },
        ],
      });
    }

    // 5. Parse data rows (skip empty rows)
    const dataRows = rawRows.slice(1).filter((row) => !this.isEmptyRow(row));
    const excelRowCount = dataRows.length;

    // 6. File-level validations — errors keyed by their owning question field
    const fileLevelErrorMap: Record<string, Array<{ field: string; code: string; message: string }>> = {};
    if (excelRowCount > maxAllowedExcelRows) {
      fileLevelErrorMap['electedBodyExcelFile'] = [
        {
          field: 'electedBodyExcelFile',
          code: 'tooManyRows',
          message: `Excel has ${excelRowCount} rows, maximum allowed is ${maxAllowedExcelRows} (${dbUlbCount} DB ULBs × 2).`,
        },
      ];
    }
    if (dto.ulbCount !== excelRowCount) {
      fileLevelErrorMap['ulbCount'] = [
        {
          field: 'ulbCount',
          code: 'mismatch',
          message: `ULB count entered (${dto.ulbCount}) does not match the number of rows in the Excel file (${excelRowCount}).`,
        },
      ];
    }
    if (Object.keys(fileLevelErrorMap).length > 0) {
      throwXviFcValidationError(fileLevelErrorMap);
    }

    // 7. Build DB ULB lookup by censusCode/sbCode
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dbUlbByCode = new Map<string, UlbLean>();
    for (const ulb of dbUlbs) {
      const code = (ulb.censusCode || ulb.sbCode || '').trim().toLowerCase();
      if (code) dbUlbByCode.set(code, ulb);
    }

    // 8. Classify and validate each row
    const processedRows: ProcessedRow[] = [];
    const matchedUlbCodes = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const raw = dataRows[i];
      const parsed = this.parseDataRow(raw, colIndexMap, i + 1);
      const censusCodNorm = parsed.censusCode ? parsed.censusCode.trim().toLowerCase() : '';
      const dbMatch = censusCodNorm ? dbUlbByCode.get(censusCodNorm) : undefined;
      const rowType: 'DB_ULB' | 'EXTRA_ULB' = dbMatch ? 'DB_ULB' : 'EXTRA_ULB';

      if (dbMatch && censusCodNorm) matchedUlbCodes.add(censusCodNorm);

      const rowErrors =
        rowType === 'DB_ULB'
          ? this.eulbValidator.validateDbUlbRow(parsed, dbMatch!, today)
          : this.eulbValidator.validateExtraUlbRow(parsed, today);

      processedRows.push({
        ...parsed,
        rowType,
        ulbId: dbMatch ? dbMatch._id : undefined,
        dbCensusCode: dbMatch ? dbMatch.censusCode || dbMatch.sbCode || undefined : undefined,
        dbUlbName: dbMatch ? dbMatch.name : undefined,
        validationRowStatus: rowErrors.length === 0 ? 'VALID' : 'INVALID',
        rowErrors,
      });
    }

    // 9. Compute summary
    const matchedDbUlbCount = matchedUlbCodes.size;
    const missingDbUlbCount = dbUlbCount - matchedDbUlbCount;
    const extraExcelRowCount = processedRows.filter((r) => r.rowType === 'EXTRA_ULB').length;
    const errorRowCount = processedRows.filter((r) => r.validationRowStatus === 'INVALID').length;

    const formValidationStatus: EulbValidationStatus =
      errorRowCount === 0 && missingDbUlbCount === 0 ? 'VALID' : 'INVALID';

    // 10. Safe replace: insert new rows → update form → delete old rows
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };
    const existing = await this.formModel
      .findOne(filter, { _id: 1, currentFormStatus: 1, activeDatasetVersion: 1 })
      .lean()
      .exec();

    const currentVersion = existing?.activeDatasetVersion ?? 0;
    const newVersion = currentVersion + 1;
    // Pre-generate formId for new forms so rows can reference it before the form document is created
    const formId: Types.ObjectId = existing ? existing._id : new Types.ObjectId();

    // Step A: Insert new rows BEFORE updating form's activeDatasetVersion.
    // If this fails, the form still points to the old version and old rows remain intact.
    const rowDocs = processedRows.map((r) => ({
      form: formId,
      state: stateOid,
      year: yearOid,
      datasetVersion: newVersion,
      rowNumber: r.rowNumber,
      ulbId: r.ulbId,
      censusCode: r.censusCode,
      ulbName: r.ulbName,
      dbCensusCode: r.dbCensusCode,
      dbUlbName: r.dbUlbName,
      electedBodyStatus: r.electedBodyStatus,
      dateOfConstitution: r.dateOfConstitution ? this.toDate(r.dateOfConstitution) : undefined,
      dateOfExpiry: r.dateOfExpiry ? this.toDate(r.dateOfExpiry) : undefined,
      remarks: r.remarks,
      rowType: r.rowType,
      lastUpdatedSource: 'EXCEL' as const,
      validationStatus: r.validationRowStatus,
      errors: r.rowErrors,
      rawExcelData: r.rawExcelData,
      createdBy: userOid,
      updatedBy: userOid,
      isActive: true,
    }));

    await this.rowModel.insertMany(rowDocs);

    // Step B: Upsert form with all summary fields and new activeDatasetVersion.
    const formSummaryFields = {
      ulbCount: dto.ulbCount,
      electedBodyExcelFile: dto.electedBodyExcelFile,
      dbUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      errorRowCount,
      validationStatus: formValidationStatus,
      activeDatasetVersion: newVersion,
      lastExcelUploadedAt: new Date(),
      lastExcelUploadedBy: userOid,
      updatedBy: userOid,
    };

    if (existing) {
      await this.formModel.findByIdAndUpdate(existing._id, { $set: formSummaryFields }).lean().exec();
    } else {
      await this.formModel.create({
        _id: formId,
        state: stateOid,
        year: yearOid,
        formType: EULB_FORM_TYPE,
        currentFormStatus: FORM_STATUS.NOT_STARTED,
        isDraft: true,
        isActive: true,
        isDeleted: false,
        createdBy: userOid,
        ...formSummaryFields,
      });
    }

    // Step C: Hard-delete old rows only after new rows and form summary are saved.
    // Cleanup failure is logged but does not fail the response — old rows are invisible
    // because the rows API queries by activeDatasetVersion = newVersion.
    if (currentVersion > 0) {
      try {
        await this.rowModel.deleteMany({ form: formId, datasetVersion: currentVersion }).exec();
      } catch (err: unknown) {
        this.logger.error(
          `EULB old row cleanup failed [form=${formId.toString()} version=${currentVersion}]`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    // 11. Generate error Excel if there are row errors and upload to S3
    let errorExcelFile: EulbFileRefData | undefined;
    if (errorRowCount > 0) {
      errorExcelFile = await this.generateAndStoreErrorExcel(processedRows, formId, userOid);
    }

    const summary: EulbValidationSummary = {
      dbUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      errorRowCount,
      validationStatus: formValidationStatus,
      activeDatasetVersion: newVersion,
    };

    // Flatten per-row errors into a single array keyed by rowNumber for the response
    const rowErrors: EulbRowValidationError[] = processedRows
      .filter((r) => r.rowErrors.length > 0)
      .flatMap((r) =>
        r.rowErrors.map((e) => ({
          rowNumber: r.rowNumber,
          censusCode: r.censusCode,
          ulbName: r.ulbName,
          field: e.field,
          code: e.code,
          message: e.message,
          value: e.value,
        })),
      );

    const responseData: EulbValidateExcelResponseData = {
      validationStatus: formValidationStatus,
      summary,
      errorExcelFile,
      errors: rowErrors,
    };

    const message =
      formValidationStatus === 'VALID' ? 'Excel validated successfully.' : 'Excel validation completed with errors.';
    return xviFcSuccess(message, responseData);
  }

  async revalidateExcel(
    stateId: string,
    yearId: string,
    dto: { ulbCount: number },
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbRevalidateExcelResponseData>> {
    this.assertStateAccess(user, stateId);
    this.assertEditPermission(user);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);

    const form = await this.formModel
      .findOne({ state: stateOid, year: yearOid, formType: EULB_FORM_TYPE, isDeleted: false })
      .lean()
      .exec();

    if (!form) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }

    assertCanStateEditForm(form.currentFormStatus);

    if (!form.activeDatasetVersion) {
      throw new BadRequestException('No uploaded Excel data found to revalidate.');
    }

    const rows = await this.rowModel
      .find({ form: form._id, datasetVersion: form.activeDatasetVersion })
      .sort({ rowNumber: 1 })
      .lean()
      .exec();

    if (rows.length === 0) {
      throw new BadRequestException('No uploaded Excel data found to revalidate.');
    }

    if (dto.ulbCount !== rows.length) {
      throwXviFcValidationError({
        ulbCount: [
          { field: 'ulbCount', code: 'mismatch', message: 'ULB count must match the uploaded Excel row count.' },
        ],
      });
    }

    const dbUlbs = (await this.ulbModel
      .find({ state: stateOid, isActive: true })
      .select('_id name censusCode sbCode')
      .lean()
      .exec()) as UlbLean[];

    const dbUlbById = new Map<string, UlbLean>();
    for (const ulb of dbUlbs) {
      dbUlbById.set(ulb._id.toString(), ulb);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let errorRowCount = 0;
    let extraExcelRowCount = 0;
    const matchedUlbIds = new Set<string>();
    const flatErrors: EulbRowValidationError[] = [];

    type RowBulkOp = {
      updateOne: {
        filter: { _id: Types.ObjectId };
        update: {
          $set: { errors: EulbRowError[]; validationStatus: EulbRowValidationStatus; updatedBy: Types.ObjectId };
        };
      };
    };
    const bulkOps: RowBulkOp[] = [];

    for (const row of rows) {
      if (row.rowType === 'EXTRA_ULB') extraExcelRowCount++;

      const parsed: ParsedExcelRow = {
        censusCode: row.censusCode,
        ulbName: row.ulbName,
        electedBodyStatus: row.electedBodyStatus,
        dateOfConstitution: row.dateOfConstitution,
        dateOfExpiry: row.dateOfExpiry,
        remarks: row.remarks,
        rowNumber: row.rowNumber,
      };

      let newErrors: EulbRowError[];
      if (row.rowType === 'DB_ULB' && row.ulbId) {
        const ulbIdStr = row.ulbId.toString();
        const dbUlb = dbUlbById.get(ulbIdStr);
        if (dbUlb) {
          matchedUlbIds.add(ulbIdStr);
          newErrors = this.eulbValidator.validateDbUlbRow(parsed, dbUlb, today);
        } else {
          newErrors = this.eulbValidator.validateExtraUlbRow(parsed, today);
        }
      } else {
        newErrors = this.eulbValidator.validateExtraUlbRow(parsed, today);
      }

      const newValidationStatus: EulbRowValidationStatus = newErrors.length === 0 ? 'VALID' : 'INVALID';
      if (newErrors.length > 0) {
        errorRowCount++;
        for (const e of newErrors) {
          flatErrors.push({
            rowNumber: row.rowNumber,
            censusCode: row.censusCode,
            ulbName: row.ulbName,
            field: e.field,
            code: e.code,
            message: e.message,
            value: e.value,
          });
        }
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { errors: newErrors, validationStatus: newValidationStatus, updatedBy: userOid } },
        },
      });
    }

    if (bulkOps.length > 0) {
      await this.rowModel.bulkWrite(bulkOps as unknown as Parameters<typeof this.rowModel.bulkWrite>[0]);
    }

    const dbUlbCount = dbUlbs.length;
    const matchedDbUlbCount = matchedUlbIds.size;
    const missingDbUlbCount = dbUlbCount - matchedDbUlbCount;
    const validationStatus: EulbValidationStatus = errorRowCount === 0 && missingDbUlbCount === 0 ? 'VALID' : 'INVALID';

    await this.formModel
      .findByIdAndUpdate(form._id, {
        $set: {
          dbUlbCount,
          maxAllowedExcelRows: dbUlbCount * 2,
          excelRowCount: rows.length,
          matchedDbUlbCount,
          missingDbUlbCount,
          extraExcelRowCount,
          errorRowCount,
          validationStatus,
          updatedBy: userOid,
        },
      })
      .lean()
      .exec();

    const validationSummary: EulbValidationSummary = {
      dbUlbCount,
      maxAllowedExcelRows: dbUlbCount * 2,
      excelRowCount: rows.length,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      errorRowCount,
      validationStatus,
      activeDatasetVersion: form.activeDatasetVersion,
    };

    const message = errorRowCount > 0 ? 'Excel revalidation completed with errors.' : 'Excel revalidation completed.';
    return xviFcSuccess(message, { validationSummary, errors: flatErrors });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private validateFileMetadata(file: { fileName: string; fileSize: number | null; mimeType?: string }): void {
    const name = file.fileName.toLowerCase();
    const isValidType = name.endsWith('.xlsx') || name.endsWith('.xls');
    if (!isValidType) {
      throwXviFcValidationError({
        electedBodyExcelFile: [
          { field: 'electedBodyExcelFile', code: 'invalidFileType', message: 'Only xlsx and xls files are allowed.' },
        ],
      });
    }
    if (file.fileSize !== null && file.fileSize / (1024 * 1024) > 20) {
      throwXviFcValidationError({
        electedBodyExcelFile: [
          { field: 'electedBodyExcelFile', code: 'maxFileSize', message: 'File must not exceed 20 MB.' },
        ],
      });
    }
  }

  /** Builds a map from column index → normalized camelCase key. */
  private buildColIndexMap(headerRow: string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (let i = 0; i < headerRow.length; i++) {
      const raw = headerRow[i].trim();
      const normalized = EXCEL_HEADER_MAP[raw] ?? raw;
      map.set(normalized, i);
    }
    return map;
  }

  private findMissingRequiredHeaders(colIndexMap: Map<string, number>): string[] {
    const required = ['censusCode', 'ulbName', 'electedBodyStatus', 'dateOfConstitution', 'dateOfExpiry', 'remarks'];
    return required.filter((k) => !colIndexMap.has(k));
  }

  private isEmptyRow(row: unknown[]): boolean {
    return row.every((cell) => cell === '' || cell === null || cell === undefined);
  }

  private parseDataRow(raw: unknown[], colIndexMap: Map<string, number>, rowNumber: number): ParsedExcelRow {
    const get = (key: string): unknown => {
      const idx = colIndexMap.get(key);
      return idx !== undefined ? raw[idx] : undefined;
    };

    const toStr = (v: unknown): string | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v === 'string') return v.trim() || undefined;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim() || undefined;
      return undefined;
    };

    const toDate = (v: unknown): Date | string | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      if (v instanceof Date) return v;
      if (typeof v === 'string') return v.trim() || undefined;
      if (typeof v === 'number') return String(v);
      return undefined;
    };

    return {
      censusCode: toStr(get('censusCode')),
      ulbName: toStr(get('ulbName')) ?? '',
      electedBodyStatus: toStr(get('electedBodyStatus')),
      dateOfConstitution: toDate(get('dateOfConstitution')),
      dateOfExpiry: toDate(get('dateOfExpiry')),
      remarks: toStr(get('remarks')),
      rowNumber,
      rawExcelData: Object.fromEntries([...colIndexMap.entries()].map(([k, idx]) => [k, raw[idx]])) as Record<
        string,
        unknown
      >,
    };
  }

  private toDate(value: Date | string): Date | undefined {
    if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  /**
   * Generates an error Excel with an extra "Errors" column and uploads to S3.
   * Stores the resulting file metadata on the form document as `errorExcelFile`.
   * Returns the file metadata on success, undefined if generation fails (row errors still stored in DB).
   */
  private async generateAndStoreErrorExcel(
    rows: ProcessedRow[],
    formId: Types.ObjectId,
    updatedBy: Types.ObjectId,
  ): Promise<EulbFileRefData | undefined> {
    try {
      const excelRows = rows.map((r) => ({
        censusCode: r.censusCode ?? '',
        ulbName: r.ulbName,
        electedBodyStatus: r.electedBodyStatus ?? '',
        dateOfConstitution:
          r.dateOfConstitution instanceof Date
            ? r.dateOfConstitution.toISOString().split('T')[0]
            : (r.dateOfConstitution ?? ''),
        dateOfExpiry:
          r.dateOfExpiry instanceof Date ? r.dateOfExpiry.toISOString().split('T')[0] : (r.dateOfExpiry ?? ''),
        remarks: r.remarks ?? '',
        errors: r.rowErrors.map((e) => `[${e.field}] ${e.message}`).join('; '),
      }));

      const buffer = await this.excelService.generateExcel(ERROR_EXCEL_HEADERS, excelRows, 'Validation Errors');

      const s3Key = `state/elected-body-error-excels/${formId.toString()}-errors.xlsx`;
      const storageUrl = this.config.get<string>('AWS_STORAGE_URL', '');
      const fileUrl = storageUrl ? `${storageUrl}${s3Key}` : s3Key;

      await this.s3Service.uploadPublic(
        s3Key,
        Buffer.from(buffer as ArrayBuffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const fileRef: EulbFileRefData = {
        fileName: `elected-body-errors-${formId.toString()}.xlsx`,
        fileUrl,
        fileSize: (buffer as ArrayBuffer).byteLength,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        s3Key,
      };

      await this.formModel.findByIdAndUpdate(formId, { $set: { errorExcelFile: fileRef, updatedBy } });

      return fileRef;
    } catch {
      // Error Excel generation failure is non-fatal; row errors are persisted in DB regardless.
      return undefined;
    }
  }

  // ─── Scope enforcement ────────────────────────────────────────────────────────

  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }

  private assertEditPermission(user: AuthUser): void {
    const perms = new Set(getEffectivePermissions(user));
    if (!perms.has(Permission.EDIT_STATE_FORMS)) {
      throw new ForbiddenException('You do not have permission to validate Excel files.');
    }
  }
}
