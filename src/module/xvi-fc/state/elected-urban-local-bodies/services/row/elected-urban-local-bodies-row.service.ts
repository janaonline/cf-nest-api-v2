import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { ExcelService, RowHeader } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { assertCanStateEditForm } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import {
  throwXviFcValidationErrorWithData,
  xviFcSuccess,
} from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse, XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';
import { ERROR_EXCEL_HEADERS } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import type { GetElectedUrbanLocalBodiesRowsQueryDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/get-elected-urban-local-bodies-rows-query.dto';
import type { UpdateElectedUrbanLocalBodiesRowDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/update-elected-urban-local-bodies-row.dto';
import {
  ElectedUrbanLocalBodiesValidator,
  extractDateConfig,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { EulbValidationSummary } from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';
import type { EulbValidationStatus } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';

interface UlbLean {
  _id: Types.ObjectId;
  name: string;
  censusCode?: string | null;
  sbCode?: string | null;
}

const DUPLICATE_CENSUS_CODE_MESSAGE = 'A ULB with this census code already exists for the selected design year.';

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && Reflect.get(err, 'code') === 11000;
}

@Injectable()
export class ElectedUrbanLocalBodiesRowService {
  private readonly logger = new Logger(ElectedUrbanLocalBodiesRowService.name);

  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly formModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly eulbValidator: ElectedUrbanLocalBodiesValidator,
    private readonly excelService: ExcelService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  async getRows(
    stateId: string,
    yearId: string,
    query: GetElectedUrbanLocalBodiesRowsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findFormOrThrow(stateId, yearId);
    const activeVersion = formDoc.activeDatasetVersion ?? 0;

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const filter: FilterQuery<EulbRowDocument> = {
      form: formDoc._id,
      datasetVersion: activeVersion,
    };

    if (query.validationStatus) filter['validationStatus'] = query.validationStatus;
    if (query.errorField) filter['errors.field'] = query.errorField;

    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter['$or'] = [{ censusCode: regex }, { ulbName: regex }];
    }

    const [rows, total] = await Promise.all([
      this.rowModel.find(filter).sort({ validationStatus: 1, rowNumber: 1 }).skip(skip).limit(limit).lean().exec(),
      this.rowModel.countDocuments(filter).exec(),
    ]);

    return xviFcSuccess('Rows fetched.', { rows, total, page, limit });
  }

  async updateRow(
    stateId: string,
    yearId: string,
    rowId: string,
    dto: UpdateElectedUrbanLocalBodiesRowDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findFormOrThrow(stateId, yearId);
    assertCanStateEditForm(formDoc.currentFormStatus);

    const activeVersion = formDoc.activeDatasetVersion ?? 0;
    const userOid = new Types.ObjectId(user._id);

    const row = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), form: formDoc._id, datasetVersion: activeVersion })
      .lean()
      .exec();

    if (!row) {
      throw new NotFoundException('Row not found in the active dataset.');
    }
    // Defense-in-depth for rows created before this filter existed — new rows for ineligible
    // ULBs are already rejected at Excel-ingestion time (see elected-urban-local-bodies-row.service
    // extra-ULB validation), but an already-existing row could otherwise still be edited here.
    // `row.ulbId` can be null on an intra-batch duplicate-census-code row — nothing to check then.
    if (row.ulbId) {
      await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
        row.ulbId,
        'XVIFC',
        CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rowFormJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
    const rowEditFields = getFieldsByType(rowFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const rowExtraUlbPortalFields = getFieldsByType(rowFormJsonFields, 'EULB_EXTRA_ULB_PORTAL_FIELDS');
    const rowDateConfig = extractDateConfig(rowEditFields, rowExtraUlbPortalFields);

    const effectiveStatus = dto.electedBodyStatus ?? row.electedBodyStatus ?? undefined;
    const isConstituted = effectiveStatus === 'Constituted';

    // For non-Constituted rows, exclude dates from DTO validation and clear them in DB.
    // Identity fields (censusCode/ulbName) belong to the ULB registry, never to a portal edit —
    // always ignored here to avoid spurious errors.
    const dtoForValidation = {
      ...(isConstituted ? dto : { ...dto, dateOfConstitution: undefined, dateOfExpiry: undefined }),
      censusCode: undefined,
      ulbName: undefined,
    };

    // Validate submitted editable fields before applying — produce uniform 400 with field-keyed errors
    const dtoErrors = this.eulbValidator.validatePortalUpdateFields(dtoForValidation, today, rowDateConfig);
    if (dtoErrors.length > 0) {
      const errorMap: XviFcValidationErrorMap = {};
      for (const e of dtoErrors) {
        const key = e.field ?? '_form';
        (errorMap[key] ??= []).push({ field: e.field, code: e.code, message: e.message });
      }
      throwXviFcValidationErrorWithData(errorMap, {
        rowId: String(row._id),
        rowNumber: row.rowNumber,
        censusCode: row.censusCode,
        ulbName: row.ulbName,
      });
    }

    // Build update applying only editable fields; clear dates for non-Constituted rows
    const updateFields: Record<string, unknown> = { updatedBy: userOid, lastUpdatedSource: 'PORTAL' };
    if (dto.electedBodyStatus !== undefined) updateFields['electedBodyStatus'] = dto.electedBodyStatus;
    if (isConstituted) {
      if (dto.dateOfConstitution !== undefined) updateFields['dateOfConstitution'] = new Date(dto.dateOfConstitution);
      if (dto.dateOfExpiry !== undefined) updateFields['dateOfExpiry'] = new Date(dto.dateOfExpiry);
    } else {
      updateFields['dateOfConstitution'] = null;
      updateFields['dateOfExpiry'] = null;
    }
    if (dto.remarks !== undefined) updateFields['remarks'] = dto.remarks;

    const mergedRow = {
      censusCode: row.censusCode,
      ulbName: row.ulbName,
      electedBodyStatus: effectiveStatus,
      dateOfConstitution: isConstituted
        ? dto.dateOfConstitution
          ? new Date(dto.dateOfConstitution)
          : (row.dateOfConstitution ?? undefined)
        : undefined,
      dateOfExpiry: isConstituted
        ? dto.dateOfExpiry
          ? new Date(dto.dateOfExpiry)
          : (row.dateOfExpiry ?? undefined)
        : undefined,
      remarks: dto.remarks ?? row.remarks,
      rowNumber: row.rowNumber,
    };

    let dbUlb: UlbLean | null = null;
    if (row.ulbId) {
      dbUlb = (await this.ulbModel
        .findById(row.ulbId)
        .select('_id name censusCode sbCode')
        .lean()
        .exec()) as UlbLean | null;
    }

    const newErrors = this.eulbValidator.revalidateRow(mergedRow, dbUlb, today, rowDateConfig);
    updateFields['validationStatus'] = newErrors.length === 0 ? 'VALID' : 'INVALID';
    updateFields['errors'] = newErrors;

    let updatedRow: typeof row | null;
    try {
      updatedRow = await this.rowModel.findByIdAndUpdate(row._id, { $set: updateFields }, { new: true }).lean().exec();
    } catch (err: unknown) {
      if (isMongoDuplicateKeyError(err)) {
        throwXviFcValidationErrorWithData(
          {
            censusCode: [
              {
                field: 'censusCode',
                code: 'duplicate',
                message: DUPLICATE_CENSUS_CODE_MESSAGE,
              },
            ],
          },
          {
            rowId: String(row._id),
            rowNumber: row.rowNumber,
            censusCode: row.censusCode,
            ulbName: row.ulbName,
          },
        );
      }
      throw new InternalServerErrorException('Failed to update row.');
    }

    // Recalculate form validation summary and include it in the response
    const validationSummary = await this.recalculateFormSummary(formDoc._id, activeVersion);

    return xviFcSuccess('Row updated successfully.', { row: updatedRow, validationSummary });
  }

  /**
   * Generates an on-demand error sheet Excel from the latest active row dataset, merged with the
   * excludedRows snapshot (rows dropped at the last validate/revalidate-from-file call — unmatched
   * or intra-batch duplicates — which never became row documents). The DB-driven half keeps portal
   * row edits reflected immediately; the snapshot half restores visibility into excluded rows that
   * would otherwise be invisible once dropped from persistence.
   * No S3 upload — buffer is streamed directly to the caller.
   *
   * @param stateId - ObjectId string of the target state.
   * @param yearId  - ObjectId string of the target year.
   * @param user    - Authenticated user; scope-checked against stateId.
   */
  async getErrorSheet(stateId: string, yearId: string, user: AuthUser): Promise<ArrayBuffer> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findFormOrThrow(stateId, yearId);
    const activeVersion = formDoc.activeDatasetVersion;

    if (!activeVersion) {
      throw new BadRequestException('No uploaded Elected Bodies data found to generate error sheet.');
    }

    const rows = await this.rowModel
      .find({ form: formDoc._id, datasetVersion: activeVersion, isActive: true })
      .sort({ rowNumber: 1 })
      .lean()
      .exec();

    const excludedRows = formDoc.excludedRows ?? [];

    if (rows.length === 0 && excludedRows.length === 0) {
      throw new BadRequestException('No uploaded Elected Bodies data found to generate error sheet.');
    }

    const dbExcelRows = rows.map((r) => ({
      rowNumber: r.rowNumber,
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
      errors: (r.errors ?? []).map((e) => e.message).join('; '),
    }));

    const excludedExcelRows = excludedRows.map((r) => ({
      rowNumber: r.rowNumber,
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
      errors: (r.errors ?? []).map((e) => e.message).join('; '),
    }));

    const excelRows = [...dbExcelRows, ...excludedExcelRows].sort((a, b) => a.rowNumber - b.rowNumber);

    const buf = await this.excelService.generateExcel(ERROR_EXCEL_HEADERS as RowHeader[], excelRows, 'Error Sheet');
    return buf as unknown as ArrayBuffer;
  }

  /**
   * Deletes the current uploaded Excel dataset for the given EULB form.
   * Hard-deletes all rows for the active dataset version, clears the file reference,
   * and resets the validation summary to NOT_VALIDATED.
   * Blocked when the form status does not allow editing.
   *
   * @param stateId    - ObjectId string of the target state.
   * @param yearId     - ObjectId string of the target year.
   * @param user       - Authenticated user; scope-checked against stateId.
   * @param _ip        - Client IP (reserved for future audit trail).
   * @param _userAgent - User-Agent header (reserved for future audit trail).
   */
  async deleteUploadedExcel(
    stateId: string,
    yearId: string,
    user: AuthUser,
    _ip: string,
    _userAgent: string,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findFormOrThrow(stateId, yearId);

    // Enforce same edit status gate as save-draft
    assertCanStateEditForm(formDoc.currentFormStatus);

    const activeVersion = formDoc.activeDatasetVersion ?? 0;
    const formId = formDoc._id;
    const userOid = new Types.ObjectId(user._id);

    // Hard-delete current active rows
    if (activeVersion > 0) {
      await this.rowModel.deleteMany({ form: formId, datasetVersion: activeVersion }).exec();
    }

    // Clear file reference and reset validation summary
    await this.formModel.findByIdAndUpdate(formId, {
      $unset: { electedBodyExcelFile: '' },
      $set: {
        excelRowCount: 0,
        matchedDbUlbCount: 0,
        missingDbUlbCount: 0,
        extraExcelRowCount: 0,
        errorRowCount: 0,
        validationStatus: 'NOT_VALIDATED',
        excludedRows: [],
        updatedBy: userOid,
      },
    });

    this.logger.log(`EULB uploaded Excel deleted [form=${formId.toString()} version=${activeVersion}] by ${user._id}`);

    return xviFcSuccess('Uploaded Excel removed successfully.', {
      validationSummary: {
        dbUlbCount: formDoc.dbUlbCount ?? 0,
        maxAllowedExcelRows: formDoc.maxAllowedExcelRows ?? 0,
        excelRowCount: 0,
        matchedDbUlbCount: 0,
        missingDbUlbCount: 0,
        extraExcelRowCount: 0,
        errorRowCount: 0,
        validationStatus: 'NOT_VALIDATED',
        activeDatasetVersion: activeVersion,
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findFormOrThrow(stateId: string, yearId: string) {
    const formDoc = await this.formModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .lean()
      .exec();

    if (!formDoc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }
    return formDoc;
  }

  /**
   * Recounts error rows in the active dataset, updates form validationStatus + errorRowCount,
   * and returns the full recalculated validation summary for inclusion in the PATCH response.
   * Marks form VALID only when errorRowCount === 0 and missingDbUlbCount === 0.
   */
  private async recalculateFormSummary(formId: Types.ObjectId, datasetVersion: number): Promise<EulbValidationSummary> {
    const [errorRowCount, form] = await Promise.all([
      this.rowModel.countDocuments({ form: formId, datasetVersion, validationStatus: 'INVALID' }),
      this.formModel
        .findById(formId, {
          dbUlbCount: 1,
          maxAllowedExcelRows: 1,
          excelRowCount: 1,
          matchedDbUlbCount: 1,
          missingDbUlbCount: 1,
          extraExcelRowCount: 1,
          activeDatasetVersion: 1,
        })
        .lean()
        .exec(),
    ]);

    const missingDbUlbCount = form?.missingDbUlbCount ?? 0;
    const validationStatus: EulbValidationStatus = errorRowCount === 0 && missingDbUlbCount === 0 ? 'VALID' : 'INVALID';

    await this.formModel.findByIdAndUpdate(formId, { $set: { errorRowCount, validationStatus } });

    return {
      dbUlbCount: form?.dbUlbCount ?? 0,
      maxAllowedExcelRows: form?.maxAllowedExcelRows ?? 0,
      excelRowCount: form?.excelRowCount ?? 0,
      matchedDbUlbCount: form?.matchedDbUlbCount ?? 0,
      missingDbUlbCount,
      extraExcelRowCount: form?.extraExcelRowCount ?? 0,
      errorRowCount,
      validationStatus,
      activeDatasetVersion: form?.activeDatasetVersion ?? 0,
    };
  }

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
}
