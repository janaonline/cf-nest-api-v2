import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import {
  canStateFinalSubmitForm,
  ULB_EDITABLE_STATUS_IDS,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { XviFcApiResponse, XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionDocument,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import {
  XviFcEligibilityExemptionFormLog,
  XviFcEligibilityExemptionFormLogDocument,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountDocument } from 'src/schemas/xvi-fc/annual-account.schema';
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

/** formId 23 (Elected Body) has no per-ULB status to check at all - ElectedUrbanLocalBodiesForm is
 *  a whole-state document (state+year, no `ulb` field), not per-ULB like Annual Accounts - so
 *  there's no equivalent "does this ULB already have real progress" question to ask for it. Only
 *  formId 30/31 (Audited/Provisional AFS) map to a real per-ULB section document. Same mapping as
 *  `AnnualAccountsService`'s own SECTION_FORM_IDS (inverse direction) and
 *  `RequestExemptionMohuaService`'s AFS_SECTION_TYPE_BY_FORM_ID - kept as three small local copies
 *  rather than a shared cross-module export, consistent with this codebase's existing convention
 *  for small structural formId lookup tables. Unlike the *offered reasons and their labels* (now
 *  sourced per-year via `RequestExemptionFormJsonConfigService.loadReasonOptions`), this is a stable
 *  code-level mapping of which Annual Accounts section a reason corresponds to. */
const AFS_SECTION_TYPE_BY_FORM_ID: Record<number, 'audited' | 'unaudited'> = { 30: 'audited', 31: 'unaudited' };

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
  ulb: Types.ObjectId;
  data: ExemptionEntryData[];
};

type ListRowLean = {
  _id: Types.ObjectId;
  ulb: Types.ObjectId;
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
    @InjectConnection()
    private readonly connection: Connection,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly formJsonConfig: RequestExemptionFormJsonConfigService,
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
    this.assertStateAccess(user, stateId);

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
   * The `reasonForExemption` field's `{id, label}` options for `yearId` — the same per-year
   * `formjsons`-sourced list `getForm` embeds in its field config, exposed on its own so the
   * "Exemption Status" list's filter dropdown can fetch just this, without `getForm`'s unrelated
   * ULB-autocomplete/file fields and start-a-new-request permission gating.
   */
  async getReasonOptions(
    stateId: string,
    yearId: string,
    user: AuthUser,
  ): Promise<XviFcApiResponse<RequestExemptionReasonOption[]>> {
    this.assertStateAccess(user, stateId);

    const reasonOptions = await this.formJsonConfig.loadReasonOptions(yearId);
    return xviFcSuccess('Request Exemption reason options fetched.', reasonOptions);
  }

  /**
   * Final-submits a Request Exemption for one or more `formId`s at once — the only write path for
   * this form (no draft step). Resolves the one document for `{ulb, year}` (creating it if this is
   * this ULB's first-ever request this year) and merges each submitted `formId` into its `data[]`:
   * a brand-new `formId` is pushed; a `RETURNED_BY_MOHUA` one is wholesale-replaced in place
   * (fresh content/timestamps, decision fields cleared); a still-`UNDER_REVIEW_BY_MOHUA` or already
   * `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` one blocks the *whole* submission (all-or-nothing), naming
   * every conflicting `formId`. See `xvi-fc-eligibility-exemption.schema.ts`'s own doc-comment for
   * the full reasoning behind this shape.
   *
   * Writes one append-only log row per submitted `formId` alongside the document write, in the
   * same transaction — see `xvi-fc-eligibility-exemption-form-log.schema.ts`'s doc-comment for why
   * that pairing needs transactional integrity here specifically (unlike most of this feature's
   * other writes).
   */
  async finalSubmit(
    dto: SaveRequestExemptionDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<RequestExemptionSaveResponseData>> {
    this.assertStateAccess(user, dto.stateId);

    const reasonOptions = await this.formJsonConfig.loadReasonOptions(dto.yearId);
    const reasonLabelById = new Map(reasonOptions.map((option) => [option.id, option.label]));

    const sanitized = this.validateAndSanitize(
      dto.data,
      reasonOptions.map((option) => option.id),
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
      // ConflictException (409), deliberately not ForbiddenException (403): the frontend's global
      // HTTP interceptor treats *any* 403 as an invalid/expired session and force-logs the user
      // out - correct for a genuine cross-state access violation (assertStateAccess, above), but
      // wrong here. This is a normal, expected business-rule conflict for a fully authenticated,
      // authorized user - there's no client-side equivalent check to prevent them from hitting it
      // in the first place (unlike every other ForbiddenException in this codebase's state forms,
      // which the UI already makes practically unreachable by disabling the button first), so this
      // is the one case in this feature that a real user actually hits in normal use.
      throw new ConflictException(
        `This ULB already has a request for: ${details}. Check the Exemption Status list, and resubmit ` +
          `that request if it needs revising, rather than filing a new one for the same reason.`,
      );
    }

    await this.assertTargetFormsEligible(sanitized.ulb, dto.yearId, sanitized.reasonForExemption, reasonLabelById);

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
        await this.model
          .findOneAndUpdate({ _id: existingDoc._id }, { $set: { data: mergedData, updatedBy: userOid } }, { session })
          .exec();
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
   * table; `canCreate` mirrors `getForm`'s `canEdit` so the frontend can disable/hide the "Request
   * Exemption" button without a second round trip.
   *
   * Pagination happens after flattening, in memory, not at the Mongo query level: every document
   * for this state+year is fetched (bounded by how many distinct ULBs have ever filed a request —
   * small even for a large state, and each document holds at most one entry per this year's offered
   * reasons), which is simpler than an `$unwind` aggregation for a row count nowhere near large
   * enough for that to matter.
   */
  async list(
    stateId: string,
    yearId: string,
    query: GetRequestExemptionListQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<RequestExemptionListResponseData>> {
    this.assertStateAccess(user, stateId);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const filter = { state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId) };

    const [state, docs, reasonOptions] = await Promise.all([
      this.stateModel.findById(stateId, { name: 1 }).lean<{ name?: string }>().exec(),
      this.model.find(filter, { ulb: 1, data: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean<ListRowLean[]>().exec(),
      this.formJsonConfig.loadReasonOptions(yearId),
    ]);
    const reasonLabelById = new Map(reasonOptions.map((option) => [option.id, option.label]));

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

    // Filters applied in-memory, before pagination - the whole state+year candidate set is already
    // in hand (see the comment above on why this stays a plain .find() + JS, not an aggregation).
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

  /** Batch-resolves `{ulbId -> {name, censusCode}}` for a page of list rows — same find-by-ids + Map
   *  technique `ulb.service.ts`'s `attachLookupNames` uses; kept local since only these two fields are
   *  needed here. `censusCode` falls back to `sbCode` — same convention `listUlbSlbForms`/
   *  `listUlbSubmissions`'s own `$ifNull: ['$censusCode', '$sbCode']` aggregation stage uses, just
   *  computed in plain TS since this is a `.find()`, not an aggregation pipeline. */
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

  /** Loads the one document for `{ulb, year}` (scoped to this state, though the unique `{ulb,
   *  year}` index alone already guarantees at most one exists regardless of state) — `null` if
   *  this ULB has never filed a request this year. */
  private async resolveExistingDocument(
    stateId: string,
    yearId: string,
    ulb: Types.ObjectId,
  ): Promise<ExistingDocLean | null> {
    return this.model
      .findOne(
        { state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), ulb },
        { state: 1, year: 1, ulb: 1, data: 1 },
      )
      .lean<ExistingDocLean>()
      .exec();
  }

  /**
   * Fails fast (409) if any submitted formId's own target form already has real progress -
   * re-verified again at MoHUA-decide time (RequestExemptionMohuaService.approve), since time may
   * pass between filing and decision; this is purely so a doomed request never sits in MoHUA's
   * queue in the first place. Only formId 30/31 have a real per-ULB status to check - see
   * AFS_SECTION_TYPE_BY_FORM_ID's own doc-comment for why formId 23 is skipped entirely.
   */
  private async assertTargetFormsEligible(
    ulb: Types.ObjectId,
    yearId: string,
    reasonForExemption: number[],
    reasonLabelById: Map<number, string>,
  ): Promise<void> {
    const sectionFormIds = reasonForExemption.filter((formId) => formId in AFS_SECTION_TYPE_BY_FORM_ID);
    if (sectionFormIds.length === 0) return;

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

  private validateAndSanitize(
    data: RequestExemptionDataDto,
    allowedReasonFormIds: readonly number[],
  ): {
    ulb: Types.ObjectId;
    reasonForExemption: number[];
    supportingDetails: string;
    supportingFile: FileInfo | null;
  } {
    const errors: XviFcValidationErrorMap = {};

    if (!data.ulb) {
      errors['ulb'] = [{ field: 'ulb', message: 'This field is required.', code: 'required' }];
    }

    const reasonForExemption = data.reasonForExemption ?? [];
    if (reasonForExemption.length === 0) {
      errors['reasonForExemption'] = [
        { field: 'reasonForExemption', message: 'This field is required.', code: 'required' },
      ];
    } else {
      const invalid = reasonForExemption.filter((id) => !allowedReasonFormIds.includes(id));
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
      ulb: new Types.ObjectId(data.ulb!),
      reasonForExemption,
      supportingDetails,
      supportingFile: supportingFile ?? null,
    };
  }

  private buildFormPermissions(user: AuthUser, stateId: string): RequestExemptionPermissions {
    const perms = new Set(getEffectivePermissions(user));
    const hasAccess = this.hasStateAccess(user, stateId);
    return {
      canView: perms.has(Permission.VIEW_STATE_FORMS) && hasAccess,
      canEdit: perms.has(Permission.RECOMMEND_EXEMPTIONS) && hasAccess,
      canFinalSubmit: perms.has(Permission.RECOMMEND_EXEMPTIONS) && hasAccess,
    };
  }

  // ─── Scope enforcement ────────────────────────────────────────────────────

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
