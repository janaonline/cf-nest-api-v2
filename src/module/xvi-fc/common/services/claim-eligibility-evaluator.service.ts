import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
import { IFormJson } from 'src/master/form-json/interfaces/form-json.interface';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { YearAccessService } from './year-access.service';
import {
  DISCRETIONARY_COUNTED_STATUSES,
  DISCRETIONARY_PENDING_STATUS,
  type DiscretionaryExemptionEntry,
  ExemptionResolverService,
} from './exemption-resolver.service';
import {
  CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES,
  type ClaimEligibilityConfig,
  type ClaimExemptionKind,
  type ClaimEligibilityRowMatchConfig,
  type EligibilityEvaluationResult,
  type FormEligibilityEvidence,
  type FormStatusEvidenceV1,
  type RowEligibilityEvidence,
  type RowFieldValue,
  type UlbEligibilityBucket,
  type UlbEligibilityTally,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import {
  buildClaimSourceQuery,
  claimSourceFiltersByDesignYear,
} from 'src/module/xvi-fc/common/utils/claim-eligibility-source-query.util';

export interface ClaimEligibilityEvaluationContext {
  stateId: Types.ObjectId;
  designYearId: string;
  installment: 1 | 2;
  /** Present only when re-verifying one specific ULB (e.g. assembly-time save re-check) rather
   *  than the bulk per-state tally used by the picker/checklist (see `evaluateUlbBulk`). */
  ulbId?: Types.ObjectId;
}

export interface UlbBulkEvaluationContext {
  stateId: Types.ObjectId;
  designYearId: string;
  /** Every ULB expected to be evaluated, from `ExpectedUlbSetService` — a ULB with no matching
   *  document/row still gets a bucket (via each source's own no-data default), rather than being
   *  silently absent from the tally. */
  expectedUlbIds: string[];
}

/** One row's resolved field values for `bucketRowValue` — the domain value (`rowStatusField`),
 *  only when `rowFormStatusField` is configured, the row's FORM_STATUS-backed review value, and
 *  the row's own `_id` (always present on a fetched doc, never explicitly projected out) for
 *  callers that need to freeze `rowDocumentId` onto a snapshot without a second query. */
interface RowMatchValues {
  value: unknown;
  formStatus?: unknown;
  rowDocumentId: string;
}

/** Reads a possibly-dotted field path off a plain object (e.g. `'stateDecision.status'`) —
 *  a flat path behaves identically to today's plain bracket-notation lookup. */
function resolveNestedField(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      doc,
    );
}

function toRowFieldValue(value: unknown): RowFieldValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

/**
 * Generic evaluator dispatch (plan §4) — evaluates one enabled `formJson.claimEligibility` source
 * against live data. Only 'FORM_STATUS' is implemented (brain §7.3's named type for "Devolution
 * parent checks"); any other configured `evaluator.type` throws loudly rather than silently
 * passing every ULB. No `formId === 24` (or any other formId) branching anywhere in this file —
 * the source collection/field mapping and installment scoping come entirely from the passed-in
 * `sourceFormJson.claimEligibility` config — SFC, Elected Body, FC Unspent, and GTC are already
 * wired onto this same evaluator alongside Devolution, each via its own `formjsons` document, no
 * code change needed here.
 */
