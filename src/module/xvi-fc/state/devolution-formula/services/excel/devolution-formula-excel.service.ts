import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import type ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { S3Service } from 'src/core/s3/s3.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ExcelColumnValidation, ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { assertCanStateEditForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import {
  FileInfoNormalizerService,
  type HydratedFileInfoResponse,
} from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import type { FileInfo } from 'src/schemas/common/file.schema';
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
  DF_ERROR_EXCEL_HEADERS,
  DF_EXCEL_HEADER_MAP,
  DF_FOLDER_PATH_ERROR_SHEETS,
  DF_TEMPLATE_HEADERS,
  type DfInstallment,
} from '../../constants/devolution-formula.constants';
import type { ValidateExcelDevolutionFormulaDto } from '../../dto/validate-excel-devolution-formula.dto';
import type {
  DfFormLeanDoc,
  DfRevalidateExcelResponseData,
  DfRowError,
  DfRowValidationError,
  DfValidateExcelResponseData,
} from '../../types/devolution-formula.types';
import { DevolutionFormulaValidator, type DfParsedExcelRow } from '../../validators/devolution-formula.validator';
import { DevolutionFormulaService } from '../main/devolution-formula.service';
import { DfFormJsonConfigService } from '../form-json/devolution-formula-form-json.service';
import { getDfFieldsByType } from '../../helpers/devolution-formula-form-json.helpers';
import {
  keyByFieldKey,
  requireField,
  getValidatorValue,
} from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { deriveFileValidationOptions } from 'src/module/xvi-fc/common/utils/xvi-fc-file-constraint.util';
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

/**
 * On transaction abort, distinguishes a genuine row-level business duplicate (the same ULB
 * appearing twice in one upload) from a form-level conflict (two requests racing on the same
 * state+year+installment form doc, or a transaction write-conflict) — these need different,
 * honest messages. Falls through without throwing for anything else, so the caller's `throw err`
 * still applies.
 */
