import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FormJsonService } from 'src/form-json/form-json.service';
import { ConfigService } from '@nestjs/config';
import { Buffer } from 'exceljs';
import ms, { type StringValue } from 'ms';
import { FilterQuery, Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ExcelService, RowHeader } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
  canStateEditForm,
  canStateFinalSubmitForm,
} from '../../common/utils/xvi-fc-form-status-access.util';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import {
  SFC_FORM_ID,
  SFC_STATUS_FORM_TYPE,
  SfcStatusAction,
  XviFcSfcStatus,
  XviFcSfcStatusDocument,
} from '../../../../schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcSfcStatusHistory,
  XviFcSfcStatusHistoryDocument,
} from '../../../../schemas/xvi-fc/state/sfc-status-history.schema';
import { DynamicFormValidationService } from '../../common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from '../../common/services/xvifc-form-actors.service';
import { FileInfoNormalizerService } from '../../common/services/file-info-normalizer.service';
import { FileInfo } from '../../../../schemas/common/file.schema';

import type {
  FieldConfig,
  FormData,
  FormJson,
  HydratedFieldConfig,
} from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import { XviFcApiResponse, XviFcValidationErrorMap } from '../../common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import type { FormFieldOption } from '../../common/types/field-config.type';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from '../../common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
import { SaveSfcStatusDto } from './dto/save-sfc-status.dto';
import type { SfcFormGetResponseData, SfcFormPermissions } from './sfc-status.types';
import type { SfcHistoryEntryInput } from './types/sfc-status-history.types';
import type {
  SfcStatusDumpFilters,
  SfcStatusDumpRecord,
  SfcStatusDumpRow,
  SfcStatusPopulatedState,
  SfcStatusPopulatedUser,
  SfcStatusPopulatedYear,
} from './types/sfc-status-dump.types';

type PopulatedNameRef = { _id?: Types.ObjectId; name?: string };

type SfcStatusLeanDoc = {
  _id: Types.ObjectId;
  state?: Types.ObjectId | PopulatedNameRef;
  createdBy?: Types.ObjectId | PopulatedNameRef;
  updatedBy?: Types.ObjectId | PopulatedNameRef;
  submittedBy?: Types.ObjectId | PopulatedNameRef;
  createdAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date;
  currentFormStatus?: number;
  data?: unknown;
};

const SFC_DUMP_HEADERS: RowHeader[] = [
  { label: 'State Name', key: 'stateName', width: 25 },
  { label: 'Year Name', key: 'yearName', width: 15 },
  { label: 'Form Status', key: 'currentFormStatusLabel', width: 32 },
  { label: 'Submitted By', key: 'submittedBy', width: 25 },
  { label: 'Submitted At', key: 'submittedAt', width: 22 },
  { label: 'Created By', key: 'createdBy', width: 25 },
  { label: 'Updated By', key: 'updatedBy', width: 25 },
  { label: 'Created At', key: 'createdAt', width: 22 },
  { label: 'Updated At', key: 'updatedAt', width: 22 },
  { label: 'Is Active SFC', key: 'isActiveSfc', width: 16 },
  { label: 'Award Period', key: 'awardPeriod', width: 16 },
  { label: 'Award Period Duration (Years)', key: 'awardPeriodDuration', width: 28 },
  { label: 'SFC Constituted for Interim?', key: 'sfcConstitutedForInterim', width: 28 },
  { label: 'SFC Award Period Extended?', key: 'sfcAwardPeriodExtended', width: 26 },
  { label: 'Extension Order - File Name', key: 'extensionOrder_fileName', width: 35 },
  { label: 'Extension Order - File URL', key: 'extensionOrder_fileUrl', width: 55 },
  { label: 'Extension Order - File Size', key: 'extensionOrder_fileSize', width: 24 },
  { label: 'Extension Order - MIME Type', key: 'extensionOrder_mimeType', width: 22 },
  { label: 'Which Award Period (SFC)', key: 'whichAwardPeriod', width: 25 },
  { label: 'SFC Report Status', key: 'sfcReportStatus', width: 35 },
  { label: 'Expected Report Submission Date', key: 'reportSubmissionDate', width: 30 },
  { label: 'SFC Report - File Name', key: 'sfcReport_fileName', width: 35 },
  { label: 'SFC Report - File URL', key: 'sfcReport_fileUrl', width: 55 },
  { label: 'SFC Report - File Size', key: 'sfcReport_fileSize', width: 22 },
  { label: 'SFC Report - MIME Type', key: 'sfcReport_mimeType', width: 20 },
  { label: 'ATR Report - File Name', key: 'atrReport_fileName', width: 35 },
  { label: 'ATR Report - File URL', key: 'atrReport_fileUrl', width: 55 },
  { label: 'ATR Report - File Size', key: 'atrReport_fileSize', width: 22 },
  { label: 'ATR Report - MIME Type', key: 'atrReport_mimeType', width: 20 },
  { label: 'Is New SFC Constituted?', key: 'isNewSfcConstituted', width: 25 },
  { label: 'Gazette Notification - File Name', key: 'gazetteNotification_fileName', width: 35 },
  { label: 'Gazette Notification - File URL', key: 'gazetteNotification_fileUrl', width: 55 },
  { label: 'Gazette Notification - File Size', key: 'gazetteNotification_fileSize', width: 28 },
  { label: 'Gazette Notification - MIME Type', key: 'gazetteNotification_mimeType', width: 28 },
  { label: 'Raise an Issue', key: 'raiseAnIssue', width: 45 },
  { label: 'Checkbox Confirmation', key: 'checkboxConfirmation', width: 22 },
];

