import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
  canStateEditForm,
  canStateFinalSubmitForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type {
  FieldConfig,
  FormData,
  HydratedFieldConfig,
} from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import {
  applyActionVisibility,
  findSupportingAction,
  stripSupportingContentMeta,
} from 'src/module/xvi-fc/common/utils/xvi-fc-supporting-content-visibility.util';
import { keyByFieldKey, requireField } from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { deriveFileValidationOptions } from 'src/module/xvi-fc/common/utils/xvi-fc-file-constraint.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  ApplicableFc,
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL,
  FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID,
  FC_UNSPENT_DEVOLUTION_INSTALLMENT,
  FC_UNSPENT_BLOCKING_MESSAGE_MISSING_DEVOLUTION,
  FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_RETURNED,
  FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_NOT_READY,
} from '../../constants/fc-unspent-declaration.constants';
import type {
  FcUnspentActiveRowLean,
  FcUnspentDeclarationGetResponseData,
  FcUnspentDeclarationTemplateResponseData,
  FcUnspentDependencyGates,
  FcUnspentDevolutionFormLean,
  FcUnspentPermissions,
  FcUnspentUlbRowResponse,
} from '../../types/fc-unspent-declaration.types';
import { SaveFcUnspentDeclarationDto } from '../../dto/save-fc-unspent-declaration.dto';
import { FcUnspentDeclarationRowService } from '../rows/fc-unspent-declaration-row.service';
import { FcUnspentDeclarationFormJsonService } from '../form-json/fc-unspent-declaration-form-json.service';
import { getFcUnspentFieldsByType } from '../../helpers/fc-unspent-declaration-form-json.helpers';
import { S3Service } from 'src/core/s3/s3.service';

type PopulatedNameRef = { _id?: Types.ObjectId; name?: string };

type FcUnspentLeanDoc = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | PopulatedNameRef;
  currentFormStatus?: number;
  isFcUnspent?: boolean | null;
  fcDeclaration?: FileInfo | null;
  checkboxConfirmation?: boolean;
};

type FcUnspentExistingLean = {
  _id: Types.ObjectId;
  currentFormStatus: number;
  fcDeclaration?: FileInfo | null;
  auditRevision?: number;
};

@Injectable()
export class FcUnspentDeclarationService {
  constructor(
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly model: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(XviFcUnspentStateFormHistory.name)
    private readonly historyModel: Model<XviFcUnspentStateFormHistoryDocument>,
    @InjectModel(DevolutionFormulaForm.name)
    private readonly devolutionFormModel: Model<DevolutionFormulaFormDocument>,
    private readonly rowService: FcUnspentDeclarationRowService,
    private readonly formJsonConfigService: FcUnspentDeclarationFormJsonService,
    private readonly dynamicFormValidator: DynamicFormValidationService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Returns the hydrated FC Unspent Declaration form for a given state and year.
   * Never includes the full ULB options list — that is served by the separate
   * lazy /ulb-options endpoint. Active rows are loaded from the row collection —
   * the parent document no longer stores them.
   */
  async getForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentDeclarationGetResponseData>> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const doc = await this.model
      .findOne({ state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<FcUnspentLeanDoc>()
      .exec();

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const gates = await this.resolveDevolutionDependency(stateOid, yearOid);
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus, gates);
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);

    const { fields: allFields, thresholdPercent: threshold } = await this.formJsonConfigService.loadFormConfig(yearId);
    const questionsConfig = getFcUnspentFieldsByType(allFields, 'FC_UNSPENT_MAIN_FORM_FIELDS');
    const rowEditFields = getFcUnspentFieldsByType(allFields, 'FC_UNSPENT_ROW_EDIT_FIELDS');
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('FC_UNSPENT_ROW_EDIT_FIELDS group is empty in form configuration.');
    }
    const savedData: FormData = {};
    // Stored/validated as a strict boolean (see save DTO), but the radio control and its
    // visibleWhen conditions operate in the 'yes'/'no' string domain — convert for display only.
    if (doc?.isFcUnspent !== undefined) {
      savedData['isFcUnspent'] = doc.isFcUnspent === true ? 'yes' : doc.isFcUnspent === false ? 'no' : null;
    }
    if (doc?.fcDeclaration !== undefined) savedData['fcDeclaration'] = doc.fcDeclaration;
    if (doc?.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;

    const folderPathContext: XviFcFolderPathContext = { _id: stateId, role: 'state', designYear };
    const questions = this.hydrateQuestions(questionsConfig, savedData, folderPathContext, permissions.canEdit);

    const activeRows = doc ? await this.rowService.getActiveRows(doc._id) : [];
    const unspentUlbData = activeRows.map((row) => this.mapRowToResponse(row));

    const responseData: FcUnspentDeclarationGetResponseData = {
      stateName,
      applicableFc,
      threshold,
      currentFormStatus,
      permissions,
      dependency: gates.dependency,
      actors,
      questions,
      rowEditFields,
      unspentUlbData,
    };

    return xviFcSuccess('FC Unspent Declaration form fetched.', responseData);
  }

