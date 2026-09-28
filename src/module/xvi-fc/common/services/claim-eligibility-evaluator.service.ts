import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
import { IFormJson } from 'src/master/form-json/interfaces/form-json.interface';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { YearAccessService } from './year-access.service';
import { DISCRETIONARY_APPROVED_STATUS, ExemptionResolverService } from './exemption-resolver.service';
import {
  CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES,
  type ClaimEligibilityConfig,
  type ClaimEligibilityRowMatchConfig,
  type EligibilityEvaluationResult,
  type FormStatusEvidenceV1,
  type RowEligibilityEvidence,
  type UlbEligibilityBucket,
  type UlbEligibilityTally,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';

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

/** Reads a possibly-dotted field path off a plain object (e.g. `'auditedData.form_status_id'`) —
 *  a flat path behaves identically to today's plain bracket-notation lookup. */
function resolveNestedField(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      doc,
    );
}

/**
 * Generic evaluator dispatch (plan §4) — evaluates one enabled `formJson.claimEligibility` source
 * against live data. Only 'FORM_STATUS' is implemented (brain §7.3's named type for "Devolution
 * parent checks"); any other configured `evaluator.type` throws loudly rather than silently
 * passing every ULB. No `formId === 24` (or any other formId) branching anywhere in this file —
 * the source collection/field mapping and installment scoping come entirely from the passed-in
 * `sourceFormJson.claimEligibility` config, so wiring in a second FORM_STATUS-shaped source (e.g.
 * SFC) later is pure configuration.
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

    const query: Record<string, unknown> = {
      [source.fields.designYear]: new Types.ObjectId(ctx.designYearId),
    };
    if (source.fields.state) query[source.fields.state] = ctx.stateId;
    if (source.fields.ulb && ctx.ulbId) query[source.fields.ulb] = ctx.ulbId;

    // Devolution's installment scoping travels through the free-form evaluator config bag —
    // brain §7.2's source.fields mapping has no dedicated `installment` key.
    const installmentField = config.evaluator.config?.['installmentField'];
    if (typeof installmentField === 'string') query[installmentField] = ctx.installment;

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

    // Discretionary (STATE->MoHUA Request Exemption) whole-state exemption - always wins,
    // regardless of whether a source document exists or what status it's in, since a MoHUA
    // approval is a later, authoritative decision. No automatic-mechanism check here: Dynamic
    // Year Access is ULB-scoped (Ulb.yearAccess), never applicable to a whole-state single-
    // document source like this one. Gated by config.exemption.allowed so a non-exemptable
    // source pays zero extra query cost.
    let exemptionId: string | null = null;
    if (config.exemption?.allowed && sourceFormJson.formId !== undefined) {
      const exemption = await this.exemptionResolverService.resolveDiscretionary(
        null,
        new Types.ObjectId(ctx.designYearId),
        sourceFormJson.formId,
        ctx.stateId,
      );
      if (exemption?.currentFormStatus === DISCRETIONARY_APPROVED_STATUS) {
        exemptionId = String(exemption.requestId);
      }
    }

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
        reasonCode: exemptionId ? 'DISCRETIONARY_EXEMPTION_APPROVED' : 'SOURCE_FORM_NOT_FOUND',
        evidence,
      };
    }

    // Cast, not narrowed: this value comes from an external collection at runtime and can't be
    // statically guaranteed to be one of FormStatusType's literal members. Resolved via
    // `resolveNestedField` (not plain bracket-notation) so a dotted path like
    // `auditedData.form_status_id` works the same as a flat one.
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
      reasonCode: exemptionId
        ? 'DISCRETIONARY_EXEMPTION_APPROVED'
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

  /** SLB, Annual Accounts (Provisional/Audited): one flat document per ULB, bucketed against
   *  `acceptedFormStatuses` — same matching semantics as `evaluateFormStatus`, just bulk and
   *  ULB-scoped instead of one state-scoped document. A ULB with no document at all has nothing
   *  to accept, so it can't be eligible — no configurable default, unlike the row-collection case
   *  below, since there's no equivalent "absence isn't a problem" scenario here. */
  private async evaluateUlbBulkFormStatus(
    sourceFormJson: IFormJson,
    ctx: UlbBulkEvaluationContext,
  ): Promise<{ perUlb: Map<string, UlbEligibilityBucket>; tally: UlbEligibilityTally }> {
    const config = sourceFormJson.claimEligibility!;
    const { source } = config;
    if (!source.collection || !source.fields?.ulb) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)}'s ULB-bulk FORM_STATUS evaluator is missing source.collection/source.fields.ulb.`,
      );
    }

    const query: Record<string, unknown> = {
      [source.fields.designYear]: new Types.ObjectId(ctx.designYearId),
      // Bounds the read to exactly the ULBs this evaluation cares about — the only narrowing
      // available at all for sources with no `source.fields.state` mapping (e.g. SLB, whose
      // schema has no state field), and a further narrowing on top of `state` for the rest.
      [source.fields.ulb]: { $in: ctx.expectedUlbIds.map((id) => new Types.ObjectId(id)) },
    };
    if (source.fields.state) query[source.fields.state] = ctx.stateId;

    const docs = await this.connection
      .collection(source.collection)
      .find(query, { projection: { [source.fields.ulb]: 1, [source.fields.currentFormStatus]: 1 } })
      .toArray();

    const statusByUlbId = new Map<string, unknown>();
    for (const doc of docs) {
      const ulbValue = resolveNestedField(doc, source.fields.ulb);
      if (!ulbValue) continue;
      // Genuinely an ObjectId at runtime (the ULB-linkage field on every source this reads) —
      // cast, not a raw `unknown`, so String() has a real toString() to call.
      statusByUlbId.set(String(ulbValue as Types.ObjectId), resolveNestedField(doc, source.fields.currentFormStatus));
    }

    // Exemption lookup, gated behind config.exemption.allowed so every non-exemptable form pays
    // zero extra query cost. Automatic stays scoped to ULBs with no document at all (see
    // buildExemptionLookup's own doc-comment for why); discretionary is checked for every
    // expected ULB, since an approved MoHUA exemption overrides real data too.
    const ulbsMissingData = ctx.expectedUlbIds.filter((ulbId) => !statusByUlbId.has(ulbId));
    const exemptionLookup = await this.buildExemptionLookup(sourceFormJson, config, ctx, ulbsMissingData);

    const perUlb = new Map<string, UlbEligibilityBucket>();
    for (const ulbId of ctx.expectedUlbIds) {
      const status = statusByUlbId.get(ulbId);

      // Discretionary (MoHUA-approved) exemption always wins - a later, authoritative decision
      // that overrides whatever this document's own status says, real data or not.
      if (exemptionLookup?.discretionary.get(ulbId)) {
        perUlb.set(ulbId, 'EXEMPTED');
        continue;
      }
      // A document with the exempted stub status is always EXEMPTED, regardless of
      // acceptedFormStatuses (no admin needs to remember to add it to every form's list).
      if (status === FORM_STATUS.EXEMPTED_ACKNOWLEDGED) {
        perUlb.set(ulbId, 'EXEMPTED');
        continue;
      }
      if (status !== undefined && config.acceptedFormStatuses.includes(status as FormStatusType)) {
        perUlb.set(ulbId, 'ELIGIBLE');
        continue;
      }
      // Automatic (Dynamic Year Access) golden rule, unchanged: only a ULB with NO document at
      // all can be EXEMPTED this way - a document with any other real status is always judged on
      // that data, never re-classified.
      if (status === undefined && exemptionLookup?.automatic.get(ulbId)) {
        perUlb.set(ulbId, 'EXEMPTED');
        continue;
      }
      perUlb.set(ulbId, 'INELIGIBLE');
    }

    return { perUlb, tally: this.tallyBuckets(perUlb) };
  }

  /**
   * Bulk, read-only exemption lookup shared by evaluateUlbBulkFormStatus and
   * evaluateUlbBulkRowStatus - checks both real exemption mechanisms, kept as two SEPARATE maps
   * (not merged) because they have different precedence against a ULB's own real data:
   * - Automatic (Dynamic Year Access): golden rule, documented as a hard invariant in this
   *   folder's own CLAUDE.md - "if a real form document already exists for (ulb, year, form),
   *   none of this automatic mechanism ever touches it". So this block only ever needs to run for
   *   `ulbIdsMissingData` - one Ulb query for exactly those ULBs, then a plain map lookup per ULB.
   *   Uses YearAccessService.peekEntry (never writes) since a claim-eligibility pass over
   *   hundreds of ULBs must not materialize hundreds of yearAccess entries as a side effect.
   *   Gated by formJsonConfig.isApplicableForExemption - stays a no-op for a formId that was
   *   never opted into this mechanism, and a no-op entirely when `ulbIdsMissingData` is empty.
   * - Discretionary (STATE->MoHUA Request Exemption): a later, authoritative human decision -
   *   overrides a ULB's real data too, not just a missing document. So this block runs for every
   *   `ctx.expectedUlbIds`, gated only by config.exemption.allowed - independent of
   *   isApplicableForExemption, since a formId can have a live discretionary reason offered
   *   without ever being wired into Dynamic Year Access. A formId with no discretionary reason
   *   offered just gets an empty result back.
   * Returns null only when this source doesn't opt into exemption at all
   * (config.exemption.allowed: false), so callers can skip the whole branch cheaply.
   */
  private async buildExemptionLookup(
    sourceFormJson: IFormJson,
    config: ClaimEligibilityConfig,
    ctx: UlbBulkEvaluationContext,
    ulbIdsMissingData: string[],
  ): Promise<{ automatic: Map<string, boolean>; discretionary: Map<string, boolean> } | null> {
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

    const discretionary = new Map<string, boolean>();
    const discretionaryEntries = await this.exemptionResolverService.resolveDiscretionaryBulk(
      ctx.expectedUlbIds.map((id) => new Types.ObjectId(id)),
      new Types.ObjectId(ctx.designYearId),
      formId,
    );
    for (const [ulbId, entry] of discretionaryEntries) {
      if (entry.currentFormStatus === DISCRETIONARY_APPROVED_STATUS) {
        discretionary.set(ulbId, true);
      }
    }

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
    // own doc-comment); discretionary is checked for every expected ULB below, since an approved
    // MoHUA exemption overrides a real row too.
    const ulbsMissingRow = ctx.expectedUlbIds.filter((ulbId) => !valueByUlbId.has(ulbId));
    const exemptionLookup = await this.buildExemptionLookup(sourceFormJson, config, ctx, ulbsMissingRow);

    const perUlb = new Map<string, UlbEligibilityBucket>();
    const rowEvidenceByUlbId = new Map<string, RowEligibilityEvidence>();
    for (const ulbId of ctx.expectedUlbIds) {
      const entry = valueByUlbId.get(ulbId);

      // Discretionary (MoHUA-approved) exemption always wins, regardless of any existing row -
      // still frozen as evidence (with the real row's fields when one exists) so claim-letter
      // assembly's buildChildEligibilitySources doesn't silently fall back to the state-level
      // source's own result/reasonCode for this ULB.
      if (exemptionLookup?.discretionary.get(ulbId)) {
        perUlb.set(ulbId, 'EXEMPTED');
        rowEvidenceByUlbId.set(ulbId, {
          bucket: 'EXEMPTED',
          rowDocumentId: entry?.rowDocumentId ?? null,
          rowStatusAtEvaluation: (entry?.formStatus as FormStatusType | undefined) ?? null,
          datasetVersion: activeDatasetVersion ?? null,
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
      });
    }

    return { perUlb, tally: this.tallyBuckets(perUlb), rowEvidenceByUlbId };
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
    if (rowMatch.rowFormStatusField && rowMatch.rowAcceptedFormStatuses) {
      if (!rowMatch.rowAcceptedFormStatuses.includes(entry.formStatus as FormStatusType)) return 'INELIGIBLE';
    }
    if (rowMatch.rowExemptedValues?.some((v) => v === entry.value)) return 'EXEMPTED';
    if (rowMatch.rowEligibleValues.some((v) => v === entry.value)) return 'ELIGIBLE';
    return 'INELIGIBLE';
  }

  private tallyBuckets(perUlb: Map<string, UlbEligibilityBucket>): UlbEligibilityTally {
    let eligible = 0;
    let ineligible = 0;
    let exempted = 0;
    for (const bucket of perUlb.values()) {
      if (bucket === 'ELIGIBLE') eligible++;
      else if (bucket === 'INELIGIBLE') ineligible++;
      else exempted++;
    }
    return { eligible, ineligible, exempted, total: perUlb.size };
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
