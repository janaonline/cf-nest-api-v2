import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import { escapeRegex } from 'src/common/utils/regex.util';
import { resolveStateScopeFilter } from 'src/module/xvi-fc/common/utils/xvi-fc-scope-filter.util';
import {
  assertCanUlbEditForm,
  assertCanUlbSubmitForm,
  canUlbEditForm,
  canUlbSubmitForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type {
  FieldConfig,
  FormData,
  HydratedFieldConfig,
} from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type { UploadedFileValue } from 'src/module/xvi-fc/common/types/field-config.type';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel, getPreviousYearLabel } from 'src/core/constants/years';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { SLB_FORM_ID, SLB_FORM_TYPE, SlbForm, SlbFormDocument } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';
import { SlbFormJsonConfigService } from './services/slb-form-json.service';
import { getSlbFieldsByType } from './helpers/slb-form-json.helpers';
import type { SaveSlbDto } from './dto/save-slb.dto';
import type { SlbUlbSubmissionsQueryDto } from './dto/slb-ulb-submissions-query.dto';
import type { SlbFormGetResponseData, SlbFormPermissions } from './slb.types';

interface SlbSubmissionRow {
  ulbId: Types.ObjectId;
  ulbCode: string;
  censusCode: string;
  ulbName: string;
  formStatus: FormStatusType;
  lastUpdatedAt: Date | null;
  slbFormId: Types.ObjectId | null;
}

interface SlbSubmissionsFacetResult {
  data: SlbSubmissionRow[];
  totalCount: Array<{ count: number }>;
  counts: Array<{ _id: FormStatusType; count: number }>;
}

type PopulatedNameRef = { _id?: Types.ObjectId; name?: string };

type SlbFormLeanDoc = {
  _id: Types.ObjectId;
  ulb?: Types.ObjectId | PopulatedNameRef;
  createdBy?: Types.ObjectId | PopulatedNameRef;
  updatedBy?: Types.ObjectId | PopulatedNameRef;
  submittedBy?: Types.ObjectId | PopulatedNameRef;
  createdAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date;
  currentFormStatus?: number;
  data?: unknown;
};

