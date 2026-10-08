import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
  canStateEditForm,
  canStateFinalSubmitForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertStateAccess, hasStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
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
  FC_UNSPENT_DECLARATION_DOCUMENT_ACTION_ID,
  FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID,
  FC_UNSPENT_DEVOLUTION_INSTALLMENT,
  FC_UNSPENT_BLOCKING_MESSAGE_MISSING_DEVOLUTION,
  FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_RETURNED,
  FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_NOT_READY,
} from '../../constants/fc-unspent-declaration.constants';
import type {
  FcUnspentActiveRowLean,
  FcUnspentDeclarationGetResponseData,
  FcUnspentDependencyGates,
  FcUnspentDevolutionFormLean,
  FcUnspentPermissions,
  FcUnspentUlbRowResponse,
} from '../../types/fc-unspent-declaration.types';
import { SaveFcUnspentDeclarationDto } from '../../dto/save-fc-unspent-declaration.dto';
import { FcUnspentDeclarationRowService } from '../rows/fc-unspent-declaration-row.service';
import { FcUnspentDeclarationFormJsonService } from '../form-json/fc-unspent-declaration-form-json.service';
import { getFcUnspentFieldsByType } from '../../helpers/fc-unspent-declaration-form-json.helpers';

type PopulatedNameRef = { _id?: Types.ObjectId; name?: string };

type FcUnspentLeanDoc = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  state?: Types.ObjectId | PopulatedNameRef;
  currentFormStatus?: number;
  isFcUnspent?: boolean | null;
  fcDeclaration?: FileInfo | null;
  fcUnspentDeclaration?: FileInfo | null;
  checkboxConfirmation?: boolean;
};

