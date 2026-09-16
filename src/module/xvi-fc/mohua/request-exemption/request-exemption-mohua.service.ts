import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { ULB_EDITABLE_STATUS_IDS } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
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
import type { RequestExemptionDecideResponseData } from './request-exemption-mohua.types';

type ExemptionEntryLean = { formId: number; currentFormStatus: number };
type ExemptionDocLean = {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  ulb: Types.ObjectId;
  data: ExemptionEntryLean[];
};

/** The two discretionary-exemption reasons that map to a real, per-ULB Annual Accounts section
 *  document - used only to read-check eligibility before approving (see `assertSectionStillEligible`).
 *  formId 23 (Elected Body) has no per-ULB document at all (one whole-state doc per {state, year}),
 *  so it's skipped entirely - not a gap, just nothing to check. */
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
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  /**
   * Approves one `data[]` entry. For formId 30/31 (Audited/Provisional AFS), first does a read-only
   * eligibility check against the real Annual Accounts section: blocks with a ConflictException if
   * that section already has real progress beyond what ULB_EDITABLE_STATUS_IDS covers - approving an
   * exemption for a section the ULB has substantially already submitted would be nonsensical.
   * Nothing is written to that section either way; only the exemption entry itself changes.
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

    await this.assertSectionStillEligible(doc.ulb, doc.year, formId);

    const userOid = new Types.ObjectId(user._id);
    const now = new Date();

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      await this.exemptionModel
        .findOneAndUpdate(
          { _id: requestOid, 'data.formId': formId },
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

      await this.exemptionModel
        .findOneAndUpdate(
          { _id: requestOid, 'data.formId': formId },
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

  /** Read-only eligibility check for formId 30/31 - blocks approval if the target Annual Accounts
   *  section already has real progress beyond ULB_EDITABLE_STATUS_IDS. Never reads/writes anything
   *  for formId 23 (Elected Body), which has no per-ULB document this could ever check. */
  private async assertSectionStillEligible(ulb: Types.ObjectId, year: Types.ObjectId, formId: number): Promise<void> {
    const sectionType = AFS_SECTION_TYPE_BY_FORM_ID[formId];
    if (!sectionType) return;

    const existing = await this.annualAccountModel
      .findOne({ ulb, design_year: year, sectionType }, { form_status_id: 1 })
      .lean()
      .exec();
    if (existing && !ULB_EDITABLE_STATUS_IDS.includes(existing.form_status_id)) {
      throw new ConflictException(
        `This ULB's ${AFS_SECTION_LABEL_BY_FORM_ID[formId]} already has real progress (status: ` +
          `${getFormStatusLabel(existing.form_status_id)}) and cannot be exempted. Reject this request ` +
          `instead, or ask the state to withdraw it.`,
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