@Injectable()
export class SlbService {
  constructor(
    @InjectModel(SlbForm.name)
    private readonly model: Model<SlbFormDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly validator: DynamicFormValidationService,
    private readonly fileTokenService: FileTokenService,
    private readonly slbFormJsonConfig: SlbFormJsonConfigService,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  /** Returns the SLB question config array from the DB for frontend rendering. */
  async getQuestions(): Promise<XviFcApiResponse<FieldConfig[]>> {
    const fields = await this.slbFormJsonConfig.loadFields();
    return xviFcSuccess('SLB questions fetched.', getSlbFieldsByType(fields, 'SLB_MAIN_FORM_FIELDS'));
  }

  /**
   * Returns the hydrated SLB form for a given ULB and year.
   * ULB users may only fetch their own ULB's form; STATE users may fetch any ULB within
   * their own state (read-only); ADMIN may fetch any ULB.
   */
  async getForm(ulbId: string, yearId: string, user: AuthUser): Promise<XviFcApiResponse<SlbFormGetResponseData>> {
    const effectiveUlbId = await this.resolveEffectiveUlbId(user, ulbId);
    await this.assertCanReadSlb(user, effectiveUlbId);

    const ulbOid = new Types.ObjectId(effectiveUlbId);
    const yearOid = new Types.ObjectId(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const actualYearLabel = getPreviousYearLabel(designYear);

    const doc = await this.model
      .findOne({ ulb: ulbOid, year: yearOid, formType: SLB_FORM_TYPE, isDeleted: false })
      .populate('ulb', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<SlbFormLeanDoc>()
      .exec();

    const fields = await this.slbFormJsonConfig.loadFields(yearId);
    const mainFields = getSlbFieldsByType(fields, 'SLB_MAIN_FORM_FIELDS');

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const savedData: FormData = (doc?.data ?? {}) as FormData;
    const folderPathContext: XviFcFolderPathContext = { _id: effectiveUlbId, designYear, role: 'ulb' };
    const questions = this.hydrateQuestions(mainFields, savedData, folderPathContext);
    const permissions = this.buildFormPermissions(user, effectiveUlbId, currentFormStatus);
    const { actors, ulbName } = this.buildActorsAndUlbName(doc);

    const responseData: SlbFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formName: SLB_FORM_TYPE,
      formId: SLB_FORM_ID,
      ulbName,
      ulbId: effectiveUlbId,
      yearId,
      designYear,
      actualYearLabel,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      questions,
      permissions,
      actors,
      meta: { version: 1 },
    };

    return xviFcSuccess('SLB form fetched.', responseData);
  }

  /**
   * Saves the SLB form as a draft.
   * Runs partial validation — absent required fields are allowed. Unlike
   * `DynamicFormValidationService`'s default (which still enforces `requiredTrue`, e.g. a
   * confirmation checkbox, even in draft mode), SLB drafts allow the self-declaration
   * checkbox to stay unchecked too — a draft is work in progress, not a certification.
   * All other format validators are still enforced on any provided value.
   * Upserts by ulb + year + formType. Sets status to IN_PROGRESS.
   */
  async saveDraft(dto: SaveSlbDto, user: AuthUser): Promise<XviFcApiResponse> {
    const effectiveUlbId = await this.resolveEffectiveUlbId(user, dto.ulbId);
    await this.assertCanSubmitSlb(user, effectiveUlbId);

    const fields = await this.slbFormJsonConfig.loadFields(dto.yearId);
    const mainFields = getSlbFieldsByType(fields, 'SLB_MAIN_FORM_FIELDS');
    const draftFields = this.withoutRequiredTrue(mainFields);
    const result = this.validator.validateDraftAndBuildPayload(draftFields, dto.data as FormData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const sanitizedPayload = result.sanitizedPayload;

    const ulbOid = new Types.ObjectId(effectiveUlbId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { ulb: ulbOid, year: yearOid, formType: SLB_FORM_TYPE };

    const existing = await this.model.findOne(filter, { _id: 1, currentFormStatus: 1 }).lean().exec();

    if (existing) {
      assertCanUlbEditForm(existing.currentFormStatus);

      const updated = await this.model
        .findOneAndUpdate(
          filter,
          { $set: { data: sanitizedPayload, currentFormStatus: FORM_STATUS.IN_PROGRESS, updatedBy: userOid } },
          { new: true },
        )
        .lean()
        .exec();

      return xviFcSuccess('SLB form saved as draft.', {
        ...updated,
        currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
      });
    }

    const created = await this.model.create({
      ulb: ulbOid,
      year: yearOid,
      formType: SLB_FORM_TYPE,
      data: sanitizedPayload,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      createdBy: userOid,
      updatedBy: userOid,
      isActive: true,
      isDeleted: false,
    });

    return xviFcSuccess('SLB form saved as draft.', {
      ...created.toObject(),
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
    });
  }

  /**
   * Final-submits the SLB form for a given ULB and year.
   * Supports one-shot submit: creates the record if none exists yet.
   * Runs full validation — all visible required fields must be present and valid.
   * SLB has no STATE approve/return workflow (see listUlbSlbForms), so submission transitions
   * status directly to APPROVED_BY_STATE rather than parking it at UNDER_REVIEW_BY_STATE.
   */
  async finalSubmit(dto: SaveSlbDto, user: AuthUser): Promise<XviFcApiResponse> {
    const effectiveUlbId = await this.resolveEffectiveUlbId(user, dto.ulbId);
    await this.assertCanSubmitSlb(user, effectiveUlbId);

    const fields = await this.slbFormJsonConfig.loadFields(dto.yearId);
    const mainFields = getSlbFieldsByType(fields, 'SLB_MAIN_FORM_FIELDS');

    const ulbOid = new Types.ObjectId(effectiveUlbId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { ulb: ulbOid, year: yearOid, formType: SLB_FORM_TYPE };

    const existing = await this.model.findOne(filter, { _id: 1, currentFormStatus: 1 }).lean().exec();
    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;

    assertCanUlbSubmitForm(fromStatus);

    const validation = this.validator.validateFinalSubmitAndBuildPayload(mainFields, dto.data as FormData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const sanitizedPayload = validation.sanitizedPayload;
    const toStatus = FORM_STATUS.APPROVED_BY_STATE;
    const now = new Date();

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

      result = (updated ?? {}) as Record<string, unknown>;
    } else {
      const created = await this.model.create({
        ulb: ulbOid,
        year: yearOid,
        formType: SLB_FORM_TYPE,
        data: sanitizedPayload,
        currentFormStatus: toStatus,
        submittedBy: userOid,
        submittedAt: now,
        createdBy: userOid,
        updatedBy: userOid,
        isActive: true,
        isDeleted: false,
      });

      result = created.toObject() as unknown as Record<string, unknown>;
    }

    return xviFcSuccess('SLB form submitted successfully.', {
      ...result,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── State-scoped ULB submissions list ───────────────────────────────────────

  /**
   * Paginated list of every ULB in the requester's state for a given design year, joined against
   * that ULB's SLB form status. ULB is the primary collection (left-joined to the SLB doc) so
   * ULBs that haven't started still appear, reported as NOT_STARTED. Mirrors
   * BankAccountService.listUlbBankAccounts() exactly — SLB has no bulk decision endpoint (STATE
   * users can only view, never approve/return an SLB form), so unlike bank-account this is the
   * only state-scoped SLB endpoint besides the read-only per-ULB getForm().
   */
  async listUlbSlbForms(
    dto: SlbUlbSubmissionsQueryDto,
    user: AuthUser,
  ): Promise<
    XviFcApiResponse<{
      total: number;
      page: number;
      pageSize: number;
      rows: SlbSubmissionRow[];
      counts: Record<FormStatusType, number>;
    }>
  > {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may list ULB submissions');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }

    const stateId = resolveStateScopeFilter(user, dto.stateId);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (stateId) matchStage.state = stateId;
    if (dto.search?.trim()) {
      const regex = new RegExp(escapeRegex(dto.search.trim()), 'i');
      matchStage.$or = [{ name: regex }, { code: regex }];
    }

    const sortField = dto.sortField ?? 'ulbName';
    const sortDirection = dto.sortDirection === 'desc' ? -1 : 1;
    const sortStage: Record<string, 1 | -1> =
      sortField === 'formStatus' ? { formStatus: sortDirection } : { name: sortDirection };

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const yearObjectId = new Types.ObjectId(dto.designYearId);

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'xvifc_slb_forms',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$ulb', '$$ulbId'] }, { $eq: ['$year', yearObjectId] }] },
              },
            },
          ],
          as: 'slbForm',
        },
      },
      { $addFields: { slbForm: { $arrayElemAt: ['$slbForm', 0] } } },
      {
        $addFields: {
          formStatus: { $ifNull: ['$slbForm.currentFormStatus', FORM_STATUS.NOT_STARTED] },
          lastUpdatedAt: { $ifNull: ['$slbForm.updatedAt', null] },
        },
      },
    ];

    const statusMatch: PipelineStage.FacetPipelineStage[] =
      dto.status?.length ? [{ $match: { formStatus: { $in: dto.status } } }] : [];

    pipeline.push({
      $facet: {
        data: [
          ...statusMatch,
          { $sort: sortStage },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              ulbId: '$_id',
              ulbCode: '$code',
              censusCode: { $ifNull: ['$censusCode', '$sbCode'] },
              ulbName: '$name',
              formStatus: 1,
              lastUpdatedAt: 1,
              slbFormId: { $ifNull: ['$slbForm._id', null] },
            },
          },
        ],
        totalCount: [...statusMatch, { $count: 'count' }],
        counts: [{ $group: { _id: '$formStatus', count: { $sum: 1 } } }],
      },
    });

    const [result] = await this.ulbModel.aggregate<SlbSubmissionsFacetResult>(pipeline).exec();
    const rows = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    const counts = Object.fromEntries(
      Object.values(FORM_STATUS)
        .filter((status): status is FormStatusType => status !== FORM_STATUS.NO_STATUS)
        .map((status) => [status, result?.counts.find((c) => c._id === status)?.count ?? 0]),
    ) as Record<FormStatusType, number>;

    return xviFcSuccess('ULB SLB submissions fetched.', { total, page, pageSize, rows, counts });
  }

