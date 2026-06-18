import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { ExcelService, RowHeader } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { assertCanStateEditForm } from '../../common/utils/xvi-fc-form-status-access.util';
import { xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { ERROR_EXCEL_HEADERS } from './constants/elected-urban-local-bodies.constants';
import type { GetElectedUrbanLocalBodiesRowsQueryDto } from './dto/get-elected-urban-local-bodies-rows-query.dto';
import type { UpdateElectedUrbanLocalBodiesRowDto } from './dto/update-elected-urban-local-bodies-row.dto';
import { ElectedUrbanLocalBodiesValidator } from './elected-urban-local-bodies.validator';
import type { EulbValidationSummary } from './elected-urban-local-bodies.types';
import type { EulbValidationStatus } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';

interface UlbLean {
  _id: Types.ObjectId;
  name: string;
  censusCode?: string | null;
  sbCode?: string | null;
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
    if (query.rowType) filter['rowType'] = query.rowType;
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Validate submitted editable fields before applying — produce uniform 400 with errors[]
    const dtoErrors = this.eulbValidator.validatePortalUpdateFields(dto, today);
    if (dtoErrors.length > 0) {
      const errors = dtoErrors.map((e) => ({
        rowId: String(row._id),
        rowNumber: row.rowNumber,
        censusCode: row.censusCode,
        ulbName: row.ulbName,
        ...e,
      }));
      throw new BadRequestException({ message: 'Row validation failed.', errors });
    }

    // Build update applying only editable fields
    const updateFields: Record<string, unknown> = { updatedBy: userOid, lastUpdatedSource: 'PORTAL' };
    if (dto.electedBodyStatus !== undefined) updateFields['electedBodyStatus'] = dto.electedBodyStatus;
    if (dto.dateOfConstitution !== undefined) updateFields['dateOfConstitution'] = new Date(dto.dateOfConstitution);
    if (dto.dateOfExpiry !== undefined) updateFields['dateOfExpiry'] = new Date(dto.dateOfExpiry);
    if (dto.remarks !== undefined) updateFields['remarks'] = dto.remarks;

    const mergedRow = {
      censusCode: row.censusCode,
      ulbName: row.ulbName,
      electedBodyStatus: dto.electedBodyStatus ?? row.electedBodyStatus,
      dateOfConstitution: dto.dateOfConstitution ? new Date(dto.dateOfConstitution) : row.dateOfConstitution,
      dateOfExpiry: dto.dateOfExpiry ? new Date(dto.dateOfExpiry) : row.dateOfExpiry,
      remarks: dto.remarks ?? row.remarks,
      rowNumber: row.rowNumber,
      rowType: row.rowType,
    };

    let dbUlb: UlbLean | null = null;
    if (row.rowType === 'DB_ULB' && row.ulbId) {
      dbUlb = (await this.ulbModel
        .findById(row.ulbId)
        .select('_id name censusCode sbCode')
        .lean()
        .exec()) as UlbLean | null;
    }

    const newErrors = this.eulbValidator.revalidateRow(mergedRow, dbUlb, today);
    updateFields['validationStatus'] = newErrors.length === 0 ? 'VALID' : 'INVALID';
    updateFields['errors'] = newErrors;

    const updatedRow = await this.rowModel
      .findByIdAndUpdate(row._id, { $set: updateFields }, { new: true })
      .lean()
      .exec();

    // Recalculate form validation summary and include it in the response
    const validationSummary = await this.recalculateFormSummary(formDoc._id, activeVersion);

    return xviFcSuccess('Row updated successfully.', { row: updatedRow, validationSummary });
  }

  /**
   * Generates an on-demand error sheet Excel from the latest active row dataset.
   * Includes every row; the `errors` column is empty for valid rows and contains
   * joined validation messages for invalid rows.
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

    if (rows.length === 0) {
      throw new BadRequestException('No uploaded Elected Bodies data found to generate error sheet.');
    }

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
      errors: (r.errors ?? []).map((e) => e.message).join('; '),
    }));

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
