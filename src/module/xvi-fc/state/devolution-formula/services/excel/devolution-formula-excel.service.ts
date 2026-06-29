import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { S3Service } from 'src/core/s3/s3.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { assertCanStateEditForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  throwXviFcValidationError,
  throwXviFcValidationErrorWithData,
  xviFcSuccess,
} from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  DF_ALLOWED_FILE_EXTENSIONS,
  DF_ALLOWED_MIME_TYPES,
  DF_ERROR_EXCEL_HEADERS,
  DF_EXCEL_HEADER_MAP,
  DF_FOLDER_PATH_ERROR_SHEETS,
  DF_MAX_FILE_SIZE_BYTES,
  DF_TEMPLATE_HEADERS,
  type DfInstallment,
} from '../../constants/devolution-formula.constants';
import type { ValidateExcelDevolutionFormulaDto } from '../../dto/validate-excel-devolution-formula.dto';
import type {
  DfFileRefData,
  DfFormLeanDoc,
  DfRevalidateExcelResponseData,
  DfRowError,
  DfRowValidationError,
  DfValidateExcelResponseData,
} from '../../types/devolution-formula.types';
import { DevolutionFormulaValidator, type DfParsedExcelRow } from '../../validators/devolution-formula.validator';
import { DevolutionFormulaService } from '../main/devolution-formula.service';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';

interface UlbLean {
  _id: Types.ObjectId;
  name: string;
  censusCode?: string | number | null;
  sbCode?: string | number | null;
}

interface ProcessedRow {
  rowNumber: number;
  censusCode: string;
  sbCode: string;
  ulbName: string;
  totalGrantAllocation: unknown;
  installment1Amount: unknown;
  installment2Amount: unknown;
  devolutionFormula: string;
  ulbId: Types.ObjectId | null;
  validationRowStatus: 'VALID' | 'INVALID';
  rowErrors: DfRowError[];
  rawExcelData: Record<string, unknown>;
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && Reflect.get(err, 'code') === 11000;
}