  // ─── Draft validation helpers ──────────────────────────────────────────────

  /** Strips `requiredTrue` validations so `saveDraft` never blocks on an unchecked confirmation checkbox. */
  private withoutRequiredTrue(fields: FieldConfig[]): FieldConfig[] {
    return fields.map((field) =>
      field.validations?.some((v) => v.name === 'requiredTrue')
        ? { ...field, validations: field.validations.filter((v) => v.name !== 'requiredTrue') }
        : field,
    );
  }

  // ─── Hydration helpers ─────────────────────────────────────────────────────

  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    folderPathContext: XviFcFolderPathContext,
  ): HydratedFieldConfig[] {
    return questions.map((question) => {
      const value = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      if (question.formFieldType === 'file') {
        const resolvedFolderPath = question.folderPathKey
          ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
          : question.folderPath;

        // Accepts both the `UploadedFileValue` contract (`fileUrl`) and the `CommonFile`
        // contract (`path`, e.g. supportingDocumentFile) — see normalizeFileForPayload/
        // validateFileField, which already read both shapes for the same field.
        const fileVal = value as (UploadedFileValue & { path?: string }) | null | undefined;
        const rawUrl = fileVal?.fileUrl ?? fileVal?.path;
        if (rawUrl) {
          try {
            const signedUrl = this.fileTokenService.signFileUrl(rawUrl);
            return { ...question, folderPath: resolvedFolderPath, value: { ...fileVal, fileUrl: signedUrl } };
          } catch {
            // keep raw if signing fails
          }
        }
        return { ...question, folderPath: resolvedFolderPath, value };
      }

      return { ...question, value };
    });
  }

  /** Builds the audit-actor timeline and resolves the ULB name from a lean populated form document. */
  private buildActorsAndUlbName(doc: SlbFormLeanDoc | null): { actors: XvifcFormActor[]; ulbName: string } {
    const getPopulatedName = (value: unknown): string | undefined => {
      if (value === null || value === undefined || typeof value !== 'object') return undefined;
      const name = (value as Record<string, unknown>)['name'];
      return typeof name === 'string' ? name : undefined;
    };
    const toIsoStringOrNull = (value: unknown): string | null => {
      if (!(value instanceof Date)) return null;
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    };

    const ulbName = getPopulatedName(doc?.ulb) ?? '';
    const actors: XvifcFormActor[] = [
      {
        action: 'Created by',
        designation: 'ULB Officer',
        by: getPopulatedName(doc?.createdBy) ?? null,
        date: toIsoStringOrNull(doc?.createdAt),
      },
      {
        action: 'Updated by',
        designation: 'ULB Officer',
        by: getPopulatedName(doc?.updatedBy) ?? null,
        date: toIsoStringOrNull(doc?.updatedAt),
      },
      {
        action: 'Submitted by',
        designation: 'ULB Officer',
        by: getPopulatedName(doc?.submittedBy) ?? null,
        date: toIsoStringOrNull(doc?.submittedAt),
      },
    ];
    return { actors, ulbName };
  }

  private buildFormPermissions(user: AuthUser, ulbId: string, status: number): SlbFormPermissions {
    const hasAccess = this.hasReadAccess(user, ulbId);
    const canSubmit = user.scope === Scope.ADMIN || (user.scope === Scope.ULB && this.isOwnUlb(user, ulbId));
    const isViewerOnly = user.scope === Scope.ULB && user.accessLevel === AccessLevel.VIEWER;
    return {
      canView: hasAccess,
      canEdit: canSubmit && !isViewerOnly && canUlbEditForm(status),
      canFinalSubmit: canSubmit && !isViewerOnly && canUlbSubmitForm(status),
    };
  }

  // ─── Scope enforcement ────────────────────────────────────────────────────

  private isOwnUlb(user: AuthUser, ulbId: string): boolean {
    const userUlbId = toObjectIdString(user.ulb);
    return !!userUlbId && userUlbId === ulbId;
  }

  /**
   * Resolves which ULB a request should operate on.
   * ULB users always operate on their own ULB (an explicit different ulbId is rejected).
   * STATE/ADMIN users must supply ulbId explicitly.
   */
  async resolveEffectiveUlbId(user: AuthUser, requestedUlbId?: string): Promise<string> {
    const normalizedRequestedUlbId = requestedUlbId?.trim();
    if (normalizedRequestedUlbId && !Types.ObjectId.isValid(normalizedRequestedUlbId)) {
      throw new BadRequestException('Invalid ulbId.');
    }

    if (user.scope === Scope.ULB) {
      const userUlbId = toObjectIdString(user.ulb);
      if (!userUlbId || !Types.ObjectId.isValid(userUlbId)) {
        throw new ForbiddenException('Your account is not mapped to any ULB.');
      }
      if (normalizedRequestedUlbId && normalizedRequestedUlbId !== userUlbId) {
        throw new ForbiddenException('You can only access your own ULB SLB form.');
      }
      return userUlbId;
    }

    if (user.scope === Scope.STATE || user.scope === Scope.ADMIN) {
      if (!normalizedRequestedUlbId) {
        throw new BadRequestException('ulbId is required.');
      }
      return normalizedRequestedUlbId;
    }

    throw new ForbiddenException('Access denied.');
  }

  private hasReadAccess(user: AuthUser, ulbId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.ULB) return this.isOwnUlb(user, ulbId);
    // STATE access is verified asynchronously in assertCanReadSlb; assume checked by caller.
    return user.scope === Scope.STATE;
  }

  async assertCanReadSlb(user: AuthUser, ulbId: string): Promise<void> {
    this.assertValidUlbId(ulbId);

    if (user.scope === Scope.ADMIN) return;

    if (user.scope === Scope.ULB) {
      if (!this.isOwnUlb(user, ulbId)) {
        throw new ForbiddenException('You can only access your own ULB SLB form.');
      }
      return;
    }

    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (!userStateId || !Types.ObjectId.isValid(userStateId)) {
        throw new ForbiddenException('Your account is not mapped to any state.');
      }

      const ulb = await this.ulbModel.findById(ulbId, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!ulbStateId || ulbStateId !== userStateId) {
        throw new ForbiddenException('You can only access ULB SLB forms within your own state.');
      }
      return;
    }

    throw new ForbiddenException('Access denied.');
  }

  async assertCanSubmitSlb(user: AuthUser, ulbId: string): Promise<void> {
    this.assertValidUlbId(ulbId);
    await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
      ulbId,
      'XVIFC',
      CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
    );

    if (user.scope === Scope.ADMIN) return;

    if (user.scope === Scope.ULB) {
      if (user.accessLevel === AccessLevel.VIEWER) {
        throw new ForbiddenException('Viewers cannot submit SLB forms.');
      }
      if (!this.isOwnUlb(user, ulbId)) {
        throw new ForbiddenException('You can only submit your own ULB SLB form.');
      }
      return;
    }

    if (user.scope === Scope.STATE) {
      throw new ForbiddenException('STATE users cannot submit ULB SLB forms.');
    }

    throw new ForbiddenException('Access denied.');
  }

  private assertValidUlbId(ulbId: string): void {
    if (!ulbId || !Types.ObjectId.isValid(ulbId)) {
      throw new BadRequestException('Invalid ulbId.');
    }
  }
}