  /**
   * Saves the FC Unspent Declaration form as a draft. Allowed statuses:
   * NOT_STARTED, IN_PROGRESS, RETURNED_BY_MOHUA. Never creates parent or row
   * history. Parent and row writes happen in one Mongo transaction.
   */
  async saveDraft(dto: SaveFcUnspentDeclarationDto, user: AuthUser): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    const designYear = YearIdToLabel[dto.yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${dto.yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const existing = await this.model
      .findOne({ state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE })
      .lean<FcUnspentExistingLean>()
      .exec();

    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateEditForm(fromStatus);

    const gates = await this.resolveDevolutionDependency(stateOid, yearOid);
    if (!gates.canSaveDraftGate) {
      throwXviFcValidationError({
        _form: [
          {
            message: gates.dependency.blockingMessage ?? 'Draft save is currently blocked.',
            code: 'devolutionBlocked',
          },
        ],
      });
    }

    const { fields: allFields, thresholdPercent } = await this.formJsonConfigService.loadFormConfig(dto.yearId);
    const questions = getFcUnspentFieldsByType(allFields, 'FC_UNSPENT_MAIN_FORM_FIELDS');
    const validatorData: FormData = {
      isFcUnspent: dto.data.isFcUnspent ?? null,
      fcDeclaration: dto.data.fcDeclaration ?? null,
      checkboxConfirmation: dto.data.checkboxConfirmation ?? false,
    };
    const validation = this.dynamicFormValidator.validateDraftAndBuildPayload(questions, validatorData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const isYes = dto.data.isFcUnspent === true;
    const isNo = dto.data.isFcUnspent === false;

    let fcDeclaration: FileInfo | null | undefined;
    let branch: 'yes' | 'no' | 'undecided' = 'undecided';
    let resolvedRows: Awaited<ReturnType<FcUnspentDeclarationRowService['resolveAndValidateRows']>>['rows'] = [];

    if (isNo) {
      branch = 'no';
      if ((dto.data.unspentUlbData ?? []).length > 0) {
        throwXviFcValidationError({
          unspentUlbData: [
            {
              field: 'unspentUlbData',
              code: 'mustBeEmpty',
              message: 'unspentUlbData must be empty when isFcUnspent is No.',
            },
          ],
        });
      }
      if (dto.data.fcDeclaration !== undefined) {
        const fcDeclarationField = requireField(
          keyByFieldKey(questions),
          'fcDeclaration',
          'FcUnspentDeclarationService.saveDraft',
        );
        const { file, errors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
          dto.data.fcDeclaration as unknown as Record<string, unknown>,
          existing?.fcDeclaration,
          deriveFileValidationOptions(fcDeclarationField, 'fcDeclaration'),
        );
        if (errors.length > 0) throwXviFcValidationError({ fcDeclaration: errors });
        fcDeclaration = file;
      }
    } else if (isYes) {
      branch = 'yes';
      const rowsInput = dto.data.unspentUlbData ?? [];
      const { rows: builtRows, errors } = await this.rowService.resolveAndValidateRows(
        stateOid,
        rowsInput,
        gates.devolutionForm,
        { requireAtLeastOne: false, thresholdPercent },
      );
      if (Object.keys(errors).length > 0) throwXviFcValidationError(errors);
      resolvedRows = builtRows;
      fcDeclaration = null;
    }

    const setDoc: Record<string, unknown> = {
      isFcUnspent: dto.data.isFcUnspent ?? null,
      checkboxConfirmation: isYes ? (dto.data.checkboxConfirmation ?? false) : false,
      applicableFc,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      isDraft: true,
      updatedBy: userOid,
    };
    if (fcDeclaration !== undefined) setDoc['fcDeclaration'] = fcDeclaration;

    const session = await this.model.db.startSession();
    let updatedParent: XviFcUnspentStateFormDocument;
    try {
      session.startTransaction();

      updatedParent = await this.model
        .findOneAndUpdate(
          { state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE },
          { $set: setDoc, $setOnInsert: { createdBy: userOid } },
          { upsert: true, new: true, session },
        )
        .exec();

      if (branch === 'no') {
        await this.rowService.deactivateAllRows(updatedParent._id, userOid, session);
      } else if (branch === 'yes') {
        await this.rowService.applyRows(
          updatedParent._id,
          stateOid,
          yearOid,
          resolvedRows,
          userOid,
          undefined,
          session,
        );
      }
      // branch === 'undecided' -> isFcUnspent not yet chosen; leave existing rows untouched.

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('FC Unspent Declaration saved as draft.', {
      _id: String(updatedParent._id),
      currentFormStatus: updatedParent.currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(updatedParent.currentFormStatus),
    });
  }

  /**
   * Final-submits the FC Unspent Declaration form. Requires Devolution Formula
   * Installment 1 to be UNDER_REVIEW_BY_MOHUA with an active dataset. Parent
   * transition, row upserts/deactivation, row-history, and parent history are all
   * committed atomically within one Mongo transaction.
   */
  async finalSubmit(
    dto: SaveFcUnspentDeclarationDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    const designYear = YearIdToLabel[dto.yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${dto.yearId}`);
    const applicableFc = this.resolveApplicableFc(designYear);

    const existing = await this.model
      .findOne({ state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE })
      .lean<FcUnspentExistingLean>()
      .exec();

    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateFinalSubmitForm(fromStatus);

    const gates = await this.resolveDevolutionDependency(stateOid, yearOid);
    if (!gates.canFinalSubmitGate) {
      throwXviFcValidationError({
        _form: [
          {
            message: gates.dependency.blockingMessage ?? 'Final submit is currently blocked.',
            code: 'devolutionBlocked',
          },
        ],
      });
    }

    const { fields: allFields, thresholdPercent } = await this.formJsonConfigService.loadFormConfig(dto.yearId);
    const questions = getFcUnspentFieldsByType(allFields, 'FC_UNSPENT_MAIN_FORM_FIELDS');
    const validatorData: FormData = {
      isFcUnspent: dto.data.isFcUnspent ?? null,
      fcDeclaration: dto.data.fcDeclaration ?? existing?.fcDeclaration ?? null,
      checkboxConfirmation: dto.data.checkboxConfirmation ?? false,
    };
    const validation = this.dynamicFormValidator.validateFinalSubmitAndBuildPayload(questions, validatorData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const isYes = dto.data.isFcUnspent === true;
    const isNo = dto.data.isFcUnspent === false;
    if (!isYes && !isNo) {
      throwXviFcValidationError({
        isFcUnspent: [{ field: 'isFcUnspent', code: 'required', message: 'isFcUnspent is required.' }],
      });
    }

    let finalFcDeclaration: FileInfo | null | undefined;
    let resolvedRows: Awaited<ReturnType<FcUnspentDeclarationRowService['resolveAndValidateRows']>>['rows'] = [];
    let finalCheckboxConfirmation = false;

    if (isNo) {
      if ((dto.data.unspentUlbData ?? []).length > 0) {
        throwXviFcValidationError({
          unspentUlbData: [
            {
              field: 'unspentUlbData',
              code: 'mustBeEmpty',
              message: 'unspentUlbData must be empty when isFcUnspent is No.',
            },
          ],
        });
      }
      // Final submit always requires the declaration reference in the payload (even when
      // unchanged, so the same-path case can be detected below) — omitted/null is rejected
      // rather than silently falling back to `existing`, which would risk clearing a
      // previously stored file if a client ever sends an explicit null.
      if (dto.data.fcDeclaration === undefined || dto.data.fcDeclaration === null) {
        throwXviFcValidationError({
          fcDeclaration: [{ field: 'fcDeclaration', code: 'required', message: 'Signed declaration is required.' }],
        });
      }
      const fcDeclarationField = requireField(
        keyByFieldKey(questions),
        'fcDeclaration',
        'FcUnspentDeclarationService.finalSubmit',
      );
      const { file, errors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.fcDeclaration as unknown as Record<string, unknown>,
        existing?.fcDeclaration,
        deriveFileValidationOptions(fcDeclarationField, 'fcDeclaration'),
      );
      if (errors.length > 0) throwXviFcValidationError({ fcDeclaration: errors });
      finalFcDeclaration = file;
    } else {
      if (dto.data.checkboxConfirmation !== true) {
        throwXviFcValidationError({
          checkboxConfirmation: [
            { field: 'checkboxConfirmation', code: 'requiredTrue', message: 'Please confirm before submitting.' },
          ],
        });
      }
      const rowsInput = dto.data.unspentUlbData ?? [];
      const { rows: builtRows, errors } = await this.rowService.resolveAndValidateRows(
        stateOid,
        rowsInput,
        gates.devolutionForm,
        { requireAtLeastOne: true, thresholdPercent },
      );
      if (Object.keys(errors).length > 0) throwXviFcValidationError(errors);
      resolvedRows = builtRows;
      finalFcDeclaration = null;
      finalCheckboxConfirmation = true;
    }

    const now = new Date();
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const newAuditRevision = (existing?.auditRevision ?? 0) + 1;

    const setDoc: Record<string, unknown> = {
      isFcUnspent: isYes,
      checkboxConfirmation: finalCheckboxConfirmation,
      applicableFc,
      currentFormStatus: toStatus,
      isDraft: false,
      submittedBy: userOid,
      submittedAt: now,
      updatedBy: userOid,
      auditRevision: newAuditRevision,
    };
    if (finalFcDeclaration !== undefined) setDoc['fcDeclaration'] = finalFcDeclaration;

    const session = await this.model.db.startSession();
    try {
      session.startTransaction();

      const updatedParent = await this.model
        .findOneAndUpdate(
          { state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE },
          { $set: setDoc, $setOnInsert: { createdBy: userOid } },
          { upsert: true, new: true, session },
        )
        .exec();

      const parentId = updatedParent._id;

      if (isNo) {
        await this.rowService.deactivateAllRows(parentId, userOid, session);
      } else {
        const { transitions } = await this.rowService.applyRows(
          parentId,
          stateOid,
          yearOid,
          resolvedRows,
          userOid,
          FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          session,
        );
        await this.rowService.insertRowHistory(
          parentId,
          stateOid,
          yearOid,
          transitions,
          userOid,
          ip,
          userAgent,
          session,
        );
      }

      const activeRows = await this.rowService.getActiveRows(parentId, session);
      const snapshot = activeRows.map((row) => this.mapRowToSnapshot(row));

      await this.historyModel.create(
        [
          {
            fcUnspentForm: parentId,
            state: stateOid,
            year: yearOid,
            fromStatus,
            toStatus,
            auditRevision: newAuditRevision,
            applicableFc,
            isFcUnspent: updatedParent.isFcUnspent,
            fcDeclaration: updatedParent.fcDeclaration ?? null,
            unspentUlbData: snapshot,
            checkboxConfirmation: updatedParent.checkboxConfirmation,
            changedBy: userOid,
            changedAt: now,
            ip,
            userAgent,
          },
        ],
        { session },
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('FC Unspent Declaration submitted successfully.', {
      currentFormStatus: toStatus,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  /**
   * Returns a private, signed download URL for the design-year-specific FC Unspent
   * declaration DOCX template (No-branch only). Available only while the form is
   * effectively editable — the same `canEdit` gate (permission + access + form
   * status + Devolution dependency) computed for State GET, so the endpoint and
   * the supporting action it drives are never out of sync.
   */
  async getDeclarationTemplate(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentDeclarationTemplateResponseData>> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const doc = await this.model
      .findOne({ state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .select('currentFormStatus')
      .lean<{ currentFormStatus?: number }>()
      .exec();

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const gates = await this.resolveDevolutionDependency(stateOid, yearOid);
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus, gates);

    if (!permissions.canEdit) {
      throw new ForbiddenException(`Form cannot be edited when status is ${getFormStatusLabel(currentFormStatus)}.`);
    }

    const allFields = await this.formJsonConfigService.loadFields(yearId);
    const mainFields = getFcUnspentFieldsByType(allFields, 'FC_UNSPENT_MAIN_FORM_FIELDS');
    const fcDeclarationField = requireField(
      keyByFieldKey(mainFields),
      'fcDeclaration',
      'FcUnspentDeclarationService.getDeclarationTemplate',
    );
    const template = this.resolveDeclarationTemplateMeta(fcDeclarationField);
    if (!template) {
      throwXviFcValidationError({
        fcDeclaration: [
          {
            field: 'fcDeclaration',
            code: 'templateNotConfigured',
            message: 'The declaration template is not configured for the selected design year.',
          },
        ],
      });
    }

    try {
      const head = await this.s3Service.headObject(template.path);
      if (head.ContentLength === 0) throw new Error('empty object');
    } catch {
      throwXviFcValidationError({
        _form: [
          {
            message: 'The declaration template could not be generated. Please contact support.',
            code: 'templateUnavailable',
          },
        ],
      });
    }

    const url = this.fileTokenService.signFileUrl(template.path);

    return xviFcSuccess('Declaration template generated successfully.', {
      fileName: template.fileName,
      mimeType: template.mimeType,
      url,
    });
  }

  /**
   * Reads the design-year-specific declaration template asset (S3 path/fileName/mimeType) off
   * the `fcDeclaration` field's `download-template` supporting action `meta` — DB-driven, single
   * source of truth. Returns `undefined` (not a thrown error) when the action or a well-formed
   * `meta` is absent — that's an expected, legitimate state for a design year whose template
   * hasn't been approved/uploaded yet, not a malformed-config bug.
   */
  private resolveDeclarationTemplateMeta(
    fcDeclarationField: FieldConfig,
  ): { path: string; fileName: string; mimeType: string } | undefined {
    const action = findSupportingAction(
      fcDeclarationField.supportingContent,
      FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID,
    );
    const meta = action?.meta;
    const path = meta?.['path'];
    const fileName = meta?.['fileName'];
    const mimeType = meta?.['mimeType'];
    if (
      typeof path !== 'string' ||
      !path ||
      typeof fileName !== 'string' ||
      !fileName ||
      typeof mimeType !== 'string' ||
      !mimeType
    ) {
      return undefined;
    }
    return { path, fileName, mimeType };
  }

  // ─── Devolution dependency ──────────────────────────────────────────────────

  /**
   * Resolves the Devolution Formula (Installment 1) dependency for a state/year and
   * derives the dependency block + permission gates. Called identically by GET,
   * save-draft, and final-submit so the three never diverge.
   */
  // Reads devolution-formula's activeDatasetVersion invariant from outside that module — see
  // devolution-formula/docs/adr/0001-dataset-versioning.md before changing either side of this.
  private async resolveDevolutionDependency(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
  ): Promise<FcUnspentDependencyGates> {
    const devolutionForm = await this.devolutionFormModel
      .findOne({ state: stateOid, year: yearOid, installment: FC_UNSPENT_DEVOLUTION_INSTALLMENT })
      .select('_id currentFormStatus activeDatasetVersion')
      .lean<FcUnspentDevolutionFormLean>()
      .exec();

    const devolutionStatus = devolutionForm?.currentFormStatus ?? null;
    const hasActiveDataset = !!devolutionForm && (devolutionForm.activeDatasetVersion ?? 0) > 0;

    if (!devolutionForm || !hasActiveDataset) {
      return {
        dependency: {
          devolutionStatus,
          devolutionDatasetExists: false,
          editableDueToDevolutionReturn: false,
          blockingMessage: FC_UNSPENT_BLOCKING_MESSAGE_MISSING_DEVOLUTION,
        },
        canEditGate: false,
        canSaveDraftGate: false,
        canFinalSubmitGate: false,
        devolutionForm: null,
      };
    }

    if (devolutionStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      return {
        dependency: {
          devolutionStatus,
          devolutionDatasetExists: true,
          editableDueToDevolutionReturn: false,
          blockingMessage: null,
        },
        canEditGate: true,
        canSaveDraftGate: true,
        canFinalSubmitGate: true,
        devolutionForm,
      };
    }

    if (devolutionStatus === FORM_STATUS.RETURNED_BY_MOHUA) {
      return {
        dependency: {
          devolutionStatus,
          devolutionDatasetExists: true,
          editableDueToDevolutionReturn: true,
          blockingMessage: FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_RETURNED,
        },
        canEditGate: true,
        canSaveDraftGate: true,
        canFinalSubmitGate: false,
        devolutionForm,
      };
    }

    return {
      dependency: {
        devolutionStatus,
        devolutionDatasetExists: true,
        editableDueToDevolutionReturn: false,
        blockingMessage: FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_NOT_READY,
      },
      canEditGate: true,
      canSaveDraftGate: true,
      canFinalSubmitGate: false,
      devolutionForm,
    };
  }

  private buildFormPermissions(
    user: AuthUser,
    stateId: string,
    status: number,
    gates: FcUnspentDependencyGates,
  ): FcUnspentPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = this.hasStateAccess(user, stateId);
    return {
      canView: perms.has(Permission.VIEW_STATE_FORMS) && hasAccess,
      canEdit: perms.has(Permission.EDIT_STATE_FORMS) && hasAccess && canStateEditForm(status) && gates.canEditGate,
      canSaveDraft:
        perms.has(Permission.EDIT_STATE_FORMS) && hasAccess && canStateEditForm(status) && gates.canSaveDraftGate,
      canFinalSubmit:
        perms.has(Permission.FINAL_SUBMIT_STATE_FORMS) &&
        hasAccess &&
        canStateFinalSubmitForm(status) &&
        gates.canFinalSubmitGate,
    };
  }

  // ─── Row mapping ────────────────────────────────────────────────────────────

  private mapRowToResponse(row: FcUnspentActiveRowLean): FcUnspentUlbRowResponse {
    return {
      slNo: row.rowNumber,
      ulbId: String(row.ulbId),
      censusCode: row.censusCode || null,
      sbCode: row.sbCode || null,
      ulbName: row.ulbName,
      allocationAmount: row.allocationAmount,
      unspentAmount: row.unspentAmount,
      allocationPerc: row.allocationPerc,
      eligibility: row.eligibility,
    };
  }

  private mapRowToSnapshot(row: FcUnspentActiveRowLean) {
    return {
      rowNumber: row.rowNumber,
      ulbId: row.ulbId,
      censusCode: row.censusCode,
      sbCode: row.sbCode,
      ulbName: row.ulbName,
      allocationAmount: row.allocationAmount,
      unspentAmount: row.unspentAmount,
      allocationPerc: row.allocationPerc,
      eligibility: row.eligibility,
      rowStatus: row.rowStatus,
      rejectionRemark: row.rejectionRemark ?? null,
      allocationSource: row.allocationSource ?? null,
    };
  }

  // ─── Hydration ──────────────────────────────────────────────────────────────

  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    folderPathContext: XviFcFolderPathContext,
    canEdit: boolean,
  ): HydratedFieldConfig[] {
    // `meta` is a backend-only extension point (see SupportingContentAction.meta) — every
    // question returned from this function must have it stripped before it reaches the client.
    const finalize = (q: HydratedFieldConfig): HydratedFieldConfig => ({
      ...q,
      supportingContent: stripSupportingContentMeta(q.supportingContent),
    });

    return questions.map((question) => {
      const value = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      if (question.formFieldType === 'file') {
        const resolvedFolderPath = question.folderPathKey
          ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
          : question.folderPath;

        const fileVal = value as FileInfo | null | undefined;
        const hydrated = this.fileInfoNormalizer.hydrateFileInfoForResponse(fileVal ?? null, (p) =>
          this.signStorageFileUrl(p),
        );
        const hydratedQuestion: HydratedFieldConfig = {
          ...question,
          folderPath: resolvedFolderPath,
          value: hydrated ?? value,
        };
        if (question.key === 'fcDeclaration') {
          const templateConfigured = !!this.resolveDeclarationTemplateMeta(question);
          return finalize(this.hydrateDeclarationTemplateAction(hydratedQuestion, canEdit && templateConfigured));
        }
        return finalize(hydratedQuestion);
      }

      const hydratedQuestion: HydratedFieldConfig = { ...question, value };
      return question.key === 'isFcUnspent'
        ? finalize(this.hydrateIsFcUnspentSupportingContent(hydratedQuestion, canEdit))
        : finalize(hydratedQuestion);
    });
  }

  /**
   * Toggles the `download-template` supporting action's `visible` flag on the
   * `fcDeclaration` question, keeping its paired `description` ("Download the
   * official template...") in sync via the shared applyActionVisibility helper —
   * that description only makes sense alongside the action, so it must not linger
   * once the action is hidden. Never mutates formJson — this is a per-response
   * hydration derived from `canEdit` and whether the design year has a configured
   * template; it is never written back to the DB.
   */
  private hydrateDeclarationTemplateAction(question: HydratedFieldConfig, visible: boolean): HydratedFieldConfig {
    return {
      ...question,
      supportingContent: applyActionVisibility(question.supportingContent, {
        [FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID]: visible,
      }),
    };
  }

  /**
   * Removes the `isFcUnspent` info supportingContent block entirely when the form is
   * read-only, rather than merely blanking its description — an empty-string
   * description still leaves the block object in the array, which renders as an
   * empty box on the frontend. Unlike DevolutionFormulaService's excel supportingContent
   * (whose block also carries actions/badges that must stay present with their own
   * `visible` flags), this info block carries nothing else worth keeping when hidden,
   * so it is dropped outright. Never mutates formJson.
   */
  private hydrateIsFcUnspentSupportingContent(question: HydratedFieldConfig, canEdit: boolean): HydratedFieldConfig {
    if (!question.supportingContent) return question;
    if (canEdit) return question;

    const supportingContent = question.supportingContent.filter((block) => block.type !== 'info');

    return { ...question, supportingContent: supportingContent.length > 0 ? supportingContent : undefined };
  }

  /**
   * Never persisted — GET-only signed URL for the stored raw S3-relative path. Signed
   * `inline` so the uploaded declaration opens in a new tab (matches sfc-status and
   * other "view your uploaded file" links) rather than force-downloading — unlike
   * getDeclarationTemplate's blank-template link, which is a genuine download and
   * stays on signFileUrl's default `attachment`.
   */
  private signStorageFileUrl(path: string): string {
    try {
      return this.fileTokenService.signFileUrl(path, 'inline');
    } catch {
      return path;
    }
  }

  private resolveApplicableFc(designYear: string): ApplicableFc {
    const applicableFc = FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYear];
    if (!applicableFc) {
      throw new NotFoundException(`No applicable FC mapping for design year: ${designYear}`);
    }
    return applicableFc;
  }

  // ─── Scope enforcement ──────────────────────────────────────────────────────

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
