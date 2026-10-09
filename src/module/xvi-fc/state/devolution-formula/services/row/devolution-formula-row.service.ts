import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type ExcelJS from 'exceljs';
import { ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { assertCanStateEditForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { ClaimLetterUlbLock, ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import {
  DF_ERROR_EXCEL_HEADERS,
  DF_PAGINATION_DEFAULT_LIMIT,
  DF_PAGINATION_DEFAULT_PAGE,
  DF_PAGINATION_MAX_LIMIT,
  type DfInstallment,
} from '../../constants/devolution-formula.constants';
import type { RowsQueryDevolutionFormulaDto } from '../../dto/rows-query-devolution-formula.dto';
import type { UpdateRowDevolutionFormulaDto } from '../../dto/update-row-devolution-formula.dto';
import type { DfFormLeanDoc, DfRowError } from '../../types/devolution-formula.types';
import { DevolutionFormulaValidator, type DfParsedExcelRow } from '../../validators/devolution-formula.validator';
import { amountsAreEqual } from '../../helpers/devolution-formula-tolerance.helpers';
import { DfFormJsonConfigService } from '../form-json/devolution-formula-form-json.service';
import { getDfFieldsByType } from '../../helpers/devolution-formula-form-json.helpers';
import {
  keyByFieldKey,
  requireField,
  getValidatorValue,
} from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';

@Injectable()
export class DevolutionFormulaRowService {
  constructor(
    @InjectModel(DevolutionFormulaForm.name)
    private readonly formModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly rowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(ClaimLetterUlbLock.name)
    private readonly claimLetterUlbLockModel: Model<ClaimLetterUlbLockDocument>,
    private readonly dfValidator: DevolutionFormulaValidator,
    private readonly excelService: ExcelService,
    private readonly dfFormJsonConfig: DfFormJsonConfigService,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  /** DB-driven `devolutionFormula` max length — single source of truth is the DF_ROW_EDIT_FIELDS group. */
  private async resolveMaxFormulaLength(yearId: string): Promise<number> {
    const dfFields = await this.dfFormJsonConfig.loadFields(yearId);
    const rowFields = getDfFieldsByType(dfFields, 'DF_ROW_EDIT_FIELDS');
    const devolutionFormulaField = requireField(
      keyByFieldKey(rowFields),
      'devolutionFormula',
      'DevolutionFormulaRowService',
    );
    const maxLength = getValidatorValue<number>(devolutionFormulaField, 'maxlength');
    if (maxLength === undefined) {
      throw new InternalServerErrorException(
        "DevolutionFormulaRowService: 'devolutionFormula' field is missing a maxlength validator.",
      );
    }
    return maxLength;
  }

  async getRows(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    query: RowsQueryDevolutionFormulaDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse> {
    assertStateAccess(user, stateId);

    const form = await this.findFormOrThrow(stateId, yearId, installment);
    const activeVersion = ((form as Record<string, unknown>)['activeDatasetVersion'] as number) ?? 0;

    const page = query.page ?? DF_PAGINATION_DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DF_PAGINATION_DEFAULT_LIMIT, DF_PAGINATION_MAX_LIMIT);
    const skip = (page - 1) * limit;

    const filter: FilterQuery<DevolutionFormulaRowDocument> = {
      form: (form as Record<string, unknown>)['_id'] as Types.ObjectId,
      datasetVersion: activeVersion,
      isActive: true,
    };

    if (query.validationStatus) filter['validationStatus'] = query.validationStatus;

    if (query.search) {
      const regex = new RegExp(escapeRegex(query.search), 'i');
      filter['$or'] = [{ censusCode: regex }, { sbCode: regex }, { ulbName: regex }];
    }

    const [rows, total] = await Promise.all([
      this.rowModel
        .find(filter)
        .sort({ rowNumber: 1 })
        .skip(skip)
        .limit(limit)
        .select('-rawExcelData -sbCode -__v')
        .lean()
        .exec(),
      this.rowModel.countDocuments(filter).exec(),
    ]);

    const validCount = await this.rowModel
      .countDocuments({
        form: filter['form'],
        datasetVersion: activeVersion,
        isActive: true,
        validationStatus: 'VALID',
      })
      .exec();
    const errorCount = total - validCount;

    const formDoc = form as Record<string, unknown>;
    const validationSummary = this.dfValidator.buildValidationSummary({
      excelRowCount: (formDoc['excelRowCount'] as number) ?? 0,
      validRowCount: validCount,
      errorRowCount: errorCount,
      missingUlbCount: (formDoc['missingUlbCount'] as number) ?? 0,
      newUlbCount: (formDoc['newUlbCount'] as number) ?? 0,
      duplicateUlbCount: (formDoc['duplicateUlbCount'] as number) ?? 0,
      totalMoHUAAllocation: (formDoc['totalMoHUAAllocation'] as number) ?? 0,
      totalAllocatedSum: (formDoc['totalAllocatedSum'] as number) ?? 0,
      activeDatasetVersion: activeVersion,
    });

    return xviFcSuccess('Rows fetched.', {
      rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      validationSummary,
    });
  }

  async updateRow(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    rowId: string,
    dto: UpdateRowDevolutionFormulaDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse> {
    assertStateAccess(user, stateId);

    const form = await this.findFormOrThrow(stateId, yearId, installment);
    const formDoc = form as Record<string, unknown>;
    assertCanStateEditForm((formDoc['currentFormStatus'] as number | undefined) ?? FORM_STATUS.NOT_STARTED);

    const row = await this.rowModel
      .findOne({
        _id: new Types.ObjectId(rowId),
        form: formDoc['_id'] as Types.ObjectId,
        datasetVersion: formDoc['activeDatasetVersion'] as number,
        isActive: true,
      })
      .lean()
      .exec();

    if (!row) {
      throw new NotFoundException('Row not found in the active dataset.');
    }
    // Defense-in-depth: ineligible ULBs are rejected at ingestion, but a row created before this
    // filter existed could otherwise still be edited here.
    if (row.ulbId) {
      await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
        row.ulbId,
        'XVIFC',
        CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
      );
    }

    await this.assertNoActiveClaimLockForUlb(
      stateId,
      yearId,
      installment,
      row.ulbId ? new Types.ObjectId(String(row.ulbId)) : null,
    );

    const maxFormulaLength = await this.resolveMaxFormulaLength(yearId);

    const fieldErrors = this.dfValidator.validatePortalRowEdit(dto, installment, maxFormulaLength, {
      totalMoHUAAllocation: (formDoc['totalMoHUAAllocation'] as number | undefined) ?? undefined,
    });
    if (fieldErrors.length > 0) {
      const errorMap = Object.fromEntries(fieldErrors.map((e) => [e.field, [e]]));
      throwXviFcValidationError(errorMap);
    }

    const updatedFields: Partial<{
      totalGrantAllocation: number;
      installment1Amount: number;
      installment2Amount: number;
      devolutionFormula: string;
      updatedBy: Types.ObjectId;
    }> = { updatedBy: new Types.ObjectId(user._id) };

    if (dto.totalGrantAllocation !== undefined) updatedFields.totalGrantAllocation = dto.totalGrantAllocation;
    if (dto.installment1Amount !== undefined) updatedFields.installment1Amount = dto.installment1Amount;
    if (dto.installment2Amount !== undefined) updatedFields.installment2Amount = dto.installment2Amount;
    if (dto.devolutionFormula !== undefined) updatedFields.devolutionFormula = dto.devolutionFormula;

    const mergedValues = {
      totalGrantAllocation: updatedFields.totalGrantAllocation ?? row.totalGrantAllocation,
      installment1Amount: updatedFields.installment1Amount ?? row.installment1Amount,
      installment2Amount: updatedFields.installment2Amount ?? row.installment2Amount,
      devolutionFormula: updatedFields.devolutionFormula ?? row.devolutionFormula,
    };

    const parsed: DfParsedExcelRow = {
      rowNumber: row.rowNumber,
      censusCode: row.censusCode ?? '',
      ulbName: row.ulbName,
      ...mergedValues,
    };

    let rowErrors: DfRowError[] = [];
    if (!row.ulbId) {
      rowErrors.push({ field: 'censusCode', code: 'unknownUlb', message: 'ULB not found in registry.' });
    } else {
      rowErrors = this.dfValidator.validateRow(parsed, installment, maxFormulaLength, {
        totalMoHUAAllocation: (formDoc['totalMoHUAAllocation'] as number | undefined) ?? undefined,
      });
    }

    const rowValidationStatus: 'VALID' | 'INVALID' = rowErrors.length === 0 ? 'VALID' : 'INVALID';

    const updatedRow = await this.rowModel
      .findByIdAndUpdate(
        rowId,
        {
          $set: {
            ...updatedFields,
            ...mergedValues,
            validationErrors: rowErrors,
            validationStatus: rowValidationStatus,
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    await this.recalculateFormSummary(
      formDoc['_id'] as Types.ObjectId,
      formDoc['activeDatasetVersion'] as number,
      new Types.ObjectId(user._id),
    );

    const updatedForm = await this.formModel
      .findById(formDoc['_id'] as Types.ObjectId)
      .lean<DfFormLeanDoc>()
      .exec();

    const validCountUpdated = await this.rowModel
      .countDocuments({
        form: formDoc['_id'] as Types.ObjectId,
        datasetVersion: formDoc['activeDatasetVersion'] as number,
        isActive: true,
        validationStatus: 'VALID',
      })
      .exec();
    const totalRowCount = await this.rowModel
      .countDocuments({
        form: formDoc['_id'] as Types.ObjectId,
        datasetVersion: formDoc['activeDatasetVersion'] as number,
        isActive: true,
      })
      .exec();

    const validationSummary = this.dfValidator.buildValidationSummary({
      excelRowCount: updatedForm?.excelRowCount ?? totalRowCount,
      validRowCount: validCountUpdated,
      errorRowCount: totalRowCount - validCountUpdated,
      missingUlbCount: updatedForm?.missingUlbCount ?? 0,
      newUlbCount: updatedForm?.newUlbCount ?? 0,
      duplicateUlbCount: updatedForm?.duplicateUlbCount ?? 0,
      totalMoHUAAllocation: updatedForm?.totalMoHUAAllocation ?? 0,
      totalAllocatedSum: updatedForm?.totalAllocatedSum ?? 0,
      activeDatasetVersion: updatedForm?.activeDatasetVersion ?? (formDoc['activeDatasetVersion'] as number),
    });

    return xviFcSuccess('Row updated.', { row: updatedRow, validationSummary });
  }

  async deleteUploadedExcel(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse> {
    assertStateAccess(user, stateId);

    const form = await this.findFormOrThrow(stateId, yearId, installment);
    const formDoc = form as Record<string, unknown>;
    assertCanStateEditForm((formDoc['currentFormStatus'] as number | undefined) ?? FORM_STATUS.NOT_STARTED);

    const formId = formDoc['_id'] as Types.ObjectId;
    const activeVersion = (formDoc['activeDatasetVersion'] as number) ?? 0;
    const userOid = new Types.ObjectId(user._id);

    // Rows are already hidden via isActive:false, so the physical delete can run fire-and-forget.
    if (activeVersion > 0) {
      await this.rowModel
        .updateMany({ form: formId, datasetVersion: activeVersion }, { $set: { isActive: false } })
        .exec();
      void this.rowModel.deleteMany({ form: formId, datasetVersion: activeVersion }).exec();
    }

    await this.formModel
      .findByIdAndUpdate(formId, {
        $unset: { excelFile: 1, errorExcelFile: 1 },
        $set: {
          excludedRows: [],
          validationStatus: 'NOT_VALIDATED',
          excelRowCount: 0,
          errorRowCount: 0,
          // Reset alongside the rest of the reconciliation state — previously left stale here
          // (unlike EULB's equivalent deleteUploadedExcel, which already reset all three).
          newUlbCount: 0,
          missingUlbCount: 0,
          duplicateUlbCount: 0,
          totalAllocatedSum: 0,
          updatedBy: userOid,
        },
      })
      .exec();

    return xviFcSuccess('Uploaded Excel data deleted.', null);
  }

  async getErrorSheet(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    user: AuthUser,
  ): Promise<ExcelJS.Buffer> {
    assertStateAccess(user, stateId);

    const form = await this.findFormOrThrow(stateId, yearId, installment);
    const formDoc = form as Record<string, unknown>;
    const activeVersion = (formDoc['activeDatasetVersion'] as number) ?? 0;

    if (activeVersion === 0) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'noDataset',
            message: 'No uploaded data found. Please validate an Excel file first.',
          },
        ],
      });
    }

    const rows = await this.rowModel
      .find({
        form: formDoc['_id'] as Types.ObjectId,
        datasetVersion: activeVersion,
        isActive: true,
      })
      .sort({ rowNumber: 1 })
      .lean()
      .exec();

    const dbErrorRows = rows.map((r) => ({
      rowNumber: r.rowNumber,
      censusCode: r.censusCode ?? '',
      ulbName: r.ulbName,
      totalGrantAllocation: r.totalGrantAllocation,
      installment1Amount: r.installment1Amount,
      installment2Amount: r.installment2Amount,
      devolutionFormula: r.devolutionFormula,
      errors: r.validationErrors?.map((e: DfRowError) => e.message).join('; ') ?? '',
    }));

    // Merge in rows excluded from persistence at the last validate call (unmatched or intra-batch
    // duplicate ULBs) — they never became row documents, so the DB query above can't see them.
    const excludedRows =
      (formDoc['excludedRows'] as
        | Array<{
            rowNumber: number;
            censusCode: string;
            ulbName: string;
            totalGrantAllocation?: unknown;
            installment1Amount?: unknown;
            installment2Amount?: unknown;
            devolutionFormula?: string;
            validationErrors: DfRowError[];
          }>
        | undefined) ?? [];

    const excludedErrorRows = excludedRows.map((r) => ({
      rowNumber: r.rowNumber,
      censusCode: r.censusCode,
      ulbName: r.ulbName,
      totalGrantAllocation: r.totalGrantAllocation,
      installment1Amount: r.installment1Amount,
      installment2Amount: r.installment2Amount,
      devolutionFormula: r.devolutionFormula,
      errors: r.validationErrors.map((e) => e.message).join('; '),
    }));

    const errorRows = [...dbErrorRows, ...excludedErrorRows].sort((a, b) => a.rowNumber - b.rowNumber);

    return this.excelService.generateExcel(DF_ERROR_EXCEL_HEADERS, errorRows, 'ULB-wise Allocation Errors');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async findFormOrThrow(stateId: string, yearId: string, installment: DfInstallment) {
    const form = await this.formModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment,
      })
      .lean()
      .exec();

    if (!form) {
      throw new NotFoundException('ULB-wise Allocation form not found for this state, year and installment.');
    }

    return form;
  }

  private async recalculateFormSummary(
    formId: Types.ObjectId,
    activeVersion: number,
    updatedBy: Types.ObjectId,
  ): Promise<void> {
    const rows = await this.rowModel
      .find({ form: formId, datasetVersion: activeVersion, isActive: true, validationStatus: 'VALID' })
      .select('totalGrantAllocation')
      .lean()
      .exec();

    const totalAllocatedSum = rows.reduce((sum, r) => sum + (r.totalGrantAllocation || 0), 0);
    const totalRowCount = await this.rowModel
      .countDocuments({ form: formId, datasetVersion: activeVersion, isActive: true })
      .exec();
    const errorRowCount = totalRowCount - rows.length;

    const formDoc = await this.formModel
      .findById(formId)
      .select('totalMoHUAAllocation excelRowCount missingUlbCount')
      .lean()
      .exec();
    const totalMoHUAAllocation = ((formDoc as Record<string, unknown> | null)?.['totalMoHUAAllocation'] as number) ?? 0;
    const missingUlbCount = ((formDoc as Record<string, unknown> | null)?.['missingUlbCount'] as number) ?? 0;
    // Backstop equality, not a forgiving tolerance — see devolution-formula-tolerance.helpers.ts.
    const allocationBalanced = amountsAreEqual(totalAllocatedSum, totalMoHUAAllocation);
    // missingUlbCount here is read-back only, never recomputed — see CLAUDE.md's "Invariants
    // worth knowing before you change adjacent code" section.
    const validationStatus = errorRowCount === 0 && missingUlbCount === 0 && allocationBalanced ? 'VALID' : 'INVALID';

    await this.formModel
      .findByIdAndUpdate(formId, {
        $set: { totalAllocatedSum, errorRowCount, validationStatus, updatedBy },
        ...(validationStatus === 'VALID' && { $unset: { errorExcelFile: 1 } }),
      })
      .exec();
  }

  /**
   * Devolution's own per-ULB edit lock — see CLAUDE.md's "Row-level claim-lock enforcement (PMU
   * Review feature)" section.
   */
  private async assertNoActiveClaimLockForUlb(
    stateId: string,
    yearId: string,
    installment: DfInstallment,
    ulbId: Types.ObjectId | null,
  ): Promise<void> {
    if (!ulbId) return;

    const activeLock = await this.claimLetterUlbLockModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment,
        ulbId,
        lockState: 'ACTIVE',
      })
      .select('_id')
      .lean()
      .exec();

    if (activeLock) {
      throw new ConflictException(
        'This ULB is locked in an active claim letter for this installment and cannot be edited.',
      );
    }
  }
}
