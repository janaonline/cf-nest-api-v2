import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Buffer } from 'exceljs';
import ms, { type StringValue } from 'ms';
import { Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ExcelColumnValidation, ExcelService, RowHeader } from 'src/services/excel/excel.service';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
  canStateEditForm,
  canStateFinalSubmitForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import type { FormData } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type {
  FieldConfig,
  FieldSupportingContent,
  FormFieldOption,
  HydratedFieldConfig,
  UploadedFileValue,
} from 'src/module/xvi-fc/common/types/field-config.type';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  throwXviFcValidationError,
  throwXviFcValidationErrorWithData,
  xviFcSuccess,
} from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
  EulbValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  EULB_ACTION_DOWNLOAD_ERROR_SHEET,
  EULB_ACTION_DOWNLOAD_TEMPLATE,
  EULB_ACTION_REVALIDATE_EXCEL,
  EULB_ACTION_VIEW_UPLOADED_DATA,
  EULB_FORM_NAME,
  TEMPLATE_HEADERS,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import type { SaveElectedUrbanLocalBodiesDraftDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/save-elected-urban-local-bodies-draft.dto';
import type { FinalSubmitElectedUrbanLocalBodiesDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/final-submit-elected-urban-local-bodies.dto';
import type {
  EulbFormGetResponseData,
  EulbFormLeanDoc,
  EulbFormPermissions,
  EulbDumpFormRecord,
  EulbDumpRow,
  EulbDumpRowRecord,
  EulbValidationSummary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

/** Converts a date validator value ('2021-05-31' or 'TODAY') to an Excel formula expression. */
function toExcelDateExpr(dateVal: string): string {
  if (dateVal === 'TODAY') return 'TODAY()';
  const d = new Date(dateVal);
  return `DATE(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
}

/** Converts a stored date (Date object or ISO string) to a Date for ExcelJS to serialize as a date
 *  serial, or '' for empty/invalid values. Returning a Date keeps ISNUMBER() checks in the
 *  validation formula satisfied; returning '' leaves the cell blank. */
function dateToTemplateValue(val: Date | string | undefined | null): Date | string {
  if (!val) return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? '' : d;
}

function dateToDumpValue(val: Date | string | undefined | null): string {
  if (!val) return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toISOString().split('T')[0];
}

function datetimeToDumpValue(val: Date | undefined): string {
  return val ? val.toISOString() : '';
}

type EulbTemplateRow = {
  censusCode: string;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: Date | string;
  dateOfExpiry: Date | string;
  remarks: string;
};

const EULB_DUMP_HEADERS: RowHeader[] = [
  { label: 'Row Number', key: 'rowNumber', width: 14 },
  { label: 'Census Code', key: 'censusCode', width: 16 },
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  { label: 'Elected Body Status', key: 'electedBodyStatus', width: 24 },
  { label: 'Date of Constitution', key: 'dateOfConstitution', width: 24 },
  { label: 'Date of Expiry', key: 'dateOfExpiry', width: 20 },
  { label: 'Remarks', key: 'remarks', width: 35 },
  { label: 'Row Type', key: 'rowType', width: 16 },
  { label: 'Validation Status', key: 'validationStatus', width: 20 },
  { label: 'Latest Data Source', key: 'latestDataSource', width: 22 },
  { label: 'Dataset Version', key: 'datasetVersion', width: 18 },
  { label: 'Submitted By', key: 'submittedBy', width: 25 },
  { label: 'Submitted At', key: 'submittedAt', width: 24 },
  { label: 'Created By', key: 'createdBy', width: 25 },
  { label: 'Updated By', key: 'updatedBy', width: 25 },
  { label: 'Created At', key: 'createdAt', width: 24 },
  { label: 'Updated At', key: 'updatedAt', width: 24 },
];

@Injectable()
export class ElectedUrbanLocalBodiesService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly model: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly validator: DynamicFormValidationService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly config: ConfigService,
    private readonly fileUrlNormalizer: FileUrlNormalizerService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
  ) {}

  /**
   * Returns the Elected Urban Local Bodies question config for frontend rendering.
   * Loads EULB_MAIN_FORM_FIELDS from the DB-backed form config (Redis-cached).
   * The electedBodyExcelFile question receives default (no-form) supporting actions.
   */
  async getQuestions(): Promise<XviFcApiResponse<HydratedFieldConfig[]>> {
    const fields = await this.eulbFormJsonConfig.loadFields();
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }
    const noPermissions: EulbFormPermissions = { canView: false, canEdit: false, canFinalSubmit: false };
    const questions = mainFormFields.map((q) => {
      if (q.key === 'electedBodyExcelFile') {
        return { ...q, supportingContent: this.buildElectedBodyFileSupportingContent(null, noPermissions) };
      }
      return q;
    });
    return xviFcSuccess('Elected Urban Local Bodies questions fetched.', questions as HydratedFieldConfig[]);
  }

  /**
   * Returns the hydrated EULB form for a given state and year.
   * Merges saved field values with TEMP_QUESTIONS defaults. Signs file URLs.
   * Returns a default Not Started form when no record exists yet.
   *
   * @param stateId - ObjectId string of the target state.
   * @param yearId  - ObjectId string of the target year.
   * @param user    - Authenticated user; scope-checked against stateId.
   */
  async getForm(stateId: string, yearId: string, user: AuthUser): Promise<XviFcApiResponse<EulbFormGetResponseData>> {
    this.assertStateAccess(user, stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    const rowEditFields = getFieldsByType(fields, 'EULB_ROW_EDIT_FIELDS');
    const extraUlbEditFields = getFieldsByType(fields, 'EULB_EXTRA_ULB_PORTAL_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const doc = await this.model
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<EulbFormLeanDoc>()
      .exec();

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const jwtExpiresIn = (this.config.get<string>('JWT_EXPIRES_IN') ?? '24h') as StringValue;
    const jwtExpiresMs = ms(jwtExpiresIn) ?? 24 * 60 * 60 * 1000;

    // Build savedData from top-level form fields
    const savedData: FormData = {};
    if (doc) {
      if (doc.ulbCount !== undefined) savedData['ulbCount'] = doc.ulbCount;
      if (doc.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;
      if (doc.electedBodyExcelFile !== undefined) savedData['electedBodyExcelFile'] = doc.electedBodyExcelFile;
    }

    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);
    const questions = this.hydrateQuestions(mainFormFields, savedData, jwtExpiresMs, doc, permissions);
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const validationSummary = this.buildValidationSummary(doc);

    const responseData: EulbFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formName: EULB_FORM_NAME,
      stateId,
      yearId,
      stateName,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      questions,
      rowEditFields,
      extraUlbEditFields,
      permissions,
      actors,
      validationSummary,
      instructions: [],
      meta: { version: 1 },
    };

    return xviFcSuccess('Elected Urban Local Bodies form fetched.', responseData);
  }

  /**
   * Generates an Excel template for the EULB data collection.
   *
   * If an active dataset exists for the state/year, the template is pre-filled with the
   * saved row values (electedBodyStatus, dateOfConstitution, dateOfExpiry, remarks) so
   * that re-downloads include previously entered data.  EXTRA_ULB rows added by the user
   * are preserved.  If no active dataset exists the template falls back to the current
   * behaviour: one blank row per active ULB from the master data.
   *
   * In both cases the row array is padded with blank rows up to maxAllowedExcelRows
   * (dbUlbCount × 2) so that Excel data-validations cover every row a user may fill in.
   */
  async getTemplate(stateId: string, yearId: string, user: AuthUser): Promise<Buffer> {
    this.assertStateAccess(user, stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const rowEditFields = getFieldsByType(fields, 'EULB_ROW_EDIT_FIELDS');
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const formDoc = await this.model
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .lean<EulbFormLeanDoc>()
      .exec();

    const activeVersion = formDoc?.activeDatasetVersion ?? 0;

    let rows: EulbTemplateRow[];
    let dbUlbCount: number;

    if (activeVersion > 0 && formDoc) {
      const savedRows = await this.rowModel
        .find({ form: formDoc._id as Types.ObjectId, datasetVersion: activeVersion, isActive: true })
        .select('censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks')
        .sort({ rowNumber: 1 })
        .lean()
        .exec();

      rows = savedRows.map((r) => ({
        censusCode: r.censusCode ?? '',
        ulbName: r.ulbName,
        electedBodyStatus: r.electedBodyStatus ?? '',
        dateOfConstitution: dateToTemplateValue(r.dateOfConstitution),
        dateOfExpiry: dateToTemplateValue(r.dateOfExpiry),
        remarks: r.remarks ?? '',
      }));

      dbUlbCount = formDoc.dbUlbCount ?? rows.length;
    } else {
      // TODO: Add date of constitution / createdAt condition.
      const ulbs = await this.ulbModel
        .find({ state: new Types.ObjectId(stateId), isActive: true })
        .select('_id name censusCode sbCode')
        .sort({ name: 1 })
        .lean()
        .exec();

      rows = ulbs.map((u: Record<string, unknown>) => ({
        censusCode: (u['censusCode'] as string | null) || (u['sbCode'] as string | null) || '',
        ulbName: u['name'] as string,
        electedBodyStatus: '',
        dateOfConstitution: '',
        dateOfExpiry: '',
        remarks: '',
      }));

      dbUlbCount = ulbs.length;
    }

    // Pad with blank rows up to maxAllowedExcelRows so data-validations cover every row a
    // user is permitted to fill in, not only pre-populated rows.
    const maxAllowedExcelRows = dbUlbCount * 2;
    const blankRow: EulbTemplateRow = {
      censusCode: '',
      ulbName: '',
      electedBodyStatus: '',
      dateOfConstitution: '',
      dateOfExpiry: '',
      remarks: '',
    };
    const templateRows = [
      ...rows,
      ...Array.from({ length: Math.max(0, maxAllowedExcelRows - rows.length) }, () => ({ ...blankRow })),
    ];

    const validations = this.buildTemplateValidations(rowEditFields, maxAllowedExcelRows);
    return this.excelService.generateExcel(
      TEMPLATE_HEADERS as RowHeader[],
      templateRows,
      'Elected Bodies Template',
      validations,
    );
  }

  /**
   * Exports only the latest active EULB row dataset for the given state/year.
   * Uses the form's activeDatasetVersion and loads a flat row projection only:
   * histories, raw upload data, post-submission batches, and old dataset versions
   * are deliberately excluded.
   */
  async dumpToExcel(stateId: string, yearId: string, user: AuthUser): Promise<Buffer> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const formDoc = await this.model
      .findOne({
        state: stateOid,
        year: yearOid,
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .select('_id activeDatasetVersion submittedBy submittedAt')
      .populate('submittedBy', 'name')
      .lean<EulbDumpFormRecord>()
      .exec();

    if (!formDoc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }

    const activeVersion = formDoc.activeDatasetVersion ?? 0;
    const rows =
      activeVersion > 0
        ? await this.rowModel
            .find({
              form: formDoc._id,
              state: stateOid,
              year: yearOid,
              datasetVersion: activeVersion,
              isActive: true,
            })
            .select(
              'rowNumber censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks rowType validationStatus lastUpdatedSource datasetVersion createdBy updatedBy createdAt updatedAt',
            )
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ rowNumber: 1 })
            .lean<EulbDumpRowRecord[]>()
            .exec()
        : [];

    return this.excelService.generateExcel(
      EULB_DUMP_HEADERS,
      rows.map((row) => this.buildDumpRow(row, formDoc)),
      'EULB Dump',
    );
  }

  /**
   * Saves the EULB form as a draft.
   * Runs partial validation — absent required fields are allowed (except requiredTrue checkboxes).
   * Upserts the main form document's top-level fields. Sets status to IN_PROGRESS. Does not touch rows.
   *
   * @param dto       - Payload with stateId, yearId, and partial form data.
   * @param user      - Authenticated user; must have EDIT_STATE_FORMS permission.
   * @param ip        - Client IP (passed through; reserved for future audit trail).
   * @param userAgent - User-Agent header (reserved for future audit trail).
   */
  async saveDraft(
    dto: SaveElectedUrbanLocalBodiesDraftDto,
    user: AuthUser,
    _ip: string,
    _userAgent: string,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(dto.yearId);
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }

    const rawExcelFile = dto.data.electedBodyExcelFile;
    const normalizedExcelFile = rawExcelFile?.fileUrl
      ? { ...rawExcelFile, fileUrl: this.fileUrlNormalizer.toRawStoragePath(rawExcelFile.fileUrl) }
      : rawExcelFile;

    const formData: FormData = {
      ulbCount: dto.data.ulbCount,
      electedBodyExcelFile: normalizedExcelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };

    const result = this.validator.validateDraftAndBuildPayload(mainFormFields, formData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };

    const existing = await this.model.findOne(filter, { _id: 1, currentFormStatus: 1, excelRowCount: 1 }).lean().exec();

    const savedExcelRowCount = existing?.excelRowCount ?? 0;
    if (dto.data.ulbCount !== undefined && savedExcelRowCount > 0 && dto.data.ulbCount !== savedExcelRowCount) {
      throwXviFcValidationError({
        ulbCount: [
          {
            field: 'ulbCount',
            code: 'mismatch',
            message: `ULB count entered (${dto.data.ulbCount}) does not match the number of ULBs/ rows in the Excel file (${savedExcelRowCount}).`,
          },
        ],
      });
    }

    const fieldUpdates: Record<string, unknown> = {
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      updatedBy: userOid,
    };
    if (result.sanitizedPayload['ulbCount'] !== undefined)
      fieldUpdates['ulbCount'] = result.sanitizedPayload['ulbCount'];
    if (normalizedExcelFile !== undefined) fieldUpdates['electedBodyExcelFile'] = normalizedExcelFile;
    if (result.sanitizedPayload['checkboxConfirmation'] !== undefined)
      fieldUpdates['checkboxConfirmation'] = result.sanitizedPayload['checkboxConfirmation'];

    if (existing) {
      assertCanStateEditForm(existing.currentFormStatus);

      const updated = await this.model.findOneAndUpdate(filter, { $set: fieldUpdates }, { new: true }).lean().exec();

      return xviFcSuccess('Elected Urban Local Bodies form saved as draft.', {
        ...updated,
        currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
      });
    }

    const created = await this.model.create({
      state: stateOid,
      year: yearOid,
      formType: EULB_FORM_TYPE,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      isDraft: true,
      isActive: true,
      isDeleted: false,
      createdBy: userOid,
      ...fieldUpdates,
    });

    return xviFcSuccess('Elected Urban Local Bodies form saved as draft.', {
      ...created.toObject(),
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
    });
  }

  /**
   * Final-submits the EULB form.
   * Runs full form-level validation then enforces all Excel row-level pre-conditions
   * (validationStatus VALID, zero errors, zero missing DB ULBs, ulbCount match).
   * Transitions status to UNDER_REVIEW_BY_MOHUA. Blocked by status gate.
   *
   * @param dto       - Payload with stateId, yearId, and complete form data.
   * @param user      - Authenticated user; must have FINAL_SUBMIT_STATE_FORMS permission.
   * @param ip        - Client IP (passed through; reserved for future audit trail).
   * @param userAgent - User-Agent header (reserved for future audit trail).
   */
  async finalSubmit(
    dto: FinalSubmitElectedUrbanLocalBodiesDto,
    user: AuthUser,
    _ip: string,
    _userAgent: string,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(dto.yearId);
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };

    const existing = await this.model
      .findOne(filter, {
        _id: 1,
        currentFormStatus: 1,
        validationStatus: 1,
        errorRowCount: 1,
        missingDbUlbCount: 1,
        excelRowCount: 1,
        dbUlbCount: 1,
        maxAllowedExcelRows: 1,
        matchedDbUlbCount: 1,
        extraExcelRowCount: 1,
        activeDatasetVersion: 1,
      })
      .lean()
      .exec();

    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateFinalSubmitForm(fromStatus);

    const normalizedExcelFile = {
      ...dto.data.electedBodyExcelFile,
      fileUrl: this.fileUrlNormalizer.toRawStoragePath(dto.data.electedBodyExcelFile.fileUrl),
    };

    // Full form-level validation
    const formData: FormData = {
      ulbCount: dto.data.ulbCount,
      electedBodyExcelFile: normalizedExcelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };
    const validation = this.validator.validateFinalSubmitAndBuildPayload(mainFormFields, formData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    // Excel/row validation checks
    if (!existing) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelNotValidated',
              message:
                'Excel has not been validated. Please validate or revalidate the uploaded Excel before submitting.',
            },
          ],
        },
        {
          validationSummary: {
            validationStatus: 'NOT_VALIDATED' as EulbValidationStatus,
            excelRowCount: 0,
            errorRowCount: 0,
            activeDatasetVersion: 0,
          },
        },
      );
    }

    const storedValidationStatus = existing.validationStatus as EulbValidationStatus | undefined;
    const errorRowCount = (existing.errorRowCount as number | undefined) ?? 0;
    const missingDbUlbCount = (existing.missingDbUlbCount as number | undefined) ?? 0;
    const excelRowCount = (existing.excelRowCount as number | undefined) ?? 0;
    const dbUlbCount = (existing.dbUlbCount as number | undefined) ?? 0;
    const maxAllowedExcelRows = (existing.maxAllowedExcelRows as number | undefined) ?? dbUlbCount * 2;
    const matchedDbUlbCount = (existing.matchedDbUlbCount as number | undefined) ?? 0;
    const extraExcelRowCount = (existing.extraExcelRowCount as number | undefined) ?? 0;
    const activeDatasetVersion = (existing.activeDatasetVersion as number | undefined) ?? 0;

    const dbValidationSummary: EulbValidationSummary = {
      dbUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      errorRowCount,
      validationStatus: storedValidationStatus ?? 'NOT_VALIDATED',
      activeDatasetVersion,
    };

    if (!storedValidationStatus || storedValidationStatus === 'NOT_VALIDATED') {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelNotValidated',
              message:
                'Excel has not been validated. Please validate or revalidate the uploaded Excel before submitting.',
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (storedValidationStatus !== 'VALID') {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message:
                'Uploaded Excel has validation errors. Please view uploaded data, fix errors, and revalidate before final submit.',
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (errorRowCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `${errorRowCount} row(s) have validation errors. Fix all errors before submitting.`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (missingDbUlbCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `${missingDbUlbCount} DB ULB(s) are missing from the Excel file.`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (excelRowCount > dbUlbCount * 2) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `Excel row count (${excelRowCount}) exceeds the maximum allowed (${dbUlbCount * 2}).`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (dto.data.ulbCount !== excelRowCount) {
      throwXviFcValidationError({
        ulbCount: [
          {
            field: 'ulbCount',
            code: 'mismatch',
            message: `ULB count entered (${dto.data.ulbCount}) does not match the number of ULBs/ rows in the Excel file (${excelRowCount}).`,
          },
        ],
      });
    }

    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const now = new Date();

    const fieldUpdates = {
      currentFormStatus: toStatus,
      submittedBy: userOid,
      submittedAt: now,
      updatedBy: userOid,
      isDraft: false,
      ulbCount: dto.data.ulbCount,
      electedBodyExcelFile: normalizedExcelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };

    const updated = await this.model
      .findOneAndUpdate({ _id: existing._id }, { $set: fieldUpdates }, { new: true })
      .lean()
      .exec();

    return xviFcSuccess('Elected Urban Local Bodies form submitted successfully.', {
      ...updated,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Merges saved form data onto TEMP_QUESTIONS in one O(n) pass.
   * File-type questions have their fileUrl signed with a JWT-lifetime token.
   * The electedBodyExcelFile question receives backend-driven supporting actions based on the form doc.
   *
   * @param savedData    - Key-value pairs extracted from the stored form document's top-level fields.
   * @param jwtExpiresMs - Token lifetime in milliseconds used when signing file URLs.
   * @param doc          - Lean form document used to compute supporting action/badge visibility.
   */
  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    jwtExpiresMs: number,
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
  ): HydratedFieldConfig[] {
    return questions.map((question) => {
      const rawValue = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      let value = rawValue;
      if (question.formFieldType === 'file') {
        const fileVal = rawValue as UploadedFileValue | null | undefined;
        if (fileVal?.fileUrl) {
          const signedUrl = this.signStorageFileUrl(fileVal.fileUrl, jwtExpiresMs);
          value = { ...fileVal, fileUrl: signedUrl };
        }
      }

      if (question.key === 'electedBodyExcelFile') {
        return { ...question, value, supportingContent: this.buildElectedBodyFileSupportingContent(doc, permissions) };
      }

      return { ...question, value };
    });
  }

  /**
   * Builds the backend-driven `actions` supporting content item for the electedBodyExcelFile question.
   * Action and badge visibility is derived from the current form document state.
   * When doc is null (no form record yet), only the download-template action is visible.
   *
   * @param doc - Lean form document; null when no record exists yet.
   */
  private buildElectedBodyFileSupportingContent(
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
  ): FieldSupportingContent[] {
    const { canView, canEdit } = permissions;
    const activeDatasetVersion = doc?.activeDatasetVersion ?? 0;
    const excelRowCount = doc?.excelRowCount ?? 0;
    const errorRowCount = doc?.errorRowCount ?? 0;
    const missingDbUlbCount = doc?.missingDbUlbCount ?? 0;
    const validationStatus = doc?.validationStatus ?? 'NOT_VALIDATED';

    const hasActiveDataset = activeDatasetVersion > 0 && excelRowCount > 0;
    const hasUploadedExcel = !!(doc?.electedBodyExcelFile?.fileName || doc?.electedBodyExcelFile?.fileUrl);

    return [
      {
        type: 'actions',
        position: 'before',
        layout: 'inline',
        separator: 'dot',
        description: canEdit
          ? 'Download the template, upload the completed Excel. If errors are found, review the uploaded rows or download the error sheet, make corrections, and revalidate before final submission.'
          : '',
        actions: [
          {
            id: EULB_ACTION_DOWNLOAD_TEMPLATE,
            label: 'Download the template',
            icon: 'bi bi-file-earmark-arrow-down',
            tone: 'primary',
            visible: canEdit,
          },
          {
            id: EULB_ACTION_VIEW_UPLOADED_DATA,
            label: 'Review uploaded data',
            icon: 'bi bi-table',
            tone: errorRowCount > 0 ? 'danger' : 'primary',
            visible: canView && hasActiveDataset,
          },
          {
            id: EULB_ACTION_DOWNLOAD_ERROR_SHEET,
            label: 'Download error sheet',
            icon: 'bi bi-file-earmark-excel',
            tone: 'danger',
            visible: canView && errorRowCount > 0,
          },
          {
            id: EULB_ACTION_REVALIDATE_EXCEL,
            label: 'Revalidate uploaded Excel',
            icon: 'bi bi-arrow-repeat',
            tone: 'primary',
            visible: canEdit && hasUploadedExcel && validationStatus !== 'VALID',
          },
        ],
        badges: [
          {
            label: `Total rows: ${excelRowCount}`,
            tone: 'secondary',
            visible: canEdit && hasActiveDataset,
          },
          {
            label: 'All valid',
            icon: 'bi bi-check-circle-fill',
            tone: 'success',
            visible: canEdit && validationStatus === 'VALID',
          },
          {
            label: `${errorRowCount} error(s)`,
            tone: 'danger',
            visible: canEdit && errorRowCount > 0,
          },
          {
            label: `${missingDbUlbCount} missing ULB(s)`,
            tone: 'warning',
            visible: canEdit && missingDbUlbCount > 0,
          },
        ],
      },
    ];
  }

  /**
   * Derives canView, canEdit, canFinalSubmit from role permissions, state scope, and current form status.
   *
   * @param user    - Authenticated user providing role and scope context.
   * @param stateId - ObjectId string of the target state; compared against user scope.
   * @param status  - Current numeric form status; gates canEdit and canFinalSubmit.
   */
  private buildFormPermissions(user: AuthUser, stateId: string, status: number): EulbFormPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = this.hasStateAccess(user, stateId);
    return {
      canView: perms.has(Permission.VIEW_STATE_FORMS) && hasAccess,
      canEdit: perms.has(Permission.EDIT_STATE_FORMS) && hasAccess && canStateEditForm(status),
      canFinalSubmit: perms.has(Permission.FINAL_SUBMIT_STATE_FORMS) && hasAccess && canStateFinalSubmitForm(status),
    };
  }

  /**
   * Extracts the Excel validation summary fields from a stored form document.
   * Returns zero/NOT_VALIDATED defaults when no doc exists.
   *
   * @param doc - Lean form document; may be null when no record exists yet.
   */
  private buildValidationSummary(doc: EulbFormLeanDoc | null): EulbValidationSummary {
    return {
      dbUlbCount: doc?.dbUlbCount ?? 0,
      maxAllowedExcelRows: doc?.maxAllowedExcelRows ?? 0,
      excelRowCount: doc?.excelRowCount ?? 0,
      matchedDbUlbCount: doc?.matchedDbUlbCount ?? 0,
      missingDbUlbCount: doc?.missingDbUlbCount ?? 0,
      extraExcelRowCount: doc?.extraExcelRowCount ?? 0,
      errorRowCount: doc?.errorRowCount ?? 0,
      validationStatus: doc?.validationStatus ?? 'NOT_VALIDATED',
      activeDatasetVersion: doc?.activeDatasetVersion ?? 0,
    };
  }

  /**
   * Prepends AWS_STORAGE_URL to a relative S3 path, signs it with FileTokenService,
   * and returns the app-relative download URL with the token as a query param.
   *
   * @param relativePath - S3 key as stored in the DB (e.g. `state/2026-27/...`).
   * @param expMs        - Token lifetime in milliseconds from now.
   */
  private signStorageFileUrl(relativePath: string, expMs: number): string {
    if (!relativePath) return '';
    const storageUrl = this.config.get<string>('AWS_STORAGE_URL', '');
    const fullPath = storageUrl ? `${storageUrl}${relativePath}` : relativePath;
    const token = this.fileTokenService.createToken({
      path: fullPath,
      disposition: 'inline',
      exp: Date.now() + expMs,
    });
    const baseUrl = this.config.get<string>('BASE_URL', '');
    return `${baseUrl}file/download?signature=${token}`;
  }

  /**
   * Builds ExcelJS data validations for the EULB template, derived entirely from EULB_ROW_EDIT_FIELDS.
   * Returns an empty array when rowCount is 0 so generateExcel skips validation application.
   */
  private buildTemplateValidations(rowEditFields: FieldConfig[], rowCount: number): ExcelColumnValidation[] {
    if (rowCount === 0) return [];

    const statusField = rowEditFields.find((f) => f.key === 'electedBodyStatus')!;
    const constitutionField = rowEditFields.find((f) => f.key === 'dateOfConstitution')!;
    const expiryField = rowEditFields.find((f) => f.key === 'dateOfExpiry')!;
    const remarksField = rowEditFields.find((f) => f.key === 'remarks')!;

    const statusOptions = (statusField.options as FormFieldOption[]).map((o) => o.id).join(',');

    const constitutionMinVal = constitutionField.validations?.find((v) => v.name === 'minDate')?.validator as string;
    const constitutionMaxVal = constitutionField.maxDate!;

    const expiryMinVal = expiryField.minDate!;
    const expiryMaxVal = expiryField.validations?.find((v) => v.name === 'maxDate')?.validator as string;

    const maxLength = remarksField.validations?.find((v) => v.name === 'maxlength')?.validator as number;

    const constitutionMin = toExcelDateExpr(constitutionMinVal);
    const constitutionMax = toExcelDateExpr(constitutionMaxVal);
    const expiryMin = toExcelDateExpr(expiryMinVal);
    const expiryMax = toExcelDateExpr(expiryMaxVal);

    return [
      {
        key: 'electedBodyStatus',
        mode: 'static',
        validation: {
          type: 'list',
          allowBlank: false,
          formulae: [`"${statusOptions}"`],
          showInputMessage: true,
          promptTitle: 'Elected Body Status',
          prompt: 'Select a value from the dropdown.',
          showErrorMessage: true,
          errorStyle: 'error',
          errorTitle: 'Invalid Status',
          error: 'Select a valid elected body status.',
        },
      },
      {
        key: 'dateOfConstitution',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const statusLetter = keyToLetter.get('electedBodyStatus')!;
          const constitutionLetter = keyToLetter.get('dateOfConstitution')!;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [
              `OR(AND($${statusLetter}${row}<>"Constituted",${constitutionLetter}${row}=""),AND($${statusLetter}${row}="Constituted",ISNUMBER(${constitutionLetter}${row}),${constitutionLetter}${row}>=${constitutionMin},${constitutionLetter}${row}<=${constitutionMax}))`,
            ],
            showInputMessage: true,
            promptTitle: 'Date of Constitution',
            prompt: 'Required when status is Constituted. Must be between 31 May 2021 and today.',
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Date of Constitution',
            error: 'Required for Constituted status and must be within the allowed date range.',
          };
        },
      },
      {
        key: 'dateOfExpiry',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const statusLetter = keyToLetter.get('electedBodyStatus')!;
          const expiryLetter = keyToLetter.get('dateOfExpiry')!;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [
              `OR(AND($${statusLetter}${row}<>"Constituted",${expiryLetter}${row}=""),AND($${statusLetter}${row}="Constituted",ISNUMBER(${expiryLetter}${row}),${expiryLetter}${row}>=${expiryMin},${expiryLetter}${row}<=${expiryMax}))`,
            ],
            showInputMessage: true,
            promptTitle: 'Date of Expiry',
            prompt: `Required when status is Constituted. Must be between today and 31 March 2030.`,
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Date of Expiry',
            error: 'Required for Constituted status and must be within the allowed date range.',
          };
        },
      },
      {
        key: 'remarks',
        mode: 'static',
        validation: {
          type: 'textLength',
          operator: 'lessThanOrEqual',
          allowBlank: true,
          formulae: [maxLength],
          showInputMessage: true,
          promptTitle: 'Remarks',
          prompt: `Maximum ${maxLength} characters.`,
          showErrorMessage: true,
          errorStyle: 'error',
          errorTitle: 'Remarks Too Long',
          error: 'Remarks cannot exceed the configured maximum length.',
        },
      },
    ];
  }

  private buildDumpRow(row: EulbDumpRowRecord, form: EulbDumpFormRecord): EulbDumpRow {
    return {
      rowNumber: row.rowNumber,
      censusCode: row.censusCode ?? '',
      ulbName: row.ulbName,
      electedBodyStatus: row.electedBodyStatus ?? '',
      dateOfConstitution: dateToDumpValue(row.dateOfConstitution),
      dateOfExpiry: dateToDumpValue(row.dateOfExpiry),
      remarks: row.remarks ?? '',
      rowType: row.rowType,
      validationStatus: row.validationStatus,
      latestDataSource: row.lastUpdatedSource,
      datasetVersion: row.datasetVersion,
      submittedBy: form.submittedBy?.name ?? '',
      submittedAt: datetimeToDumpValue(form.submittedAt),
      createdBy: row.createdBy?.name ?? '',
      updatedBy: row.updatedBy?.name ?? '',
      createdAt: datetimeToDumpValue(row.createdAt),
      updatedAt: datetimeToDumpValue(row.updatedAt),
    };
  }

  /**
   * Returns true if the user is ADMIN, or is a STATE user whose state matches the given stateId.
   *
   * @param user    - Authenticated user providing scope and state context.
   * @param stateId - ObjectId string of the target state to check access for.
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
   * Throws ForbiddenException when the user does not have access to the given stateId.
   *
   * @param user    - Authenticated user to validate scope for.
   * @param stateId - ObjectId string of the state being accessed.
   */
  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
