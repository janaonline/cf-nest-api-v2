import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Buffer } from 'exceljs';
import ms, { type StringValue } from 'ms';
import { Model, Types } from 'mongoose';
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
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { DynamicFormValidationService } from '../../common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from '../../common/services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from '../../common/services/file-url-normalizer.service';
import type { FormData } from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import type {
  FieldSupportingContent,
  HydratedFieldConfig,
  UploadedFileValue,
} from '../../common/types/field-config.type';
import type { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import {
  throwXviFcValidationError,
  throwXviFcValidationErrorWithData,
  xviFcSuccess,
} from '../../common/response/xvi-fc-response.util';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
  EulbValidationStatus,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import {
  EULB_ACTION_DOWNLOAD_ERROR_SHEET,
  EULB_ACTION_DOWNLOAD_TEMPLATE,
  EULB_ACTION_REVALIDATE_EXCEL,
  EULB_ACTION_VIEW_UPLOADED_DATA,
  EULB_FORM_NAME,
  EULB_ROW_EDIT_FIELDS,
  TEMPLATE_HEADERS,
  TEMP_QUESTIONS,
} from './constants/elected-urban-local-bodies.constants';
import type { SaveElectedUrbanLocalBodiesDraftDto } from './dto/save-elected-urban-local-bodies-draft.dto';
import type { FinalSubmitElectedUrbanLocalBodiesDto } from './dto/final-submit-elected-urban-local-bodies.dto';
import type {
  EulbFormGetResponseData,
  EulbFormLeanDoc,
  EulbFormPermissions,
  EulbValidationSummary,
} from './elected-urban-local-bodies.types';

@Injectable()
export class ElectedUrbanLocalBodiesService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly model: Model<EulbFormDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly validator: DynamicFormValidationService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly config: ConfigService,
    private readonly fileUrlNormalizer: FileUrlNormalizerService,
  ) {}

  /**
   * Returns the Elected Urban Local Bodies question config for frontend rendering.
   * Reads directly from TEMP_QUESTIONS — no DB call required.
   * The electedBodyExcelFile question receives default (no-form) supporting actions.
   */
  getQuestions(): XviFcApiResponse<HydratedFieldConfig[]> {
    const noPermissions: EulbFormPermissions = { canView: false, canEdit: false, canFinalSubmit: false };
    const questions = TEMP_QUESTIONS.map((q) => {
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
    const questions = this.hydrateQuestions(savedData, jwtExpiresMs, doc, permissions);
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
      rowEditFields: EULB_ROW_EDIT_FIELDS,
      permissions,
      actors,
      validationSummary,
      instructions: [],
      meta: { version: 1 },
    };

    return xviFcSuccess('Elected Urban Local Bodies form fetched.', responseData);
  }

  /**
   * Generates an Excel template pre-filled with active DB ULBs for the given state.
   * Returns an ExcelJS buffer ready to stream as a downloadable .xlsx file.
   *
   * @param stateId - ObjectId string of the state whose ULBs populate the template.
   * @param yearId  - Unused in query but required for future year-scoped filtering.
   * @param user    - Authenticated user; scope-checked against stateId.
   */
  async getTemplate(stateId: string, yearId: string, user: AuthUser): Promise<Buffer> {
    this.assertStateAccess(user, stateId);

    const ulbs = await this.ulbModel
      .find({ state: new Types.ObjectId(stateId), isActive: true })
      .select('_id name censusCode sbCode')
      .sort({ name: 1 })
      .lean()
      .exec();

    const rows = ulbs.map((u: Record<string, unknown>) => ({
      censusCode: (u['censusCode'] as string | null) || (u['sbCode'] as string | null) || '',
      ulbName: u['name'] as string,
      electedBodyStatus: '',
      dateOfConstitution: '',
      dateOfExpiry: '',
      remarks: '',
    }));

    return this.excelService.generateExcel(TEMPLATE_HEADERS as RowHeader[], rows, 'Elected Bodies Template');
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

    const rawExcelFile = dto.data.electedBodyExcelFile;
    const normalizedExcelFile = rawExcelFile?.fileUrl
      ? { ...rawExcelFile, fileUrl: this.fileUrlNormalizer.toRawStoragePath(rawExcelFile.fileUrl) }
      : rawExcelFile;

    const formData: FormData = {
      ulbCount: dto.data.ulbCount,
      electedBodyExcelFile: normalizedExcelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };

    const result = this.validator.validateDraftAndBuildPayload(TEMP_QUESTIONS, formData);
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
            message: `ULB count does not match the validated Excel row count (${savedExcelRowCount}).`,
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
    const validation = this.validator.validateFinalSubmitAndBuildPayload(TEMP_QUESTIONS, formData);
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
            message: `ULB count does not match the validated Excel row count (${excelRowCount}).`,
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
    savedData: FormData,
    jwtExpiresMs: number,
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
  ): HydratedFieldConfig[] {
    return TEMP_QUESTIONS.map((question) => {
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
            label: 'View uploaded data',
            icon: 'bi bi-table',
            tone: 'primary',
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
            tone: 'warning',
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
