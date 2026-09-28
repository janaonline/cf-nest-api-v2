import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
} from '../../common/utils/xvi-fc-form-status-access.util';
import { assertStateAccess, buildStateFormPermissions } from '../../common/utils/xvi-fc-state-access.util';
import {
  assertFreshFormStatus,
  isMongoDuplicateKeyError,
  throwXviFcConflictError,
} from '../../common/utils/xvi-fc-concurrent-write.util';
import {
  applyActionVisibility,
  findSupportingAction,
  stripSupportingContentMeta,
} from '../../common/utils/xvi-fc-supporting-content-visibility.util';
import { XviFcGtc, XviFcGtcDocument } from '../../../../schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory, XviFcGtcHistoryDocument } from '../../../../schemas/xvi-fc/state/gtc-form-history.schema';
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
import { XviFcApiResponse } from '../../common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from '../../common/response/xvi-fc-response.util';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from '../../common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
import { SaveGtcDto } from './dto/save-gtc.dto';
import type { GtcFormGetResponseData, GtcInstallmentAccess, GtcTemplateResponseData } from './gtc.types';
import type { GtcHistoryEntryInput } from './types/gtc-history.types';
import {
  GTC_ACTION_DOWNLOAD_TEMPLATE,
  GTC_FORM_ID,
  GTC_FORM_TYPE,
  type GtcInstallment,
} from './constants/gtc.constants';

type PopulatedNameRef = { _id?: Types.ObjectId; name?: string };

