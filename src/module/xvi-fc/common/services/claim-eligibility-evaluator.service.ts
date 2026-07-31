import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { FormStatusType } from 'src/common/constants/form-status.constants';
import { IFormJson } from 'src/master/form-json/interfaces/form-json.interface';
import {
  CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES,
  type ClaimEligibilityRowMatchConfig,
  type EligibilityEvaluationResult,
  type FormStatusEvidenceV1,
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
  constructor(@InjectConnection() private readonly connection: Connection) {}

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
      ownerLevel: config.ownerLevel,
      evaluationLevel: config.evaluationLevel,
    };

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
        result: 'FAILED',
        reasonCode: 'SOURCE_FORM_NOT_FOUND',
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
      result: passed ? 'PASSED' : 'FAILED',
      reasonCode: passed ? 'FORM_STATUS_ACCEPTED' : `FORM_STATUS_${resolvedFormStatus}_NOT_ACCEPTED`,
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
  ): Promise<{ perUlb: Map<string, UlbEligibilityBucket>; tally: UlbEligibilityTally }> {
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

    const perUlb = new Map<string, UlbEligibilityBucket>();
    for (const ulbId of ctx.expectedUlbIds) {
      const status = statusByUlbId.get(ulbId);
      const bucket: UlbEligibilityBucket =
        status !== undefined && config.acceptedFormStatuses.includes(status as FormStatusType)
          ? 'ELIGIBLE'
          : 'INELIGIBLE';
      perUlb.set(ulbId, bucket);
    }

    return { perUlb, tally: this.tallyBuckets(perUlb) };
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
  ): Promise<{ perUlb: Map<string, UlbEligibilityBucket>; tally: UlbEligibilityTally }> {
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
      const activeDatasetVersion = parent ? resolveNestedField(parent, activeDatasetVersionField) : undefined;
      if (activeDatasetVersion !== undefined) query[rowFields['datasetVersion']] = activeDatasetVersion;
    }

    const rows = await this.connection
      .collection(source.rowCollection)
      .find(query, { projection: { [rowFields['ulb']]: 1, [rowMatch.rowStatusField]: 1 } })
      .toArray();

    const valueByUlbId = new Map<string, unknown>();
    for (const row of rows) {
      const ulbValue = resolveNestedField(row, rowFields['ulb']);
      if (!ulbValue) continue; // e.g. Elected Body's unmatched EXTRA_ULB rows, which have no ulbId
      // Genuinely an ObjectId at runtime — cast, not a raw `unknown`, so String() has a real
      // toString() to call.
      valueByUlbId.set(String(ulbValue as Types.ObjectId), resolveNestedField(row, rowMatch.rowStatusField));
    }

    const perUlb = new Map<string, UlbEligibilityBucket>();
    for (const ulbId of ctx.expectedUlbIds) {
      if (!valueByUlbId.has(ulbId)) {
        perUlb.set(ulbId, rowMatch.defaultWhenNoRow);
        continue;
      }
      perUlb.set(ulbId, this.bucketRowValue(valueByUlbId.get(ulbId), rowMatch));
    }

    return { perUlb, tally: this.tallyBuckets(perUlb) };
  }

  private bucketRowValue(value: unknown, rowMatch: ClaimEligibilityRowMatchConfig): UlbEligibilityBucket {
    if (rowMatch.rowExemptedValues?.some((v) => v === value)) return 'EXEMPTED';
    if (rowMatch.rowEligibleValues.some((v) => v === value)) return 'ELIGIBLE';
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
