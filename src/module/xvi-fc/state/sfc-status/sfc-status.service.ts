import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import {
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
import type {
  FormData,
  FormJson,
  HydratedFieldConfig,
} from '../../common/dynamic-form-validation/dynamic-form-validation.types';
import { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import { SFC_STATUS_QUESTIONS } from './constants/sfc-status.questions';
import { SaveSfcStatusDto } from './dto/save-sfc-status.dto';
import type { SfcFormGetResponseData, SfcFormPermissions } from './sfc-status.types';
import type { SfcHistoryEntryInput } from './types/sfc-status-history.types';

@Injectable()
export class SfcStatusService {
  constructor(
    @InjectModel(XviFcSfcStatus.name)
    private readonly model: Model<XviFcSfcStatusDocument>,
    @InjectModel(XviFcSfcStatusHistory.name)
    private readonly historyModel: Model<XviFcSfcStatusHistoryDocument>,
    private readonly validator: DynamicFormValidationService,
  ) {}

  /**
   * Returns the static question config array served to the frontend for rendering.
   * No DB access; O(1) return.
   */
  getQuestions(): XviFcApiResponse<typeof SFC_STATUS_QUESTIONS> {
    return xviFcSuccess('SFC Status questions fetched.', SFC_STATUS_QUESTIONS);
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
      .lean()
      .exec();

    const formJson: FormJson = {
      design_year: yearId,
      formId: 100,
      type: 'xvifcSfc',
      data: SFC_STATUS_QUESTIONS,
      isActive: true,
    };

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const savedData: FormData = (doc?.data ?? {}) as FormData;
    const questions = this.hydrateQuestions(savedData, formJson);
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);

    const responseData: SfcFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formKey: 'sfc-status',
      formName: 'SFC Status',
      formType: 'STATE_FORM',
      stateId,
      yearId,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      questions,
      permissions,
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

    const { isValid: isDraftValid, errors: draftErrors } = this.validator.validateDraft(
      SFC_STATUS_QUESTIONS,
      dto.data as FormData,
    );
    if (!isDraftValid) throwXviFcValidationError(draftErrors);

    const sanitizedPayload = this.validator.buildSanitizedPayload(SFC_STATUS_QUESTIONS, dto.data as FormData);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: SFC_STATUS_FORM_TYPE };

    const existing = await this.model.findOne(filter, { _id: 1, currentFormStatus: 1 }).lean().exec();

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

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: SFC_STATUS_FORM_TYPE };

    const existing = await this.model.findOne(filter, { _id: 1, currentFormStatus: 1 }).lean().exec();
    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;

    assertCanStateFinalSubmitForm(fromStatus);

    const { isValid: isSubmitValid, errors: submitErrors } = this.validator.validateFull(
      SFC_STATUS_QUESTIONS,
      dto.data as FormData,
    );
    if (!isSubmitValid) throwXviFcValidationError(submitErrors);

    const sanitizedPayload = this.validator.buildSanitizedPayload(SFC_STATUS_QUESTIONS, dto.data as FormData);
    const toStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
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

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Merges saved form data onto the question template.
   * For each question: uses saved value if the key exists in savedData,
   * otherwise keeps the template default from SFC_STATUS_QUESTIONS.
   * O(n) — one pass over questions, no extra DB calls.
   *
   * @param savedData - Key-value pairs from the stored document's `data` field.
   * @param formJson  - Form template carrying the question config array.
   */
  private hydrateQuestions(savedData: FormData, formJson: FormJson): HydratedFieldConfig[] {
    return formJson.data.map((question) => ({
      ...question,
      value: Object.prototype.hasOwnProperty.call(savedData, question.key) ? savedData[question.key] : question.value,
    }));
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
