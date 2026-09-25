import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  STATE_EDITABLE_STATUS_IDS,
  ULB_EDITABLE_STATUS_IDS,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
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
import type { RequestExemptionDecideResponseData } from './request-exemption-mohua.types';

type ExemptionEntryLean = { formId: number; currentFormStatus: number };
type ExemptionDocLean = {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  /** `null` for a whole-state (SFC etc.) request — see `XviFcEligibilityExemption.ulb`'s own
   *  doc-comment. `assertSectionStillEligible` below branches on `formId` (not on this field) to
   *  pick which target form to check, so approve/reject pass the whole doc through unconditionally. */
  ulb: Types.ObjectId | null;
  data: ExemptionEntryLean[];
};

/** The two discretionary-exemption reasons that map to a real, per-ULB Annual Accounts section
 *  document - used only to read-check eligibility before approving (see `assertSectionStillEligible`).
 *  formId 23 (Elected Body) is checked separately there, by row eligibility rather than a per-ULB
 *  document - see that method's own `formId === EULB_FORM_ID` branch. */
const AFS_SECTION_TYPE_BY_FORM_ID: Record<number, 'audited' | 'unaudited'> = { 30: 'audited', 31: 'unaudited' };
const AFS_SECTION_LABEL_BY_FORM_ID: Record<number, string> = {
  30: 'Audited Financial Statement',
  31: 'Provisional Financial Statement',
};

/**
 * MoHUA-side decide (approve/reject) for the discretionary Request Exemption flow
 * (`state/request-exemption`) — a separate module, decoupled from the STATE-side one, mirroring
 * `mohua/fc-unspent-declaration`'s split. Much simpler than that module: one `data[]` entry per
 * decide call, addressed by `{requestId, formId}` — no bulk-row/eligibility machinery.
 *
 * Deliberately never writes to `xvifc_annualaccounts`/its own log collection - both approve and
 * reject only ever touch this module's own collections (`xvifc_eligibility_exemptions` + its own
 * form-log). An "Approved" outcome is a pure display-only overlay, exactly like "Pending"/"Rejected"
 * already are (see `AnnualAccountsService.listUlbSubmissions`'s exemption overlay and
 * `assertNotBlockedByPendingExemption`) - not a real status write into a collection this module
 * doesn't own. This was a deliberate architecture change: an earlier version materialized/revised a
 * real Annual Accounts section document on approve, which repeatedly conflicted with that
 * collection's own invariants owned by `AnnualAccountsService` (e.g. the `sectionType: 'audited'`
 * universal per-{ulb,year} anchor `findOrInitialize` guarantees elsewhere) - see this feature's ADR.
 */
@Injectable()
export class RequestExemptionMohuaService {
  constructor(
    @InjectModel(XviFcEligibilityExemption.name)
    private readonly exemptionModel: Model<XviFcEligibilityExemptionDocument>,
    @InjectModel(XviFcEligibilityExemptionFormLog.name)
    private readonly exemptionLogModel: Model<XviFcEligibilityExemptionFormLogDocument>,
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
    private readonly formJsonService: FormJsonService,
  ) {}

