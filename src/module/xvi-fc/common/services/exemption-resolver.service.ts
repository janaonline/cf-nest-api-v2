import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionDocument,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { UlbAccessInput, YearAccessInput, YearAccessService } from './year-access.service';

/** 'AUTOMATIC' (dynamic year access) and 'DISCRETIONARY' (STATE-filed, MoHUA-decided Request
 *  Exemption) are the two real sources. Kept as a union (not a bare boolean) so a future third
 *  source won't be a breaking signature change for callers of this service. */
export type ExemptionSource = 'AUTOMATIC' | 'DISCRETIONARY';

export interface ExemptionResolution {
  exempted: boolean;
  source: ExemptionSource | null;
}

const NOT_EXEMPT: ExemptionResolution = { exempted: false, source: null };

/** One `data[]` entry from a `XviFcEligibilityExemption` document, as relevant to a caller asking
 *  "does an open/decided discretionary request exist for this {ulb, year, formId}?" */
export interface DiscretionaryExemptionEntry {
  requestId: Types.ObjectId;
  /** Always one of FORM_STATUS.UNDER_REVIEW_BY_MOHUA / RETURNED_BY_MOHUA /
   *  SUBMISSION_ACKNOWLEDGED_BY_MOHUA — see XviFcEligibilityExemptionEntry's own doc-comment. */
  currentFormStatus: number;
  decidedAt: Date | null;
  mohuaRemarks: string | null;
}

type LeanExemptionDoc = {
  _id: Types.ObjectId;
  ulb: Types.ObjectId | null;
  data: { formId: number; currentFormStatus: number; decidedAt: Date | null; mohuaRemarks: string | null }[];
};

/**
 * Centralizes read-only exemption checks for (ulb, formId, designYear).
 * Returns exemption status and reason without duplicating lookup logic.
 * Uses YearAccessService.peekEntry only; never persists or materializes yearAccess entries.
 */
@Injectable()
export class ExemptionResolverService {
  constructor(
    private readonly yearAccessService: YearAccessService,
    private readonly formJsonConfigService: FormJsonConfigService,
    @InjectModel(XviFcEligibilityExemption.name)
    private readonly eligibilityExemptionModel: Model<XviFcEligibilityExemptionDocument>,
  ) {}

  /**
   * Resolves exemptions in bulk for multiple ULBs for one (year, formId) pair.
   * Reuses one formJsonConfig lookup and performs one read-only peekEntry per ULB.
   * Callers must batch-load ULBs rather than invoke this per ULB.
   */
  async resolveBulk(
    ulbs: UlbAccessInput[],
    year: YearAccessInput,
    formId: number,
  ): Promise<Map<string, ExemptionResolution>> {
    const result = new Map<string, ExemptionResolution>();
    if (ulbs.length === 0) return result;

    const formConfig = await this.formJsonConfigService.findByFormId(formId);
    if (!formConfig?.isApplicableForExemption) {
      for (const ulb of ulbs) result.set(String(ulb._id), NOT_EXEMPT);
      return result;
    }

    for (const ulb of ulbs) {
      const entry = await this.yearAccessService.peekEntry(ulb, year);
      const exempted = entry.yearEnabled && entry.disabledFormIds.includes(formId);
      result.set(String(ulb._id), exempted ? { exempted: true, source: 'AUTOMATIC' } : NOT_EXEMPT);
    }
    return result;
  }

  /**
   * Read-only lookup of the discretionary Request Exemption `data[]` entry (if any) for one
   * `{ulb, year, formId}` — used by callers that need to know whether a STATE has ever filed a
   * discretionary exemption request for this form, regardless of its outcome (Pending/Approved/
   * Rejected all return an entry; only "never requested" returns null).
   *
   * `ulbId: null` resolves the whole-state branch instead (a `ulb: null` document covering every
   * ULB in the state) — e.g. SFC Status (formId 22), which has no per-ULB submission at all.
   * Unlike a ULB id, `ulb: null` alone isn't unique to one state — every state's whole-state
   * exemption doc for a given year shares it — so `stateId` is required in that case (enforced
   * by the overload below) to scope the query correctly.
   */
  async resolveDiscretionary(
    ulbId: Types.ObjectId,
    yearId: Types.ObjectId,
    formId: number,
  ): Promise<DiscretionaryExemptionEntry | null>;
  async resolveDiscretionary(
    ulbId: null,
    yearId: Types.ObjectId,
    formId: number,
    stateId: Types.ObjectId,
  ): Promise<DiscretionaryExemptionEntry | null>;
  async resolveDiscretionary(
    ulbId: Types.ObjectId | null,
    yearId: Types.ObjectId,
    formId: number,
    stateId?: Types.ObjectId,
  ): Promise<DiscretionaryExemptionEntry | null> {
    const filter: Record<string, unknown> = { ulb: ulbId, year: yearId, 'data.formId': formId };
    if (ulbId === null) filter['state'] = stateId;

    const doc = await this.eligibilityExemptionModel
      .findOne(filter, { ulb: 1, data: 1 })
      .lean<LeanExemptionDoc>()
      .exec();
    return this.pickEntry(doc, formId);
  }

  /** Bulk variant of `resolveDiscretionary` for one (year, formId) pair across many ULBs — one
   *  query total, same batching shape as `resolveBulk`. */
  async resolveDiscretionaryBulk(
    ulbIds: Types.ObjectId[],
    yearId: Types.ObjectId,
    formId: number,
  ): Promise<Map<string, DiscretionaryExemptionEntry>> {
    const result = new Map<string, DiscretionaryExemptionEntry>();
    if (ulbIds.length === 0) return result;

    const docs = await this.eligibilityExemptionModel
      .find({ ulb: { $in: ulbIds }, year: yearId, 'data.formId': formId }, { ulb: 1, data: 1 })
      .lean<LeanExemptionDoc[]>()
      .exec();

    for (const doc of docs) {
      const entry = this.pickEntry(doc, formId);
      if (entry) result.set(String(doc.ulb), entry);
    }
    return result;
  }

  private pickEntry(doc: LeanExemptionDoc | null, formId: number): DiscretionaryExemptionEntry | null {
    const entry = doc?.data.find((e) => e.formId === formId);
    if (!entry) return null;
    return {
      requestId: doc!._id,
      currentFormStatus: entry.currentFormStatus,
      decidedAt: entry.decidedAt ? new Date(entry.decidedAt) : null,
      mohuaRemarks: entry.mohuaRemarks ?? null,
    };
  }
}

/** Re-exported for callers that want to compare a `DiscretionaryExemptionEntry.currentFormStatus`
 *  without importing the shared constants module directly. */
export const DISCRETIONARY_PENDING_STATUS = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
export const DISCRETIONARY_APPROVED_STATUS = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
export const DISCRETIONARY_REJECTED_STATUS = FORM_STATUS.RETURNED_BY_MOHUA;