type GtcLeanDoc = {
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

/** Static template asset resolved off a field's `download-template` supporting action `meta`. */
interface GtcTemplateAsset {
  path: string;
  fileName: string;
  mimeType: string;
}

@Injectable()
export class GtcService {
  private static readonly INSTALLMENT_2_LOCK_REASON = 'Installment 2 is not yet available for this design year.';

  constructor(
    @InjectModel(XviFcGtc.name)
    private readonly model: Model<XviFcGtcDocument>,
    @InjectModel(XviFcGtcHistory.name)
    private readonly historyModel: Model<XviFcGtcHistoryDocument>,
    private readonly formJsonService: FormJsonService,
    private readonly validator: DynamicFormValidationService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
    private readonly s3Service: S3Service,
  ) {}

  async getQuestions(): Promise<XviFcApiResponse<FieldConfig[]>> {
    const questions = await this.loadFormQuestions();
    return xviFcSuccess('GTC questions fetched.', questions);
  }

  /** Returns a fully hydrated Not Started form when no record exists yet. */
  async getForm(
    stateId: string,
    yearId: string,
    installment: GtcInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse<GtcFormGetResponseData>> {
    assertStateAccess(user, stateId);

    const doc = await this.model
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment,
        isDeleted: false,
      })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<GtcLeanDoc>()
      .exec();

    const formQuestions = await this.loadFormQuestions(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);

    const formJson: FormJson = {
      design_year: yearId,
      formId: GTC_FORM_ID,
      type: GTC_FORM_TYPE,
      data: formQuestions,
      isActive: true,
    };

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const savedData: FormData = (doc?.data ?? {}) as FormData;
    const folderPathContext: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };
    const permissions = buildStateFormPermissions(user, stateId, currentFormStatus);
    const questions = this.hydrateQuestions(savedData, formJson, permissions.canEdit, folderPathContext);
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);

    const responseData: GtcFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formName: GTC_FORM_TYPE,
      formId: formJson.formId,
      stateName,
      stateId,
      yearId,
      installment,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      questions,
      permissions,
      actors,
      instructions: [],
      installmentAccess: this.buildInstallmentAccess(),
    };

    return xviFcSuccess('GTC form fetched.', responseData);
  }

  /** Runs partial validation - absent required fields are allowed, but requiredTrue and format
   *  validators are still enforced on any provided value. */
  async saveDraft(dto: SaveGtcDto, user: AuthUser, ip: string, userAgent: string): Promise<XviFcApiResponse> {
    assertStateAccess(user, dto.stateId);

    const formQuestions = await this.loadFormQuestions(dto.yearId);
    const result = this.validator.validateDraftAndBuildPayload(formQuestions, dto.data as FormData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, installment: dto.installment };

    const existing = await this.model
      .findOne(filter, { _id: 1, currentFormStatus: 1, data: 1 })
      .lean<{ _id: Types.ObjectId; currentFormStatus: number; data?: FormData }>()
      .exec();

    const { payload: sanitizedPayload, errors: fileErrors } = this.fileInfoNormalizer.normalizePayloadFileFields(
      result.sanitizedPayload,
      formQuestions,
      existing?.data ?? {},
    );
    if (Object.keys(fileErrors).length > 0) throwXviFcValidationError(fileErrors);

    if (existing) {
      assertCanStateEditForm(existing.currentFormStatus);

      const updated = await this.model
        .findOneAndUpdate(
          { ...filter, currentFormStatus: existing.currentFormStatus },
          { $set: { data: sanitizedPayload, currentFormStatus: FORM_STATUS.IN_PROGRESS, updatedBy: userOid } },
          { new: true },
        )
        .lean()
        .exec();

      // Filter matched nothing - status changed since it was read (e.g. a concurrent final submit).
      if (!updated) await this.assertFreshDraftStatus(filter);

      await this.createHistoryEntry({
        gtcFormId: existing._id,
        stateId: stateOid,
        yearId: yearOid,
        installment: dto.installment,
        action: FormHistoryAction.UPDATE_DRAFT,
        fromStatus: existing.currentFormStatus,
        toStatus: FORM_STATUS.IN_PROGRESS,
        changedBy: userOid,
        ip,
        userAgent,
      });

      return xviFcSuccess('GTC form saved as draft.', {
        ...updated,
        currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
      });
    }

    let created: XviFcGtcDocument;
    try {
      created = await this.model.create({
        state: stateOid,
        year: yearOid,
        installment: dto.installment,
        data: sanitizedPayload,
        currentFormStatus: FORM_STATUS.IN_PROGRESS,
        createdBy: userOid,
        updatedBy: userOid,
        isActive: true,
        isDeleted: false,
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) throwXviFcConflictError();
      throw error;
    }

    await this.createHistoryEntry({
      gtcFormId: created._id,
      stateId: stateOid,
      yearId: yearOid,
      installment: dto.installment,
      action: FormHistoryAction.CREATE_DRAFT,
      fromStatus: FORM_STATUS.NOT_STARTED,
      toStatus: FORM_STATUS.IN_PROGRESS,
      changedBy: userOid,
      ip,
      userAgent,
    });

    return xviFcSuccess('GTC form saved as draft.', {
      ...created.toObject(),
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
    });
  }

  /** Supports one-shot submit - creates the record if none exists yet, without requiring a prior
   *  draft. */
  async finalSubmit(dto: SaveGtcDto, user: AuthUser, ip: string, userAgent: string): Promise<XviFcApiResponse> {
    assertStateAccess(user, dto.stateId);

    if (dto.installment === 2) {
      this.checkInstallment2Prereq();
    }

    const formQuestions = await this.loadFormQuestions(dto.yearId);
    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, installment: dto.installment };

    const existing = await this.model
      .findOne(filter, { _id: 1, currentFormStatus: 1, data: 1 })
      .lean<{ _id: Types.ObjectId; currentFormStatus: number; data?: FormData }>()
      .exec();
    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;

    assertCanStateFinalSubmitForm(fromStatus);

    const validation = this.validator.validateFinalSubmitAndBuildPayload(formQuestions, dto.data as FormData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const { payload: sanitizedPayload, errors: fileErrors } = this.fileInfoNormalizer.normalizePayloadFileFields(
      validation.sanitizedPayload,
      formQuestions,
      existing?.data ?? {},
    );
    if (Object.keys(fileErrors).length > 0) throwXviFcValidationError(fileErrors);
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const now = new Date();

    let formOid: Types.ObjectId;
    let result: Record<string, unknown>;

    if (existing) {
      const updated = await this.model
        .findOneAndUpdate(
          { _id: existing._id, currentFormStatus: existing.currentFormStatus },
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

      // Filter matched nothing - status changed since it was read (e.g. a second concurrent submit).
      if (!updated) await this.assertFreshFinalSubmitStatus(filter);

      formOid = existing._id;
      result = updated as Record<string, unknown>;
    } else {
      let created: XviFcGtcDocument;
      try {
        created = await this.model.create({
          state: stateOid,
          year: yearOid,
          installment: dto.installment,
          data: sanitizedPayload,
          currentFormStatus: toStatus,
          submittedBy: userOid,
          submittedAt: now,
          createdBy: userOid,
          updatedBy: userOid,
          isActive: true,
          isDeleted: false,
        });
      } catch (error) {
        if (isMongoDuplicateKeyError(error)) throwXviFcConflictError();
        throw error;
      }

      formOid = created._id;
      result = created.toObject() as unknown as Record<string, unknown>;
    }

    await this.createHistoryEntry({
      gtcFormId: formOid,
      stateId: stateOid,
      yearId: yearOid,
      installment: dto.installment,
      action: FormHistoryAction.FINAL_SUBMIT,
      fromStatus,
      toStatus,
      changedBy: userOid,
      ip,
      userAgent,
    });

    return xviFcSuccess('GTC form submitted successfully.', {
      ...result,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  /** See CLAUDE.md's "Static template download" section for the full design. */
  async getTemplate(
    stateId: string,
    yearId: string,
    installment: GtcInstallment,
    user: AuthUser,
  ): Promise<XviFcApiResponse<GtcTemplateResponseData>> {
    assertStateAccess(user, stateId);

    const doc = await this.model
      .findOne({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), installment })
      .select('currentFormStatus')
      .lean<{ currentFormStatus?: number }>()
      .exec();

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateEditForm(currentFormStatus);

    const formQuestions = await this.loadFormQuestions(yearId);
    const templateField = formQuestions.find((field) =>
      findSupportingAction(field.supportingContent, GTC_ACTION_DOWNLOAD_TEMPLATE),
    );
    const template = templateField && this.resolveTemplateMeta(templateField);

    if (!template) {
      throwXviFcValidationError({
        _form: [
          {
            message: 'The download template is not configured for the selected design year and installment.',
            code: 'templateNotConfigured',
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
            message: 'The template could not be retrieved. Please contact support.',
            code: 'templateUnavailable',
          },
        ],
      });
    }

    const url = this.fileTokenService.signFileUrl(template.path);

    return xviFcSuccess('GTC template generated successfully.', {
      fileName: template.fileName,
      mimeType: template.mimeType,
      url,
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Merges saved data onto the question template, signs file URLs, and sets download-template
   *  visibility - see CLAUDE.md's "Static template download" section for why `meta` is always
   *  stripped before a question leaves this method. */
  private hydrateQuestions(
    savedData: FormData,
    formJson: FormJson,
    canEdit: boolean,
    folderPathContext?: XviFcFolderPathContext,
  ): HydratedFieldConfig[] {
    return formJson.data.map((question) => {
      const value = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      let hydrated: HydratedFieldConfig;

      if (question.formFieldType === 'file') {
        const resolvedFolderPath =
          question.folderPathKey && folderPathContext
            ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
            : question.folderPath;

        const fileVal = value as FileInfo | null | undefined;
        const hydratedFile = this.fileInfoNormalizer.hydrateFileInfoForResponse(fileVal ?? null, (p) =>
          this.fileTokenService.signFileUrlForSession(p),
        );
        hydrated = { ...question, folderPath: resolvedFolderPath, value: hydratedFile ?? value };
      } else {
        hydrated = { ...question, value };
      }

      if (findSupportingAction(hydrated.supportingContent, GTC_ACTION_DOWNLOAD_TEMPLATE)) {
        const templateConfigured = !!this.resolveTemplateMeta(question);
        hydrated = {
          ...hydrated,
          supportingContent: applyActionVisibility(hydrated.supportingContent, {
            [GTC_ACTION_DOWNLOAD_TEMPLATE]: canEdit && templateConfigured,
          }),
        };
      }

      return { ...hydrated, supportingContent: stripSupportingContentMeta(hydrated.supportingContent) };
    });
  }

  /** Returns `undefined` (not a thrown error) when absent/malformed - the expected state for an
   *  ordinary questionnaire submission. See CLAUDE.md's "Static template download" section. */
  private resolveTemplateMeta(field: FieldConfig): GtcTemplateAsset | undefined {
    const action = findSupportingAction(field.supportingContent, GTC_ACTION_DOWNLOAD_TEMPLATE);
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

  private async assertFreshDraftStatus(filter: Record<string, unknown>): Promise<never> {
    return assertFreshFormStatus(
      async () =>
        (await this.model.findOne(filter, { currentFormStatus: 1 }).lean<{ currentFormStatus?: number }>().exec())
          ?.currentFormStatus,
      assertCanStateEditForm,
    );
  }

  private async assertFreshFinalSubmitStatus(filter: Record<string, unknown>): Promise<never> {
    return assertFreshFormStatus(
      async () =>
        (await this.model.findOne(filter, { currentFormStatus: 1 }).lean<{ currentFormStatus?: number }>().exec())
          ?.currentFormStatus,
      assertCanStateFinalSubmitForm,
    );
  }

  private checkInstallment2Prereq(): void {
    if (this.isInstallment2Unlocked()) return;

    throwXviFcValidationError({
      installment: [
        {
          field: 'installment',
          code: 'installment2Locked',
          message: GtcService.INSTALLMENT_2_LOCK_REASON,
        },
      ],
    });
  }

  /** TODO: unlock once installment 2's questionnaire is authored - see CLAUDE.md's Known Gaps
   *  section. */
  private isInstallment2Unlocked(): boolean {
    return false;
  }

  private buildInstallmentAccess(): GtcInstallmentAccess {
    const installment2Unlocked = this.isInstallment2Unlocked();

    return {
      installment1: { canSelect: true, locked: false, lockReason: null },
      installment2: {
        canSelect: installment2Unlocked,
        locked: !installment2Unlocked,
        lockReason: installment2Unlocked ? null : GtcService.INSTALLMENT_2_LOCK_REASON,
      },
    };
  }

  /** No-ops when `fromStatus === toStatus`. See CLAUDE.md's "one tradeoff worth knowing before
   *  touching writes" section for the non-transactional-write tradeoff. */
  private async createHistoryEntry(entry: GtcHistoryEntryInput): Promise<void> {
    if (entry.fromStatus === entry.toStatus) return;

    await this.historyModel.create({
      gtcForm: entry.gtcFormId,
      state: entry.stateId,
      year: entry.yearId,
      installment: entry.installment,
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

  /** With yearId: Redis-cached `findActiveByDesignYearAndFormId`. Without (getQuestions): falls
   *  back to `findByType`. */
  private async loadFormQuestions(yearId?: string): Promise<FieldConfig[]> {
    const formJson = yearId
      ? await this.formJsonService.findActiveByDesignYearAndFormId(yearId, GTC_FORM_ID)
      : await this.formJsonService.findByType(GTC_FORM_TYPE);
    if (!formJson.data?.length) throw new NotFoundException('GTC form configuration not found');
    return formJson.data;
  }
}