  /**
   * Approves one `data[]` entry. For formId 30/31 (Audited/Provisional AFS) and formId 22 (SFC
   * Status), first does a read-only eligibility check against the real target form: blocks with a
   * ConflictException if that form already has real progress beyond what ULB_EDITABLE_STATUS_IDS/
   * STATE_EDITABLE_STATUS_IDS covers - approving an exemption for a form the ULB/state has
   * substantially already submitted would be nonsensical. Nothing is written to that form either
   * way; only the exemption entry itself changes.
   */
  async approve(
    requestId: string,
    formId: number,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<RequestExemptionDecideResponseData>> {
    this.assertReviewAccess(user);

    const requestOid = new Types.ObjectId(requestId);
    const doc = await this.exemptionModel
      .findById(requestOid, { state: 1, year: 1, ulb: 1, data: 1 })
      .lean<ExemptionDocLean>()
      .exec();
    if (!doc) throw new NotFoundException('Exemption request not found.');

    const entry = doc.data.find((e) => e.formId === formId);
    if (!entry) throw new NotFoundException(`No exemption entry for formId ${formId} on this request.`);
    this.assertPending(entry);

    await this.assertSectionStillEligible(doc, formId);

    const userOid = new Types.ObjectId(user._id);
    const now = new Date();

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updateResult = await this.exemptionModel
        .findOneAndUpdate(
          { _id: requestOid, data: { $elemMatch: { formId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } } },
          {
            $set: {
              'data.$.currentFormStatus': FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
              'data.$.decidedBy': userOid,
              'data.$.decidedAt': now,
              'data.$.mohuaRemarks': null,
              updatedBy: userOid,
            },
          },
          { session },
        )
        .exec();
      this.assertUpdateMatched(updateResult);

      await this.exemptionLogModel.create(
        [
          {
            requestId: requestOid,
            ulb: doc.ulb,
            year: doc.year,
            formId,
            action: 'APPROVED',
            toStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
            toStatusLabel: getFormStatusLabel(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA),
            actorStage: 'MOHUA',
            userInfo: { userId: userOid, role: user.role, ipAddress: ip ?? null, userAgent: userAgent ?? null },
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

    return xviFcSuccess(
      'Exemption request approved.',
      this.buildDecideResponse(requestId, formId, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA),
    );
  }

  /**
   * Rejects one `data[]` entry (requires a non-empty `mohuaRemarks`). Only the exemption request
   * itself is touched — same as approve, this never writes to the target form's own status or log:
   * nothing about that form actually happened (its real status is left exactly as it was before
   * this request existed), so there's nothing true to record in its audit trail. The ULB is expected
   * to regain normal edit access on its own the moment this entry leaves UNDER_REVIEW_BY_MOHUA — that
   * gate reads the entry's live status directly, not a copy, so there's nothing to unwind here.
   */
  async reject(
    requestId: string,
    formId: number,
    mohuaRemarksRaw: string,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<RequestExemptionDecideResponseData>> {
    this.assertReviewAccess(user);

    const mohuaRemarks = mohuaRemarksRaw?.trim();
    if (!mohuaRemarks) {
      throwXviFcValidationError({
        mohuaRemarks: [{ field: 'mohuaRemarks', message: 'A rejection remark is required.', code: 'required' }],
      });
    }

    const requestOid = new Types.ObjectId(requestId);
    const doc = await this.exemptionModel
      .findById(requestOid, { ulb: 1, year: 1, data: 1 })
      .lean<ExemptionDocLean>()
      .exec();
    if (!doc) throw new NotFoundException('Exemption request not found.');

    const entry = doc.data.find((e) => e.formId === formId);
    if (!entry) throw new NotFoundException(`No exemption entry for formId ${formId} on this request.`);
    this.assertPending(entry);

    const userOid = new Types.ObjectId(user._id);
    const now = new Date();

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updateResult = await this.exemptionModel
        .findOneAndUpdate(
          { _id: requestOid, data: { $elemMatch: { formId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } } },
          {
            $set: {
              'data.$.currentFormStatus': FORM_STATUS.RETURNED_BY_MOHUA,
              'data.$.decidedBy': userOid,
              'data.$.decidedAt': now,
              'data.$.mohuaRemarks': mohuaRemarks,
              updatedBy: userOid,
            },
          },
          { session },
        )
        .exec();
      this.assertUpdateMatched(updateResult);

      await this.exemptionLogModel.create(
        [
          {
            requestId: requestOid,
            ulb: doc.ulb,
            year: doc.year,
            formId,
            action: 'RETURNED',
            toStatus: FORM_STATUS.RETURNED_BY_MOHUA,
            toStatusLabel: getFormStatusLabel(FORM_STATUS.RETURNED_BY_MOHUA),
            actorStage: 'MOHUA',
            userInfo: { userId: userOid, role: user.role, ipAddress: ip ?? null, userAgent: userAgent ?? null },
            mohuaRemarks,
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

    return xviFcSuccess(
      'Exemption request rejected.',
      this.buildDecideResponse(requestId, formId, FORM_STATUS.RETURNED_BY_MOHUA),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Fast pre-transaction check - not a full race guard on its own, see `assertUpdateMatched`. */
  private assertPending(entry: ExemptionEntryLean): void {
    if (entry.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      // ConflictException (409), not ForbiddenException - same reasoning as the STATE-side
      // finalSubmit's own blocked-formId check: an ordinary, expected business-rule conflict for
      // an authenticated, authorized MoHUA user (e.g. a double-click, or two reviewers racing on
      // the same request), not an auth failure - the frontend's global interceptor force-logs out
      // on any 403, which would be wrong here.
      throw new ConflictException(
        `This entry cannot be decided while its status is ${getFormStatusLabel(entry.currentFormStatus)}.`,
      );
    }
  }

  /** Null means the entry was no longer UNDER_REVIEW_BY_MOHUA when the write ran - raced by
   *  another decision. Closes the gap assertPending's pre-transaction read can't. */
  private assertUpdateMatched(updateResult: unknown): void {
    if (!updateResult) {
      throw new ConflictException(
        "This entry's status changed before your decision could be saved (likely already decided " +
          'by another reviewer). Refresh and try again.',
      );
    }
  }

  /**
   * Read-only eligibility check re-run at decide time (filing already checked this once, but time
   * may pass between filing and decision - see `RequestExemptionService.assertTargetFormsEligible`/
   * `assertTargetStateFormsEligible`, the same check's filing-time counterparts). Branches on
   * `formId`, not on `doc.ulb` - formId 30/31 check the real per-ULB Annual Accounts section;
   * formId 22 checks the real whole-state SFC Status document; formId 23 (Elected Body) checks the
   * ULB's row eligibility instead, via `assertElectedBodyRowNotAlreadyEligible` below. The first two
   * block approval (409) if the target form already has real progress beyond
   * ULB_EDITABLE_STATUS_IDS/STATE_EDITABLE_STATUS_IDS; Elected Body blocks on a different condition
   * (row already eligible) - see that method's own doc-comment for why.
   */
  private async assertSectionStillEligible(doc: ExemptionDocLean, formId: number): Promise<void> {
    const sectionType = AFS_SECTION_TYPE_BY_FORM_ID[formId];
    if (sectionType) {
      const existing = await this.annualAccountModel
        .findOne({ ulb: doc.ulb, design_year: doc.year, sectionType }, { form_status_id: 1 })
        .lean()
        .exec();
      if (existing && !ULB_EDITABLE_STATUS_IDS.includes(existing.form_status_id)) {
        throw new ConflictException(
          `This ULB's ${AFS_SECTION_LABEL_BY_FORM_ID[formId]} already has real progress (status: ` +
            `${getFormStatusLabel(existing.form_status_id)}) and cannot be exempted. Reject this request ` +
            `instead, or ask the state to withdraw it.`,
        );
      }
      return;
    }

    if (formId === SFC_FORM_ID) {
      const existing = await this.sfcStatusModel
        .findOne(
          { state: doc.state, year: doc.year, formType: SFC_STATUS_FORM_TYPE, isDeleted: false },
          { currentFormStatus: 1 },
        )
        .lean<{ currentFormStatus: number }>()
        .exec();
      if (existing && !STATE_EDITABLE_STATUS_IDS.includes(existing.currentFormStatus)) {
        throw new ConflictException(
          `This state's SFC Status already has real progress (status: ` +
            `${getFormStatusLabel(existing.currentFormStatus)}) and cannot be exempted. Reject this request ` +
            `instead, or ask the state to withdraw it.`,
        );
      }
      return;
    }

    if (formId === EULB_FORM_ID) {
      await this.assertElectedBodyRowNotAlreadyEligible(doc);
    }
  }

  /**
   * Elected Body (23) has no per-ULB submission-status document the way 30/31 do - its row-level
   * domain value (`electedBodyStatus`) and its submission-workflow status (`rowStatus`) are
   * decoupled (both only ever move together, in bulk, at finalSubmit - see
   * common/services/CLAUDE.md). So this re-checks the same thing `RequestExemptionService`'s
   * `assertElectedBodyRowNotAlreadyEligible` already checked at filing time: not "has this been
   * submitted for review", but "does the ULB's current row value already meet the requirement" -
   * approving an exemption for a ULB that's already "Constituted"/"6th Schedule" would be
   * nonsensical, since there's nothing left to excuse. `rowEligibleValues` is read live from
   * Elected Body's own claimEligibility config, same as at filing time - not a second hardcoded
   * list.
   */
  private async assertElectedBodyRowNotAlreadyEligible(doc: ExemptionDocLean): Promise<void> {
    if (!doc.ulb) return; // formId 23 is always a per-ULB request; defensive, not reachable today.

    const form = await this.electedBodyFormModel
      .findOne({ state: doc.state, year: doc.year }, { activeDatasetVersion: 1 })
      .lean<{ activeDatasetVersion: number }>()
      .exec();
    if (!form) return; // nothing uploaded yet - nothing to check

    const row = await this.electedBodyRowModel
      .findOne(
        { ulbId: doc.ulb, year: doc.year, datasetVersion: form.activeDatasetVersion, isActive: true },
        { electedBodyStatus: 1 },
      )
      .lean<{ electedBodyStatus?: string }>()
      .exec();
    if (!row?.electedBodyStatus) return; // no row, or no value yet - nothing to check

    const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(String(doc.year), EULB_FORM_ID);
    const rowMatch = formJson.claimEligibility?.evaluator?.config as ClaimEligibilityRowMatchConfig | undefined;
    const eligibleValues = rowMatch?.rowEligibleValues ?? [];

    if (eligibleValues.includes(row.electedBodyStatus)) {
      throw new ConflictException(
        `This ULB's Elected Body status is already "${row.electedBodyStatus}" and cannot be exempted. Reject ` +
          `this request instead, or ask the state to withdraw it.`,
      );
    }
  }

  private buildDecideResponse(
    requestId: string,
    formId: number,
    currentFormStatus: number,
  ): RequestExemptionDecideResponseData {
    return { requestId, formId, currentFormStatus, currentFormStatusLabel: getFormStatusLabel(currentFormStatus) };
  }

  private assertReviewAccess(user: AuthUser): void {
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only MoHUA or admin users may review discretionary exemption requests.');
    }
  }
}