type FcUnspentExistingLean = {
  _id: Types.ObjectId;
  currentFormStatus: number;
  fcDeclaration?: FileInfo | null;
  fcUnspentDeclaration?: FileInfo | null;
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
  ) {}

  /**
   * Never includes the full ULB options list — served by the separate lazy /ulb-options endpoint.
   * Active rows are loaded from the row collection; the parent document no longer stores them.
   */
  async getForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentDeclarationGetResponseData>> {
    assertStateAccess(user, stateId);

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
    // Stored as a strict boolean (see save DTO); converted to 'yes'/'no' only for the radio's visibleWhen domain.
    if (doc?.isFcUnspent !== undefined) {
      savedData['isFcUnspent'] = doc.isFcUnspent === true ? 'yes' : doc.isFcUnspent === false ? 'no' : null;
    }
    if (doc?.fcDeclaration !== undefined) savedData['fcDeclaration'] = doc.fcDeclaration;
    if (doc?.fcUnspentDeclaration !== undefined) savedData['fcUnspentDeclaration'] = doc.fcUnspentDeclaration;
    if (doc?.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;

    const folderPathContext: XviFcFolderPathContext = { _id: stateId, role: 'state', designYear };
    const questions = this.hydrateQuestions(questionsConfig, savedData, folderPathContext, permissions.canEdit);

    // Only the Yes branch has disclosures. Gate here to ignore stale rows from older saves.
    const activeRows = doc?.isFcUnspent === true ? await this.rowService.getActiveRows(doc._id) : [];
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
   * Allowed only from NOT_STARTED/IN_PROGRESS/RETURNED_BY_MOHUA (assertCanStateEditForm). Never
   * writes history — only finalSubmit does; parent + row writes commit in one transaction here.
   */
  async saveDraft(dto: SaveFcUnspentDeclarationDto, user: AuthUser): Promise<XviFcApiResponse> {
    assertStateAccess(user, dto.stateId);

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
      fcUnspentDeclaration: dto.data.fcUnspentDeclaration ?? null,
      checkboxConfirmation: dto.data.checkboxConfirmation ?? false,
      // Synthetic key for fcUnspentDeclaration.visibleWhen — see CLAUDE.md's "FC Unspent
      // Declaration document and its two file fields" section.
      savedUnspentUlbData: dto.data.unspentUlbData ?? [],
    };
    const validation = this.dynamicFormValidator.validateDraftAndBuildPayload(questions, validatorData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const isYes = dto.data.isFcUnspent === true;
    const isNo = dto.data.isFcUnspent === false;

    let fcDeclaration: FileInfo | null | undefined;
    let fcUnspentDeclaration: FileInfo | null | undefined;
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
      // Switching to No clears any stale Yes-branch upload; only re-answering Yes restores it.
      fcUnspentDeclaration = null;
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
      // Switching to Yes clears any stale No-branch upload, mirroring the reverse case above.
      fcDeclaration = null;
      if (dto.data.fcUnspentDeclaration !== undefined) {
        const fcUnspentDeclarationField = requireField(
          keyByFieldKey(questions),
          'fcUnspentDeclaration',
          'FcUnspentDeclarationService.saveDraft',
        );
        const { file, errors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
          dto.data.fcUnspentDeclaration as unknown as Record<string, unknown>,
          existing?.fcUnspentDeclaration,
          deriveFileValidationOptions(fcUnspentDeclarationField, 'fcUnspentDeclaration'),
        );
        if (errors.length > 0) throwXviFcValidationError({ fcUnspentDeclaration: errors });
        fcUnspentDeclaration = file;
      }
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
    if (fcUnspentDeclaration !== undefined) setDoc['fcUnspentDeclaration'] = fcUnspentDeclaration;

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

      if (branch === 'yes') {
        await this.rowService.applyRows(
          updatedParent._id,
          stateOid,
          yearOid,
          resolvedRows,
          userOid,
          undefined,
          session,
        );
      } else {
        // 'no' and 'undecided' both deactivate rows — see CLAUDE.md's "Every branch outcome
        // deactivates rows except an actual Yes" section.
        await this.rowService.deactivateAllRows(updatedParent._id, userOid, session);
      }

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
   * Requires Devolution Formula Installment 1 to have an active dataset and be under PMU or
   * MoHUA review (see resolveDevolutionDependency). Parent transition, rows, row-history, and
   * parent history all commit atomically in one transaction.
   */
  async finalSubmit(
    dto: SaveFcUnspentDeclarationDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse> {
    assertStateAccess(user, dto.stateId);

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
      fcUnspentDeclaration: dto.data.fcUnspentDeclaration ?? existing?.fcUnspentDeclaration ?? null,
      checkboxConfirmation: dto.data.checkboxConfirmation ?? false,
      // Same synthetic key as saveDraft — see CLAUDE.md's "FC Unspent Declaration document and
      // its two file fields" section.
      savedUnspentUlbData: dto.data.unspentUlbData ?? [],
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
    let finalFcUnspentDeclaration: FileInfo | null | undefined;
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
      // Required even when unchanged (never falls back to `existing`) — see CLAUDE.md's
      // "Invariants worth knowing" section.
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
      finalFcUnspentDeclaration = null;
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

      // Same rule as the No branch above.
      if (dto.data.fcUnspentDeclaration === undefined || dto.data.fcUnspentDeclaration === null) {
        throwXviFcValidationError({
          fcUnspentDeclaration: [
            { field: 'fcUnspentDeclaration', code: 'required', message: 'Signed declaration is required.' },
          ],
        });
      }
      const fcUnspentDeclarationField = requireField(
        keyByFieldKey(questions),
        'fcUnspentDeclaration',
        'FcUnspentDeclarationService.finalSubmit',
      );
      const { file, errors: fcUnspentDeclarationErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.fcUnspentDeclaration as unknown as Record<string, unknown>,
        existing?.fcUnspentDeclaration,
        deriveFileValidationOptions(fcUnspentDeclarationField, 'fcUnspentDeclaration'),
      );
      if (fcUnspentDeclarationErrors.length > 0) {
        throwXviFcValidationError({ fcUnspentDeclaration: fcUnspentDeclarationErrors });
      }
      finalFcUnspentDeclaration = file;
    }

    const now = new Date();
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_PMU;
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
    if (finalFcUnspentDeclaration !== undefined) setDoc['fcUnspentDeclaration'] = finalFcUnspentDeclaration;

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
          FORM_STATUS.UNDER_REVIEW_BY_PMU,
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

      // Defensive: skip explicitly even though assertCanStateFinalSubmitForm above already
      // guarantees a real transition.
      if (fromStatus !== toStatus) {
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
              fcUnspentDeclaration: updatedParent.fcUnspentDeclaration ?? null,
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
      }

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

  // ─── Devolution dependency ──────────────────────────────────────────────────

  /**
   * Not `private` — reused by GET/saveDraft/finalSubmit and the document service (see CLAUDE.md).
   * Reads devolution-formula's activeDatasetVersion invariant from outside that module — see
   * devolution-formula/docs/adr/0001-dataset-versioning.md before changing either side.
   */
  async resolveDevolutionDependency(
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

    // Devolution's own PMU pre-screen stage counts as "ready" too — see CLAUDE.md's
    // "Dependencies" section.
    if (
      devolutionStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU ||
      devolutionStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA
    ) {
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

    if (devolutionStatus === FORM_STATUS.RETURNED_BY_MOHUA || devolutionStatus === FORM_STATUS.RETURNED_BY_PMU) {
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

  /** Not `private` — reused as-is by the document-generation service's own gating. */
  buildFormPermissions(
    user: AuthUser,
    stateId: string,
    status: number,
    gates: FcUnspentDependencyGates,
  ): FcUnspentPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = hasStateAccess(user, stateId);
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
      previousFcUnspentBalance: row.previousFcUnspentBalance,
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
      previousFcUnspentBalance: row.previousFcUnspentBalance,
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
          return finalize(
            this.hydrateDeclarationTemplateAction(hydratedQuestion, FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID, canEdit),
          );
        }
        if (question.key === 'fcUnspentDeclaration') {
          return finalize(
            this.hydrateDeclarationTemplateAction(hydratedQuestion, FC_UNSPENT_DECLARATION_DOCUMENT_ACTION_ID, canEdit),
          );
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
   * Keeps the action's paired `description` block in sync with its own `visible` flag (via
   * applyActionVisibility) — a hidden action's description must not linger. Hydration-only,
   * never written back to formJson. Shared by both `fcDeclaration` and `fcUnspentDeclaration`.
   */
  private hydrateDeclarationTemplateAction(
    question: HydratedFieldConfig,
    actionId: string,
    visible: boolean,
  ): HydratedFieldConfig {
    return {
      ...question,
      supportingContent: applyActionVisibility(question.supportingContent, {
        [actionId]: visible,
      }),
    };
  }

  /**
   * Drops the `isFcUnspent` info block entirely when read-only, rather than blanking its
   * description — an empty description still renders as an empty box on the frontend. Never
   * mutates formJson.
   */
  private hydrateIsFcUnspentSupportingContent(question: HydratedFieldConfig, canEdit: boolean): HydratedFieldConfig {
    if (!question.supportingContent) return question;
    if (canEdit) return question;

    const supportingContent = question.supportingContent.filter((block) => block.type !== 'info');

    return { ...question, supportingContent: supportingContent.length > 0 ? supportingContent : undefined };
  }

  /**
   * GET-only signed URL, never persisted. Signed `inline` (opens in a new tab, like sfc-status) —
   * unlike the generated-declaration downloads in `services/document/`, which use `attachment`.
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
}
