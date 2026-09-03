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
import { computeEulbStatusSummary } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-status-summary.helper';
import {
  deriveElectedBodyStatuses,
  parseFieldRelativeBoundary,
  type EulbDateOffsetBoundary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
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
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { keyByFieldKey, requireField } from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { deriveFileValidationOptions } from 'src/module/xvi-fc/common/utils/xvi-fc-file-constraint.util';
import { buildUlbReconciliationBadges } from 'src/module/xvi-fc/common/utils/xvi-fc-ulb-reconciliation-badges.util';
import { buildValidationIssuesMessage } from 'src/module/xvi-fc/common/utils/xvi-fc-validation-issues-message.util';
import { formatXviFcDate } from 'src/module/xvi-fc/common/utils/xvi-fc-date-format.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import type { FormData } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type {
  FieldConfig,
  FieldSupportingContent,
  FormFieldOption,
  HydratedFieldConfig,
} from 'src/module/xvi-fc/common/types/field-config.type';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
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
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import {
  EULB_ACTION_DOWNLOAD_ERROR_SHEET,
  EULB_ACTION_DOWNLOAD_TEMPLATE,
  EULB_ACTION_REGISTER_ULB,
  EULB_ACTION_REVALIDATE_EXCEL,
  EULB_ACTION_VIEW_UPLOADED_DATA,
  EULB_FORM_NAME,
  TEMPLATE_HEADERS,
  buildEulbRegisterUlbUrl,
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
  EulbStatusSummary,
  EulbValidationSummary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

/** Converts a date validator value ('2021-05-31' or 'TODAY') to an Excel formula expression. */
function toExcelDateExpr(dateVal: string): string {
  if (dateVal === 'TODAY') return 'TODAY()';
  const d = new Date(dateVal);
  return `DATE(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
}

/** Builds a per-row Excel formula expression for a FIELD-relative bound (e.g. dateOfConstitution
 *  + 5 years), referencing that sibling column's own cell for the given row. `EDATE` shifts by
 *  whole months, so Y/M units use it directly; D uses plain cell arithmetic. */
function buildRelativeExcelExpr(cellRef: string, offset: EulbDateOffsetBoundary): string {
  const delta = offset.amount * offset.sign;
  switch (offset.unit) {
    case 'Y':
      return `EDATE(${cellRef},${delta * 12})`;
    case 'M':
      return `EDATE(${cellRef},${delta})`;
    case 'D':
      return `(${cellRef}+${delta})`;
  }
}

/** Human-readable description of a FIELD-relative bound for Excel prompt text, e.g.
 *  "5 years after Date on which the elected body is in place" (Excel data-validation prompts are
 *  static text shown before entry, so unlike the formula itself this can't be computed per row.) */
function describeRelativeOffset(offset: EulbDateOffsetBoundary, fieldLabel: string): string {
  const unitWord = offset.unit === 'D' ? 'day' : offset.unit === 'M' ? 'month' : 'year';
  const plural = offset.amount === 1 ? '' : 's';
  const direction = offset.sign < 0 ? 'before' : 'after';
  return `${offset.amount} ${unitWord}${plural} ${direction} ${fieldLabel}`;
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
  { label: 'Date on which the elected body is in place', key: 'dateOfConstitution', width: 48 },
  { label: 'Date of Expiry', key: 'dateOfExpiry', width: 20 },
  { label: 'Remarks', key: 'remarks', width: 35 },
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
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
    private readonly ulbEligibilityService: UlbEligibilityService,
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
        return { ...q, supportingContent: this.buildElectedBodyFileSupportingContent(null, noPermissions, '') };
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
   * `ulbCount` is hydrated as a read-only, backend-owned field computed from the active
   * ULB registry. The client-provided value is ignored.
   *
   * @param stateId - ObjectId string of the target state.
   * @param yearId  - ObjectId string of the target year.
   * @param user    - Authenticated user; scope-checked against stateId.
   */
  async getForm(stateId: string, yearId: string, user: AuthUser): Promise<XviFcApiResponse<EulbFormGetResponseData>> {
    this.assertStateAccess(user, stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const folderPathContext: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };

    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    const rowEditFields = getFieldsByType(fields, 'EULB_ROW_EDIT_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(stateId);
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');

    const [doc, computedActiveUlbCount] = await Promise.all([
      this.model
        .findOne({
          state: stateOid,
          year: new Types.ObjectId(yearId),
          formType: EULB_FORM_TYPE,
          isDeleted: false,
        })
        .populate('state', 'name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .populate('submittedBy', 'name')
        .lean<EulbFormLeanDoc>()
        .exec(),
      this.ulbModel.countDocuments(eligibleUlbFilter),
    ]);

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const jwtExpiresIn = (this.config.get<string>('JWT_EXPIRES_IN') ?? '24h') as StringValue;
    const jwtExpiresMs = ms(jwtExpiresIn) ?? 24 * 60 * 60 * 1000;

    // Build savedData from top-level form fields (ulbCount is not included — it is backend-owned)
    const savedData: FormData = {};
    if (doc) {
      if (doc.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;
      if (doc.electedBodyExcelFile !== undefined) savedData['electedBodyExcelFile'] = doc.electedBodyExcelFile;
      if (doc.signedElectedbodyFile !== undefined) savedData['signedElectedbodyFile'] = doc.signedElectedbodyFile;
    }

    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);
    const questions = this.hydrateQuestions(
      mainFormFields,
      savedData,
      jwtExpiresMs,
      doc,
      permissions,
      yearId,
      computedActiveUlbCount,
      folderPathContext,
    );
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const validationSummary = this.buildValidationSummary(doc);

    // Only computed once the form has actually been submitted (UNDER_REVIEW_BY_MOHUA or later) —
    // avoids a needless aggregation query on every pre-submission page load. `null` beforehand.
    let statusSummary: EulbStatusSummary | null = null;
    if (doc && currentFormStatus >= FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      const electedBodyStatuses = deriveElectedBodyStatuses(rowEditFields);
      statusSummary = await computeEulbStatusSummary(
        this.rowModel,
        doc._id as Types.ObjectId,
        stateId,
        yearId,
        doc.activeDatasetVersion ?? 0,
        electedBodyStatuses,
      );
    }

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
      permissions,
      actors,
      validationSummary,
      statusSummary,
      instructions: [],
      meta: { version: 1 },
    };

    return xviFcSuccess('Elected Urban Local Bodies form fetched.', responseData);
  }

  /**
   * Generates an Excel template for the EULB data collection.
   *
   * The template always represents the current active ULB registry for the state — every
   * persisted row is registry-backed, so no separate "excluded row" case applies here.
   * When an active dataset exists, saved row values are overlaid onto the matching registry ULB.
   * No blank padding rows are added beyond the active registry count.
   */
  async getTemplate(stateId: string, yearId: string, user: AuthUser): Promise<Buffer> {
    this.assertStateAccess(user, stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const rowEditFields = getFieldsByType(fields, 'EULB_ROW_EDIT_FIELDS');
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(stateId);

    // Always load the active, XVI-FC-eligible registry — needed in both branches to determine
    // template rows. Cantonment Board ULBs are excluded here via the shared eligibility filter.
    // TODO: dateOfConstitution has no validation rule defined/implemented yet — same gap as
    // elected-urban-local-bodies-excel.service.ts's revalidateExcel (identical TODO, not yet scoped).
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const activeUlbs = await this.ulbModel
      .find(eligibleUlbFilter)
      .select('_id name censusCode sbCode')
      .sort({ name: 1 })
      .lean()
      .exec();

    const computedActiveUlbCount = activeUlbs.length;

    const formDoc = await this.model
      .findOne({
        state: stateOid,
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .lean<EulbFormLeanDoc>()
      .exec();

    const activeVersion = formDoc?.activeDatasetVersion ?? 0;

    let rows: EulbTemplateRow[];

    if (activeVersion > 0 && formDoc) {
      // Load saved rows for the active dataset version — every row is registry-backed.
      const savedDbRows = await this.rowModel
        .find({
          form: formDoc._id as Types.ObjectId,
          datasetVersion: activeVersion,
          isActive: true,
        })
        .select('ulbId censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks')
        .lean()
        .exec();

      // Build overlay map keyed by ulbId string for O(1) lookup.
      const savedRowByUlbId = new Map<string, (typeof savedDbRows)[number]>();
      for (const r of savedDbRows) {
        if (r.ulbId) savedRowByUlbId.set(r.ulbId.toString(), r);
      }

      // Iterate active registry; overlay saved values when a match exists.
      rows = activeUlbs.map((u) => {
        const saved = savedRowByUlbId.get(u._id.toString());
        const censusCode = String(u['censusCode'] ?? u['sbCode'] ?? '');
        return {
          censusCode,
          ulbName: u['name'],
          electedBodyStatus: saved?.electedBodyStatus ?? '',
          dateOfConstitution: saved ? dateToTemplateValue(saved.dateOfConstitution) : '',
          dateOfExpiry: saved ? dateToTemplateValue(saved.dateOfExpiry) : '',
          remarks: saved?.remarks ?? '',
        };
      });
    } else {
      // No active dataset — one blank row per active registry ULB.
      rows = activeUlbs.map((u: Record<string, unknown>) => ({
        censusCode: (u['censusCode'] as string | null) || (u['sbCode'] as string | null) || '',
        ulbName: u['name'] as string,
        electedBodyStatus: '',
        dateOfConstitution: '',
        dateOfExpiry: '',
        remarks: '',
      }));
    }

    const validations = this.buildTemplateValidations(rowEditFields, computedActiveUlbCount);
    return this.excelService.generateExcel(
      TEMPLATE_HEADERS as RowHeader[],
      rows,
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
              'rowNumber censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks validationStatus lastUpdatedSource datasetVersion createdBy updatedBy createdAt updatedAt',
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
   * `ulbCount` is computed server-side from the active ULB registry — the client-submitted
   * value is ignored. Partial validation runs; absent required fields are allowed (except
   * requiredTrue checkboxes). Upserts the main form document. Does not touch rows.
   *
   * @param dto       - Payload with stateId, yearId, and partial form data.
   * @param user      - Authenticated user; must have EDIT_STATE_FORMS permission.
   * @param ip        - Client IP (reserved for future audit trail).
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

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };

    // Compute active ULB count server-side; the client-submitted ulbCount is ignored. Must use the
    // same eligibility filter as getTemplate()'s registry query, or a state's Excel upload will
    // spuriously fail the row-count match check the moment it has any Cantonment Board ULBs.
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const [activeUlbCount, existing] = await Promise.all([
      this.ulbModel.countDocuments(eligibleUlbFilter),
      this.model
        .findOne(filter, {
          _id: 1,
          currentFormStatus: 1,
          electedBodyExcelFile: 1,
          signedElectedbodyFile: 1,
          validationStatus: 1,
        })
        .lean<
          Pick<
            EulbFormLeanDoc,
            '_id' | 'currentFormStatus' | 'electedBodyExcelFile' | 'signedElectedbodyFile' | 'validationStatus'
          >
        >()
        .exec(),
    ]);

    let normalizedExcelFile: FileInfo | null | undefined;
    if (dto.data.electedBodyExcelFile !== undefined) {
      const excelFileField = requireField(
        keyByFieldKey(mainFormFields),
        'electedBodyExcelFile',
        'ElectedUrbanLocalBodiesService.saveDraft',
      );
      const { file, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.electedBodyExcelFile as unknown as Record<string, unknown>,
        existing?.electedBodyExcelFile,
        deriveFileValidationOptions(excelFileField, 'electedBodyExcelFile'),
      );
      if (fileErrors.length > 0) throwXviFcValidationError({ electedBodyExcelFile: fileErrors });
      normalizedExcelFile = file;
    }

    let normalizedSignedFile: FileInfo | null | undefined;
    if (dto.data.signedElectedbodyFile !== undefined) {
      const signedFileField = requireField(
        keyByFieldKey(mainFormFields),
        'signedElectedbodyFile',
        'ElectedUrbanLocalBodiesService.saveDraft',
      );
      const { file, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.signedElectedbodyFile as unknown as Record<string, unknown>,
        existing?.signedElectedbodyFile,
        deriveFileValidationOptions(signedFileField, 'signedElectedbodyFile'),
      );
      if (fileErrors.length > 0) throwXviFcValidationError({ signedElectedbodyFile: fileErrors });
      normalizedSignedFile = file;
    }

    /**
     * A new/replaced/removed electedBodyExcelFile invalidates the previous validationStatus.
     * normalizedExcelFile is undefined only when the file is unchanged, matching the persistence logic below.
     */
    const effectiveValidationStatus: EulbValidationStatus =
      normalizedExcelFile !== undefined ? 'NOT_VALIDATED' : (existing?.validationStatus ?? 'NOT_VALIDATED');

    const formData: FormData = {
      ulbCount: activeUlbCount,
      electedBodyExcelFile: normalizedExcelFile,
      signedElectedbodyFile: normalizedSignedFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
      // Synthetic key for signedElectedbodyFile.visibleWhen to check Excel validity, not just presence.
      // See dynamic-form-validation.service.ts's evaluateCondition.
      electedBodyExcelValidationStatus: effectiveValidationStatus,
    };

    const result = this.validator.validateDraftAndBuildPayload(mainFormFields, formData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const fieldUpdates: Record<string, unknown> = {
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      updatedBy: userOid,
      ulbCount: activeUlbCount,
    };
    if (normalizedExcelFile !== undefined) {
      fieldUpdates['electedBodyExcelFile'] = normalizedExcelFile;
      // Reset the stale validationStatus from the previous file — mirrors deleteUploadedExcel's
      // reset on delete (services/row/elected-urban-local-bodies-row.service.ts).
      fieldUpdates['validationStatus'] = effectiveValidationStatus;
    }
    if (normalizedSignedFile !== undefined) fieldUpdates['signedElectedbodyFile'] = normalizedSignedFile;
    if (result.sanitizedPayload['checkboxConfirmation'] !== undefined)
      fieldUpdates['checkboxConfirmation'] = result.sanitizedPayload['checkboxConfirmation'];

    if (existing) {
      assertCanStateEditForm(existing.currentFormStatus ?? FORM_STATUS.NOT_STARTED);

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
   * `ulbCount` is computed server-side; the client-submitted value is ignored.
   * Runs full form-level validation then enforces all Excel row-level pre-conditions:
   * validationStatus VALID, zero errors, zero missing DB ULBs, zero extra ULB rows,
   * and Excel row count matching the computed active ULB count.
   * Transitions status to UNDER_REVIEW_BY_MOHUA. devolution-formula's Installment-1 gate reads
   * this status from outside this module (see devolution-formula/CLAUDE.md) — changing when/how
   * this transition happens has a blast radius there too.
   *
   * @param dto       - Payload with stateId, yearId, and complete form data.
   * @param user      - Authenticated user; must have FINAL_SUBMIT_STATE_FORMS permission.
   * @param ip        - Client IP (reserved for future audit trail).
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

    // Compute active ULB count server-side; the client-submitted ulbCount is ignored. Must use the
    // same eligibility filter as getTemplate()'s registry query, or a state's Excel upload will
    // spuriously fail the row-count match check the moment it has any Cantonment Board ULBs.
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const activeUlbCount = await this.ulbModel.countDocuments(eligibleUlbFilter);

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
        duplicateUlbCount: 1,
        activeDatasetVersion: 1,
        electedBodyExcelFile: 1,
        signedElectedbodyFile: 1,
      })
      .lean()
      .exec();

    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateFinalSubmitForm(fromStatus);

    const excelFileFieldFinal = requireField(
      keyByFieldKey(mainFormFields),
      'electedBodyExcelFile',
      'ElectedUrbanLocalBodiesService.finalSubmit',
    );
    const { file: normalizedExcelFile, errors: excelFileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.data.electedBodyExcelFile as unknown as Record<string, unknown>,
      existing?.electedBodyExcelFile as FileInfo | undefined,
      deriveFileValidationOptions(excelFileFieldFinal, 'electedBodyExcelFile'),
    );
    if (excelFileErrors.length > 0) throwXviFcValidationError({ electedBodyExcelFile: excelFileErrors });

    const signedFileFieldFinal = requireField(
      keyByFieldKey(mainFormFields),
      'signedElectedbodyFile',
      'ElectedUrbanLocalBodiesService.finalSubmit',
    );
    const { file: normalizedSignedFile, errors: signedFileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.data.signedElectedbodyFile as unknown as Record<string, unknown>,
      existing?.signedElectedbodyFile as FileInfo | undefined,
      deriveFileValidationOptions(signedFileFieldFinal, 'signedElectedbodyFile'),
    );
    if (signedFileErrors.length > 0) throwXviFcValidationError({ signedElectedbodyFile: signedFileErrors });

    // `normalizedExcelFile`/`normalizedSignedFile` are `undefined` when the file is unchanged from
    // what's already stored — fall back to the existing file so the required-field validator below
    // still sees it as present (the raw, possibly-undefined value is used for the $set below).
    const formData: FormData = {
      ulbCount: activeUlbCount,
      electedBodyExcelFile: normalizedExcelFile !== undefined ? normalizedExcelFile : existing?.electedBodyExcelFile,
      signedElectedbodyFile:
        normalizedSignedFile !== undefined ? normalizedSignedFile : existing?.signedElectedbodyFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
      // Same synthetic key as saveDraft — existing.validationStatus is already loaded above (it's
      // exactly what the hard-gate check below reads too), so this needs no extra query.
      electedBodyExcelValidationStatus: existing?.validationStatus ?? 'NOT_VALIDATED',
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
    const duplicateUlbCount = (existing.duplicateUlbCount as number | undefined) ?? 0;
    const activeDatasetVersion = (existing.activeDatasetVersion as number | undefined) ?? 0;

    const dbValidationSummary: EulbValidationSummary = {
      dbUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      duplicateUlbCount,
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

    // Extra ULB rows indicate unregistered ULBs — report this specifically before generic checks.
    if (extraExcelRowCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'newUlbsAdded',
              message: `${extraExcelRowCount} ULB(s) in the uploaded Excel are not registered in City Finance. Please register them before submitting.`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }

    // Compare stored Excel row count against computed active ULB count (not client-submitted ulbCount).
    if (excelRowCount !== activeUlbCount) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `Excel row count (${excelRowCount}) does not match the number of active ULBs registered in City Finance (${activeUlbCount}).`,
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

    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const now = new Date();

    const fieldUpdates: Record<string, unknown> = {
      currentFormStatus: toStatus,
      submittedBy: userOid,
      submittedAt: now,
      updatedBy: userOid,
      isDraft: false,
      ulbCount: activeUlbCount,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };
    // Omit when unchanged (rather than `electedBodyExcelFile: undefined`) so Mongoose's
    // FileInfo `timestamps` option doesn't re-stamp the stored subdocument.
    if (normalizedExcelFile !== undefined) fieldUpdates['electedBodyExcelFile'] = normalizedExcelFile;
    if (normalizedSignedFile !== undefined) fieldUpdates['signedElectedbodyFile'] = normalizedSignedFile;

    // Two collections are written together here (parent + rows), so this needs the same
    // transactional guarantee finalSubmit already has in fc-unspent-declaration.service.ts —
    // a crash between the two writes must never leave the form UNDER_REVIEW_BY_MOHUA while
    // its rows are still `null`.
    const session = await this.model.db.startSession();
    let updated: EulbFormLeanDoc | null = null;
    try {
      session.startTransaction();

      updated = await this.model
        .findOneAndUpdate({ _id: existing._id }, { $set: fieldUpdates }, { new: true, session })
        .lean<EulbFormLeanDoc>()
        .exec();

      await this.rowModel
        .updateMany(
          { form: existing._id, datasetVersion: activeDatasetVersion, isActive: true },
          { $set: { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } },
          { session },
        )
        .exec();

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

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
   * The ulbCount question is overridden with the backend-computed active ULB count (read-only).
   *
   * @param savedData              - Key-value pairs extracted from the stored form document's top-level fields.
   * @param jwtExpiresMs           - Token lifetime in milliseconds used when signing file URLs.
   * @param doc                    - Lean form document used to compute supporting action/badge visibility.
   * @param yearId                 - Design year ObjectId string (for building Register ULB URL).
   * @param computedActiveUlbCount - Active ULB count from the registry (server-side authoritative value).
   */
  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    jwtExpiresMs: number,
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
    yearId: string,
    computedActiveUlbCount: number,
    folderPathContext?: XviFcFolderPathContext,
  ): HydratedFieldConfig[] {
    return questions.map((question) => {
      if (question.key === 'ulbCount') {
        return { ...question, value: computedActiveUlbCount } as HydratedFieldConfig;
      }

      const rawValue = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      let value = rawValue;
      if (question.formFieldType === 'file') {
        const resolvedFolderPath =
          question.folderPathKey && folderPathContext
            ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
            : question.folderPath;

        const fileVal = rawValue as FileInfo | null | undefined;
        const hydrated = this.fileInfoNormalizer.hydrateFileInfoForResponse(fileVal ?? null, (p) =>
          this.signStorageFileUrl(p, jwtExpiresMs),
        );
        if (hydrated) value = hydrated;

        if (question.key === 'electedBodyExcelFile') {
          return {
            ...question,
            folderPath: resolvedFolderPath,
            value,
            supportingContent: this.buildElectedBodyFileSupportingContent(doc, permissions, yearId),
          };
        }
        return { ...question, folderPath: resolvedFolderPath, value };
      }

      if (question.key === 'electedBodyExcelFile') {
        return {
          ...question,
          value,
          supportingContent: this.buildElectedBodyFileSupportingContent(doc, permissions, yearId),
        };
      }

      return { ...question, value };
    });
  }

  /**
   * Builds the backend-driven `actions` supporting content item for the electedBodyExcelFile question.
   * Action and badge visibility is derived from the current form document state.
   * When doc is null (no form record yet), only the download-template action is visible.
   * The Register ULB action is shown when the user can edit and extra ULB rows exist.
   *
   * @param doc     - Lean form document; null when no record exists yet.
   * @param yearId  - Design year ObjectId string; used to build the Register ULB URL.
   */
  private buildElectedBodyFileSupportingContent(
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
    yearId: string,
  ): FieldSupportingContent[] {
    const { canView, canEdit } = permissions;
    const activeDatasetVersion = doc?.activeDatasetVersion ?? 0;
    const excelRowCount = doc?.excelRowCount ?? 0;
    const errorRowCount = doc?.errorRowCount ?? 0;
    const missingDbUlbCount = doc?.missingDbUlbCount ?? 0;
    const extraExcelRowCount = doc?.extraExcelRowCount ?? 0;
    const duplicateUlbCount = doc?.duplicateUlbCount ?? 0;
    const validationStatus = doc?.validationStatus ?? 'NOT_VALIDATED';

    const hasActiveDataset = activeDatasetVersion > 0 && excelRowCount > 0;
    const hasUploadedExcel = !!doc?.electedBodyExcelFile?.path;

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
          {
            id: EULB_ACTION_REGISTER_ULB,
            label: 'Register ULB',
            icon: 'bi bi-person-check',
            url: buildEulbRegisterUlbUrl(yearId),
            tone: 'success' as const,
            variant: 'link' as const,
            visible: canEdit && extraExcelRowCount > 0,
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
          ...buildUlbReconciliationBadges({
            missingCount: missingDbUlbCount,
            newCount: extraExcelRowCount,
            duplicateCount: duplicateUlbCount,
            visible: canEdit,
          }),
        ],
        validationMessage: buildValidationIssuesMessage({
          errorRowCount,
          missingCount: missingDbUlbCount,
          newCount: extraExcelRowCount,
          duplicateCount: duplicateUlbCount,
          visible: canEdit && hasActiveDataset && validationStatus === 'INVALID',
        }),
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
      duplicateUlbCount: doc?.duplicateUlbCount ?? 0,
      errorRowCount: doc?.errorRowCount ?? 0,
      validationStatus: doc?.validationStatus ?? 'NOT_VALIDATED',
      activeDatasetVersion: doc?.activeDatasetVersion ?? 0,
    };
  }

  /**
   * Signs a relative S3 path with FileTokenService and returns the app-relative
   * download URL with the token as a query param. Signs the bare relative key
   * directly (no AWS_STORAGE_URL reconstruction) — the download handler's
   * `S3Service.getKeyFromS3Url` already accepts a bare key as-is, and naively
   * concatenating AWS_STORAGE_URL + relativePath without a separator previously
   * corrupted the resulting "S3 key" whenever AWS_STORAGE_URL had no trailing slash.
   *
   * @param relativePath - S3 key as stored in the DB (e.g. `state/2026-27/...`).
   * @param expMs        - Token lifetime in milliseconds from now.
   */
  private signStorageFileUrl(relativePath: string, expMs: number): string {
    if (!relativePath) return '';
    const token = this.fileTokenService.createToken({
      path: relativePath,
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

    const statusOptions = (statusField.options as FormFieldOption[]).map((o) => o.label).join(',');

    const constitutionMinVal = constitutionField.validations?.find((v) => v.name === 'minDate')?.validator as string;
    const constitutionMaxVal = constitutionField.maxDate!;

    const expiryMinVal = expiryField.minDate!;
    const expiryMaxVal = expiryField.validations?.find((v) => v.name === 'maxDate')?.validator as string;
    // dateOfExpiry's maxDate may be a fixed ISO date (toExcelDateExpr handles it directly, same as
    // the other three bounds) or a 'FIELD:<key>+-N[DMY]' token (e.g. dateOfConstitution + 5 years)
    // — that one needs a per-row formula referencing the constitution column's own cell, so it's
    // built separately below rather than as a shared constant.
    const expiryMaxRelative = parseFieldRelativeBoundary(expiryMaxVal);

    const maxLength = remarksField.validations?.find((v) => v.name === 'maxlength')?.validator as number;

    const constitutionMin = toExcelDateExpr(constitutionMinVal);
    const constitutionMax = toExcelDateExpr(constitutionMaxVal);
    const expiryMin = toExcelDateExpr(expiryMinVal);
    const expiryMax = expiryMaxRelative ? undefined : toExcelDateExpr(expiryMaxVal);

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
            promptTitle: 'Date on which the elected body is in place',
            prompt: `Required when status is Constituted. Must be between ${formatXviFcDate(constitutionMinVal)} and today.`,
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Date on which the elected body is in place',
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
          const constitutionLetter = keyToLetter.get('dateOfConstitution')!;
          const upperBoundExpr = expiryMaxRelative
            ? buildRelativeExcelExpr(`${constitutionLetter}${row}`, expiryMaxRelative)
            : expiryMax!;
          const prompt = expiryMaxRelative
            ? `Required when status is Constituted. Must be between today and ${describeRelativeOffset(expiryMaxRelative, constitutionField.label)}.`
            : `Required when status is Constituted. Must be between today and ${formatXviFcDate(expiryMaxVal)}.`;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [
              `OR(AND($${statusLetter}${row}<>"Constituted",${expiryLetter}${row}=""),AND($${statusLetter}${row}="Constituted",ISNUMBER(${expiryLetter}${row}),${expiryLetter}${row}>=${expiryMin},${expiryLetter}${row}<=${upperBoundExpr}))`,
            ],
            showInputMessage: true,
            promptTitle: 'Date of Expiry',
            prompt,
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