@Injectable()
export class ClaimEligibilityEvaluatorService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    private readonly formJsonConfigService: FormJsonConfigService,
    private readonly yearAccessService: YearAccessService,
    private readonly exemptionResolverService: ExemptionResolverService,
  ) {}

  async evaluate(
    sourceFormJson: IFormJson,
    ctx: ClaimEligibilityEvaluationContext,
  ): Promise<EligibilityEvaluationResult> {
    const config = sourceFormJson.claimEligibility;
    if (!config?.enabled) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)} has no enabled claimEligibility config.`,
      );
    }

    switch (config.evaluator.type) {
      case 'FORM_STATUS':
        return this.evaluateFormStatus(sourceFormJson, ctx);
      default:
        throw new InternalServerErrorException(
          `Unsupported claim-eligibility evaluator type: "${config.evaluator.type}".`,
        );
    }
  }

  private async evaluateFormStatus(
    sourceFormJson: IFormJson,
    ctx: ClaimEligibilityEvaluationContext,
  ): Promise<EligibilityEvaluationResult> {
    // Non-null: only called after the `config.enabled` guard in evaluate().
    const config = sourceFormJson.claimEligibility!;
    const { source } = config;

    if (!source.collection || !source.fields) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)}'s FORM_STATUS evaluator is missing source.collection/source.fields.`,
      );
    }

    const query = buildClaimSourceQuery(config, ctx);
    if (source.fields.ulb && ctx.ulbId) query[source.fields.ulb] = ctx.ulbId;

    const doc = await this.connection.collection(source.collection).findOne(query);
    const evaluatedAt = new Date().toISOString();
    const acceptedFormStatuses = config.acceptedFormStatuses;

    const base = {
      formId: sourceFormJson.formId ?? 0,
      formJsonId: String(sourceFormJson._id),
      ruleVersion: config.ruleVersion,
      formType: sourceFormJson.type ?? '',
      displayLabel: config.displayLabel,
      displayDescription: config.displayDescription,
      checklistRoute: config.checklistRoute,
      checklistSummary: config.checklistSummary,
      ownerLevel: config.ownerLevel,
      evaluationLevel: config.evaluationLevel,
    };

    // Discretionary (STATE->MoHUA Request Exemption) whole-state exemption - always wins while
    // under MoHUA review or approved, regardless of whether a source document exists or what
    // status it's in; MoHUA decides it later (a rejection counts for nothing). No
    // automatic-mechanism check here: Dynamic Year Access is ULB-scoped (Ulb.yearAccess), never
    // applicable to a whole-state single-document source like this one. Gated by
    // config.exemption.allowed so a non-exemptable source pays zero extra query cost.
    let exemptionId: string | null = null;
    let exemptionStatus: number | null = null;
    if (config.exemption?.allowed && sourceFormJson.formId !== undefined) {
      const exemption = await this.exemptionResolverService.resolveDiscretionary(
        null,
        new Types.ObjectId(ctx.designYearId),
        sourceFormJson.formId,
        ctx.stateId,
      );
      if (exemption && DISCRETIONARY_COUNTED_STATUSES.includes(exemption.currentFormStatus)) {
        exemptionId = String(exemption.requestId);
        exemptionStatus = exemption.currentFormStatus;
      }
    }
    const exemptionReasonCode =
      exemptionStatus === DISCRETIONARY_PENDING_STATUS
        ? 'DISCRETIONARY_EXEMPTION_PENDING'
        : 'DISCRETIONARY_EXEMPTION_APPROVED';

    if (!doc) {
      const evidence: FormStatusEvidenceV1 = {
        evidenceVersion: 1,
        resolvedFormStatus: null,
        acceptedFormStatuses,
        sourceFormDocumentId: null,
        evaluatedAt,
      };
      return {
        ...base,
        formDocumentId: null,
        statusAtEvaluation: null,
        result: exemptionId ? 'EXEMPTED' : 'FAILED',
        exemptionId,
        exemptionStatus,
        exemptionKind: exemptionId ? 'DISCRETIONARY_STATE' : null,
        reasonCode: exemptionId ? exemptionReasonCode : 'SOURCE_FORM_NOT_FOUND',
        evidence,
      };
    }

    // Cast, not narrowed: this value comes from an external collection at runtime and can't be
    // statically guaranteed to be one of FormStatusType's literal members. Resolved via
    // `resolveNestedField` (not plain bracket-notation) so a dotted path works the same as a flat one.
    const resolvedFormStatus = resolveNestedField(doc, source.fields.currentFormStatus) as FormStatusType;
    const passed = acceptedFormStatuses.includes(resolvedFormStatus);

    const evidence: FormStatusEvidenceV1 = {
      evidenceVersion: 1,
      resolvedFormStatus,
      acceptedFormStatuses,
      sourceFormDocumentId: String(doc['_id']),
      evaluatedAt,
    };
    this.assertEvidenceSize(evidence);

    return {
      ...base,
      formDocumentId: String(doc['_id']),
      statusAtEvaluation: resolvedFormStatus,
      result: exemptionId ? 'EXEMPTED' : passed ? 'PASSED' : 'FAILED',
      exemptionId,
      exemptionStatus,
      exemptionKind: exemptionId ? 'DISCRETIONARY_STATE' : null,
      reasonCode: exemptionId
        ? exemptionReasonCode
        : passed
          ? 'FORM_STATUS_ACCEPTED'
          : `FORM_STATUS_${resolvedFormStatus}_NOT_ACCEPTED`,
      evidence,
    };
  }

  /**
   * Per-ULB bulk evaluation — one bulk query for the whole state rather than one query per ULB
   * (hundreds of ULBs per state makes N individual queries a real cost). Separate from
   * `evaluate()` because the return shape is fundamentally different: a tally + per-ULB map, not
   * one `EligibilityEvaluationResult`.
   *
   * Dispatches on which half of `source` is populated (`rowCollection` vs `collection`), **not**
   * on `evaluator.type` — deliberately. A source like Elected Body's is `evaluationLevel:
   * 'FORM_AND_ROW'` but keeps `evaluator.type: 'FORM_STATUS'`, because that field still governs
   * its single-result state-level pass/fail line via `evaluate()` above; this method is called
   * separately, only for its row-level tally. Keying both dispatches off the same `evaluator.type`
   * would force one config to mean two different things depending on which method reads it.
   */
  async evaluateUlbBulk(
    sourceFormJson: IFormJson,
    ctx: UlbBulkEvaluationContext,
  ): Promise<{
    perUlb: Map<string, UlbEligibilityBucket>;
    tally: UlbEligibilityTally;
    /** Only set by the row-collection path (`evaluateUlbBulkRowStatus`) — undefined for
     *  ownerLevel:'ULB' flat-document sources (SLB, Annual Accounts), which have no row concept. */
    rowEvidenceByUlbId?: Map<string, RowEligibilityEvidence>;
    /** Only set by the flat-document path (`evaluateUlbBulkFormStatus`): every expected ULB's
     *  document, status and exemption, for the claim snapshot. */
    formEvidenceByUlbId?: Map<string, FormEligibilityEvidence>;
    /** Each ULB's discretionary request status for this form (5, 6 or 7) when one was filed; only 5
     *  and 7 make it EXEMPTED. Automatic exemptions are not included. */
    discretionaryExemptionStatusByUlbId: Map<string, number>;
  }> {
    const config = sourceFormJson.claimEligibility;
    if (!config?.enabled) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)} has no enabled claimEligibility config.`,
      );
    }

    if (config.source.rowCollection) return this.evaluateUlbBulkRowStatus(sourceFormJson, ctx);
    if (config.source.collection) return this.evaluateUlbBulkFormStatus(sourceFormJson, ctx);
    throw new InternalServerErrorException(
      `formJson ${String(sourceFormJson._id)}'s claimEligibility config has neither source.collection nor source.rowCollection for ULB-bulk evaluation.`,
    );
  }

  /** SLB, Annual Accounts (Provisional/Audited): one flat document per ULB (per section for Annual
   *  Accounts, picked by `source.match`), bucketed against `acceptedFormStatuses` — same
   *  matching semantics as `evaluateFormStatus`, just bulk and
   *  ULB-scoped instead of one state-scoped document. A ULB with no document at all has nothing
   *  to accept, so it can't be eligible — no configurable default, unlike the row-collection case
   *  below, since there's no equivalent "absence isn't a problem" scenario here. */
  private async evaluateUlbBulkFormStatus(
    sourceFormJson: IFormJson,
    ctx: UlbBulkEvaluationContext,
  ): Promise<{
    perUlb: Map<string, UlbEligibilityBucket>;
    tally: UlbEligibilityTally;
    formEvidenceByUlbId: Map<string, FormEligibilityEvidence>;
    discretionaryExemptionStatusByUlbId: Map<string, number>;
  }> {
    const config = sourceFormJson.claimEligibility!;
    const { source } = config;
    if (!source.collection || !source.fields?.ulb) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)}'s ULB-bulk FORM_STATUS evaluator is missing source.collection/source.fields.ulb.`,
      );
    }

    const query: Record<string, unknown> = {
      ...source.match,
      // Bounds the read to exactly the ULBs this evaluation cares about — the only narrowing
      // available at all for sources with no `source.fields.state` mapping (e.g. SLB, whose
      // schema has no state field), and a further narrowing on top of `state` for the rest.
      [source.fields.ulb]: { $in: ctx.expectedUlbIds.map((id) => new Types.ObjectId(id)) },
    };
    if (this.filtersByDesignYear(config)) query[source.fields.designYear] = new Types.ObjectId(ctx.designYearId);
    if (source.fields.state) query[source.fields.state] = ctx.stateId;

    const docs = await this.connection
      .collection(source.collection)
      .find(query, { projection: { [source.fields.ulb]: 1, [source.fields.currentFormStatus]: 1 } })
      .toArray();

    const docByUlbId = new Map<string, { id: string; status: unknown }>();
    for (const doc of docs) {
      const ulbValue = resolveNestedField(doc, source.fields.ulb);
      if (!ulbValue) continue;
      // Genuinely an ObjectId at runtime (the ULB-linkage field on every source this reads) —
      // cast, not a raw `unknown`, so String() has a real toString() to call.
      docByUlbId.set(String(ulbValue as Types.ObjectId), {
        id: String(doc['_id'] as Types.ObjectId),
        status: resolveNestedField(doc, source.fields.currentFormStatus),
      });
    }

    // Exemption lookup, gated behind config.exemption.allowed so every non-exemptable form pays
    // zero extra query cost. Automatic stays scoped to ULBs with no document at all (see
    // buildExemptionLookup's own doc-comment for why); discretionary is checked for every
    // expected ULB, since a MoHUA exemption under review or approved overrides real data too.
    const ulbsMissingData = ctx.expectedUlbIds.filter((ulbId) => !docByUlbId.has(ulbId));
    const exemptionLookup = await this.buildExemptionLookup(sourceFormJson, config, ctx, ulbsMissingData);

    const perUlb = new Map<string, UlbEligibilityBucket>();
    const formEvidenceByUlbId = new Map<string, FormEligibilityEvidence>();
    for (const ulbId of ctx.expectedUlbIds) {
      const doc = docByUlbId.get(ulbId);
      const status = doc?.status;
      const discretionary = exemptionLookup?.discretionary.get(ulbId);
      let bucket: UlbEligibilityBucket = 'INELIGIBLE';
      let exemptionKind: ClaimExemptionKind | null = null;

      if (this.countsAsDiscretionary(discretionary)) {
        // Discretionary exemption under review or approved always wins - a later, authoritative
        // decision that overrides whatever this document's own status says, real data or not.
        bucket = 'EXEMPTED';
        exemptionKind = 'DISCRETIONARY_ULB';
      } else if (status === FORM_STATUS.EXEMPTED_ACKNOWLEDGED) {
        // A document with the exempted stub status is always EXEMPTED, regardless of
        // acceptedFormStatuses (no admin needs to remember to add it to every form's list).
        bucket = 'EXEMPTED';
        exemptionKind = 'AUTO_NEW_ULB_STUB';
      } else if (status !== undefined && config.acceptedFormStatuses.includes(status as FormStatusType)) {
        bucket = 'ELIGIBLE';
      } else if (status === undefined && exemptionLookup?.automatic.get(ulbId)) {
        // Automatic (Dynamic Year Access) golden rule, unchanged: only a ULB with NO document at
        // all can be EXEMPTED this way - a document with any other real status is always judged on
        // that data, never re-classified.
        bucket = 'EXEMPTED';
        exemptionKind = 'AUTO_NEW_ULB_NO_DOCUMENT';
      }

      perUlb.set(ulbId, bucket);
      const relied = exemptionKind === 'DISCRETIONARY_ULB' ? discretionary : undefined;
      formEvidenceByUlbId.set(ulbId, {
        bucket,
        formDocumentId: doc?.id ?? null,
        statusAtEvaluation: (status as FormStatusType | undefined) ?? null,
        exemptionId: relied ? String(relied.requestId) : null,
        exemptionStatus: relied?.currentFormStatus ?? null,
        exemptionKind,
      });
    }

    const statuses = this.discretionaryStatuses(exemptionLookup);
    return {
      perUlb,
      tally: this.tallyBuckets(perUlb, statuses),
      formEvidenceByUlbId,
      discretionaryExemptionStatusByUlbId: statuses,
    };
  }

  private countsAsDiscretionary(entry: DiscretionaryExemptionEntry | undefined): boolean {
    return entry !== undefined && DISCRETIONARY_COUNTED_STATUSES.includes(entry.currentFormStatus);
  }

  private discretionaryStatuses(
    lookup: { discretionary: Map<string, DiscretionaryExemptionEntry> } | null,
  ): Map<string, number> {
    return new Map([...(lookup?.discretionary ?? [])].map(([ulbId, entry]) => [ulbId, entry.currentFormStatus]));
  }

  /**
   * Read-only lookup for both exemption mechanisms, kept separate due to different precedence:
   * Automatic (Dynamic Year Access): Applies only to ULBs missing data, uses peekEntry to avoid
   * writes, and runs only when isApplicableForExemption is true.
   * Discretionary (STATE->MoHUA): Applies to all expected ULBs and overrides real data
   * while pending or approved. Returns all statuses, including rejected; countsAsDiscretionary
   * determines exemption. Runs when config.exemption.allowed is true, independently of
   * isApplicableForExemption.
   *
   * Returns null when discretionary exemptions are disabled; otherwise, returns lookup results. */
  private async buildExemptionLookup(
    sourceFormJson: IFormJson,
    config: ClaimEligibilityConfig,
    ctx: UlbBulkEvaluationContext,
    ulbIdsMissingData: string[],
  ): Promise<{ automatic: Map<string, boolean>; discretionary: Map<string, DiscretionaryExemptionEntry> } | null> {
    if (!config.exemption?.allowed || sourceFormJson.formId === undefined) return null;
    const formId = sourceFormJson.formId;

    const automatic = new Map<string, boolean>();
    if (ulbIdsMissingData.length > 0) {
      const formConfig = await this.formJsonConfigService.findByFormId(formId);
      if (formConfig?.isApplicableForExemption) {
        const year = await this.yearModel
          .findById(ctx.designYearId, { year: 1 })
          .lean<{ _id: Types.ObjectId; year: string }>()
          .exec();
        if (year) {
          const ulbs = await this.ulbModel
            .find(
              { _id: { $in: ulbIdsMissingData.map((id) => new Types.ObjectId(id)) } },
              { startYear: 1, yearAccess: 1 },
            )
            .lean()
            .exec();
          for (const ulb of ulbs) {
            const entry = await this.yearAccessService.peekEntry(ulb, year);
            if (entry.yearEnabled && entry.disabledFormIds.includes(formId)) {
              automatic.set(String(ulb._id), true);
            }
          }
        }
      }
    }

    const discretionary = await this.exemptionResolverService.resolveDiscretionaryBulk(
      ctx.expectedUlbIds.map((id) => new Types.ObjectId(id)),
      new Types.ObjectId(ctx.designYearId),
      formId,
    );

    return { automatic, discretionary };
  }

  /** Elected Body / FC Unspent rows: a genuine child-row collection, bucketed via the
   *  `evaluator.config` value mapping (`ClaimEligibilityRowMatchConfig`) rather than
   *  `acceptedFormStatuses`. `source.parentCollection`/`parentFields` — declared, unused
   *  elsewhere — are used here for dataset-versioned row collections (Elected Body) to resolve
   *  the parent form's currently-active dataset version before filtering rows; FC Unspent has no
   *  dataset-versioning concept, so it simply omits `parentCollection` and this step no-ops. */
  private async evaluateUlbBulkRowStatus(
    sourceFormJson: IFormJson,
    ctx: UlbBulkEvaluationContext,
  ): Promise<{
    perUlb: Map<string, UlbEligibilityBucket>;
    tally: UlbEligibilityTally;
    rowEvidenceByUlbId: Map<string, RowEligibilityEvidence>;
    discretionaryExemptionStatusByUlbId: Map<string, number>;
  }> {
    const config = sourceFormJson.claimEligibility!;
    const { source } = config;
    if (!source.rowCollection || !source.rowFields?.['ulb'] || !source.rowFields?.['designYear']) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)}'s ROW_STATUS_AND_FIELDS evaluator is missing source.rowCollection/source.rowFields.ulb/designYear.`,
      );
    }
    const rowMatch = config.evaluator.config as unknown as ClaimEligibilityRowMatchConfig | undefined;
    if (!rowMatch?.rowStatusField || !rowMatch.defaultWhenNoRow) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)}'s ROW_STATUS_AND_FIELDS evaluator is missing evaluator.config.rowStatusField/defaultWhenNoRow.`,
      );
    }

    const rowFields = source.rowFields;
    const query: Record<string, unknown> = {
      [rowFields['designYear']]: new Types.ObjectId(ctx.designYearId),
    };
    if (rowFields['state']) query[rowFields['state']] = ctx.stateId;
    if (rowFields['isActive']) query[rowFields['isActive']] = true;

    // Hoisted (not scoped to the `if` below) so it's available when building rowEvidenceByUlbId —
    // one shared value per source-evaluation call, frozen identically onto every ULB's evidence.
    let activeDatasetVersion: number | undefined;
    if (source.parentCollection && source.parentFields && rowFields['datasetVersion']) {
      const parentDesignYearField = source.parentFields['designYear'] ?? rowFields['designYear'];
      const parentQuery: Record<string, unknown> = {
        [parentDesignYearField]: new Types.ObjectId(ctx.designYearId),
      };
      if (source.parentFields['state']) parentQuery[source.parentFields['state']] = ctx.stateId;
      const activeDatasetVersionField = source.parentFields['activeDatasetVersion'] ?? 'activeDatasetVersion';
      const parent = await this.connection
        .collection(source.parentCollection)
        .findOne(parentQuery, { projection: { [activeDatasetVersionField]: 1 } });
      const resolvedVersion = parent ? resolveNestedField(parent, activeDatasetVersionField) : undefined;
      if (resolvedVersion !== undefined) {
        activeDatasetVersion = resolvedVersion as number;
        query[rowFields['datasetVersion']] = resolvedVersion;
      }
    }

    const projection: Record<string, 1> = { [rowFields['ulb']]: 1, [rowMatch.rowStatusField]: 1 };
    if (rowMatch.rowFormStatusField) projection[rowMatch.rowFormStatusField] = 1;

    const rows = await this.connection.collection(source.rowCollection).find(query, { projection }).toArray();

    const valueByUlbId = new Map<string, RowMatchValues>();
    for (const row of rows) {
      const ulbValue = resolveNestedField(row, rowFields['ulb']);
      if (!ulbValue) continue; // e.g. Elected Body's unmatched EXTRA_ULB rows, which have no ulbId
      // Genuinely an ObjectId at runtime — cast, not a raw `unknown`, so String() has a real
      // toString() to call.
      valueByUlbId.set(String(ulbValue as Types.ObjectId), {
        value: resolveNestedField(row, rowMatch.rowStatusField),
        formStatus: rowMatch.rowFormStatusField ? resolveNestedField(row, rowMatch.rowFormStatusField) : undefined,
        rowDocumentId: String(row['_id'] as Types.ObjectId),
      });
    }

    // Automatic stays scoped to ULBs with no row at all (golden rule, see buildExemptionLookup's
    // own doc-comment); discretionary is checked for every expected ULB below, since a MoHUA
    // exemption under review or approved overrides a real row too.
    const ulbsMissingRow = ctx.expectedUlbIds.filter((ulbId) => !valueByUlbId.has(ulbId));
    const exemptionLookup = await this.buildExemptionLookup(sourceFormJson, config, ctx, ulbsMissingRow);

    const perUlb = new Map<string, UlbEligibilityBucket>();
    const rowEvidenceByUlbId = new Map<string, RowEligibilityEvidence>();
    for (const ulbId of ctx.expectedUlbIds) {
      const entry = valueByUlbId.get(ulbId);

      // Discretionary exemption under review or approved always wins, regardless of any existing
      // row - still frozen as evidence (with the real row's fields when one exists) so
      // claim-letter assembly's buildChildEligibilitySources doesn't silently fall back to the
      // state-level source's own result/reasonCode for this ULB.
      const discretionary = exemptionLookup?.discretionary.get(ulbId);
      if (discretionary && this.countsAsDiscretionary(discretionary)) {
        perUlb.set(ulbId, 'EXEMPTED');
        rowEvidenceByUlbId.set(ulbId, {
          bucket: 'EXEMPTED',
          rowDocumentId: entry?.rowDocumentId ?? null,
          rowStatusAtEvaluation: (entry?.formStatus as FormStatusType | undefined) ?? null,
          datasetVersion: activeDatasetVersion ?? null,
          rowValue: entry ? toRowFieldValue(entry.value) : null,
          rowAccepted: entry ? this.isRowAccepted(entry, rowMatch) : null,
          exemptionId: String(discretionary.requestId),
          exemptionStatus: discretionary.currentFormStatus,
          exemptionKind: 'DISCRETIONARY_ULB',
        });
        continue;
      }

      if (!entry) {
        // Automatic (Dynamic Year Access) golden rule, unchanged: only applies when no row
        // exists at all. Still frozen as evidence (null row fields) for the same assembly reason
        // as above - only the plain, non-exempted defaultWhenNoRow case has nothing to freeze.
        const automaticExempt = exemptionLookup?.automatic.get(ulbId) ?? false;
        perUlb.set(ulbId, automaticExempt ? 'EXEMPTED' : rowMatch.defaultWhenNoRow);
        if (automaticExempt) {
          rowEvidenceByUlbId.set(ulbId, {
            bucket: 'EXEMPTED',
            rowDocumentId: null,
            rowStatusAtEvaluation: null,
            datasetVersion: activeDatasetVersion ?? null,
            rowValue: null,
            rowAccepted: null,
            exemptionId: null,
            exemptionStatus: null,
            exemptionKind: 'AUTO_NEW_ULB_NO_DOCUMENT',
          });
        }
        continue;
      }

      const bucket = this.bucketRowValue(entry, rowMatch);
      perUlb.set(ulbId, bucket);
      rowEvidenceByUlbId.set(ulbId, {
        bucket,
        rowDocumentId: entry.rowDocumentId,
        rowStatusAtEvaluation: (entry.formStatus as FormStatusType | undefined) ?? null,
        datasetVersion: activeDatasetVersion ?? null,
        rowValue: toRowFieldValue(entry.value),
        rowAccepted: this.isRowAccepted(entry, rowMatch),
        exemptionId: null,
        exemptionStatus: null,
        exemptionKind: null,
      });
    }

    const statuses = this.discretionaryStatuses(exemptionLookup);
    return {
      perUlb,
      tally: this.tallyBuckets(perUlb, statuses),
      rowEvidenceByUlbId,
      discretionaryExemptionStatusByUlbId: statuses,
    };
  }

  /** Null when the source has no row-status check configured. */
  private isRowAccepted(entry: RowMatchValues, rowMatch: ClaimEligibilityRowMatchConfig): boolean | null {
    if (!rowMatch.rowFormStatusField || !rowMatch.rowAcceptedFormStatuses) return null;
    return rowMatch.rowAcceptedFormStatuses.includes(entry.formStatus as FormStatusType);
  }

  /**
   * Buckets one row's already-resolved field values. When `rowFormStatusField`/
   * `rowAcceptedFormStatuses` are configured, a row must clear that AND-condition first — an
   * unreviewed/rejected row is `INELIGIBLE` regardless of its domain value, with no exemption
   * bypass — before the existing `rowEligibleValues`/`rowExemptedValues` value mapping applies.
   * Unset (either field absent), this is a no-op and behavior is unchanged from before this check
   * existed — every source that hasn't opted in keeps its current behavior exactly.
   */
  private bucketRowValue(entry: RowMatchValues, rowMatch: ClaimEligibilityRowMatchConfig): UlbEligibilityBucket {
    if (this.isRowAccepted(entry, rowMatch) === false) return 'INELIGIBLE';
    if (rowMatch.rowExemptedValues?.some((v) => v === entry.value)) return 'EXEMPTED';
    if (rowMatch.rowEligibleValues.some((v) => v === entry.value)) return 'ELIGIBLE';
    return 'INELIGIBLE';
  }

  /** Mirrors BankAccountService's own {ulb}-only ONCE_EVER lookup. */
  private filtersByDesignYear(config: ClaimEligibilityConfig): boolean {
    return claimSourceFiltersByDesignYear(config);
  }

  private tallyBuckets(
    perUlb: Map<string, UlbEligibilityBucket>,
    discretionary: Map<string, number>,
  ): UlbEligibilityTally {
    let eligible = 0;
    let ineligible = 0;
    let exempted = 0;
    let exemptedUnderReview = 0;
    for (const [ulbId, bucket] of perUlb) {
      if (bucket === 'ELIGIBLE') eligible++;
      else if (bucket === 'INELIGIBLE') ineligible++;
      else {
        exempted++;
        if (discretionary.get(ulbId) === DISCRETIONARY_PENDING_STATUS) exemptedUnderReview++;
      }
    }
    return { eligible, ineligible, exempted, exemptedUnderReview, total: perUlb.size };
  }

  /** One misconfigured future evaluator can't inflate child-document size across a 700-ULB batch. */
  private assertEvidenceSize(evidence: FormStatusEvidenceV1): void {
    const size = Buffer.byteLength(JSON.stringify(evidence), 'utf8');
    if (size > CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES) {
      throw new InternalServerErrorException(
        `Claim-eligibility evidence exceeds the ${CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES}-byte limit.`,
      );
    }
  }
}
