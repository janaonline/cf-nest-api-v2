import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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
import type { FormData } from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import type { HydratedFieldConfig, UploadedFileValue } from '../../common/types/field-config.type';
import type { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
  EulbValidationStatus,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { Ulb, UlbDocument } from '../../../../schemas/ulb.schema';
import { EULB_FORM_NAME, TEMPLATE_HEADERS, TEMP_QUESTIONS } from './constants/elected-urban-local-bodies.constants';
import type { SaveElectedUrbanLocalBodiesDraftDto } from './dto/save-elected-urban-local-bodies-draft.dto';
import type { FinalSubmitElectedUrbanLocalBodiesDto } from './dto/final-submit-elected-urban-local-bodies.dto';
import type {
  EulbFormActor,
  EulbFormGetResponseData,
  EulbFormLeanDoc,
  EulbFormPermissions,
  EulbValidationSummary,
} from './elected-urban-local-bodies.types';

function getPopulatedName(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  const name = (value as Record<string, unknown>)['name'];
  return typeof name === 'string' ? name : undefined;
}

const toIsoStringOrNull = (value: unknown): string | null => {
  if (!(value instanceof Date)) return null;
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};

@Injectable()
export class ElectedUrbanLocalBodiesService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly model: Model<EulbFormDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly validator: DynamicFormValidationService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns the Elected Urban Local Bodies question config for frontend rendering.
   * Reads directly from TEMP_QUESTIONS — no DB call required.
   */
  getQuestions(): XviFcApiResponse<HydratedFieldConfig[]> {
    return xviFcSuccess('Elected Urban Local Bodies questions fetched.', TEMP_QUESTIONS as HydratedFieldConfig[]);
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

    const questions = this.hydrateQuestions(savedData, jwtExpiresMs);
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);
    const { actors, stateName } = this.getActors(doc);
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
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const formData: FormData = {
      ulbCount: dto.data.ulbCount,
      electedBodyExcelFile: dto.data.electedBodyExcelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };

    const result = this.validator.validateDraftAndBuildPayload(TEMP_QUESTIONS, formData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };

    const existing = await this.model.findOne(filter, { _id: 1, currentFormStatus: 1 }).lean().exec();

    const fieldUpdates: Record<string, unknown> = {
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      updatedBy: userOid,
    };
    if (result.sanitizedPayload['ulbCount'] !== undefined)
      fieldUpdates['ulbCount'] = result.sanitizedPayload['ulbCount'];
    if (result.sanitizedPayload['electedBodyExcelFile'] !== undefined)
      fieldUpdates['electedBodyExcelFile'] = result.sanitizedPayload['electedBodyExcelFile'];
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
    ip: string,
    userAgent: string,
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
        ulbCount: 1,
      })
      .lean()
      .exec();

    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateFinalSubmitForm(fromStatus);

    // Full form-level validation
    const formData: FormData = {
      ulbCount: dto.data.ulbCount,
      electedBodyExcelFile: dto.data.electedBodyExcelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };
    const validation = this.validator.validateFinalSubmitAndBuildPayload(TEMP_QUESTIONS, formData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    // Excel/row validation checks
    if (!existing) {
      throw new BadRequestException('Excel has not been validated. Please validate the Excel file before submitting.');
    }

    const storedValidationStatus = existing.validationStatus as EulbValidationStatus | undefined;
    const errorRowCount = (existing.errorRowCount as number | undefined) ?? 0;
    const missingDbUlbCount = (existing.missingDbUlbCount as number | undefined) ?? 0;
    const excelRowCount = (existing.excelRowCount as number | undefined) ?? 0;
    const dbUlbCount = (existing.dbUlbCount as number | undefined) ?? 0;
    const storedUlbCount = existing.ulbCount ?? 0;

    if (storedValidationStatus !== 'VALID') {
      throw new BadRequestException('Excel validation status must be VALID before submitting.');
    }
    if (errorRowCount > 0) {
      throw new BadRequestException(
        `${errorRowCount} row(s) have validation errors. Fix all errors before submitting.`,
      );
    }
    if (missingDbUlbCount > 0) {
      throw new BadRequestException(`${missingDbUlbCount} DB ULB(s) are missing from the Excel file.`);
    }
    if (excelRowCount > dbUlbCount * 2) {
      throw new BadRequestException(
        `Excel row count (${excelRowCount}) exceeds the maximum allowed (${dbUlbCount * 2}).`,
      );
    }
    if (dto.data.ulbCount !== storedUlbCount || dto.data.ulbCount !== excelRowCount) {
      throw new BadRequestException('ULB count does not match the validated Excel row count.');
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
      electedBodyExcelFile: dto.data.electedBodyExcelFile,
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
   * Extracts the three actor entries (created/updated/submitted) and stateName
   * from a lean populated getForm document.
   *
   * @param doc - Lean form document with populated state, createdBy, updatedBy, submittedBy.
   */
  private getActors(doc: EulbFormLeanDoc | null): { actors: EulbFormActor[]; stateName: string } {
    const stateName = getPopulatedName(doc?.state) ?? '';
    return {
      stateName,
      actors: [
        { action: 'Created by', by: getPopulatedName(doc?.createdBy) ?? null, date: toIsoStringOrNull(doc?.createdAt) },
        { action: 'Updated by', by: getPopulatedName(doc?.updatedBy) ?? null, date: toIsoStringOrNull(doc?.updatedAt) },
        {
          action: 'Submitted by',
          by: getPopulatedName(doc?.submittedBy) ?? null,
          date: toIsoStringOrNull(doc?.submittedAt),
        },
      ],
    };
  }

  /**
   * Merges saved form data onto TEMP_QUESTIONS in one O(n) pass.
   * File-type questions have their fileUrl signed with a JWT-lifetime token.
   *
   * @param savedData    - Key-value pairs extracted from the stored form document's top-level fields.
   * @param jwtExpiresMs - Token lifetime in milliseconds used when signing file URLs.
   */
  private hydrateQuestions(savedData: FormData, jwtExpiresMs: number): HydratedFieldConfig[] {
    return TEMP_QUESTIONS.map((question) => {
      const value = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      if (question.formFieldType === 'file') {
        const fileVal = value as UploadedFileValue | null | undefined;
        if (fileVal?.fileUrl) {
          const signedUrl = this.signStorageFileUrl(fileVal.fileUrl, jwtExpiresMs);
          return { ...question, value: { ...fileVal, fileUrl: signedUrl } };
        }
      }

      return { ...question, value };
    });
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
