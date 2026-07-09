import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { S3Service } from 'src/core/s3/s3.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { assertCanStateEditForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import {
  throwXviFcValidationError,
  throwXviFcValidationErrorWithData,
  xviFcSuccess,
} from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
  EulbValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
  EulbRowError,
  EulbRowValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  EXCEL_HEADER_MAP,
  ERROR_EXCEL_HEADERS,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import type { ValidateElectedUrbanLocalBodiesExcelDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/validate-elected-urban-local-bodies-excel.dto';
import {
  ElectedUrbanLocalBodiesValidator,
  ParsedExcelRow,
  extractDateConfig,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type {
  EulbFileRefData,
  EulbRevalidateExcelResponseData,
  EulbRowValidationError,
  EulbValidateExcelResponseData,
  EulbValidationSummary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

interface UlbLean {
  _id: Types.ObjectId;
  name: string;
  censusCode?: string | number | null;
  sbCode?: string | number | null;
}

interface ProcessedRow extends ParsedExcelRow {
  rowType: 'DB_ULB' | 'EXTRA_ULB';
  ulbId?: Types.ObjectId;
  dbCensusCode?: string;
  dbUlbName?: string;
  validationRowStatus: 'VALID' | 'INVALID';
  rowErrors: Array<{ field: string; code: string; message: string; value?: unknown }>;
}

const DUPLICATE_CENSUS_CODE_MESSAGE = 'A ULB with this census code already exists for the selected design year.';
const UNKNOWN_ULB_MESSAGE = 'This ULB is not registered in City Finance. Please register the ULB before uploading.';

function hasDuplicateCensusCodeError(row: ProcessedRow): boolean {
  return row.rowErrors.some((e) => e.code === 'duplicate' && e.field === 'censusCode');
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && Reflect.get(err, 'code') === 11000;
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
    private readonly fileTokenService: FileTokenService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
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

    // 1. Normalize file URL to permanent S3 path (FE may echo back a signed URL)
    const normalizedFile = {
      ...dto.electedBodyExcelFile,
      fileUrl: this.toRawStoragePath(dto.electedBodyExcelFile.fileUrl),
    };

    // 2. File metadata validation
    this.validateFileMetadata(normalizedFile);

    // 3. Load active DB ULBs + check for existing form in parallel (no mutual dependency)
    const formFilter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };
    const [dbUlbsRaw, existing] = await Promise.all([
      this.ulbModel.find({ state: stateOid, isActive: true }).select('_id name censusCode sbCode').lean().exec(),
      this.formModel.findOne(formFilter, { _id: 1, currentFormStatus: 1, activeDatasetVersion: 1 }).lean().exec(),
    ]);
    const dbUlbs = dbUlbsRaw as UlbLean[];

    // Derive count from already-loaded list — no extra query.
    const computedActiveUlbCount = dbUlbs.length;
    const maxAllowedExcelRows = computedActiveUlbCount * 2; // catastrophic safety-net only
    const currentVersion = existing?.activeDatasetVersion ?? 0;
    const newVersion = currentVersion + 1;
    const formId: Types.ObjectId = existing ? existing._id : new Types.ObjectId();

    // 4. Read and parse Excel from S3 (use normalized path)
    const buffer = await this.s3Service.getBuffer(normalizedFile.fileUrl);
    // cellDates:false (the default) keeps date cells as their raw Excel serial numbers.
    // We convert serials to UTC midnight directly via excelSerialToUtcDate(), which avoids
    // the timezone-shift that cellDates:true introduces when creating JS Date objects.
    const workbook = XLSX.read(buffer, { type: 'buffer' });
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
          { field: 'electedBodyExcelFile', code: 'emptySheet', message: 'The uploaded Excel file has no data rows.' },
        ],
      });
    }

    // 5. Parse and normalize headers
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

    // 6. Parse data rows (skip empty rows)
    const dataRows = rawRows.slice(1).filter((row) => !this.isEmptyRow(row));
    const excelRowCount = dataRows.length;

    // 7. tooManyRows — catastrophic early abort to prevent processing enormous files.
    //    Row-level EXTRA_ULB blocking handles the business-rule enforcement below.
    if (excelRowCount > maxAllowedExcelRows) {
      throwXviFcValidationError({
        electedBodyExcelFile: [
          {
            field: 'electedBodyExcelFile',
            code: 'tooManyRows',
            message: `Excel has ${excelRowCount} rows, maximum allowed is ${maxAllowedExcelRows} (${computedActiveUlbCount} active ULBs x 2).`,
          },
        ],
      });
    }

    // 8. Build DB ULB lookup by censusCode/sbCode (safe normalization — values may be numbers)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const excelFormJsonFields = await this.eulbFormJsonConfig.loadFields(dto.yearId);
    const excelRowEditFields = getFieldsByType(excelFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const excelDateConfig = extractDateConfig(excelRowEditFields);

    const dbUlbByCode = new Map<string, UlbLean>();
    for (const ulb of dbUlbs) {
      const code = String(ulb.censusCode ?? ulb.sbCode ?? '')
        .trim()
        .toLowerCase();
      if (code) dbUlbByCode.set(code, ulb);
    }

    // 9. Classify and validate each row
    const processedRows: ProcessedRow[] = [];
    const matchedUlbCodes = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const raw = dataRows[i];
      const parsed = this.parseDataRow(raw, colIndexMap, i + 1);
      const censusCodNorm = parsed.censusCode ? parsed.censusCode.trim().toLowerCase() : '';
      const dbMatch = censusCodNorm ? dbUlbByCode.get(censusCodNorm) : undefined;
      const rowType: 'DB_ULB' | 'EXTRA_ULB' = dbMatch ? 'DB_ULB' : 'EXTRA_ULB';

      if (dbMatch && censusCodNorm) matchedUlbCodes.add(censusCodNorm);

      // EXTRA_ULB rows receive the unknownUlb error to flag non-registry rows explicitly.
      const rowErrors =
        rowType === 'DB_ULB'
          ? this.eulbValidator.validateDbUlbRow(parsed, dbMatch!, today, excelDateConfig)
          : [
              { field: 'censusCode', code: 'unknownUlb', message: UNKNOWN_ULB_MESSAGE },
              ...this.eulbValidator.validateExtraUlbRow(parsed, today, excelDateConfig),
            ];

      processedRows.push({
        ...parsed,
        rowType,
        ulbId: dbMatch ? dbMatch._id : undefined,
        dbCensusCode: dbMatch ? String(dbMatch.censusCode ?? dbMatch.sbCode ?? '') || undefined : undefined,
        dbUlbName: dbMatch ? dbMatch.name : undefined,
        validationRowStatus: rowErrors.length === 0 ? 'VALID' : 'INVALID',
        rowErrors,
      });
    }

    // 9a. Intra-batch duplicate EULB census code check.
    // The second (and later) occurrences are flagged INVALID and stored with censusCode:'' so
    // the active year+censusCode unique index is not violated at insertMany time.
    this.flagIntraBatchEulbCensusCodeDuplicates(processedRows);

    // 9b. Build row documents for DB insert (formId and newVersion known since step 3).
    // lean:true bypasses Mongoose document validation — rows are pre-validated at application
    // level and may intentionally have blank identity fields (stored as INVALID).
    // rawExcelData is only kept for INVALID rows where it may be needed for error display.
    const rowDocs = processedRows.map((r) => {
      const constituted = r.electedBodyStatus?.trim() === 'Constituted';
      return {
        form: formId,
        state: stateOid,
        year: yearOid,
        datasetVersion: newVersion,
        rowNumber: r.rowNumber,
        ulbId: r.ulbId,
        // Trim and clear duplicate rows so the unique partial index is not violated.
        censusCode: hasDuplicateCensusCodeError(r) ? '' : (r.censusCode ?? '').trim(),
        ulbName: r.ulbName,
        dbCensusCode: r.dbCensusCode,
        dbUlbName: r.dbUlbName,
        electedBodyStatus: r.electedBodyStatus,
        dateOfConstitution: constituted && r.dateOfConstitution ? this.toDate(r.dateOfConstitution) : null,
        dateOfExpiry: constituted && r.dateOfExpiry ? this.toDate(r.dateOfExpiry) : null,
        remarks: r.remarks,
        rowType: r.rowType,
        lastUpdatedSource: 'EXCEL' as const,
        validationStatus: r.validationRowStatus,
        errors: r.rowErrors,
        rawExcelData: r.validationRowStatus === 'INVALID' ? r.rawExcelData : undefined,
        createdBy: userOid,
        updatedBy: userOid,
        isActive: true,
      };
    });

    // 10. Compute summary
    const matchedDbUlbCount = matchedUlbCodes.size;
    const missingDbUlbCount = computedActiveUlbCount - matchedDbUlbCount;
    const extraExcelRowCount = processedRows.filter((r) => r.rowType === 'EXTRA_ULB').length;
    const errorRowCount = processedRows.filter((r) => r.validationRowStatus === 'INVALID').length;

    // Form validation is VALID only when there are no row errors, no missing registry ULBs,
    // no extra (unregistered) rows, and the Excel row count exactly matches the active registry.
    const formValidationStatus: EulbValidationStatus =
      errorRowCount === 0 &&
      missingDbUlbCount === 0 &&
      extraExcelRowCount === 0 &&
      excelRowCount === computedActiveUlbCount
        ? 'VALID'
        : 'INVALID';

    // 11. Safe replace: deactivate old rows → insert new rows → upsert form → delete old rows
    let previousRowsDeactivated = false;
    try {
      if (currentVersion > 0) {
        await this.rowModel
          .updateMany({ form: formId, datasetVersion: currentVersion }, { $set: { isActive: false } })
          .exec();
        previousRowsDeactivated = true;
      }

      // Step A: ordered:false lets MongoDB parallelise BTree index updates internally.
      // Safe because 9a already guarantees no duplicate censusCode values in rowDocs.
      await this.rowModel.insertMany(rowDocs, { lean: true, ordered: false });

      // Step B: Upsert form with all summary fields, normalized file, and new activeDatasetVersion.
      // ulbCount is NOT persisted from the client — it is managed via the active ULB registry.
      const formSummaryFields = {
        electedBodyExcelFile: normalizedFile,
        dbUlbCount: computedActiveUlbCount,
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

      // Step C: fire-and-forget — old rows already inactive, cleanup runs async
      if (currentVersion > 0) {
        void this.deletePreviousDatasetRows(formId, currentVersion);
      }
    } catch (err: unknown) {
      if (previousRowsDeactivated) {
        await this.rollbackDatasetReplacement(formId, currentVersion, newVersion);
      }
      if (isMongoDuplicateKeyError(err)) {
        this.throwDuplicateCensusCodeValidationError();
      }
      throw err;
    }

    // 12. Generate error Excel if there are row errors
    let errorExcelFile: EulbFileRefData | undefined;
    if (errorRowCount > 0) {
      errorExcelFile = await this.generateAndStoreErrorExcel(processedRows, formId, userOid);
    }

    // 13. Build validation summary and row errors for response
    const summary: EulbValidationSummary = {
      dbUlbCount: computedActiveUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      errorRowCount,
      validationStatus: formValidationStatus,
      activeDatasetVersion: newVersion,
    };

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

    // 14. Extra rows: throw 400 with field-keyed error and include summary data so the
    //     frontend can still display the validation state. Data was already written to DB.
    if (extraExcelRowCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'newUlbsAdded',
              message: `You have added ${extraExcelRowCount} ULB(s) not registered in City Finance. Please register before proceeding.`,
            },
          ],
        },
        { validationSummary: summary, errors: rowErrors },
      );
    }

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

    // Case A: active rows already exist — revalidate in place
    if (form.activeDatasetVersion > 0) {
      const rows = await this.rowModel
        .find({ form: form._id, datasetVersion: form.activeDatasetVersion })
        .sort({ rowNumber: 1 })
        .lean()
        .exec();

      if (rows.length > 0) {
        // Load active registry ULBs for revalidation; derive count from the find result.
        // TODO: Add date of constitution check.
        const dbUlbs = (await this.ulbModel
          .find({ state: stateOid, isActive: true })
          .select('_id name censusCode sbCode')
          .lean()
          .exec()) as UlbLean[];

        const computedActiveUlbCount = dbUlbs.length;

        const dbUlbById = new Map<string, UlbLean>();
        for (const ulb of dbUlbs) {
          dbUlbById.set(ulb._id.toString(), ulb);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const revalFormJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
        const revalRowEditFields = getFieldsByType(revalFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
        const revalDateConfig = extractDateConfig(revalRowEditFields);

        let errorRowCount = 0;
        let extraExcelRowCount = 0;
        const matchedUlbIds = new Set<string>();
        const flatErrors: EulbRowValidationError[] = [];

        type RowBulkOpSet = {
          errors: EulbRowError[];
          validationStatus: EulbRowValidationStatus;
          updatedBy: Types.ObjectId;
          dateOfConstitution?: Date | null;
          dateOfExpiry?: Date | null;
        };
        type RowBulkOp = {
          updateOne: {
            filter: { _id: Types.ObjectId };
            update: { $set: RowBulkOpSet };
          };
        };
        const bulkOps: RowBulkOp[] = [];

        for (const row of rows) {
          let newErrors: EulbRowError[];

          if (row.rowType === 'EXTRA_ULB') {
            // EXTRA_ULB rows are always invalid — they reference unregistered ULBs.
            extraExcelRowCount++;
            const parsed: ParsedExcelRow = {
              censusCode: row.censusCode,
              ulbName: row.ulbName,
              electedBodyStatus: row.electedBodyStatus,
              dateOfConstitution: row.dateOfConstitution,
              dateOfExpiry: row.dateOfExpiry,
              remarks: row.remarks,
              rowNumber: row.rowNumber,
            };
            newErrors = [
              { field: 'censusCode', code: 'unknownUlb', message: UNKNOWN_ULB_MESSAGE },
              ...this.eulbValidator.validateExtraUlbRow(parsed, today, revalDateConfig),
            ];
          } else {
            const parsed: ParsedExcelRow = {
              censusCode: row.censusCode,
              ulbName: row.ulbName,
              electedBodyStatus: row.electedBodyStatus,
              dateOfConstitution: row.dateOfConstitution,
              dateOfExpiry: row.dateOfExpiry,
              remarks: row.remarks,
              rowNumber: row.rowNumber,
            };

            if (row.ulbId) {
              const ulbIdStr = row.ulbId.toString();
              const dbUlb = dbUlbById.get(ulbIdStr);
              if (dbUlb) {
                matchedUlbIds.add(ulbIdStr);
                newErrors = this.eulbValidator.validateDbUlbRow(parsed, dbUlb, today, revalDateConfig);
              } else {
                // DB_ULB whose registry entry was removed — treat as extra.
                newErrors = [
                  { field: 'censusCode', code: 'unknownUlb', message: UNKNOWN_ULB_MESSAGE },
                  ...this.eulbValidator.validateExtraUlbRow(parsed, today, revalDateConfig),
                ];
              }
            } else {
              newErrors = this.eulbValidator.validateExtraUlbRow(parsed, today, revalDateConfig);
            }
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

          const rowSetFields: RowBulkOpSet = {
            errors: newErrors,
            validationStatus: newValidationStatus,
            updatedBy: userOid,
          };
          if (row.electedBodyStatus?.trim() !== 'Constituted') {
            rowSetFields.dateOfConstitution = null;
            rowSetFields.dateOfExpiry = null;
          }

          bulkOps.push({
            updateOne: {
              filter: { _id: row._id },
              update: { $set: rowSetFields },
            },
          });
        }

        if (bulkOps.length > 0) {
          await this.rowModel.bulkWrite(bulkOps as unknown as Parameters<typeof this.rowModel.bulkWrite>[0]);
        }

        const matchedDbUlbCount = matchedUlbIds.size;
        const missingDbUlbCount = computedActiveUlbCount - matchedDbUlbCount;
        const validationStatus: EulbValidationStatus =
          errorRowCount === 0 &&
          missingDbUlbCount === 0 &&
          extraExcelRowCount === 0 &&
          rows.length === computedActiveUlbCount
            ? 'VALID'
            : 'INVALID';

        await this.formModel
          .findByIdAndUpdate(form._id, {
            $set: {
              dbUlbCount: computedActiveUlbCount,
              maxAllowedExcelRows: computedActiveUlbCount * 2,
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
          dbUlbCount: computedActiveUlbCount,
          maxAllowedExcelRows: computedActiveUlbCount * 2,
          excelRowCount: rows.length,
          matchedDbUlbCount,
          missingDbUlbCount,
          extraExcelRowCount,
          errorRowCount,
          validationStatus,
          activeDatasetVersion: form.activeDatasetVersion,
        };

        // Extra rows block revalidation with the same field-keyed error as validateExcel.
        if (extraExcelRowCount > 0) {
          throwXviFcValidationErrorWithData(
            {
              electedBodyExcelFile: [
                {
                  field: 'electedBodyExcelFile',
                  code: 'newUlbsAdded',
                  message: `You have added ${extraExcelRowCount} ULB(s) not registered in City Finance. Please register before proceeding.`,
                },
              ],
            },
            { validationSummary, errors: flatErrors },
          );
        }

        const message =
          errorRowCount > 0 ? 'Excel revalidation completed with errors.' : 'Excel revalidation completed.';
        return xviFcSuccess(message, { validationSummary, errors: flatErrors });
      }
    }

    // Case B: no active rows, but uploaded file exists — re-parse and create rows
    const storedFileUrl = (form.electedBodyExcelFile as { fileUrl?: string } | undefined)?.fileUrl;
    if (!storedFileUrl) {
      throw new BadRequestException('No uploaded Excel data found to revalidate.');
    }

    return this.revalidateFromStoredFile(form, storedFileUrl, userOid, stateOid, yearOid, yearId);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Re-parses the uploaded Excel from its stored S3 path, creates a new row dataset,
   * and updates the form summary. Used when Case A revalidation is unavailable.
   * The client-submitted ulbCount is ignored; active ULB count is derived from the find result.
   */
  private async revalidateFromStoredFile(
    form: { _id: Types.ObjectId; activeDatasetVersion?: number; currentFormStatus?: number },
    fileUrl: string,
    userOid: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    yearId: string,
  ): Promise<XviFcApiResponse<EulbRevalidateExcelResponseData>> {
    // Load active registry ULBs; derive count from the find result — no extra query.
    const dbUlbs = (await this.ulbModel
      .find({ state: stateOid, isActive: true })
      .select('_id name censusCode sbCode')
      .lean()
      .exec()) as UlbLean[];

    const computedActiveUlbCount = dbUlbs.length;
    const maxAllowedExcelRows = computedActiveUlbCount * 2;

    const buffer = await this.s3Service.getBuffer(fileUrl);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('The uploaded Excel file has no sheets. Please re-upload the file.');
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

    if (rawRows.length < 2) {
      throw new BadRequestException('The uploaded Excel file has no data rows. Please re-upload the file.');
    }

    const headerRow = (rawRows[0] as string[]).map((h) => String(h).trim());
    const colIndexMap = this.buildColIndexMap(headerRow);
    const missingHeaders = this.findMissingRequiredHeaders(colIndexMap);
    if (missingHeaders.length > 0) {
      throw new BadRequestException(
        `Missing required Excel columns: ${missingHeaders.join(', ')}. Please re-upload the file.`,
      );
    }

    const dataRows = rawRows.slice(1).filter((row) => !this.isEmptyRow(row));
    const excelRowCount = dataRows.length;

    if (excelRowCount > maxAllowedExcelRows) {
      throw new BadRequestException(
        `Excel has ${excelRowCount} rows, maximum allowed is ${maxAllowedExcelRows}. Please re-upload a corrected file.`,
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const storedFileFormJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
    const storedFileRowEditFields = getFieldsByType(storedFileFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const storedFileDateConfig = extractDateConfig(storedFileRowEditFields);

    const dbUlbByCode = new Map<string, UlbLean>();
    for (const ulb of dbUlbs) {
      const code = String(ulb.censusCode ?? ulb.sbCode ?? '')
        .trim()
        .toLowerCase();
      if (code) dbUlbByCode.set(code, ulb);
    }

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
          ? this.eulbValidator.validateDbUlbRow(parsed, dbMatch!, today, storedFileDateConfig)
          : [
              { field: 'censusCode', code: 'unknownUlb', message: UNKNOWN_ULB_MESSAGE },
              ...this.eulbValidator.validateExtraUlbRow(parsed, today, storedFileDateConfig),
            ];

      processedRows.push({
        ...parsed,
        rowType,
        ulbId: dbMatch ? dbMatch._id : undefined,
        dbCensusCode: dbMatch ? String(dbMatch.censusCode ?? dbMatch.sbCode ?? '') || undefined : undefined,
        dbUlbName: dbMatch ? dbMatch.name : undefined,
        validationRowStatus: rowErrors.length === 0 ? 'VALID' : 'INVALID',
        rowErrors,
      });
    }

    // Intra-batch duplicate EULB census code check (same logic as validateExcel).
    this.flagIntraBatchEulbCensusCodeDuplicates(processedRows);

    const matchedDbUlbCount = matchedUlbCodes.size;
    const missingDbUlbCount = computedActiveUlbCount - matchedDbUlbCount;
    const extraExcelRowCount = processedRows.filter((r) => r.rowType === 'EXTRA_ULB').length;
    const errorRowCount = processedRows.filter((r) => r.validationRowStatus === 'INVALID').length;
    const validationStatus: EulbValidationStatus =
      errorRowCount === 0 &&
      missingDbUlbCount === 0 &&
      extraExcelRowCount === 0 &&
      excelRowCount === computedActiveUlbCount
        ? 'VALID'
        : 'INVALID';

    const currentVersion = form.activeDatasetVersion ?? 0;
    const newVersion = currentVersion + 1;
    const formId = form._id;

    // Same normalization as validateExcel: lean:true bypasses Mongoose required-String check
    // for '' so INVALID rows with blank identity fields are stored without throwing.
    const rowDocs = processedRows.map((r) => {
      const constituted = r.electedBodyStatus?.trim() === 'Constituted';
      return {
        form: formId,
        state: stateOid,
        year: yearOid,
        datasetVersion: newVersion,
        rowNumber: r.rowNumber,
        ulbId: r.ulbId,
        censusCode: hasDuplicateCensusCodeError(r) ? '' : (r.censusCode ?? '').trim(),
        ulbName: r.ulbName,
        dbCensusCode: r.dbCensusCode,
        dbUlbName: r.dbUlbName,
        electedBodyStatus: r.electedBodyStatus,
        dateOfConstitution: constituted && r.dateOfConstitution ? this.toDate(r.dateOfConstitution) : null,
        dateOfExpiry: constituted && r.dateOfExpiry ? this.toDate(r.dateOfExpiry) : null,
        remarks: r.remarks,
        rowType: r.rowType,
        lastUpdatedSource: 'EXCEL' as const,
        validationStatus: r.validationRowStatus,
        errors: r.rowErrors,
        rawExcelData: r.rawExcelData,
        createdBy: userOid,
        updatedBy: userOid,
        isActive: true,
      };
    });

    let previousRowsDeactivated = false;
    try {
      if (currentVersion > 0) {
        await this.rowModel
          .updateMany({ form: formId, datasetVersion: currentVersion }, { $set: { isActive: false } })
          .exec();
        previousRowsDeactivated = true;
      }

      await this.rowModel.insertMany(rowDocs, { lean: true });

      await this.formModel
        .findByIdAndUpdate(formId, {
          $set: {
            dbUlbCount: computedActiveUlbCount,
            maxAllowedExcelRows,
            excelRowCount,
            matchedDbUlbCount,
            missingDbUlbCount,
            extraExcelRowCount,
            errorRowCount,
            validationStatus,
            activeDatasetVersion: newVersion,
            updatedBy: userOid,
          },
        })
        .lean()
        .exec();

      if (currentVersion > 0) {
        await this.deletePreviousDatasetRows(formId, currentVersion);
      }
    } catch (err: unknown) {
      if (previousRowsDeactivated) {
        await this.rollbackDatasetReplacement(formId, currentVersion, newVersion);
      }
      if (isMongoDuplicateKeyError(err)) {
        this.throwDuplicateCensusCodeValidationError();
      }
      throw err;
    }

    const flatErrors: EulbRowValidationError[] = processedRows
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

    const validationSummary: EulbValidationSummary = {
      dbUlbCount: computedActiveUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      errorRowCount,
      validationStatus,
      activeDatasetVersion: newVersion,
    };

    // Extra rows block with the same field-keyed error as validateExcel.
    if (extraExcelRowCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'newUlbsAdded',
              message: `You have added ${extraExcelRowCount} ULB(s) not registered in City Finance. Please register before proceeding.`,
            },
          ],
        },
        { validationSummary, errors: flatErrors },
      );
    }

    const message = errorRowCount > 0 ? 'Excel revalidation completed with errors.' : 'Excel revalidation completed.';
    return xviFcSuccess(message, { validationSummary, errors: flatErrors });
  }

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

  /** Builds a map from normalized camelCase key → column index. */
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
      if (typeof v === 'number') {
        // xlsx (cellDates:false default) returns date cells as raw Excel serial integers.
        // Convert directly to UTC midnight — no timezone arithmetic involved.
        return this.excelSerialToUtcDate(v);
      }
      if (v instanceof Date) {
        // Defensive fallback: should not occur with cellDates:false, but if a Date somehow
        // arrives (e.g. programmatic row injection in tests), normalise via UTC getters.
        if (isNaN(v.getTime())) return undefined;
        return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 0, 0, 0, 0));
      }
      if (typeof v === 'string') return v.trim() || undefined;
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

  // Converts an Excel date serial integer directly to UTC midnight — no timezone involved.
  // Excel epoch: serial 1 = Jan 1 1900. Anchored at Dec 30, 1899 (serial 0) as Date.UTC.
  private excelSerialToUtcDate(serial: number): Date {
    const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
    return new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86400000);
  }

  // Normalises any Date or string value to UTC midnight before persisting.
  // Inputs are always UTC midnight Dates (produced by excelSerialToUtcDate) or ISO strings
  // from the portal. Uses UTC getters so the result is timezone-independent.
  private toDate(value: Date | string): Date | undefined {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return undefined;
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return undefined;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  }

  /**
   * If `fileUrl` is a signed download URL echoed back by the FE, decodes the token to recover
   * the original S3-relative path. Passes through raw S3 paths unchanged.
   */
  private toRawStoragePath(fileUrl: string): string {
    if (!fileUrl) return fileUrl;
    const baseUrl = this.config.get<string>('BASE_URL', '');
    const signedPrefix = `${baseUrl}file/download?signature=`;
    if (!fileUrl.startsWith(signedPrefix)) return fileUrl;
    const token = fileUrl.slice(signedPrefix.length);
    let decoded: { path: string };
    try {
      decoded = this.fileTokenService.parseToken(token);
    } catch {
      throw new BadRequestException('The file URL has expired. Please reload the page and try again.');
    }
    const storageUrl = this.config.get<string>('AWS_STORAGE_URL', '');
    return storageUrl && decoded.path.startsWith(storageUrl) ? decoded.path.slice(storageUrl.length) : decoded.path;
  }

  /**
   * Generates an error Excel with an extra "Errors" column and uploads to S3.
   * Stores the resulting file metadata on the form document as `errorExcelFile`.
   * Returns the file metadata on success, undefined if generation fails.
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

      await this.s3Service.uploadPrivate(
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

  /**
   * Marks duplicate census codes within a single batch as INVALID.
   * The second (and later) occurrence of each non-empty census code gets a `duplicate` error
   * added to its `rowErrors` array and has `validationRowStatus` flipped to INVALID.
   * The caller stores those rows with censusCode:'' to satisfy the unique partial index.
   */
  private flagIntraBatchEulbCensusCodeDuplicates(rows: ProcessedRow[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      const cc = row.censusCode ? row.censusCode.trim().toLowerCase() : '';
      if (!cc) continue;
      if (seen.has(cc)) {
        row.rowErrors.push({
          field: 'censusCode',
          code: 'duplicate',
          message: DUPLICATE_CENSUS_CODE_MESSAGE,
        });
        row.validationRowStatus = 'INVALID';
        row.ulbId = undefined;
      } else {
        seen.add(cc);
      }
    }
  }

  private async deletePreviousDatasetRows(formId: Types.ObjectId, datasetVersion: number): Promise<void> {
    try {
      await this.rowModel.deleteMany({ form: formId, datasetVersion }).exec();
    } catch (deleteErr: unknown) {
      this.logger.error(
        `EULB old row cleanup failed [form=${formId.toString()} version=${datasetVersion}]`,
        deleteErr instanceof Error ? deleteErr.stack : String(deleteErr),
      );
    }
  }

  private async rollbackDatasetReplacement(
    formId: Types.ObjectId,
    previousDatasetVersion: number,
    newDatasetVersion: number,
  ): Promise<void> {
    try {
      await this.rowModel.deleteMany({ form: formId, datasetVersion: newDatasetVersion }).exec();
    } catch (deleteErr: unknown) {
      this.logger.error(
        `EULB new row rollback failed [form=${formId.toString()} version=${newDatasetVersion}]`,
        deleteErr instanceof Error ? deleteErr.stack : String(deleteErr),
      );
    }
    await this.restorePreviousDatasetRows(formId, previousDatasetVersion);
  }

  private async restorePreviousDatasetRows(formId: Types.ObjectId, datasetVersion: number): Promise<void> {
    try {
      await this.rowModel.updateMany({ form: formId, datasetVersion }, { $set: { isActive: true } }).exec();
    } catch (restoreErr: unknown) {
      this.logger.error(
        `EULB previous row reactivation failed [form=${formId.toString()} version=${datasetVersion}]`,
        restoreErr instanceof Error ? restoreErr.stack : String(restoreErr),
      );
    }
  }

  private throwDuplicateCensusCodeValidationError(): never {
    throwXviFcValidationError({
      censusCode: [
        {
          field: 'censusCode',
          code: 'duplicate',
          message: DUPLICATE_CENSUS_CODE_MESSAGE,
        },
      ],
    });
  }
}
