import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import {
  FileInfoNormalizerService,
  type HydratedFileInfoResponse,
} from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { keyByFieldKey, requireField } from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { deriveFileValidationOptions } from 'src/module/xvi-fc/common/utils/xvi-fc-file-constraint.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import {
  POST_SUBMISSION_UPDATE_ALLOWED_STATUSES,
  assertCanViewPostSubmissionUpdate,
  canViewPostSubmissionUpdate,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
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
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import {
  resolveXviFcFolderPathsInFormJson,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
import {
  deriveElectedBodyStatuses,
  extractDateConfig,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { computeEulbStatusSummary } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-status-summary.helper';
import type { GetEulbPostSubmissionUpdateRowsQueryDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/get-eulb-post-submission-update-rows-query.dto';
import type { ValidateEulbPostSubmissionUpdateDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/validate-eulb-post-submission-update.dto';
import type { SubmitEulbPostSubmissionUpdateDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/submit-eulb-post-submission-update.dto';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import type {
  EulbPostSubmissionSubmitRowError,
  EulbPostSubmissionUpdateMetaData,
  EulbPostSubmissionUpdatePermissions,
  EulbPostSubmissionUpdateRow,
  EulbPostSubmissionUpdateRowsData,
  EulbPostSubmissionUpdateSubmitData,
  EulbPostSubmissionUpdateValidateData,
  EulbPostSubmissionUpdateValidateRow,
  EulbValidationSummary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

/**
 * Builds the eligibility `$or` condition: 'Not Constituted' always qualifies; 'Constituted' qualifies only when expired.
 * @param today Start-of-day reference date for the expiry `$lt` comparison.
 */
export function buildEligibleRowCondition(today: Date): FilterQuery<EulbRowDocument> {
  return {
    $or: [{ electedBodyStatus: 'Not Constituted' }, { electedBodyStatus: 'Constituted', dateOfExpiry: { $lt: today } }],
  };
}

/**
 * Full Mongoose filter scoping eligible rows to a specific form, state, year, and dataset version.
 * @param formId Parent form ObjectId.
 * @param stateId State ID string.
 * @param yearId Year ID string.
 * @param datasetVersion Active dataset version from the form document.
 * @param today Start-of-day reference date passed into `buildEligibleRowCondition`.
 */
export function buildPostSubmissionEligibleRowsFilter(
  formId: Types.ObjectId,
  stateId: string,
  yearId: string,
  datasetVersion: number,
  today: Date,
): FilterQuery<EulbRowDocument> {
  return {
    form: formId,
    state: new Types.ObjectId(stateId),
    year: new Types.ObjectId(yearId),
    datasetVersion,
    isActive: true,
    $and: [buildEligibleRowCondition(today)],
  };
}

@Injectable()
export class EulbPostSubmissionUpdateService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly formModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    private readonly validator: ElectedUrbanLocalBodiesValidator,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
  ) {}

  /**
   * Returns post-submission update metadata: form status, user permissions, and eligible row count.
   * @param stateId Target state ID.
   * @param yearId Target year ID.
   * @param user Authenticated user making the request.
   */
  async getMetadata(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbPostSubmissionUpdateMetaData>> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findForm(stateId, yearId);
    const formStatus = formDoc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const canUpdate = canViewPostSubmissionUpdate(formStatus);
    const permissions = this.buildPermissions(user, stateId, formStatus);

    let eligibleRowCount = 0;
    if (canUpdate && formDoc) {
      const today = this.startOfToday();
      eligibleRowCount = await this.rowModel
        .countDocuments(
          buildPostSubmissionEligibleRowsFilter(formDoc._id, stateId, yearId, formDoc.activeDatasetVersion ?? 0, today),
        )
        .exec();
    }

    const formJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
    const rowEditFields = getFieldsByType(formJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const rawQuestions = getFieldsByType(formJsonFields, 'EULB_POST_SUBMIT_UPDATE_FIELDS');
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const folderPathContext: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };
    const questions = resolveXviFcFolderPathsInFormJson(rawQuestions, folderPathContext);

    const data: EulbPostSubmissionUpdateMetaData = {
      stateId,
      formStatus,
      canUpdate,
      permissions,
      summary: { eligibleRowCount },
      rowEditFields,
      questions,
    };

    return xviFcSuccess('Post-submission update metadata fetched.', data);
  }

  /**
   * Returns a paginated list of rows eligible for post-submission update with optional status/search filters.
   * @param stateId Target state ID.
   * @param yearId Target year ID.
   * @param query Pagination and filter options (page, limit, validationStatus, electedBodyStatus, search).
   * @param user Authenticated user making the request.
   */
  async getEligibleRows(
    stateId: string,
    yearId: string,
    query: GetEulbPostSubmissionUpdateRowsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbPostSubmissionUpdateRowsData>> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findForm(stateId, yearId);
    if (!formDoc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }
    assertCanViewPostSubmissionUpdate(formDoc.currentFormStatus);

    const today = this.startOfToday();
    const activeVersion = formDoc.activeDatasetVersion ?? 0;

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const filter = buildPostSubmissionEligibleRowsFilter(formDoc._id, stateId, yearId, activeVersion, today);

    if (query.validationStatus) filter['validationStatus'] = query.validationStatus;
    if (query.electedBodyStatus) filter['electedBodyStatus'] = query.electedBodyStatus;

    // Use $and to combine the eligible-row $or with the optional search $or without one overwriting the other
    if (query.search) {
      const regex = new RegExp(escapeRegex(query.search), 'i');
      filter['$and'] = [...(filter['$and'] ?? []), { $or: [{ censusCode: regex }, { ulbName: regex }] }];
    }

    const eligibleRowsFormJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
    const eligibleRowsRowEditFields = getFieldsByType(eligibleRowsFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const electedBodyStatuses = deriveElectedBodyStatuses(eligibleRowsRowEditFields);

    const [rawRows, total, statusSummary] = await Promise.all([
      this.rowModel.find(filter).sort({ validationStatus: 1, rowNumber: 1 }).skip(skip).limit(limit).lean().exec(),
      this.rowModel.countDocuments(filter).exec(),
      computeEulbStatusSummary(this.rowModel, formDoc._id, stateId, yearId, activeVersion, electedBodyStatuses),
    ]);

    const rows: EulbPostSubmissionUpdateRow[] = rawRows.map((r) => ({
      _id: String(r._id),
      rowNumber: r.rowNumber,
      censusCode: r.censusCode ?? null,
      ulbName: r.ulbName,
      electedBodyStatus: r.electedBodyStatus ?? '',
      dateOfConstitution:
        r.dateOfConstitution instanceof Date
          ? r.dateOfConstitution.toISOString().split('T')[0]
          : (r.dateOfConstitution ?? null),
      dateOfExpiry:
        r.dateOfExpiry instanceof Date ? r.dateOfExpiry.toISOString().split('T')[0] : (r.dateOfExpiry ?? null),
      remarks: r.remarks ?? null,
      validationStatus: r.validationStatus,
      errors: (r.errors ?? []).map((e) => ({
        field: e.field,
        code: e.code,
        message: e.message,
        ...(e.value !== undefined ? { value: e.value } : {}),
      })),
    }));

    const data: EulbPostSubmissionUpdateRowsData = {
      rows,
      total,
      page,
      limit,
      eligibleRule: {
        allowedFormStatuses: [...POST_SUBMISSION_UPDATE_ALLOWED_STATUSES],
        today: today.toISOString().split('T')[0],
      },
      statusSummary,
    };

    return xviFcSuccess('Eligible rows for post-submission update fetched.', data);
  }

  /**
   * Validates and atomically applies a post-submission update: writes row history and recalculates the form summary.
   * @param stateId Target state ID.
   * @param yearId Target year ID.
   * @param dto Batch payload containing the supporting document and proposed row updates.
   * @param user Authenticated user making the request.
   */
  async submitBatch(
    stateId: string,
    yearId: string,
    dto: SubmitEulbPostSubmissionUpdateDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbPostSubmissionUpdateSubmitData>> {
    this.assertStateAccess(user, stateId);

    // ─── Document validation ───────────────────────────────────────────────────
    // Backend-generated documents never flow through this path — `document` always
    // originates from the client DTO here, so `existing` is always null (no prior
    // stored document to preserve/compare against for a new post-submission batch).
    // The DTO/API field is named `document`; the DB form-json key for this same field is
    // `proofOfElection` (EULB_POST_SUBMIT_UPDATE_FIELDS group) — single source of truth for
    // its allowed types/size, just addressed by a different key than the wire field name.

    const documentFormJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
    const postSubmitUpdateFields = getFieldsByType(documentFormJsonFields, 'EULB_POST_SUBMIT_UPDATE_FIELDS');
    const documentField = requireField(
      keyByFieldKey(postSubmitUpdateFields),
      'proofOfElection',
      'ElectedUrbanLocalBodiesPostSubmissionUpdateService.submitBatch',
    );
    const { file: documentFile, errors: documentErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.document as unknown as Record<string, unknown>,
      null,
      deriveFileValidationOptions(documentField, 'document'),
    );
    if (documentErrors.length > 0) throwXviFcValidationError({ document: documentErrors });
    if (!documentFile) {
      throwXviFcValidationError({
        document: [{ field: 'document', code: 'required', message: 'document is required.' }],
      });
    }

    // ─── Duplicate rowId check ─────────────────────────────────────────────────

    const rowIds = dto.rows.map((r) => r.rowId);
    if (new Set(rowIds).size !== rowIds.length) {
      throwXviFcValidationError({ rows: [{ message: 'Duplicate row IDs are not allowed.' }] });
    }

    // ─── Form + eligibility checks ─────────────────────────────────────────────

    const formDoc = await this.findForm(stateId, yearId);
    if (!formDoc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }
    assertCanViewPostSubmissionUpdate(formDoc.currentFormStatus);

    const today = this.startOfToday();
    const activeVersion = formDoc.activeDatasetVersion ?? 0;

    const submitRowEditFields = getFieldsByType(documentFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const submitExtraUlbPortalFields = getFieldsByType(documentFormJsonFields, 'EULB_EXTRA_ULB_PORTAL_FIELDS');
    const submitDateConfig = extractDateConfig(submitRowEditFields, submitExtraUlbPortalFields);

    const dbRows = await this.rowModel
      .find({
        _id: { $in: rowIds.map((id) => new Types.ObjectId(id)) },
        form: formDoc._id,
        datasetVersion: activeVersion,
        isActive: true,
      })
      .lean()
      .exec();

    if (dbRows.length !== rowIds.length) {
      throwXviFcValidationError({
        rows: [{ message: 'One or more row IDs were not found or do not belong to this form.' }],
      });
    }

    const ineligible = dbRows.filter((r) => !this.isRowEligibleInMemory(r, today));
    if (ineligible.length > 0) {
      throwXviFcValidationError({
        rows: [{ message: 'One or more submitted rows are not eligible for post-submission update.' }],
      });
    }

    // ─── Business validation of proposed values ────────────────────────────────

    const dbRowMap = new Map(dbRows.map((r) => [String(r._id), r]));
    const rowErrors: EulbPostSubmissionSubmitRowError[] = [];
    const fieldErrorMap: Record<string, Array<{ field?: string; code?: string; message: string }>> = {};

    for (const proposed of dto.rows) {
      const dbRow = dbRowMap.get(proposed.rowId)!;
      const errors = this.validator.validatePostSubmissionRowUpdate(
        {
          electedBodyStatus: proposed.electedBodyStatus,
          dateOfConstitution: proposed.dateOfConstitution,
          dateOfExpiry: proposed.dateOfExpiry,
          remarks: proposed.remarks,
        },
        today,
        submitDateConfig,
      );
      if (errors.length > 0) {
        rowErrors.push({
          rowId: proposed.rowId,
          rowNumber: dbRow.rowNumber,
          censusCode: dbRow.censusCode ?? null,
          ulbName: dbRow.ulbName,
          errors,
        });
        for (const e of errors) {
          const key = e.field ?? '_form';
          const bucket = (fieldErrorMap[key] ??= []);
          if (!bucket.some((x) => x.code === e.code)) {
            bucket.push({ field: e.field, code: e.code, message: e.message });
          }
        }
      }
    }

    if (rowErrors.length > 0) {
      throwXviFcValidationErrorWithData(fieldErrorMap, { rowErrors });
    }

    // ─── MongoDB transaction ───────────────────────────────────────────────────
    // Atomically appends one correction-batch record to the form (postSubmissionUpdates[]) and
    // applies every proposed row change + per-row audit-history entry — all tagged with the same
    // batchId. Without the transaction, a crash between the two writes could leave a batch record
    // with no matching row changes applied, or rows changed with no batch/audit trail explaining
    // why — either is a silent data-integrity gap for a workflow whose whole purpose is producing
    // an accurate correction history. Self-contained to this file: nothing outside this service
    // reads postSubmissionUpdates[]/batchId, so this isn't cross-referenced from an ADR.

    const batchId = new Types.ObjectId();
    const now = new Date();
    // Stamped explicitly (rather than left to Mongoose's automatic FileInfo timestamps)
    // because `documentRef` is echoed back in the response below without a DB re-read —
    // always a new document here (existing is always null for this call site).
    const documentRef: FileInfo = { ...documentFile, createdAt: now, updatedAt: now };

    const session = await this.formModel.db.startSession();
    try {
      session.startTransaction();

      const userOid = new Types.ObjectId(user._id);

      await this.formModel
        .findByIdAndUpdate(
          formDoc._id,
          {
            $push: {
              postSubmissionUpdates: {
                batchId,
                status: 'APPLIED',
                document: documentRef,
                rowIds: rowIds.map((id) => new Types.ObjectId(id)),
                submittedBy: userOid,
                submittedAt: now,
                appliedAt: now,
              },
            },
          },
          { session },
        )
        .exec();

      await Promise.all(
        dto.rows.map((proposed) => {
          const dbRow = dbRowMap.get(proposed.rowId)!;
          const isConstituted = proposed.electedBodyStatus === 'Constituted';
          const historyEntry = {
            batchId,
            source: 'POST_SUBMISSION_UPDATE' as const,
            previous: {
              electedBodyStatus: dbRow.electedBodyStatus ?? null,
              dateOfConstitution:
                dbRow.dateOfConstitution instanceof Date
                  ? dbRow.dateOfConstitution.toISOString().split('T')[0]
                  : (dbRow.dateOfConstitution ?? null),
              dateOfExpiry:
                dbRow.dateOfExpiry instanceof Date
                  ? dbRow.dateOfExpiry.toISOString().split('T')[0]
                  : (dbRow.dateOfExpiry ?? null),
              remarks: dbRow.remarks ?? null,
            },
            updated: {
              electedBodyStatus: proposed.electedBodyStatus,
              dateOfConstitution: proposed.dateOfConstitution ?? null,
              dateOfExpiry: proposed.dateOfExpiry ?? null,
              remarks: proposed.remarks ?? null,
            },
            updatedBy: userOid,
            updatedAt: now,
          };
          return this.rowModel
            .findByIdAndUpdate(
              dbRow._id,
              {
                $set: {
                  electedBodyStatus: proposed.electedBodyStatus,
                  dateOfConstitution:
                    isConstituted && proposed.dateOfConstitution ? new Date(proposed.dateOfConstitution) : null,
                  dateOfExpiry: isConstituted && proposed.dateOfExpiry ? new Date(proposed.dateOfExpiry) : null,
                  remarks: proposed.remarks ?? dbRow.remarks ?? null,
                  lastUpdatedSource: 'POST_SUBMISSION_UPDATE',
                  lastUpdateBatchId: batchId,
                  validationStatus: 'VALID',
                  errors: [],
                  updatedBy: userOid,
                },
                $push: { updateHistory: historyEntry },
              },
              { session },
            )
            .exec();
        }),
      );

      const [errorRowCount, formForSummary] = await Promise.all([
        this.rowModel.countDocuments(
          { form: formDoc._id, datasetVersion: activeVersion, validationStatus: 'INVALID' },
          { session },
        ),
        this.formModel
          .findById(
            formDoc._id,
            {
              dbUlbCount: 1,
              maxAllowedExcelRows: 1,
              excelRowCount: 1,
              matchedDbUlbCount: 1,
              missingDbUlbCount: 1,
              extraExcelRowCount: 1,
              duplicateUlbCount: 1,
              activeDatasetVersion: 1,
            },
            { session },
          )
          .lean()
          .exec(),
      ]);

      const missingDbUlbCount = formForSummary?.missingDbUlbCount ?? 0;
      const newValidationStatus = errorRowCount === 0 && missingDbUlbCount === 0 ? 'VALID' : 'INVALID';

      await this.formModel
        .findByIdAndUpdate(formDoc._id, { $set: { errorRowCount, validationStatus: newValidationStatus } }, { session })
        .exec();

      await session.commitTransaction();

      const validationSummary: EulbValidationSummary = {
        dbUlbCount: formForSummary?.dbUlbCount ?? 0,
        maxAllowedExcelRows: formForSummary?.maxAllowedExcelRows ?? 0,
        excelRowCount: formForSummary?.excelRowCount ?? 0,
        matchedDbUlbCount: formForSummary?.matchedDbUlbCount ?? 0,
        missingDbUlbCount,
        extraExcelRowCount: formForSummary?.extraExcelRowCount ?? 0,
        duplicateUlbCount: formForSummary?.duplicateUlbCount ?? 0,
        errorRowCount,
        validationStatus: newValidationStatus,
        activeDatasetVersion: formForSummary?.activeDatasetVersion ?? 0,
      };

      const hydratedDocument = this.fileInfoNormalizer.hydrateFileInfoForResponse(documentRef, (p) => {
        try {
          return this.fileTokenService.signFileUrl(p);
        } catch {
          return p;
        }
      });

      return xviFcSuccess('Elected Urban Local Bodies update submitted successfully.', {
        batchId: batchId.toString(),
        updatedRowCount: dto.rows.length,
        document: hydratedDocument as HydratedFileInfoResponse,
        validationSummary,
      });
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Dry-run: validates proposed row updates and returns per-row errors without persisting any changes.
   * @param stateId Target state ID.
   * @param yearId Target year ID.
   * @param dto Proposed row updates to validate.
   * @param user Authenticated user making the request.
   */
  async validateBatch(
    stateId: string,
    yearId: string,
    dto: ValidateEulbPostSubmissionUpdateDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbPostSubmissionUpdateValidateData>> {
    this.assertStateAccess(user, stateId);

    const formDoc = await this.findForm(stateId, yearId);
    if (!formDoc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }
    assertCanViewPostSubmissionUpdate(formDoc.currentFormStatus);

    const rowIds = dto.rows.map((r) => r.rowId);
    if (new Set(rowIds).size !== rowIds.length) {
      throwXviFcValidationError({ rows: [{ message: 'Duplicate row IDs are not allowed in a single request.' }] });
    }

    const today = this.startOfToday();
    const activeVersion = formDoc.activeDatasetVersion ?? 0;

    const validateFormJsonFields = await this.eulbFormJsonConfig.loadFields(yearId);
    const validateRowEditFields = getFieldsByType(validateFormJsonFields, 'EULB_ROW_EDIT_FIELDS');
    const validateExtraUlbPortalFields = getFieldsByType(validateFormJsonFields, 'EULB_EXTRA_ULB_PORTAL_FIELDS');
    const validateDateConfig = extractDateConfig(validateRowEditFields, validateExtraUlbPortalFields);

    const dbRows = await this.rowModel
      .find({
        _id: { $in: rowIds.map((id) => new Types.ObjectId(id)) },
        form: formDoc._id,
        datasetVersion: activeVersion,
        isActive: true,
      })
      .lean()
      .exec();

    if (dbRows.length !== rowIds.length) {
      throwXviFcValidationError({
        rows: [{ message: 'One or more row IDs were not found or do not belong to this form.' }],
      });
    }

    const ineligible = dbRows.filter((r) => !this.isRowEligibleInMemory(r, today));
    if (ineligible.length > 0) {
      throwXviFcValidationError({
        rows: [{ message: 'One or more submitted rows are not eligible for post-submission update.' }],
      });
    }

    const dbRowMap = new Map(dbRows.map((r) => [String(r._id), r]));

    const resultRows: EulbPostSubmissionUpdateValidateRow[] = dto.rows.map((proposed) => {
      const dbRow = dbRowMap.get(proposed.rowId)!;
      const errors = this.validator.validatePostSubmissionRowUpdate(
        {
          electedBodyStatus: proposed.electedBodyStatus,
          dateOfConstitution: proposed.dateOfConstitution,
          dateOfExpiry: proposed.dateOfExpiry,
          remarks: proposed.remarks,
        },
        today,
        validateDateConfig,
      );
      return {
        rowId: proposed.rowId,
        rowNumber: dbRow.rowNumber,
        censusCode: dbRow.censusCode ?? null,
        ulbName: dbRow.ulbName,
        electedBodyStatus: proposed.electedBodyStatus,
        dateOfConstitution: proposed.dateOfConstitution ?? null,
        dateOfExpiry: proposed.dateOfExpiry ?? null,
        remarks: proposed.remarks ?? '',
        validationStatus: errors.length > 0 ? 'INVALID' : 'VALID',
        errors,
      };
    });

    const errorRowCount = resultRows.filter((r) => r.validationStatus === 'INVALID').length;
    const data: EulbPostSubmissionUpdateValidateData = {
      validationStatus: errorRowCount > 0 ? 'INVALID' : 'VALID',
      rows: resultRows,
      errorRowCount,
      validRowCount: resultRows.length - errorRowCount,
      totalRowCount: resultRows.length,
    };

    return xviFcSuccess(
      errorRowCount > 0
        ? `Validation complete. ${errorRowCount} of ${resultRows.length} row(s) have errors.`
        : 'All rows are valid.',
      data,
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Fetches the active EULB form for a (state, year) pair; returns null if not found.
   * @param stateId State ID string.
   * @param yearId Year ID string.
   */
  private async findForm(stateId: string, yearId: string) {
    return this.formModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .lean()
      .exec();
  }

  /**
   * Derives canView/canSubmitUpdate permissions for the requesting user against the given form status.
   * @param user Authenticated user.
   * @param stateId Target state ID.
   * @param formStatus Current numeric form status code.
   */
  private buildPermissions(user: AuthUser, stateId: string, formStatus: number): EulbPostSubmissionUpdatePermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = this.hasStateAccess(user, stateId);
    const canUpdate = canViewPostSubmissionUpdate(formStatus);
    const canView = perms.has(Permission.VIEW_STATE_FORMS) && hasAccess && canUpdate;
    const canSubmitUpdate = perms.has(Permission.FINAL_SUBMIT_STATE_FORMS) && hasAccess && canUpdate;
    return { canView, canSubmitUpdate };
  }

  /**
   * In-memory equivalent of `buildEligibleRowCondition` — mirrors the MongoDB `$lt` logic exactly.
   * @param row Row document to check; only `electedBodyStatus` and `dateOfExpiry` are read.
   * @param today Start-of-day reference date for the expiry comparison.
   */
  private isRowEligibleInMemory(
    row: { electedBodyStatus?: string; dateOfExpiry?: Date | string },
    today: Date,
  ): boolean {
    if (row.electedBodyStatus === 'Not Constituted') return true;
    if (row.electedBodyStatus === 'Constituted') {
      const expiry =
        row.dateOfExpiry instanceof Date
          ? row.dateOfExpiry
          : typeof row.dateOfExpiry === 'string'
            ? new Date(row.dateOfExpiry)
            : null;
      return !!expiry && expiry.getTime() < today.getTime();
    }
    return false;
  }

  /** Returns midnight of the current local day — used as the reference point for all eligibility date comparisons. */
  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Returns true if the user is an admin or is a state user whose state matches `stateId`.
   * @param user Authenticated user.
   * @param stateId State ID to check access for.
   */
  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  /**
   * Throws `ForbiddenException` if the user does not have access to the given state.
   * @param user Authenticated user.
   * @param stateId State ID to enforce access on.
   */
  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