function classifyAndThrowMongoWriteConflict(err: unknown, formFilterKeys: string[]): void {
  const conflictMessage = 'This form was just updated by another request. Please refresh and try again.';

  if (err instanceof MongoServerError && err.code === 11000) {
    const conflictKeys = Object.keys((err.keyValue as Record<string, unknown>) ?? {});
    const isFormLevelConflict = conflictKeys.length > 0 && conflictKeys.every((k) => formFilterKeys.includes(k));
    if (isFormLevelConflict) {
      throwXviFcValidationError({
        excelFile: [{ field: 'excelFile', code: 'conflict', message: conflictMessage }],
      });
    }
    throwXviFcValidationError({
      excelFile: [{ field: 'excelFile', code: 'duplicate', message: 'Duplicate ULB entries detected.' }],
    });
  }
  if (err instanceof MongoServerError && err.hasErrorLabel('TransientTransactionError')) {
    throwXviFcValidationError({
      excelFile: [{ field: 'excelFile', code: 'conflict', message: conflictMessage }],
    });
  }
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
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly dfFormJsonConfig: DfFormJsonConfigService,
  ) {}

  /**
   * Loads the DB-driven `excelFile` file constraints and `devolutionFormula` max length once
   * per request — single source of truth for both, replacing the old hardcoded `DF_*` constants.
   */
  private async resolveDfValidationConfig(yearId: string): Promise<{
    fileValidationOptions: ReturnType<typeof deriveFileValidationOptions>;
    maxFormulaLength: number;
  }> {
    const dfFields = await this.dfFormJsonConfig.loadFields(yearId);
    const mainFields = getDfFieldsByType(dfFields, 'DF_MAIN_FORM_FIELDS');
    const rowFields = getDfFieldsByType(dfFields, 'DF_ROW_EDIT_FIELDS');

    const excelFileField = requireField(keyByFieldKey(mainFields), 'excelFile', 'DevolutionFormulaExcelService');
    const devolutionFormulaField = requireField(
      keyByFieldKey(rowFields),
      'devolutionFormula',
      'DevolutionFormulaExcelService',
    );
    const maxFormulaLength = getValidatorValue<number>(devolutionFormulaField, 'maxlength');
    if (maxFormulaLength === undefined) {
      throw new InternalServerErrorException(
        "DevolutionFormulaExcelService: 'devolutionFormula' field is missing a maxlength validator.",
      );
    }

    return {
      fileValidationOptions: deriveFileValidationOptions(excelFileField, 'excelFile'),
      maxFormulaLength,
    };
  }

  async validateExcel(
    dto: ValidateExcelDevolutionFormulaDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DfValidateExcelResponseData>> {
    this.assertStateAccess(user, dto.stateId);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    // 1. Load grant allocation, existing form (incl. current excelFile for unchanged-file detection), and DB ULBs
    const formFilter = { state: stateOid, year: yearOid, installment: dto.installment };
    const [grantAlloc, dbUlbsRaw, existing] = await Promise.all([
      this.dfService.resolveGrantAllocation(stateOid, yearOid),
      this.ulbModel.find({ state: stateOid, isActive: true }).select('_id name censusCode sbCode').lean().exec(),
      this.formModel
        .findOne(formFilter, { _id: 1, currentFormStatus: 1, activeDatasetVersion: 1, excelFile: 1 })
        .lean<Pick<DfFormLeanDoc, '_id' | 'currentFormStatus' | 'activeDatasetVersion' | 'excelFile'>>()
        .exec(),
    ]);

    const existingDoc = existing;

    if (existingDoc) {
      assertCanStateEditForm(existingDoc.currentFormStatus ?? FORM_STATUS.NOT_STARTED);
    }

    // 2. Normalize + validate the inbound canonical file object (path, extension/MIME, size)
    const { fileValidationOptions, maxFormulaLength } = await this.resolveDfValidationConfig(dto.yearId);
    const { file: normalizedFile, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.excelFile as unknown as Record<string, unknown>,
      existingDoc?.excelFile,
      fileValidationOptions,
    );
    if (fileErrors.length > 0) throwXviFcValidationError({ excelFile: fileErrors });
    // `normalizedFile` is `undefined` when the incoming path matches the already-stored
    // file (e.g. revalidateExcel Case B re-submits the stored path) — fall back to the
    // existing stored file for reads below; only the raw `normalizedFile` is written to
    // $set later, so an unchanged file's Mongoose-managed timestamps aren't disturbed.
    const effectiveFile = normalizedFile !== undefined ? normalizedFile : existingDoc?.excelFile;
    if (!effectiveFile) {
      throwXviFcValidationError({
        excelFile: [{ field: 'excelFile', code: 'required', message: 'excelFile is required.' }],
      });
    }

    const dbUlbs = dbUlbsRaw as UlbLean[];
    const totalMoHUAAllocation = grantAlloc.basic + grantAlloc.performance;

    // 3. Read and parse Excel from S3
    const buffer = await this.s3Service.getBuffer(effectiveFile.path);
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

    // 7. Build ULB lookup map (censusCode preferred, sbCode fallback — mirrors EULB)
    const ulbByCode = new Map<string, UlbLean>();
    for (const ulb of dbUlbs) {
      const code = String(ulb.censusCode || ulb.sbCode || '')
        .trim()
        .toLowerCase();
      if (code) ulbByCode.set(code, ulb);
    }

    // 8. Classify and validate each row
    const processedRows: ProcessedRow[] = [];
    const matchedUlbIds = new Set<string>();
    let newUlbCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const raw = dataRows[i];
      const parsed = this.parseDataRow(raw, colIndexMap, i + 1);

      const identifierNorm = parsed.censusCode.toLowerCase();
      const hasIdentifier = identifierNorm.length > 0;

      let rowErrors: DfRowError[] = [];
      let resolvedUlbId: Types.ObjectId | null = null;

      // Step 1: Registry check — Census Code column is the single consolidated identifier
      if (!hasIdentifier) {
        rowErrors.push({
          field: 'censusCode',
          code: 'identifierMissing',
          message: 'Census Code is required.',
        });
      } else {
        const dbUlb = ulbByCode.get(identifierNorm);

        if (!dbUlb) {
          newUlbCount++;
          rowErrors.push({
            field: 'censusCode',
            code: 'unknownUlb',
            message: `Census Code "${parsed.censusCode}" does not match any active onboarded ULB for this state. Unknown ULBs cannot be added to Devolution Formula.`,
            value: parsed.censusCode,
          });
        } else {
          resolvedUlbId = dbUlb._id;
          const idKey = String(dbUlb._id);
          if (matchedUlbIds.has(idKey)) {
            // Duplicate ULB — mark as invalid but null out the ulbId so partial unique index is not violated
            resolvedUlbId = null;
            rowErrors.push({
              field: 'censusCode',
              code: 'duplicate',
              message: 'This ULB appears more than once in the uploaded Excel file.',
            });
          } else {
            matchedUlbIds.add(idKey);

            // Identity guard — registry ULB name must not be altered from the downloaded template
            const registryName = String(dbUlb.name ?? '').trim();
            const uploadedName = parsed.ulbName.trim();
            if (registryName && uploadedName.toLowerCase() !== registryName.toLowerCase()) {
              rowErrors.push({
                field: 'ulbName',
                code: 'identityModified',
                message: 'ULB name must not be modified from the downloaded template.',
                value: parsed.ulbName,
              });
            } else {
              // Steps 2–4: required → type → business
              rowErrors = this.dfValidator.validateRow(parsed, dto.installment, maxFormulaLength, {
                totalMoHUAAllocation,
              });
            }
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

    // Atomic version allocation + safe dataset replacement, all inside one Mongo transaction.
    // Replaces a prior read-then-increment (`currentVersion = existingDoc.activeDatasetVersion ?? 0;
    // newVersion = currentVersion + 1`) that let two concurrent uploads for the same form compute
    // the identical datasetVersion and corrupt each other's rows via the {form,datasetVersion,ulbId}
    // unique index and a manual, version-number-keyed rollback. The $inc below is atomic — two
    // concurrent requests can never be handed the same datasetVersion — and wrapping every write in
    // one transaction means an abort undoes all of them, so no manual rollback/cleanup is needed.
    const formSummaryFieldsBase: Record<string, unknown> = {
      excelFile: normalizedFile,
      excelRowCount,
      errorRowCount,
      newUlbCount,
      totalAllocatedSum,
      totalMoHUAAllocation,
      grantAllocationRef: grantAlloc._id,
      validationStatus: formValidationStatus,
      lastExcelUploadedAt: new Date(),
      lastExcelUploadedBy: userOid,
      updatedBy: userOid,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
    };

    const session = await this.formModel.db.startSession();
    let formId!: Types.ObjectId;
    let newVersion!: number;
    try {
      session.startTransaction();

      const updatedForm = await this.formModel
        .findOneAndUpdate(
          formFilter,
          {
            $inc: { activeDatasetVersion: 1 },
            $set: formSummaryFieldsBase,
            $setOnInsert: { createdBy: userOid },
          },
          { upsert: true, new: true, session, setDefaultsOnInsert: true },
        )
        .exec();

      newVersion = updatedForm.activeDatasetVersion;
      const currentVersion = newVersion - 1;
      formId = updatedForm._id;

      const rowDocs = processedRows.map((r) => ({
        form: formId,
        state: stateOid,
        year: yearOid,
        installment: dto.installment,
        datasetVersion: newVersion,
        rowNumber: r.rowNumber,
        ulbId: r.ulbId,
        censusCode: r.censusCode,
        sbCode: '',
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

      if (currentVersion > 0) {
        await this.rowModel
          .updateMany({ form: formId, datasetVersion: currentVersion }, { $set: { isActive: false } }, { session })
          .exec();
      }

      await this.rowModel.insertMany(rowDocs, { ordered: false, session });

      if (currentVersion > 0) {
        await this.rowModel.deleteMany({ form: formId, datasetVersion: currentVersion }, { session }).exec();
      }

      await session.commitTransaction();
    } catch (err: unknown) {
      await session.abortTransaction();
      classifyAndThrowMongoWriteConflict(err, Object.keys(formFilter));
      throw err;
    } finally {
      await session.endSession();
    }

    // Generate error Excel if row errors exist
    let errorExcelFile: FileInfo | undefined;
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
      newUlbCount,
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
          ulbName: r.ulbName,
          field: e.field,
          code: e.code,
          message: e.message,
          value: e.value,
        })),
      );

    // File-control errors: new/unregistered ULB rows and (if no other unrelated row errors) allocation
    // mismatch are surfaced together as excelFile errors — additive, never overwriting one another.
    const excelFileErrors: DfRowError[] = [];

    if (newUlbCount > 0) {
      excelFileErrors.push({
        field: 'excelFile',
        code: 'newUlbsAdded',
        message: `You have added ${newUlbCount} ULB(s). Please register before proceeding.`,
      });
    }

    // Allocation mismatch with no other row errors beyond the new/unknown ULB rows already
    // accounted for above: surface alongside any newUlbsAdded error rather than suppressing it.
    if (errorRowCount === newUlbCount && missingUlbCount === 0 && !allocationBalanced) {
      excelFileErrors.push({
        field: 'excelFile',
        code: 'allocationMismatch',
        message: `Sum of ULB allocations (${totalAllocatedSum.toFixed(2)}) does not equal Total MoHUA Allocation (${totalMoHUAAllocation.toFixed(2)}).`,
      });
    }

    if (excelFileErrors.length > 0) {
      throwXviFcValidationErrorWithData(
        { excelFile: excelFileErrors },
        { validationSummary: summary, newUlbCount, rowErrors },
      );
    }

    const responseData: DfValidateExcelResponseData = {
      validationStatus: formValidationStatus,
      summary,
      errorExcelFile: this.hydrateErrorExcelFile(errorExcelFile),
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
    const { maxFormulaLength } = await this.resolveDfValidationConfig(yearId);

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
      let newUlbCount = 0;
      let totalAllocatedSum = 0;

      for (const row of activeRows) {
        const parsed: DfParsedExcelRow = {
          rowNumber: row.rowNumber,
          censusCode: row.censusCode ?? '',
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
            rowErrors = this.dfValidator.validateRow(parsed, installment, maxFormulaLength, { totalMoHUAAllocation });
          }
        } else {
          newUlbCount++;
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

      const bulkOps = rowUpdates.map((r) => ({
        updateOne: {
          filter: { _id: r.id },
          update: { $set: { errors: r.errors, validationStatus: r.validationStatus, updatedBy: userOid } },
        },
      })) as unknown as AnyBulkWriteOperation<DevolutionFormulaRowDocument>[];
      await this.rowModel.bulkWrite(bulkOps, { ordered: false });

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
            newUlbCount,
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
        newUlbCount,
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

      if (newUlbCount > 0) {
        throwXviFcValidationErrorWithData(
          {
            excelFile: [
              {
                field: 'excelFile',
                code: 'newUlbsAdded',
                message: `You have added ${newUlbCount} ULB(s). Please register before proceeding.`,
              },
            ],
          },
          { validationSummary: summary, rowErrors },
        );
      }

      return xviFcSuccess('Revalidation complete.', { validationSummary: summary, rowErrors });
    }

    // Case B: no active rows but stored Excel exists — re-parse from S3
    if (form.excelFile?.path) {
      const storedFile = form.excelFile;
      const result = await this.validateExcel(
        {
          stateId,
          yearId,
          installment,
          excelFile: {
            originalName: storedFile.originalName,
            path: storedFile.path,
            mimeType: storedFile.mimeType,
            sizeKb: storedFile.sizeKb,
            pageCount: storedFile.pageCount,
          },
        },
        user,
      );
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
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
  ): Promise<ExcelJS.Buffer> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    // Always load active registry alongside form and grant alloc — needed in both branches.
    const [form, grantAlloc, activeUlbsRaw] = await Promise.all([
      this.formModel.findOne({ state: stateOid, year: yearOid, installment }).lean<DfFormLeanDoc>().exec(),
      this.dfService.resolveGrantAllocation(stateOid, yearOid).catch(() => null),
      this.ulbModel
        .find({ state: stateOid, isActive: true })
        .select('_id name censusCode sbCode')
        .sort({ name: 1 })
        .lean()
        .exec(),
    ]);

    const maxGrantAllocation = grantAlloc ? grantAlloc.basic + grantAlloc.performance : undefined;
    const activeVersion = form?.activeDatasetVersion ?? 0;
    const { maxFormulaLength } = await this.resolveDfValidationConfig(yearId);

    if (form && activeVersion > 0) {
      // Load only saved rows that matched a registry ULB — exclude unknown-ULB rows.
      const savedRows = await this.rowModel
        .find({ form: form._id as Types.ObjectId, datasetVersion: activeVersion, isActive: true, ulbId: { $ne: null } })
        .lean()
        .exec();

      // Build overlay map: ulbId string → saved row.
      const savedByUlbId = new Map<string, (typeof savedRows)[0]>();
      for (const row of savedRows) {
        if (row.ulbId) savedByUlbId.set(String(row.ulbId), row);
      }

      // Iterate active registry in name order; overlay saved values where available.
      const rows = (activeUlbsRaw as Record<string, unknown>[]).map((u) => {
        const saved = savedByUlbId.get(String(u['_id']));
        return {
          censusCode: String((u['censusCode'] as string | null) || (u['sbCode'] as string | null) || ''),
          ulbName: (u['name'] as string | undefined) ?? '',
          totalGrantAllocation: saved?.totalGrantAllocation ?? '',
          installment1Amount: saved?.installment1Amount ?? '',
          installment2Amount: saved?.installment2Amount ?? '',
          devolutionFormula: saved?.devolutionFormula ?? '',
        };
      });

      return this.excelService.generateExcel(
        DF_TEMPLATE_HEADERS,
        rows,
        'Devolution Formula',
        this.buildDfTemplateValidations(maxFormulaLength, maxGrantAllocation),
      );
    }

    // No active dataset — blank editable rows from active registry.
    const rows = (activeUlbsRaw as Record<string, unknown>[]).map((u) => ({
      censusCode: String((u['censusCode'] as string | null) || (u['sbCode'] as string | null) || ''),
      ulbName: (u['name'] as string | undefined) ?? '',
      totalGrantAllocation: '',
      installment1Amount: '',
      installment2Amount: '',
      devolutionFormula: '',
    }));

    return this.excelService.generateExcel(
      DF_TEMPLATE_HEADERS,
      rows,
      'Devolution Formula',
      this.buildDfTemplateValidations(maxFormulaLength, maxGrantAllocation),
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private buildDfTemplateValidations(maxFormulaLength: number, totalMoHUAAllocation?: number): ExcelColumnValidation[] {
    return [
      {
        key: 'totalGrantAllocation',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const totalLetter = keyToLetter.get('totalGrantAllocation')!;
          const inst1Letter = keyToLetter.get('installment1Amount')!;
          const inst2Letter = keyToLetter.get('installment2Amount')!;
          const maxClause = totalMoHUAAllocation !== undefined ? `,${totalLetter}${row}<=${totalMoHUAAllocation}` : '';
          return {
            type: 'custom',
            allowBlank: true,
            formulae: [
              `OR(${totalLetter}${row}="",AND(ISNUMBER(${totalLetter}${row}),${totalLetter}${row}>=0${maxClause},ISNUMBER(${inst1Letter}${row}),ISNUMBER(${inst2Letter}${row}),ABS(${totalLetter}${row}-(${inst1Letter}${row}+${inst2Letter}${row}))<0.001))`,
            ],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Allocation Mismatch',
            error:
              'Total Grant Allocation must be ≥ 0 and must equal the sum of Installment 1 and Installment 2 amounts.',
          };
        },
      },
      {
        key: 'installment1Amount',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const inst1Letter = keyToLetter.get('installment1Amount')!;
          const totalLetter = keyToLetter.get('totalGrantAllocation')!;
          return {
            type: 'custom',
            allowBlank: true,
            formulae: [
              `OR(${inst1Letter}${row}="",AND(ISNUMBER(${inst1Letter}${row}),${inst1Letter}${row}>=0,OR(${totalLetter}${row}="",${inst1Letter}${row}<=${totalLetter}${row})))`,
            ],
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Invalid Installment 1 Amount',
            error: `Installment 1 Amount must be ≥ 0 and cannot exceed Total Grant Allocation (${totalMoHUAAllocation}Cr.).`,
          };
        },
      },
      {
        key: 'installment2Amount',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const inst2Letter = keyToLetter.get('installment2Amount')!;
          const totalLetter = keyToLetter.get('totalGrantAllocation')!;
          return {
            type: 'custom',
            allowBlank: true,
            formulae: [
              `OR(${inst2Letter}${row}="",AND(ISNUMBER(${inst2Letter}${row}),${inst2Letter}${row}>=0,OR(${totalLetter}${row}="",${inst2Letter}${row}<=${totalLetter}${row})))`,
            ],
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Invalid Installment 2 Amount',
            error: `Installment 2 Amount must be ≥ 0 and cannot exceed Total Grant Allocation (${totalMoHUAAllocation}).`,
          };
        },
      },
      {
        key: 'devolutionFormula',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const cellLetter = keyToLetter.get('devolutionFormula')!;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [`AND(${cellLetter}${row}<>"",LEN(${cellLetter}${row})<=${maxFormulaLength})`],
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Devolution Formula Required',
            error: `Devolution Formula is required and must not exceed ${maxFormulaLength} characters.`,
          };
        },
      },
    ];
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (user.scope === Scope.ADMIN) return;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (userStateId && userStateId === stateId) return;
    }
    throw new ForbiddenException("You do not have access to this state's data.");
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
    const requiredDataCols: Array<[string, string]> = [
      ['censusCode', 'Census Code'],
      ['ulbName', 'ULB Name'],
      ['totalGrantAllocation', 'Total Grant Allocation'],
      ['installment1Amount', 'Installment 1 Amount'],
      ['installment2Amount', 'Installment 2 Amount'],
      ['devolutionFormula', 'Devolution Formula'],
    ];
    const missing: string[] = [];
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
  ): Promise<FileInfo> {
    const errorRows = rows.map((r) => ({
      censusCode: r.censusCode,
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

    await this.s3Service.uploadPrivate(
      s3Key,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    // Backend-generated file: bypasses the client DTO/normalizer entirely, owns both timestamps.
    const now = new Date();
    const fileRef: FileInfo = {
      originalName: `devolution-formula-errors-${String(formId)}.xlsx`,
      name: '',
      path: s3Key,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      sizeKb: buffer.length / 1024,
      pageCount: null,
      sha256: '',
      createdAt: now,
      updatedAt: now,
    };

    await this.formModel
      .findByIdAndUpdate(formId, { $set: { errorExcelFile: fileRef, updatedBy: userOid } })
      .lean()
      .exec();

    return fileRef;
  }

  private hydrateErrorExcelFile(file: FileInfo | null | undefined): HydratedFileInfoResponse | undefined {
    return (
      this.fileInfoNormalizer.hydrateFileInfoForResponse(file ?? null, (p) => {
        try {
          return this.fileTokenService.signFileUrl(p);
        } catch {
          return p;
        }
      }) ?? undefined
    );
  }
}