@Injectable()
export class SfcStatusService {
  constructor(
    @InjectModel(XviFcSfcStatus.name)
    private readonly model: Model<XviFcSfcStatusDocument>,
    @InjectModel(XviFcSfcStatusHistory.name)
    private readonly historyModel: Model<XviFcSfcStatusHistoryDocument>,
    private readonly formJsonService: FormJsonService,
    private readonly validator: DynamicFormValidationService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly config: ConfigService,
  ) {}

  /** Returns the SFC Status question config array from the DB for frontend rendering. */
  async getQuestions(): Promise<XviFcApiResponse<FieldConfig[]>> {
    const questions = await this.loadFormQuestions();
    return xviFcSuccess('SFC Status questions fetched.', questions);
  }

  /**
   * Returns the hydrated SFC Status form for a given state and year.
   * Questions are merged with saved data: answered fields use saved values,
   * unanswered fields use template defaults from SFC_STATUS_QUESTIONS.
   * Returns a fully hydrated Not Started form when no record exists.
   * One DB query + one O(n) pass — no extra queries.
   *
   * @param stateId - ObjectId string of the target state.
   * @param yearId  - ObjectId string of the target year.
   * @param user    - Authenticated user; scope-checked against stateId.
   */
  async getForm(stateId: string, yearId: string, user: AuthUser): Promise<XviFcApiResponse<SfcFormGetResponseData>> {
    this.assertStateAccess(user, stateId);

    const doc = await this.model
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: SFC_STATUS_FORM_TYPE,
        isDeleted: false,
      })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<SfcStatusLeanDoc>()
      .exec();

    const formQuestions = await this.loadFormQuestions(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);

    const formJson: FormJson = {
      design_year: yearId,
      formId: SFC_FORM_ID,
      type: 'SFC',
      data: formQuestions,
      isActive: true,
    };

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const savedData: FormData = (doc?.data ?? {}) as FormData;
    const jwtExpiresIn = (this.config.get<string>('JWT_EXPIRES_IN') ?? '24h') as StringValue;
    const jwtExpiresMs = ms(jwtExpiresIn) ?? 24 * 60 * 60 * 1000;
    const folderPathContext: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };
    const questions = this.hydrateQuestions(savedData, formJson, jwtExpiresMs, folderPathContext);
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);

    const responseData: SfcFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formName: formJson.type,
      formId: formJson.formId,
      stateName,
      stateId,
      yearId,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      questions,
      permissions,
      actors,
      instructions: [],
      meta: { version: 1 },
    };

    return xviFcSuccess('SFC Status form fetched.', responseData);
  }

  /**
   * Saves the SFC Status form as a draft.
   * Runs partial validation — absent required fields are allowed; requiredTrue and all
   * format validators (pattern, yearRange, etc.) are still enforced on any provided value.
   * Upserts by state + year + formType. Sets status to IN_PROGRESS.
   *
   * @param dto       - Payload with stateId, yearId, and form data.
   * @param user      - Authenticated user; must have EDIT_STATE_FORMS permission.
   * @param ip        - Client IP stored in history.
   * @param userAgent - User-Agent header stored in history.
   */
  async saveDraft(dto: SaveSfcStatusDto, user: AuthUser, ip: string, userAgent: string): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const formQuestions = await this.loadFormQuestions(dto.yearId);
    const result = this.validator.validateDraftAndBuildPayload(formQuestions, dto.data as FormData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: SFC_STATUS_FORM_TYPE };

    const existing = await this.model
      .findOne(filter, { _id: 1, currentFormStatus: 1, data: 1 })
      .lean<{ _id: Types.ObjectId; currentFormStatus: number; data?: FormData }>()
      .exec();

    const sanitizedPayload = this.normalizeFileFields(result.sanitizedPayload, formQuestions, existing?.data ?? {});

    if (existing) {
      assertCanStateEditForm(existing.currentFormStatus);

      const updated = await this.model
        .findOneAndUpdate(
          filter,
          { $set: { data: sanitizedPayload, currentFormStatus: FORM_STATUS.IN_PROGRESS, updatedBy: userOid } },
          { new: true },
        )
        .lean()
        .exec();

      await this.createHistoryEntry({
        sfcStatusFormId: existing._id,
        stateId: stateOid,
        yearId: yearOid,
        action: SfcStatusAction.UPDATE_DRAFT,
        fromStatus: existing.currentFormStatus,
        toStatus: FORM_STATUS.IN_PROGRESS,
        changedBy: userOid,
        ip,
        userAgent,
      });

      return xviFcSuccess('SFC Status form saved as draft.', {
        ...updated,
        currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
      });
    }

    const created = await this.model.create({
      state: stateOid,
      year: yearOid,
      formType: SFC_STATUS_FORM_TYPE,
      data: sanitizedPayload,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      createdBy: userOid,
      updatedBy: userOid,
      isActive: true,
      isDeleted: false,
    });

    await this.createHistoryEntry({
      sfcStatusFormId: created._id,
      stateId: stateOid,
      yearId: yearOid,
      action: SfcStatusAction.CREATE_DRAFT,
      fromStatus: FORM_STATUS.NOT_STARTED,
      toStatus: FORM_STATUS.IN_PROGRESS,
      changedBy: userOid,
      ip,
      userAgent,
    });

    return xviFcSuccess('SFC Status form saved as draft.', {
      ...created.toObject(),
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
    });
  }

  /**
   * Final-submits the SFC Status form for a given state and year.
   * Supports one-shot submit: creates the record if none exists yet.
   * Runs full validation — all visible required fields must be present and valid.
   * Persists the sanitized visible-field payload and transitions status to
   * SUBMISSION_ACKNOWLEDGED_BY_MOHUA. Blocked by `assertCanStateFinalSubmitForm`.
   *
   * @param dto       - Payload with stateId, yearId, and form data.
   * @param user      - Authenticated user; must have FINAL_SUBMIT_STATE_FORMS permission.
   * @param ip        - Client IP stored in history.
   * @param userAgent - User-Agent header stored in history.
   */
  async finalSubmit(dto: SaveSfcStatusDto, user: AuthUser, ip: string, userAgent: string): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const formQuestions = await this.loadFormQuestions(dto.yearId);
    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: SFC_STATUS_FORM_TYPE };

    const existing = await this.model
      .findOne(filter, { _id: 1, currentFormStatus: 1, data: 1 })
      .lean<{ _id: Types.ObjectId; currentFormStatus: number; data?: FormData }>()
      .exec();
    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;

    assertCanStateFinalSubmitForm(fromStatus);

    const validation = this.validator.validateFinalSubmitAndBuildPayload(formQuestions, dto.data as FormData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const sanitizedPayload = this.normalizeFileFields(validation.sanitizedPayload, formQuestions, existing?.data ?? {});
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const now = new Date();

    let formOid: Types.ObjectId;
    let result: Record<string, unknown>;

    if (existing) {
      const updated = await this.model
        .findOneAndUpdate(
          { _id: existing._id },
          {
            $set: {
              data: sanitizedPayload,
              currentFormStatus: toStatus,
              submittedBy: userOid,
              submittedAt: now,
              updatedBy: userOid,
            },
          },
          { new: true },
        )
        .lean()
        .exec();

      formOid = existing._id;
      result = (updated ?? {}) as Record<string, unknown>;
    } else {
      const created = await this.model.create({
        state: stateOid,
        year: yearOid,
        formType: SFC_STATUS_FORM_TYPE,
        data: sanitizedPayload,
        currentFormStatus: toStatus,
        submittedBy: userOid,
        submittedAt: now,
        createdBy: userOid,
        updatedBy: userOid,
        isActive: true,
        isDeleted: false,
      });

      formOid = created._id;
      result = created.toObject() as unknown as Record<string, unknown>;
    }

    await this.createHistoryEntry({
      sfcStatusFormId: formOid,
      stateId: stateOid,
      yearId: yearOid,
      action: SfcStatusAction.FINAL_SUBMIT,
      fromStatus,
      toStatus,
      changedBy: userOid,
      ip,
      userAgent,
    });

    return xviFcSuccess('SFC Status form submitted successfully.', {
      ...result,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  /**
   * Exports all SFC Status records as an Excel workbook buffer.
   * ADMIN scope exports all records; STATE scope is restricted to the user's own state.
   * Optional filters (stateId, yearId, status) narrow the result set further.
   *
   * @param filters   - Optional stateId / yearId / status query params.
   * @param user      - Authenticated user; used for scope enforcement.
   * @returns ExcelJS buffer ready to stream as an `.xlsx` download.
   */
  async dumpToExcel(filters: SfcStatusDumpFilters, user: AuthUser): Promise<Buffer> {
    const resolvedFilters = this.resolveDumpFilters(filters, user);

    const mongoFilter: FilterQuery<XviFcSfcStatusDocument> = { isDeleted: false };
    if (resolvedFilters.stateId) mongoFilter['state'] = new Types.ObjectId(resolvedFilters.stateId);
    if (resolvedFilters.yearId) mongoFilter['year'] = new Types.ObjectId(resolvedFilters.yearId);
    if (resolvedFilters.status !== undefined) mongoFilter['currentFormStatus'] = resolvedFilters.status;

    const docs = (await this.model
      .find(mongoFilter)
      .populate<{ state: SfcStatusPopulatedState }>('state', 'name')
      .populate<{ year: SfcStatusPopulatedYear }>('year', 'year')
      .populate<{ createdBy: SfcStatusPopulatedUser }>('createdBy', 'name')
      .populate<{ updatedBy: SfcStatusPopulatedUser }>('updatedBy', 'name')
      .populate<{ submittedBy: SfcStatusPopulatedUser }>('submittedBy', 'name')
      .lean()
      .exec()) as unknown as SfcStatusDumpRecord[];

    const formQuestions = await this.loadFormQuestions();
    const radioLabelMap = this.buildRadioLabelMap(formQuestions);
    const rows = docs.map((doc) => this.buildDumpRow(doc, radioLabelMap));

    return this.excelService.generateExcel(SFC_DUMP_HEADERS, rows, 'SFC Status');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Rebuilds every file-type field in a validated payload into the canonical FileInfo
   * shape, discarding any client-supplied `updatedAt` and any other stray keys. When
   * the normalized incoming path matches the existing stored path, the stored FileInfo
   * (both timestamps) is preserved unchanged. Throws a field-keyed XviFc validation
   * error if any file field fails normalization (bad ISO date, size, or type).
   */
  private normalizeFileFields(payload: FormData, formQuestions: FieldConfig[], existingData: FormData): FormData {
    const errors: XviFcValidationErrorMap = {};
    const normalized: FormData = { ...payload };
    const now = new Date();

    for (const field of formQuestions) {
      if (field.formFieldType !== 'file') continue;
      if (!Object.prototype.hasOwnProperty.call(payload, field.key)) continue;

      const raw = payload[field.key];
      if (raw === null || raw === undefined) {
        normalized[field.key] = null;
        continue;
      }

      const existingFile = existingData[field.key] as FileInfo | undefined;
      const maxSizeKb = field.maxFileSize !== undefined ? field.maxFileSize * 1024 : undefined;
      const { file, errors: fieldErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        raw as Record<string, unknown>,
        existingFile,
        { fieldKey: field.key, allowedExtensions: field.allowedFileTypes, maxSizeKb },
      );

      if (fieldErrors.length > 0) {
        errors[field.key] = fieldErrors;
        continue;
      }

      normalized[field.key] = file !== undefined ? { ...file, createdAt: now, updatedAt: now } : existingFile;
    }

    if (Object.keys(errors).length > 0) throwXviFcValidationError(errors);
    return normalized;
  }

  /**
   * Merges saved form data onto the question template in one O(n) pass.
   * For each question: uses saved value if the key exists in savedData,
   * otherwise keeps the template default. File-type questions additionally
   * have their fileUrl signed with a JWT-lifetime token.
   *
   * @param savedData    - Key-value pairs from the stored document's `data` field.
   * @param formJson     - Form template carrying the question config array.
   * @param jwtExpiresMs - Token lifetime in milliseconds used to sign file URLs.
   */
  private hydrateQuestions(
    savedData: FormData,
    formJson: FormJson,
    jwtExpiresMs: number,
    folderPathContext?: XviFcFolderPathContext,
  ): HydratedFieldConfig[] {
    return formJson.data.map((question) => {
      const value = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      if (question.formFieldType === 'file') {
        const resolvedFolderPath =
          question.folderPathKey && folderPathContext
            ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
            : question.folderPath;

        const fileVal = value as FileInfo | null | undefined;
        const hydrated = this.fileInfoNormalizer.hydrateFileInfoForResponse(fileVal ?? null, (p) =>
          this.signStorageFileUrl(p, jwtExpiresMs),
        );
        return { ...question, folderPath: resolvedFolderPath, value: hydrated ?? value };
      }

      return { ...question, value };
    });
  }

  /**
   * Derives status-aware form permissions for the requesting user.
   * All three flags are gated by role/permission, state scope access, and current form status.
   * canEdit and canFinalSubmit are false whenever the status does not allow editing/submission,
   * regardless of the user's role.
   *
   * @param user    - Authenticated user.
   * @param stateId - ObjectId string of the target state; used for scope check.
   * @param status  - Current numeric form status from the document (or NOT_STARTED if absent).
   */
  private buildFormPermissions(user: AuthUser, stateId: string, status: number): SfcFormPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = this.hasStateAccess(user, stateId);
    return {
      canView: perms.has(Permission.VIEW_STATE_FORMS) && hasAccess,
      canEdit: perms.has(Permission.EDIT_STATE_FORMS) && hasAccess && canStateEditForm(status),
      canFinalSubmit: perms.has(Permission.FINAL_SUBMIT_STATE_FORMS) && hasAccess && canStateFinalSubmitForm(status),
    };
  }

  /**
   * Inserts a single history record into xvi_fc_sfc_status_histories.
   * Called after every successful status transition. The main form document
   * is updated first; if this insert fails the transition already persisted —
   * use transactions if atomic history is required.
   *
   * @param entry - All fields required to describe the transition;
   *                ip and userAgent are optional (omitted for non-HTTP triggers).
   */
  private async createHistoryEntry(entry: SfcHistoryEntryInput): Promise<void> {
    await this.historyModel.create({
      sfcStatusForm: entry.sfcStatusFormId,
      state: entry.stateId,
      year: entry.yearId,
      action: entry.action,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedBy: entry.changedBy,
      changedAt: new Date(),
      ip: entry.ip,
      userAgent: entry.userAgent,
      remarks: entry.remarks,
      metadata: entry.metadata,
      isActive: true,
      isDeleted: false,
    });
  }

  // ─── Dump helpers ────────────────────────────────────────────────────────────

  /**
   * Enforces scope rules for the dump endpoint and merges any implicit state filter.
   * ADMIN: filters applied as-is.
   * STATE: stateId in filters must match the user's own state (or is forced to it).
   * Any other scope: ForbiddenException.
   */
  private resolveDumpFilters(filters: SfcStatusDumpFilters, user: AuthUser): SfcStatusDumpFilters {
    if (user.scope === Scope.ADMIN) return filters;

    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (!userStateId) throw new ForbiddenException('Access denied');

      if (filters.stateId && filters.stateId !== userStateId) {
        throw new ForbiddenException('You can only export your own state data');
      }

      return { ...filters, stateId: userStateId };
    }

    throw new ForbiddenException('Access denied');
  }

  /** Flattens a populated SFC Status document into a single Excel row object. */
  private buildDumpRow(
    doc: SfcStatusDumpRecord,
    radioLabelMap: Record<string, Record<string, string>>,
  ): SfcStatusDumpRow {
    const data = doc.data ?? {};

    const awardPeriod = this.strVal(data['awardPeriod']);
    const extensionOrder = this.extractFileColumns(data['extensionOrder']);
    const sfcReport = this.extractFileColumns(data['sfcReport']);
    const atrReport = this.extractFileColumns(data['atrReport']);
    const gazetteNotification = this.extractFileColumns(data['gazetteNotification']);

    return {
      stateName: doc.state?.name ?? '',
      yearName: doc.year?.year ?? '',
      currentFormStatus: doc.currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(doc.currentFormStatus),
      submittedBy: doc.submittedBy?.name ?? '',
      submittedAt: doc.submittedAt ? doc.submittedAt.toISOString() : '',
      createdBy: doc.createdBy?.name ?? '',
      updatedBy: doc.updatedBy?.name ?? '',
      createdAt: doc.createdAt ? doc.createdAt.toISOString() : '',
      updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : '',
      isActiveSfc: this.radioVal(radioLabelMap, 'isActiveSfc', data['isActiveSfc']),
      awardPeriod,
      awardPeriodDuration: this.deriveAwardPeriodDuration(awardPeriod),
      sfcConstitutedForInterim: this.radioVal(
        radioLabelMap,
        'sfcConstitutedForInterim',
        data['sfcConstitutedForInterim'],
      ),
      sfcAwardPeriodExtended: this.radioVal(radioLabelMap, 'sfcAwardPeriodExtended', data['sfcAwardPeriodExtended']),
      extensionOrder_fileName: extensionOrder.fileName,
      extensionOrder_fileUrl: extensionOrder.fileUrl,
      extensionOrder_fileSize: extensionOrder.fileSize,
      extensionOrder_mimeType: extensionOrder.mimeType,
      whichAwardPeriod: this.strVal(data['whichAwardPeriod']),
      sfcReportStatus: this.radioVal(radioLabelMap, 'sfcReportStatus', data['sfcReportStatus']),
      reportSubmissionDate: this.strVal(data['reportSubmissionDate']),
      sfcReport_fileName: sfcReport.fileName,
      sfcReport_fileUrl: sfcReport.fileUrl,
      sfcReport_fileSize: sfcReport.fileSize,
      sfcReport_mimeType: sfcReport.mimeType,
      atrReport_fileName: atrReport.fileName,
      atrReport_fileUrl: atrReport.fileUrl,
      atrReport_fileSize: atrReport.fileSize,
      atrReport_mimeType: atrReport.mimeType,
      isNewSfcConstituted: this.radioVal(radioLabelMap, 'isNewSfcConstituted', data['isNewSfcConstituted']),
      gazetteNotification_fileName: gazetteNotification.fileName,
      gazetteNotification_fileUrl: gazetteNotification.fileUrl,
      gazetteNotification_fileSize: gazetteNotification.fileSize,
      gazetteNotification_mimeType: gazetteNotification.mimeType,
      raiseAnIssue: this.strVal(data['raiseAnIssue']),
      checkboxConfirmation: this.strVal(data['checkboxConfirmation']),
    };
  }

  /**
   * Extracts the four file sub-fields from a canonical FileInfo value.
   * The path is signed into a download URL with a 1-week expiry via FileTokenService.
   * Column keys/labels/units are unchanged from the legacy dump contract; only the
   * source fields read (canonical FileInfo instead of the old fileName/fileUrl/fileSize
   * shape) have changed. Returns empty strings for absent or malformed values.
   */
  private extractFileColumns(value: unknown): {
    fileName: string;
    fileUrl: string;
    fileSize: string;
    mimeType: string;
  } {
    if (typeof value !== 'object' || value === null) {
      return { fileName: '', fileUrl: '', fileSize: '', mimeType: '' };
    }

    const f = value as Partial<FileInfo>;
    const rawPath = typeof f.path === 'string' ? f.path : '';
    return {
      fileName: typeof f.originalName === 'string' ? f.originalName : '',
      fileUrl: this.signStorageFileUrl(rawPath, 7 * 24 * 60 * 60 * 1000),
      fileSize: typeof f.sizeKb === 'number' ? (f.sizeKb / 1024).toFixed(2) + ' MB' : '',
      mimeType: typeof f.mimeType === 'string' ? f.mimeType : '',
    };
  }

  /**
   * Signs a relative S3 file path into an encrypted download token URL.
   * Prepends AWS_STORAGE_URL to form the full path, encrypts with FileTokenService,
   * and returns the app download endpoint URL with the token as a query param.
   *
   * @param relativePath - S3 key as stored in the DB.
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
   * Fetches SFC form questions via FormJsonService.
   * When a yearId is provided the call hits the Redis-cached
   * `findActiveByDesignYearAndFormId(yearId, SFC_FORM_ID)` path.
   * When no yearId is available (getQuestions, dumpToExcel) it falls back to
   * `findByType('SFC')` which queries `{ type, isActive: true }`.
   */
  private async loadFormQuestions(yearId?: string): Promise<FieldConfig[]> {
    const formJson = yearId
      ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, SFC_FORM_ID)
      : await this.formJsonService.findByType('SFC');
    if (!formJson.data?.length) throw new NotFoundException('SFC Status form configuration not found');
    return formJson.data;
  }

  /** Builds a radio option id → label map from a questions array. */
  private buildRadioLabelMap(questions: FieldConfig[]): Record<string, Record<string, string>> {
    return Object.fromEntries(
      questions
        .filter((q) => q.formFieldType === 'radio' && Array.isArray(q.options))
        .map((q) => [q.key, Object.fromEntries((q.options as FormFieldOption[]).map((o) => [o.id, o.label]))]),
    );
  }

  /** Resolves a stored radio option id to its display label; falls back to the raw value if not found. */
  private radioVal(map: Record<string, Record<string, string>>, key: string, value: unknown): string {
    if (typeof value !== 'string' || !value) return '';
    return map[key]?.[value] ?? value;
  }

  /** Coerces any scalar form-data value to a string for Excel output. */
  private strVal(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  /**
   * Derives the numeric duration from an `awardPeriod` string (e.g. `'2026-2031'` → `'5'`).
   * Returns an empty string when the format is not `YYYY-YYYY`.
   */
  private deriveAwardPeriodDuration(awardPeriod: string): string {
    const m = /^(\d{4})-(\d{4})$/.exec(awardPeriod);
    if (!m) return '';
    return String(parseInt(m[2], 10) - parseInt(m[1], 10));
  }

  // ─── Scope enforcement ────────────────────────────────────────────────────

  /**
   * Returns true when the user is permitted to access data for the given state.
   * ADMIN bypasses state scope; STATE users must match their assigned state.
   */
  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  /** Throws ForbiddenException when the user does not have access to the given state. */
  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
