import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { escapeRegex } from 'src/common/utils/regex.util';
import {
  canStateFinalSubmitForm,
  STATE_EDITABLE_STATUS_IDS,
  ULB_EDITABLE_STATUS_IDS,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertStateAccess, hasStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { XviFcApiResponse, XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  REASON_FIELD_KEY_STATE,
  REASON_FIELD_KEY_ULB,
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionDocument,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import {
  XviFcEligibilityExemptionFormLog,
  XviFcEligibilityExemptionFormLogDocument,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from 'src/schemas/xvi-fc/annual-account.schema';
import {
  SFC_FORM_ID,
  SFC_STATUS_FORM_TYPE,
  XviFcSfcStatus,
  XviFcSfcStatusDocument,
} from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { EULB_FORM_ID } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { ClaimEligibilityRowMatchConfig } from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { getFieldsByType } from './helpers/request-exemption-form-json.helpers';
import { RequestExemptionFormJsonConfigService } from './services/form-json/request-exemption-form-json.service';
import { RequestExemptionDataDto, SaveRequestExemptionDto } from './dto/save-request-exemption.dto';
import type { GetRequestExemptionListQueryDto } from './dto/get-request-exemption-list-query.dto';
import type {
  RequestExemptionGetResponseData,
  RequestExemptionListItem,
  RequestExemptionListResponseData,
  RequestExemptionPermissions,
  RequestExemptionReasonOption,
  RequestExemptionSaveResponseData,
} from './request-exemption.types';

/** Maps a per-ULB reason formId to its Annual Accounts section type; formId 23 (Elected Body) is
 *  checked separately by `assertElectedBodyRowNotAlreadyEligible`. See CLAUDE.md's Invariants
 *  section for why this stays a small local copy rather than a shared export. */
const AFS_SECTION_TYPE_BY_FORM_ID: Record<number, 'audited' | 'unaudited'> = { 30: 'audited', 31: 'unaudited' };

/** Whole-state reasons with a real target form to check - only SFC Status today. Extend this (and
 *  assertTargetStateFormsEligible's dispatch) the day a second whole-state reason is added. */
const STATE_FORM_IDS_WITH_REAL_PROGRESS_CHECK: ReadonlySet<number> = new Set([SFC_FORM_ID]);

/** Plain-object shape of one `data[]` entry — used both for what's read back (`.lean()`) and for
 *  what `finalSubmit` constructs fresh; kept distinct from the Mongoose schema class itself since
 *  nothing here needs its decorator metadata, just the field shape. */
type ExemptionEntryData = {
  formId: number;
  currentFormStatus: number;
  supportingDetails: string;
  supportingFile: FileInfo | null;
  submittedBy: Types.ObjectId;
  submittedAt: Date;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  mohuaRemarks: string | null;
};

type ExistingDocLean = {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  ulb: Types.ObjectId | null;
  data: ExemptionEntryData[];
  updatedAt: Date;
};

type ListRowLean = {
  _id: Types.ObjectId;
  ulb: Types.ObjectId | null;
  data: ExemptionEntryData[];
  createdAt: Date;
};

@Injectable()
export class RequestExemptionService {
  constructor(
    @InjectModel(XviFcEligibilityExemption.name)
    private readonly model: Model<XviFcEligibilityExemptionDocument>,
    @InjectModel(XviFcEligibilityExemptionFormLog.name)
    private readonly formLogModel: Model<XviFcEligibilityExemptionFormLogDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(XviFcAnnualAccount.name)
    private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcSfcStatus.name)
    private readonly sfcStatusModel: Model<XviFcSfcStatusDocument>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly electedBodyFormModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly electedBodyRowModel: Model<EulbRowDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly formJsonConfig: RequestExemptionFormJsonConfigService,
    private readonly formJsonService: FormJsonService,
  ) {}

  /**
   * Returns the (always blank) Request Exemption field config for starting a new request, plus
   * status-agnostic permissions. This is a "start a new request" page, not a "resume the one
   * request for this ULB+year" page — the backend transparently resolves the right document by
   * `{ulb, year}` at submit time (see `finalSubmit`), so there's nothing to resolve up front here.
   */
  async getForm(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<RequestExemptionGetResponseData>> {
    assertStateAccess(user, stateId);

    const state = await this.stateModel.findById(stateId, { name: 1 }).lean<{ name?: string }>().exec();
    const permissions = this.buildFormPermissions(user, stateId);
    const rawFields = await this.formJsonConfig.loadFields(yearId);
    const fields: HydratedFieldConfig[] = getFieldsByType(rawFields, 'RE_MAIN_FORM_FIELDS').map((field) => ({
      ...field,
      value: field.value ?? null,
    }));

    return xviFcSuccess('Request Exemption form fetched.', {
      stateId,
      yearId,
      stateName: state?.name ?? '',
      fields,
      permissions,
    });
  }

  /**
   * The union of both reason fields' `{id, label}` options for `yearId`, for the "Exemption Status"
   * list's filter dropdown — exposed separately from `getForm` so callers don't need its unrelated
   * fields/permissions. IDs are disjoint by construction, so a flat merge is safe.
   */
  async getReasonOptions(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<RequestExemptionReasonOption[]>> {
    assertStateAccess(user, stateId);

    const [ulbReasons, stateReasons] = await Promise.all([
      this.formJsonConfig.loadReasonOptions(yearId, REASON_FIELD_KEY_ULB),
      this.formJsonConfig.loadReasonOptions(yearId, REASON_FIELD_KEY_STATE, false),
    ]);
    return xviFcSuccess('Request Exemption reason options fetched.', [...ulbReasons, ...stateReasons]);
  }

  /**
   * Final-submits one or more `formId`s at once — the only write path for this form (no draft
   * step). See docs/adr/0001-document-shape-and-write-concurrency.md for the document shape,
   * wholesale-replace semantics, and write-concurrency mechanics.
   */
  async finalSubmit(
    dto: SaveRequestExemptionDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<RequestExemptionSaveResponseData>> {
    assertStateAccess(user, dto.stateId);

    const [ulbReasonOptions, stateReasonOptions] = await Promise.all([
      this.formJsonConfig.loadReasonOptions(dto.yearId, REASON_FIELD_KEY_ULB),
      this.formJsonConfig.loadReasonOptions(dto.yearId, REASON_FIELD_KEY_STATE, false),
    ]);
    const reasonLabelById = new Map(
      [...ulbReasonOptions, ...stateReasonOptions].map((option) => [option.id, option.label]),
    );

    const sanitized = this.validateAndSanitize(
      dto.data,
      ulbReasonOptions.map((option) => option.id),
      stateReasonOptions.map((option) => option.id),
    );
    const existingDoc = await this.resolveExistingDocument(dto.stateId, dto.yearId, sanitized.ulb);

    const existingByFormId = new Map((existingDoc?.data ?? []).map((entry) => [entry.formId, entry]));
    const blocked = sanitized.reasonForExemption
      .map((formId) => existingByFormId.get(formId))
      .filter((entry): entry is ExemptionEntryData => !!entry && !canStateFinalSubmitForm(entry.currentFormStatus));

    if (blocked.length > 0) {
      const details = blocked
        .map(
          (entry) =>
            `${reasonLabelById.get(entry.formId) ?? `Reason #${entry.formId}`} (${getFormStatusLabel(entry.currentFormStatus)})`,
        )
        .join(', ');
      // ConflictException (409), not ForbiddenException (403) - see
      // docs/adr/0002-eligibility-gating-and-race-window.md for why.
      const subject = sanitized.ulb ? 'This ULB' : 'This state';
      throw new ConflictException(
        `${subject} already has a request for: ${details}. Check the Exemption Status list, and resubmit ` +
          `that request if it needs revising, rather than filing a new one for the same reason.`,
      );
    }

    if (sanitized.ulb) {
      // Per-ULB branch: formId 30/31 map to a real Annual Accounts section; formId 23 (Elected
      // Body) checks the ULB's current row value instead - see assertTargetFormsEligible.
      await this.assertTargetFormsEligible(
        sanitized.ulb,
        dto.stateId,
        dto.yearId,
        sanitized.reasonForExemption,
        reasonLabelById,
      );
    } else {
      // Whole-state branch: only formId 22 (SFC Status) maps to a real target form to check today.
      await this.assertTargetStateFormsEligible(dto.stateId, dto.yearId, sanitized.reasonForExemption, reasonLabelById);
    }

    const userOid = new Types.ObjectId(user._id);
    const now = new Date();

    const newEntries: ExemptionEntryData[] = sanitized.reasonForExemption.map((formId) => ({
      formId,
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      supportingDetails: sanitized.supportingDetails,
      supportingFile: sanitized.supportingFile,
      submittedBy: userOid,
      submittedAt: now,
      decidedBy: null,
      decidedAt: null,
      mohuaRemarks: null,
    }));

    const submittedFormIds = new Set(sanitized.reasonForExemption);
    const mergedData: ExemptionEntryData[] = [
      ...(existingDoc?.data ?? []).filter((entry) => !submittedFormIds.has(entry.formId)),
      ...newEntries,
    ];

    const session = await this.connection.startSession();
    let savedId: Types.ObjectId;
    try {
      session.startTransaction();

      if (existingDoc) {
        const updated = await this.model
          .findOneAndUpdate(
            { _id: existingDoc._id, updatedAt: existingDoc.updatedAt },
            { $set: { data: mergedData, updatedBy: userOid } },
            { session },
          )
          .exec();
        if (!updated) {
          throw new ConflictException('This request changed while you were submitting. Reload and try again.');
        }
        savedId = existingDoc._id;
      } else {
        const created = await this.model.create(
          [
            {
              state: new Types.ObjectId(dto.stateId),
              year: new Types.ObjectId(dto.yearId),
              ulb: sanitized.ulb,
              data: mergedData,
              createdBy: userOid,
              updatedBy: userOid,
              isActive: true,
              isDeleted: false,
            },
          ],
          { session },
        );
        savedId = created[0]._id;
      }

      await this.formLogModel.insertMany(
        newEntries.map((entry) => ({
          requestId: savedId,
          ulb: sanitized.ulb,
          year: new Types.ObjectId(dto.yearId),
          formId: entry.formId,
          action: 'SUBMITTED' as const,
          toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          toStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_MOHUA),
          actorStage: 'STATE' as const,
          userInfo: { userId: userOid, role: user.role, ipAddress: ip ?? null, userAgent: userAgent ?? null },
          snapshot: { supportingDetails: sanitized.supportingDetails, supportingFile: sanitized.supportingFile },
        })),
        { session },
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('Another request for this ULB was just filed. Reload and try again.');
      }
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('Exemption request submitted successfully.', {
      _id: String(savedId),
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_MOHUA),
    });
  }

  /**
   * Paginated, flattened list of this state's own requests for the year — one row per
   * `(document, data[] entry)` pair, newest document first. Backs the "Exemption Status" landing
   * table. Filters and pagination are applied in memory - see CLAUDE.md's "list() filters and
   * paginates in memory" section for why.
   */
  async list(
    stateId: string,
    yearId: string,
    query: GetRequestExemptionListQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<RequestExemptionListResponseData>> {
    assertStateAccess(user, stateId);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const filter = { state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId) };

    const [state, docs, ulbReasonOptions, stateReasonOptions] = await Promise.all([
      this.stateModel.findById(stateId, { name: 1 }).lean<{ name?: string }>().exec(),
      this.model.find(filter, { ulb: 1, data: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean<ListRowLean[]>().exec(),
      this.formJsonConfig.loadReasonOptions(yearId, REASON_FIELD_KEY_ULB),
      this.formJsonConfig.loadReasonOptions(yearId, REASON_FIELD_KEY_STATE, false),
    ]);
    const reasonLabelById = new Map(
      [...ulbReasonOptions, ...stateReasonOptions].map((option) => [option.id, option.label]),
    );

    const ulbIds = docs.map((doc) => doc.ulb).filter((id): id is Types.ObjectId => !!id);
    const ulbInfoById = await this.resolveUlbNames(ulbIds);

    let allItems: RequestExemptionListItem[] = docs.flatMap((doc) => {
      const ulbInfo = doc.ulb ? ulbInfoById.get(String(doc.ulb)) : undefined;
      return (doc.data ?? []).map((entry) => ({
        _id: `${String(doc._id)}_${entry.formId}`,
        requestId: String(doc._id),
        formId: entry.formId,
        ulb: doc.ulb
          ? { _id: String(doc.ulb), name: ulbInfo?.name ?? '', censusCode: ulbInfo?.censusCode ?? null }
          : null,
        reasonForExemptionLabel: reasonLabelById.get(entry.formId) ?? `Reason #${entry.formId}`,
        currentFormStatus: entry.currentFormStatus,
        currentFormStatusLabel: getFormStatusLabel(entry.currentFormStatus),
        submittedAt: entry.submittedAt ? new Date(entry.submittedAt).toISOString() : null,
        createdAt: doc.createdAt.toISOString(),
      }));
    });

    if (query.reasonForExemption != null) {
      allItems = allItems.filter((item) => item.formId === query.reasonForExemption);
    }
    if (query.status != null) {
      allItems = allItems.filter((item) => item.currentFormStatus === query.status);
    }
    const search = query.search?.trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      allItems = allItems.filter((item) => regex.test(item.ulb?.name ?? '') || regex.test(item.ulb?.censusCode ?? ''));
    }

    const total = allItems.length;
    const skip = (page - 1) * limit;
    const items = allItems.slice(skip, skip + limit);

    return xviFcSuccess('Request Exemption list fetched.', {
      stateName: state?.name ?? '',
      items,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      canCreate: this.buildFormPermissions(user, stateId).canEdit,
    });
  }

  /** Batch-resolves `{ulbId -> {name, censusCode}}` for a page of list rows. `censusCode` falls back
   *  to `sbCode`, same convention as `listUlbSlbForms`/`listUlbSubmissions`. */
  private async resolveUlbNames(
    ulbIds: Types.ObjectId[],
  ): Promise<Map<string, { name: string; censusCode: string | null }>> {
    if (ulbIds.length === 0) return new Map();

    const ulbs = await this.ulbModel
      .find({ _id: { $in: ulbIds } }, { name: 1, censusCode: 1, sbCode: 1 })
      .lean<{ _id: Types.ObjectId; name: string; censusCode: string | null; sbCode: string | null }[]>()
      .exec();
    return new Map(
      ulbs.map((ulb) => [String(ulb._id), { name: ulb.name, censusCode: ulb.censusCode ?? ulb.sbCode ?? null }]),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Loads the one document for `{ulb, year}` (per-ULB branch, scoped to this state though the
   *  partial unique `{ulb, year}` index alone already guarantees at most one exists regardless of
   *  state) — or, when `ulb` is `null`, the one whole-state document for `{state, year}` (DB-
   *  enforced by the second partial unique index). `null` if no such document exists yet. */
  private async resolveExistingDocument(
    stateId: string,
    yearId: string,
    ulb: Types.ObjectId | null,
  ): Promise<ExistingDocLean | null> {
    return this.model
      .findOne(
        { state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), ulb },
        { state: 1, year: 1, ulb: 1, data: 1, updatedAt: 1 },
      )
      .lean<ExistingDocLean>()
      .exec();
  }

  /**
   * Fails fast (409) if any submitted formId's own target form already has real progress. See
   * docs/adr/0002-eligibility-gating-and-race-window.md for the fail-fast/re-verify pattern and why
   * each formId's check is shaped differently.
   */
  private async assertTargetFormsEligible(
    ulb: Types.ObjectId,
    stateId: string,
    yearId: string,
    reasonForExemption: number[],
    reasonLabelById: Map<number, string>,
  ): Promise<void> {
    const sectionFormIds = reasonForExemption.filter((formId) => formId in AFS_SECTION_TYPE_BY_FORM_ID);
    if (sectionFormIds.length > 0) {
      const sectionTypes = sectionFormIds.map((formId) => AFS_SECTION_TYPE_BY_FORM_ID[formId]);
      const sectionDocs = await this.annualAccountModel
        .find(
          { ulb, design_year: new Types.ObjectId(yearId), sectionType: { $in: sectionTypes } },
          { sectionType: 1, form_status_id: 1 },
        )
        .lean<{ sectionType: 'audited' | 'unaudited'; form_status_id: number }[]>()
        .exec();
      const statusIdBySectionType = new Map(sectionDocs.map((doc) => [doc.sectionType, doc.form_status_id]));

      const ineligible = sectionFormIds
        .map((formId) => ({ formId, statusId: statusIdBySectionType.get(AFS_SECTION_TYPE_BY_FORM_ID[formId]) }))
        // No document at all = NOT_STARTED-equivalent = eligible; only a present, non-editable
        // status blocks.
        .filter(
          (x): x is { formId: number; statusId: number } =>
            x.statusId !== undefined && !ULB_EDITABLE_STATUS_IDS.includes(x.statusId),
        );

      if (ineligible.length > 0) {
        const details = ineligible
          .map((x) => `${reasonLabelById.get(x.formId) ?? `Reason #${x.formId}`} (${getFormStatusLabel(x.statusId)})`)
          .join(', ');
        throw new ConflictException(
          `This ULB already has real progress on: ${details}. An exemption can only be requested before the ` +
            `ULB has submitted that form for state review.`,
        );
      }
    }

    if (reasonForExemption.includes(EULB_FORM_ID)) {
      await this.assertElectedBodyRowNotAlreadyEligible(ulb, stateId, yearId, reasonLabelById);
    }
  }

  /**
   * Elected Body (23) has no per-ULB submission-status document to check the way 30/31 do - checks
   * the ULB's current row value against Elected Body's own live eligibility config instead. See
   * docs/adr/0002-eligibility-gating-and-race-window.md.
   */
  private async assertElectedBodyRowNotAlreadyEligible(
    ulb: Types.ObjectId,
    stateId: string,
    yearId: string,
    reasonLabelById: Map<number, string>,
  ): Promise<void> {
    const form = await this.electedBodyFormModel
      .findOne({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId) }, { activeDatasetVersion: 1 })
      .lean<{ activeDatasetVersion: number }>()
      .exec();
    if (!form) return; // nothing uploaded yet - nothing to check

    const row = await this.electedBodyRowModel
      .findOne(
        { ulbId: ulb, year: new Types.ObjectId(yearId), datasetVersion: form.activeDatasetVersion, isActive: true },
        { electedBodyStatus: 1 },
      )
      .lean<{ electedBodyStatus?: string }>()
      .exec();
    if (!row?.electedBodyStatus) return; // no row, or no value yet - nothing to check

    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, EULB_FORM_ID);
    const rowMatch = formJson.claimEligibility?.evaluator?.config as ClaimEligibilityRowMatchConfig | undefined;
    const eligibleValues = rowMatch?.rowEligibleValues ?? [];

    if (eligibleValues.includes(row.electedBodyStatus)) {
      throw new ConflictException(
        `This ULB's Elected Body status is already "${row.electedBodyStatus}" - ` +
          `${reasonLabelById.get(EULB_FORM_ID) ?? 'Election / duly constituted ULB exemption'} can only be ` +
          `requested when the ULB's current status doesn't already meet the requirement.`,
      );
    }
  }

  /** Whole-state counterpart of `assertTargetFormsEligible` - only formId 22 (SFC Status) has a
   *  real target form to check today. See docs/adr/0002-eligibility-gating-and-race-window.md. */
  private async assertTargetStateFormsEligible(
    stateId: string,
    yearId: string,
    reasonForExemptionState: number[],
    reasonLabelById: Map<number, string>,
  ): Promise<void> {
    const checkedFormIds = reasonForExemptionState.filter((formId) =>
      STATE_FORM_IDS_WITH_REAL_PROGRESS_CHECK.has(formId),
    );
    if (checkedFormIds.length === 0) return;

    // Only SFC Status (formId 22) is checked today - one query, no per-formId dispatch needed yet.
    const sfcDoc = await this.sfcStatusModel
      .findOne(
        {
          state: new Types.ObjectId(stateId),
          year: new Types.ObjectId(yearId),
          formType: SFC_STATUS_FORM_TYPE,
          isDeleted: false,
        },
        { currentFormStatus: 1 },
      )
      .lean<{ currentFormStatus: number }>()
      .exec();

    // No document at all = NOT_STARTED-equivalent = eligible; only a present, non-editable status blocks.
    if (sfcDoc && !STATE_EDITABLE_STATUS_IDS.includes(sfcDoc.currentFormStatus)) {
      throw new ConflictException(
        `This state already has real progress on: ${reasonLabelById.get(SFC_FORM_ID) ?? 'SFC Status'} ` +
          `(${getFormStatusLabel(sfcDoc.currentFormStatus)}). An exemption can only be requested before ` +
          `SFC Status has been submitted to MoHUA.`,
      );
    }
  }

  /** Validates the `'ULB'`/`'STATE'` branches of `data` separately, not as a union - see CLAUDE.md's
   *  "exemptionFor branching" section for why this split is load-bearing. */
  private validateAndSanitize(
    data: RequestExemptionDataDto,
    allowedUlbReasonFormIds: readonly number[],
    allowedStateReasonFormIds: readonly number[],
  ): {
    exemptionFor: 'ULB' | 'STATE';
    ulb: Types.ObjectId | null;
    reasonForExemption: number[];
    supportingDetails: string;
    supportingFile: FileInfo | null;
  } {
    const errors: XviFcValidationErrorMap = {};
    const exemptionFor: 'ULB' | 'STATE' = data.exemptionFor === 'STATE' ? 'STATE' : 'ULB';

    let ulb: Types.ObjectId | null = null;
    let reasonForExemption: number[];

    if (exemptionFor === 'ULB') {
      if (!data.ulb) {
        errors['ulb'] = [{ field: 'ulb', message: 'This field is required.', code: 'required' }];
      } else {
        ulb = new Types.ObjectId(data.ulb);
      }

      reasonForExemption = data.reasonForExemption ?? [];
      if (reasonForExemption.length === 0) {
        errors['reasonForExemption'] = [
          { field: 'reasonForExemption', message: 'This field is required.', code: 'required' },
        ];
      } else {
        const invalid = reasonForExemption.filter((id) => !allowedUlbReasonFormIds.includes(id));
        if (invalid.length > 0) {
          errors['reasonForExemption'] = [
            {
              field: 'reasonForExemption',
              message: `These formIds are not valid exemption reasons: ${invalid.join(', ')}.`,
              code: 'invalidOption',
            },
          ];
        }
      }
    } else {
      reasonForExemption = data.reasonForExemptionState ?? [];
      if (reasonForExemption.length === 0) {
        errors['reasonForExemptionState'] = [
          { field: 'reasonForExemptionState', message: 'This field is required.', code: 'required' },
        ];
      } else {
        const invalid = reasonForExemption.filter((id) => !allowedStateReasonFormIds.includes(id));
        if (invalid.length > 0) {
          errors['reasonForExemptionState'] = [
            {
              field: 'reasonForExemptionState',
              message: `These formIds are not valid exemption reasons: ${invalid.join(', ')}.`,
              code: 'invalidOption',
            },
          ];
        }
      }
    }

    const supportingDetails = data.supportingDetails ?? '';
    if (!supportingDetails) {
      errors['supportingDetails'] = [
        { field: 'supportingDetails', message: 'This field is required.', code: 'required' },
      ];
    } else if (supportingDetails.length < 3 || supportingDetails.length > 500) {
      errors['supportingDetails'] = [
        {
          field: 'supportingDetails',
          message: supportingDetails.length < 3 ? 'Minimum 3 characters required.' : 'Maximum 500 characters allowed.',
          code: supportingDetails.length < 3 ? 'minlength' : 'maxlength',
        },
      ];
    }

    // No "existing" file to diff against - every submission wholesale-builds a fresh entry (see
    // this form's own no-partial-patch design), so there's nothing to preserve/compare here.
    const { file: supportingFile, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      data.supportingFile as unknown as Record<string, unknown> | null,
      null,
      { fieldKey: 'supportingFile', allowedExtensions: ['pdf'], maxSizeKb: 5 * 1024 },
    );
    if (fileErrors.length > 0) errors['supportingFile'] = fileErrors;

    if (Object.keys(errors).length > 0) throwXviFcValidationError(errors);

    return {
      exemptionFor,
      ulb,
      reasonForExemption,
      supportingDetails,
      supportingFile: supportingFile ?? null,
    };
  }

  /** True for a MongoDB duplicate-key error (E11000) - the create path's race signal. */
  private isDuplicateKeyError(err: unknown): boolean {
    return (err as { code?: number } | null)?.code === 11000;
  }

  private buildFormPermissions(user: AuthUser, stateId: string): RequestExemptionPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = hasStateAccess(user, stateId);
    return {
      canView: perms.has(Permission.VIEW_STATE_FORMS) && hasAccess,
      canEdit: perms.has(Permission.RECOMMEND_EXEMPTIONS) && hasAccess,
      canFinalSubmit: perms.has(Permission.RECOMMEND_EXEMPTIONS) && hasAccess,
    };
  }
}