function normalizeIdentifier(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

@Injectable()
export class DevolutionFormulaExcelService {
  private readonly logger = new Logger(DevolutionFormulaExcelService.name);

  constructor(
    @InjectModel(DevolutionFormulaForm.name)
    private readonly formModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly rowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly s3Service: S3Service,
    private readonly excelService: ExcelService,
    private readonly dfValidator: DevolutionFormulaValidator,
    private readonly dfService: DevolutionFormulaService,
    private readonly fileTokenService: FileTokenService,
    private readonly fileUrlNormalizer: FileUrlNormalizerService,
  ) {}

  async validateExcel(
    dto: ValidateExcelDevolutionFormulaDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DfValidateExcelResponseData>> {
    this.assertStateAccess(user, dto.stateId);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    // 1. Normalize file URL → raw S3 path
    const normalizedFile: DfFileRefData = {
      ...dto.excelFile,
      fileUrl: this.fileUrlNormalizer.toRawStoragePath(dto.excelFile.fileUrl),
    };

    // 2. File metadata validation
    this.validateFileMetadata(normalizedFile);

    // 3. Load grant allocation, existing form, and DB ULBs in parallel
    const formFilter = { state: stateOid, year: yearOid, installment: dto.installment };
    const [grantAlloc, dbUlbsRaw, existing] = await Promise.all([
      this.dfService.resolveGrantAllocation(stateOid, yearOid),
      this.ulbModel.find({ state: stateOid, isActive: true }).select('_id name censusCode sbCode').lean().exec(),
      this.formModel.findOne(formFilter, { _id: 1, currentFormStatus: 1, activeDatasetVersion: 1 }).lean().exec(),
    ]);

    const existingDoc = existing as (Record<string, unknown> & { _id: Types.ObjectId }) | null;

    if (existingDoc) {
      assertCanStateEditForm((existingDoc['currentFormStatus'] as number | undefined) ?? FORM_STATUS.NOT_STARTED);
    }

    const dbUlbs = dbUlbsRaw as UlbLean[];
    const totalMoHUAAllocation = grantAlloc.basic + grantAlloc.performance;

    const currentVersion = (existingDoc?.['activeDatasetVersion'] as number | undefined) ?? 0;
    const newVersion = currentVersion + 1;
    const formId: Types.ObjectId = existingDoc ? existingDoc._id : new Types.ObjectId();

    // 4. Read and parse Excel from S3
    const buffer = await this.s3Service.getBuffer(normalizedFile.fileUrl);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throwXviFcValidationError({
        excelFile: [{ field: 'excelFile', code: 'emptyWorkbook', message: 'The uploaded Excel file has no sheets.' }],
      });
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

    if (rawRows.length < 2) {
      throwXviFcValidationError({
        excelFile: [{ field: 'excelFile', code: 'emptySheet', message: 'The uploaded Excel file has no data rows.' }],
      });
    }

    // 5. Parse and normalize headers
    const headerRow = (rawRows[0] as string[]).map((h) => String(h).trim());
    const colIndexMap = this.buildColIndexMap(headerRow);
    const missingHeaders = this.findMissingRequiredHeaders(headerRow);
    if (missingHeaders.length > 0) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'missingHeaders',
            message: `Missing required columns: ${missingHeaders.join(', ')}.`,
          },
        ],
      });
    }

    // 6. Parse data rows (skip empty rows)
    const dataRows = rawRows.slice(1).filter((row) => !this.isEmptyRow(row));
    const excelRowCount = dataRows.length;

    // 7. Build ULB lookup maps (both identifiers, lower-cased)
    const ulbByCensusCode = new Map<string, UlbLean>();
    const ulbBySbCode = new Map<string, UlbLean>();
    for (const ulb of dbUlbs) {
      const cc = normalizeIdentifier(ulb.censusCode).toLowerCase();
      const sb = normalizeIdentifier(ulb.sbCode).toLowerCase();
      if (cc) ulbByCensusCode.set(cc, ulb);
      if (sb) ulbBySbCode.set(sb, ulb);
    }

    // 8. Classify and validate each row
    const processedRows: ProcessedRow[] = [];
    const matchedUlbIds = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const raw = dataRows[i];
      const parsed = this.parseDataRow(raw, colIndexMap, i + 1);

      const ccNorm = parsed.censusCode.toLowerCase();
      const sbNorm = parsed.sbCode.toLowerCase();
      const hasCensusCode = ccNorm.length > 0;
      const hasSbCode = sbNorm.length > 0;

      let rowErrors: DfRowError[] = [];
      let resolvedUlbId: Types.ObjectId | null = null;

      // Step 1: Registry check — must have exactly one usable identifier
      if (!hasCensusCode && !hasSbCode) {
        rowErrors.push({
          field: 'censusCode',
          code: 'identifierMissing',
          message: 'Each row must have either a Census Code or an SB Code.',
        });
      } else {
        const dbUlb = hasCensusCode
          ? (ulbByCensusCode.get(ccNorm) ?? (hasSbCode ? ulbBySbCode.get(sbNorm) : undefined))
          : ulbBySbCode.get(sbNorm);

        if (!dbUlb) {
          const identifierDesc = hasCensusCode ? `Census Code "${parsed.censusCode}"` : `SB Code "${parsed.sbCode}"`;
          rowErrors.push({
            field: hasCensusCode ? 'censusCode' : 'sbCode',
            code: 'unknownUlb',
            message: `${identifierDesc} does not match any active onboarded ULB for this state. Unknown ULBs cannot be added to Devolution Formula.`,
            value: hasCensusCode ? parsed.censusCode : parsed.sbCode,
          });
        } else {
          resolvedUlbId = dbUlb._id;
          const idKey = String(dbUlb._id);
          if (matchedUlbIds.has(idKey)) {
            // Duplicate ULB — mark as invalid but null out the ulbId so partial unique index is not violated
            resolvedUlbId = null;
            rowErrors.push({
              field: hasCensusCode ? 'censusCode' : 'sbCode',
              code: 'duplicate',
              message: 'This ULB appears more than once in the uploaded Excel file.',
            });
          } else {
            matchedUlbIds.add(idKey);
            // Steps 2–4: required → type → business
            rowErrors = this.dfValidator.validateRow(parsed, dto.installment);
          }
        }
      }

      processedRows.push({
        ...parsed,
        ulbId: resolvedUlbId,
        validationRowStatus: rowErrors.length === 0 ? 'VALID' : 'INVALID',
        rowErrors,
        rawExcelData: this.buildRawExcelData(raw, headerRow),
      });
    }

    // Step 5: Completeness — which active ULBs are missing from the upload?
    const missingUlbCount = dbUlbs.filter((u) => !matchedUlbIds.has(String(u._id))).length;

    // Summary counts
    const validRows = processedRows.filter((r) => r.validationRowStatus === 'VALID');
    const errorRowCount = processedRows.length - validRows.length;
    const totalAllocatedSum = validRows.reduce((sum, r) => sum + (Number(r.totalGrantAllocation) || 0), 0);
    const allocationBalanced = Math.abs(totalAllocatedSum - totalMoHUAAllocation) <= 0.001;
    const formValidationStatus =
      errorRowCount === 0 && missingUlbCount === 0 && allocationBalanced ? 'VALID' : 'INVALID';

    // Build row documents for DB insert
    const rowDocs = processedRows.map((r) => ({
      form: formId,
      state: stateOid,
      year: yearOid,
      installment: dto.installment,
      datasetVersion: newVersion,
      rowNumber: r.rowNumber,
      ulbId: r.ulbId,
      censusCode: r.censusCode,
      sbCode: r.sbCode,
      ulbName: r.ulbName,
      totalGrantAllocation: Number(r.totalGrantAllocation) || 0,
      installment1Amount: Number(r.installment1Amount) || 0,
      installment2Amount: Number(r.installment2Amount) || 0,
      devolutionFormula: r.devolutionFormula,
      validationStatus: r.validationRowStatus,
      errors: r.rowErrors,
      rawExcelData: r.validationRowStatus === 'INVALID' ? r.rawExcelData : undefined,
      isActive: true,
      createdBy: userOid,
      updatedBy: userOid,
    }));

    // Safe dataset replacement: deactivate → insert → upsert form → delete old async
    let previousRowsDeactivated = false;
    let newRowsInserted = false;
    try {
      if (currentVersion > 0) {
        await this.rowModel
          .updateMany({ form: formId, datasetVersion: currentVersion }, { $set: { isActive: false } })
          .exec();
        previousRowsDeactivated = true;
      }

      await this.rowModel.insertMany(rowDocs, { lean: true, ordered: false });
      newRowsInserted = true;

      const formSummaryFields: Record<string, unknown> = {
        excelFile: normalizedFile,
        excelRowCount,
        errorRowCount,
        totalAllocatedSum,
        totalMoHUAAllocation,
        grantAllocationRef: grantAlloc._id,
        validationStatus: formValidationStatus,
        activeDatasetVersion: newVersion,
        lastExcelUploadedAt: new Date(),
        lastExcelUploadedBy: userOid,
        updatedBy: userOid,
        currentFormStatus: FORM_STATUS.IN_PROGRESS,
      };

      if (existingDoc) {
        await this.formModel.findByIdAndUpdate(formId, { $set: formSummaryFields }).lean().exec();
      } else {
        await this.formModel.create({
          _id: formId,
          state: stateOid,
          year: yearOid,
          installment: dto.installment,
          isDraft: true,
          isActive: true,
          createdBy: userOid,
          ...formSummaryFields,
        });
      }

      if (currentVersion > 0) {
        void this.deletePreviousDatasetRows(formId, currentVersion);
      }
    } catch (err: unknown) {
      if (previousRowsDeactivated) {
        await this.rollbackDatasetReplacement(formId, currentVersion, newVersion);
      } else if (newRowsInserted) {
        // New form: rows written but form.create failed — delete orphan rows
        await this.cleanupOrphanRows(formId, newVersion);
      }
      if (isMongoDuplicateKeyError(err)) {
        throwXviFcValidationError({
          excelFile: [{ field: 'excelFile', code: 'duplicate', message: 'Duplicate ULB entries detected.' }],
        });
      }
      throw err;
    }

    // Generate error Excel if row errors exist
    let errorExcelFile: DfFileRefData | undefined;
    if (errorRowCount > 0) {
      errorExcelFile = await this.generateAndStoreErrorExcel(processedRows, formId, dto.stateId, dto.yearId, userOid);
    } else {
      await this.formModel.findByIdAndUpdate(formId, { $unset: { errorExcelFile: 1 } }).exec();
    }

    const summary = this.dfValidator.buildValidationSummary({
      excelRowCount,
      validRowCount: validRows.length,
      errorRowCount,
      missingUlbCount,
      totalMoHUAAllocation,
      totalAllocatedSum,
      activeDatasetVersion: newVersion,
    });

    const rowErrors: DfRowValidationError[] = processedRows
      .filter((r) => r.rowErrors.length > 0)
      .flatMap((r) =>
        r.rowErrors.map((e) => ({
          rowNumber: r.rowNumber,
          censusCode: r.censusCode,
          sbCode: r.sbCode,
          ulbName: r.ulbName,
          field: e.field,
          code: e.code,
          message: e.message,
          value: e.value,
        })),
      );

    // Allocation mismatch with no other errors: surface as file-level error with partial data
    if (errorRowCount === 0 && missingUlbCount === 0 && !allocationBalanced) {
      throwXviFcValidationErrorWithData(
        {
          excelFile: [
            {
              field: 'excelFile',
              code: 'allocationMismatch',
              message: `Sum of ULB allocations (${totalAllocatedSum.toFixed(2)}) does not equal Total MoHUA Allocation (${totalMoHUAAllocation.toFixed(2)}).`,
            },
          ],
        },
        { validationSummary: summary },
      );
    }

    const responseData: DfValidateExcelResponseData = {
      validationStatus: formValidationStatus,
      summary,
      errorExcelFile: errorExcelFile ? this.signFileRef(errorExcelFile) : undefined,
      rowErrors,
    };

    const message =
      formValidationStatus === 'VALID' ? 'Excel validated successfully.' : 'Excel validation completed with errors.';
    return xviFcSuccess(message, responseData);
  }

  async revalidateExcel(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DfRevalidateExcelResponseData>> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const userOid = new Types.ObjectId(user._id);

    const form = await this.formModel
      .findOne({ state: stateOid, year: yearOid, installment })
      .lean<DfFormLeanDoc>()
      .exec();

    if (!form) {
      throw new NotFoundException('Devolution Formula form not found.');
    }

    assertCanStateEditForm(form.currentFormStatus ?? FORM_STATUS.NOT_STARTED);

    const grantAlloc = await this.dfService.resolveGrantAllocation(stateOid, yearOid);
    const totalMoHUAAllocation = grantAlloc.basic + grantAlloc.performance;

    const [dbUlbsRaw, activeRows] = await Promise.all([
      this.ulbModel.find({ state: stateOid, isActive: true }).select('_id name censusCode sbCode').lean().exec(),
      (form.activeDatasetVersion ?? 0) > 0
        ? this.rowModel
            .find({ form: form._id as Types.ObjectId, datasetVersion: form.activeDatasetVersion ?? 0, isActive: true })
            .sort({ rowNumber: 1 })
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const dbUlbs = dbUlbsRaw as UlbLean[];

    // Case A: active rows exist — revalidate in memory and bulk-update
    if (activeRows.length > 0) {
      const matchedUlbIds = new Set<string>();
      const rowUpdates: Array<{
        id: Types.ObjectId;
        errors: DfRowError[];
        validationStatus: 'VALID' | 'INVALID';
        totalGrantAllocation: number;
      }> = [];
      let errorRowCount = 0;
      let totalAllocatedSum = 0;

      for (const row of activeRows) {
        const parsed: DfParsedExcelRow = {
          rowNumber: row.rowNumber,
          censusCode: row.censusCode ?? '',
          sbCode: row.sbCode ?? '',
          ulbName: row.ulbName,
          totalGrantAllocation: row.totalGrantAllocation,
          installment1Amount: row.installment1Amount,
          installment2Amount: row.installment2Amount,
          devolutionFormula: row.devolutionFormula,
        };

        let rowErrors: DfRowError[] = [];
        if (row.ulbId) {
          const ulbIdStr = String(row.ulbId);
          if (matchedUlbIds.has(ulbIdStr)) {
            rowErrors.push({ field: 'censusCode', code: 'duplicate', message: 'Duplicate ULB in dataset.' });
          } else {
            matchedUlbIds.add(ulbIdStr);
            rowErrors = this.dfValidator.validateRow(parsed, installment);
          }
        } else {
          rowErrors.push({ field: 'censusCode', code: 'unknownUlb', message: 'ULB not found in registry.' });
        }

        const rowStatus: 'VALID' | 'INVALID' = rowErrors.length === 0 ? 'VALID' : 'INVALID';
        if (rowStatus === 'INVALID') errorRowCount++;
        else totalAllocatedSum += row.totalGrantAllocation;

        rowUpdates.push({
          id: row._id,
          errors: rowErrors,
          validationStatus: rowStatus,
          totalGrantAllocation: row.totalGrantAllocation,
        });
      }

      await Promise.all(
        rowUpdates.map((r) =>
          this.rowModel
            .findByIdAndUpdate(r.id, {
              $set: { errors: r.errors, validationStatus: r.validationStatus, updatedBy: userOid },
            })
            .lean()
            .exec(),
        ),
      );

      const missingUlbCount = dbUlbs.filter((u) => !matchedUlbIds.has(String(u._id))).length;
      const allocationBalanced = Math.abs(totalAllocatedSum - totalMoHUAAllocation) <= 0.001;
      const formValidationStatus =
        errorRowCount === 0 && missingUlbCount === 0 && allocationBalanced ? 'VALID' : 'INVALID';

      await this.formModel
        .findByIdAndUpdate(form._id as Types.ObjectId, {
          $set: {
            totalAllocatedSum,
            totalMoHUAAllocation,
            errorRowCount,
            validationStatus: formValidationStatus,
            updatedBy: userOid,
          },
          ...(formValidationStatus === 'VALID' && { $unset: { errorExcelFile: 1 } }),
        })
        .exec();

      const summary = this.dfValidator.buildValidationSummary({
        excelRowCount: activeRows.length,
        validRowCount: activeRows.length - errorRowCount,
        errorRowCount,
        missingUlbCount,
        totalMoHUAAllocation,
        totalAllocatedSum,
        activeDatasetVersion: form.activeDatasetVersion ?? 0,
      });

      const rowErrors: DfRowValidationError[] = rowUpdates
        .filter((r) => r.errors.length > 0)
        .flatMap((r, i) =>
          r.errors.map((e) => ({
            rowNumber: activeRows[i]?.rowNumber ?? i + 1,
            field: e.field,
            code: e.code,
            message: e.message,
            value: e.value,
          })),
        );

      return xviFcSuccess('Revalidation complete.', { validationSummary: summary, rowErrors });
    }

    // Case B: no active rows but stored Excel exists — re-parse from S3
    if (form.excelFile?.fileUrl) {
      const result = await this.validateExcel({ stateId, yearId, installment, excelFile: form.excelFile }, user);
      return xviFcSuccess('Revalidation complete.', {
        validationSummary: result.data!.summary,
        rowErrors: result.data!.rowErrors,
      });
    }

    throwXviFcValidationError({
      excelFile: [
        {
          field: 'excelFile',
          code: 'noDataset',
          message: 'No Excel data found to revalidate. Please upload an Excel file first.',
        },
      ],
    });
  }

  async generateTemplate(
    stateId: string,
    _yearId: string,
    _installment: DfInstallment,
    user: AuthUser,
  ): Promise<ExcelJS.Buffer> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const ulbs = await this.ulbModel
      .find({ state: stateOid, isActive: true })
      .select('_id name censusCode sbCode')
      .sort({ name: 1 })
      .lean()
      .exec();

    const rows = ulbs.map((u: Record<string, unknown>) => ({
      censusCode: u['censusCode'] ? (u['censusCode'] as string) : '',
      sbCode: u['sbCode'] ? (u['sbCode'] as string) : '',
      ulbName: (u['name'] as string | undefined) ?? '',
      totalGrantAllocation: '',
      installment1Amount: '',
      installment2Amount: '',
      devolutionFormula: '',
    }));

    return this.excelService.generateExcel(DF_TEMPLATE_HEADERS, rows, 'Devolution Formula');
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (user.scope === Scope.ADMIN) return;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (userStateId && userStateId === stateId) return;
    }
    throw new ForbiddenException("You do not have access to this state's data.");
  }

  private validateFileMetadata(file: DfFileRefData): void {
    const fileName = file.fileName ?? '';
    const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
    const extOk = DF_ALLOWED_FILE_EXTENSIONS.some((e) => e.slice(1) === ext);
    const mimeOk =
      !file.mimeType || DF_ALLOWED_MIME_TYPES.includes(file.mimeType as (typeof DF_ALLOWED_MIME_TYPES)[number]);

    if (!extOk && !mimeOk) {
      throwXviFcValidationError({
        excelFile: [{ field: 'excelFile', code: 'invalidType', message: 'Only .xlsx and .xls files are supported.' }],
      });
    }
    if (file.fileSize !== null && file.fileSize !== undefined && file.fileSize > DF_MAX_FILE_SIZE_BYTES) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'tooLarge',
            message: `File size must not exceed ${DF_MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
          },
        ],
      });
    }
  }

  private buildColIndexMap(headerRow: string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (let i = 0; i < headerRow.length; i++) {
      const key = DF_EXCEL_HEADER_MAP[headerRow[i]];
      if (key) map.set(key, i);
    }
    return map;
  }

  private findMissingRequiredHeaders(headerRow: string[]): string[] {
    const presentKeys = new Set(headerRow.map((h) => DF_EXCEL_HEADER_MAP[h]).filter(Boolean));
    const hasCensusOrSb = presentKeys.has('censusCode') || presentKeys.has('sbCode');
    const requiredDataCols: Array<[string, string]> = [
      ['ulbName', 'ULB Name'],
      ['totalGrantAllocation', 'Total Grant Allocation'],
      ['installment1Amount', 'Installment 1 Amount'],
      ['installment2Amount', 'Installment 2 Amount'],
      ['devolutionFormula', 'Devolution Formula'],
    ];
    const missing: string[] = [];
    if (!hasCensusOrSb) missing.push('Census Code or SB Code');
    for (const [key, label] of requiredDataCols) {
      if (!presentKeys.has(key)) missing.push(label);
    }
    return missing;
  }

  private isEmptyRow(row: unknown[]): boolean {
    return !row || row.every((cell) => cell === '' || cell === null || cell === undefined);
  }

  private parseDataRow(row: unknown[], colIndexMap: Map<string, number>, rowNumber: number): DfParsedExcelRow {
    const get = (key: string): unknown => {
      const idx = colIndexMap.get(key);
      return idx !== undefined ? row[idx] : undefined;
    };
    return {
      rowNumber,
      censusCode: String((get('censusCode') ?? '') as string | number | boolean).trim(),
      sbCode: String((get('sbCode') ?? '') as string | number | boolean).trim(),
      ulbName: String((get('ulbName') ?? '') as string | number | boolean).trim(),
      totalGrantAllocation: get('totalGrantAllocation'),
      installment1Amount: get('installment1Amount'),
      installment2Amount: get('installment2Amount'),
      devolutionFormula: String((get('devolutionFormula') ?? '') as string | number | boolean).trim(),
    };
  }

  private buildRawExcelData(row: unknown[], headerRow: string[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headerRow.length; i++) {
      obj[headerRow[i]] = row[i];
    }
    return obj;
  }

  private async generateAndStoreErrorExcel(
    rows: ProcessedRow[],
    formId: Types.ObjectId,
    stateId: string,
    yearId: string,
    userOid: Types.ObjectId,
  ): Promise<DfFileRefData> {
    const errorRows = rows.map((r) => ({
      censusCode: r.censusCode,
      sbCode: r.sbCode,
      ulbName: r.ulbName,
      totalGrantAllocation: r.totalGrantAllocation,
      installment1Amount: r.installment1Amount,
      installment2Amount: r.installment2Amount,
      devolutionFormula: r.devolutionFormula,
      errors: r.rowErrors.map((e) => e.message).join('; '),
    }));

    const designYear = YearIdToLabel[yearId] ?? yearId;
    const folderCtx: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };
    const s3Key = `${buildXviFcFolderPath(DF_FOLDER_PATH_ERROR_SHEETS, folderCtx)}/${String(formId)}-errors.xlsx`;

    const buffer = (await this.excelService.generateExcel(
      DF_ERROR_EXCEL_HEADERS,
      errorRows,
      'Devolution Formula Errors',
    )) as unknown as Buffer;

    await this.s3Service.uploadPublic(
      s3Key,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const fileRef: DfFileRefData = {
      fileName: `devolution-formula-errors-${String(formId)}.xlsx`,
      fileUrl: s3Key,
      fileSize: buffer.length,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      s3Key,
    };

    await this.formModel
      .findByIdAndUpdate(formId, { $set: { errorExcelFile: fileRef, updatedBy: userOid } })
      .lean()
      .exec();

    return fileRef;
  }

  private async deletePreviousDatasetRows(formId: Types.ObjectId, version: number): Promise<void> {
    try {
      await this.rowModel.deleteMany({ form: formId, datasetVersion: version }).exec();
    } catch (err) {
      this.logger.error(`Failed to delete old dataset rows [form=${formId.toString()} version=${version}]`, err);
    }
  }

  private async rollbackDatasetReplacement(
    formId: Types.ObjectId,
    oldVersion: number,
    newVersion: number,
  ): Promise<void> {
    try {
      await this.rowModel.updateMany({ form: formId, datasetVersion: oldVersion }, { $set: { isActive: true } }).exec();
      await this.rowModel.deleteMany({ form: formId, datasetVersion: newVersion }).exec();
    } catch (rollbackErr) {
      this.logger.error(`Rollback failed [form=${formId.toString()}]`, rollbackErr);
    }
  }

  private async cleanupOrphanRows(formId: Types.ObjectId, version: number): Promise<void> {
    try {
      await this.rowModel.deleteMany({ form: formId, datasetVersion: version }).exec();
    } catch (err) {
      this.logger.error(`Failed to clean up orphan rows [form=${formId.toString()} version=${version}]`, err);
    }
  }

  private signFileRef(ref: DfFileRefData): DfFileRefData {
    if (!ref?.fileUrl) return ref;
    try {
      return { ...ref, fileUrl: this.fileTokenService.signFileUrl(ref.fileUrl) };
    } catch {
      return ref;
    }
  }
}
