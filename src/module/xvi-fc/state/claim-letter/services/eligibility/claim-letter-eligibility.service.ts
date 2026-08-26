import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { FilterQuery, Model, Types } from 'mongoose';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import type {
  EligibilityEvaluationResult,
  RowEligibilityEvidence,
  UlbEligibilityTally,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { RedisService } from 'src/core/services/redis/redis.service';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock, ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { sumAmountsExactly } from '../../helpers/claim-letter-financial.helpers';
import { FormJsonService } from 'src/master/form-json/form-json.service';

export interface ClaimLetterStateLevelGate {
  sources: EligibilityEvaluationResult[];
  passed: boolean;
}

export interface DevolutionAllocation {
  /** Whole Rupees (no decimals), read directly from Devolution's own stored value — no unit conversion. */
  allocatedAmount: number;
  formDocumentId: string;
  rowDocumentId: string;
  datasetVersion: number;
}

export interface ClaimLetterFinancialOverview {
  /** State-wide installment pool — sum of every ULB's allocation, independent of any one batch. */
  totalInstallmentAllocation: number;
  /** Sum already claimed across this state/year/installment's other MoHUA-acknowledged batches. */
  totalAlreadyAcknowledged: number;
  /** Sum claimed across other batches currently UNDER_REVIEW_BY_MOHUA (excludes the batch named by
   *  `excludeClaimLetterId`, if any, so a batch never nets against its own claim twice). */
  totalClaimInProgress: number;
  /** Sum claimed across other non-abandoned, READY batches still IN_PROGRESS (draft) — same
   *  self-exclusion as `totalClaimInProgress`. */
  totalClaimInDraft: number;
  /** totalInstallmentAllocation − totalAlreadyAcknowledged − totalClaimInProgress − totalClaimInDraft. */
  availableToClaim: number;
}

export interface ClaimLetterClaimStatusBreakdown {
  totalAlreadyAcknowledged: number;
  totalClaimInProgress: number;
  totalClaimInDraft: number;
  availableToClaim: number;
}

export interface UlbCriterionSummary {
  displayLabel?: string;
  displayDescription?: string;
  tally: UlbEligibilityTally;
}

/** One ULB-bulk criterion a ULB failed — `type` is the formjson doc's stable machine key (e.g.
 *  `UPLOAD_CONFIG_AUDITED`), `label` is its display copy (e.g. "Audited Accounts"). Callers that
 *  need to test identity (e.g. "did this ULB fail the AFS criterion") should compare `type`, never
 *  `label` — display copy can change independent of the criterion's identity.
 *
 *  Reused (not just for failures — see `ClaimLetterUlbLevelEligibility.criteriaColumns`) as the
 *  canonical per-source shape wherever a ULB-bulk criterion needs to be identified and labelled,
 *  regardless of pass/fail. `shortLabel` is always populated (`config.shortLabel ?? label`), unlike
 *  the config's own optional field, so callers never need their own fallback. */
export interface ClaimLetterFailedCriterion {
  type: string;
  label: string;
  shortLabel: string;
}

export interface ClaimLetterUlbLevelEligibility {
  /** Merged verdict across every ULB-bulk-evaluable criterion (SLB, Annual Accounts x2, Elected
   *  Body row, FC Unspent row) — a ULB must be ELIGIBLE or EXEMPTED on every one, not INELIGIBLE
   *  on any, to end up `true` here. Consumed by the picker/getUlbs/buildChildren. */
  perUlbEligible: Map<string, boolean>;
  /** Tallies for criteria with no state-level checklist line of their own (SLB, Provisional,
   *  Audited) — there's no state action to gate on, so these surface as a separate informational
   *  block rather than a pass/fail line. */
  standaloneCriteria: UlbCriterionSummary[];
  /** Tallies for criteria that DO already have a state-level line (Elected Body, FC Unspent),
   *  keyed by `formId` so the caller can merge each into that line's own `ulbBreakdown` rather
   *  than rendering a second, separate entry for the same requirement. */
  rowTalliesByFormId: Map<number, UlbEligibilityTally>;
  /** Every ULB-bulk criterion a ULB was bucketed INELIGIBLE on — e.g. `[{type: 'SLB', label:
   *  'Service Level Benchmarks (SLB)'}]` — so callers (the ULB-options picker) can tell the State
   *  specifically *which* form is blocking a given ULB instead of a single generic reason code, and
   *  callers needing identity rather than display copy (e.g. the claim-letter document builder's
   *  Annexure 2) can test `type` directly against `criteriaColumns` below. A ULB with no entry here
   *  (or an empty array) failed no ULB-bulk criterion. */
  perUlbFailedCriteria: Map<string, ClaimLetterFailedCriterion[]>;
  /** The canonical list of every enabled ULB-bulk criterion for this state/year/installment, one
   *  entry per source *regardless of pass/fail* — unlike `perUlbFailedCriteria`, which only ever
   *  lists a criterion where at least one ULB actually failed it. This is what makes a dynamic
   *  column set (the claim-letter document builder's Annexure 2 city-conditions table) stable and
   *  complete: it always lists every active criterion, not just whichever ones happened to fail for
   *  someone in a given batch. A new/removed enabled criterion changes this list with no code
   *  change on either side. */
  criteriaColumns: ClaimLetterFailedCriterion[];
  /** Per-ULB row evidence (rowDocumentId, resolved rowStatus/datasetVersion, bucket) for
   *  FORM_AND_ROW criteria, keyed by formId then ulbId — lets `ClaimLetterAssemblyService` build
   *  each child's frozen `eligibilitySources` entry by reusing this same bulk fetch, no re-query.
   *  NOT part of the cached `*ForDisplay` shape — see `resolveUlbLevelEligibilityForDisplay`, which
   *  strips this before caching (no display consumer reads it, and caching a rowDocumentId per ULB
   *  state-wide would bloat the Redis payload for no benefit). Only the assembly pipeline, which
   *  always calls this method directly (never `*ForDisplay`), needs it. */
  rowEvidenceByFormId: Map<number, Map<string, RowEligibilityEvidence>>;
}

/**
 * Evaluates the State-level claim eligibility gate and resolves Devolution allocation amounts —
 * kept as two deliberately separate methods: the gate answers "can this State claim at all,"
 * allocation resolution answers "how much, per ULB." Neither branches on a hardcoded formId — the
 * gate loops generically over whatever `formjsons` documents have an enabled `claimEligibility`
 * config for this design year (today: length 1, Devolution's own entry).
 */
@Injectable()
export class ClaimLetterEligibilityService {
  /** How long `*ForDisplay` results may be served stale — long enough to cover a typical ULB-picker
   *  search/filter/page session, short enough that real eligibility drift surfaces promptly. */
  private static readonly DISPLAY_CACHE_TTL_SECONDS = 30;

  /** Namespaces cache keys per environment; dev and stg share the same Redis instance. */
  private readonly env: string;

  constructor(
    private readonly formJsonService: FormJsonService,
    private readonly evaluator: ClaimEligibilityEvaluatorService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly redis: RedisService,
    config: ConfigService,
    @InjectModel(DevolutionFormulaForm.name)
    private readonly devolutionFormModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly devolutionRowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name)
    private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
    @InjectModel(ClaimLetterUlbLock.name)
    private readonly ulbLockModel: Model<ClaimLetterUlbLockDocument>,
  ) {
    this.env = config.get<string>('NODE_ENV') ?? 'production';
  }

  private getStateGateCacheKey(stateId: string, designYearId: string, installment: number): string {
    return `claimLetterEligibility:${this.env}:stateGate:${stateId}:${designYearId}:${installment}`;
  }

  private getUlbLevelCacheKey(stateId: string, designYearId: string, installment: number): string {
    return `claimLetterEligibility:${this.env}:ulbLevel:${stateId}:${designYearId}:${installment}`;
  }

  /**
   * Cached, up to `DISPLAY_CACHE_TTL_SECONDS` stale — for read-only DISPLAY consumers only
   * (`eligibility-summary`, the ULB picker, the ULB-rows table). The claim-letter build/finalize
   * pipeline (`ClaimLetterAssemblyService`) is an authorization decision, not a display, and must
   * never read this cache — it calls `evaluateStateLevelGate` directly instead, so a state can
   * never build a claim against stale eligibility and `assertNoDrift`'s re-check stays meaningful.
   */
  async evaluateStateLevelGateForDisplay(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
  ): Promise<ClaimLetterStateLevelGate> {
    const key = this.getStateGateCacheKey(stateId, designYearId, installment);
    const cached = await this.redis.get(key);
    if (cached !== null) return JSON.parse(cached) as ClaimLetterStateLevelGate;

    const result = await this.evaluateStateLevelGate(stateId, designYearId, installment);
    await this.redis.set(key, JSON.stringify(result), ClaimLetterEligibilityService.DISPLAY_CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Same display-only caveat as `evaluateStateLevelGateForDisplay` — never call from the
   * build/finalize pipeline. Always evaluates (and caches) the FULL expected-ULB-set result for
   * `{stateId, designYearId, installment}` regardless of how many ULBs the caller asked about, then
   * narrows it down to `expectedUlbIds` — lets every read-only caller share one cached computation,
   * whether it wants the whole state (the picker, `eligibility-summary`) or a page/selection subset
   * (the ULB-rows table). `standaloneCriteria`/`rowTalliesByFormId` are state-wide tallies and are
   * returned unnarrowed — no caller reads them for a subset today.
   */
  async resolveUlbLevelEligibilityForDisplay(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
    expectedUlbIds: string[],
    /** Pass only when the caller has already resolved the FULL state-wide expected-ULB set (not a
     *  subset) via ExpectedUlbSetService this request — skips the redundant re-fetch below on a
     *  cache miss. Omit when the caller only holds a subset (e.g. one page of ULB-rows); this then
     *  resolves the true full set itself so the shared cache always reflects the complete state,
     *  never a partial view. */
    fullExpectedUlbIds?: string[],
  ): Promise<ClaimLetterUlbLevelEligibility> {
    const key = this.getUlbLevelCacheKey(stateId, designYearId, installment);
    const cached = await this.redis.get(key);
    if (cached !== null) {
      return this.narrowUlbLevelEligibility(this.deserializeUlbLevelEligibility(cached), expectedUlbIds);
    }

    const allExpectedUlbIds =
      fullExpectedUlbIds ?? (await this.expectedUlbSetService.resolve(stateId, designYearId)).map((u) => u.ulbId);
    const full = await this.resolveUlbLevelEligibility(stateId, designYearId, installment, allExpectedUlbIds);
    await this.redis.set(
      key,
      this.serializeUlbLevelEligibility(full),
      ClaimLetterEligibilityService.DISPLAY_CACHE_TTL_SECONDS,
    );
    return this.narrowUlbLevelEligibility(full, expectedUlbIds);
  }

  private narrowUlbLevelEligibility(
    full: ClaimLetterUlbLevelEligibility,
    expectedUlbIds: string[],
  ): ClaimLetterUlbLevelEligibility {
    const subset = new Set(expectedUlbIds);
    return {
      perUlbEligible: new Map([...full.perUlbEligible].filter(([id]) => subset.has(id))),
      standaloneCriteria: full.standaloneCriteria,
      rowTalliesByFormId: full.rowTalliesByFormId,
      perUlbFailedCriteria: new Map([...full.perUlbFailedCriteria].filter(([id]) => subset.has(id))),
      // State-wide, like standaloneCriteria/rowTalliesByFormId above — the column set doesn't vary
      // by which ULB subset is being displayed, so it's never narrowed.
      criteriaColumns: full.criteriaColumns,
      // Display-only path (this method is only called from resolveUlbLevelEligibilityForDisplay) —
      // never populated here, see the field's own docblock.
      rowEvidenceByFormId: new Map(),
    };
  }

  /** Maps aren't JSON-serializable directly — round-tripped as arrays of entries instead.
   *  `rowEvidenceByFormId` is deliberately omitted — display never reads it, and caching a
   *  rowDocumentId per ULB state-wide would bloat the payload for no benefit (see its docblock). */
  private serializeUlbLevelEligibility(value: ClaimLetterUlbLevelEligibility): string {
    return JSON.stringify({
      perUlbEligible: [...value.perUlbEligible.entries()],
      standaloneCriteria: value.standaloneCriteria,
      rowTalliesByFormId: [...value.rowTalliesByFormId.entries()],
      perUlbFailedCriteria: [...value.perUlbFailedCriteria.entries()],
      criteriaColumns: value.criteriaColumns,
    });
  }

  private deserializeUlbLevelEligibility(raw: string): ClaimLetterUlbLevelEligibility {
    const parsed = JSON.parse(raw) as {
      perUlbEligible: [string, boolean][];
      standaloneCriteria: UlbCriterionSummary[];
      rowTalliesByFormId: [number, UlbEligibilityTally][];
      perUlbFailedCriteria: [string, ClaimLetterFailedCriterion[]][];
      criteriaColumns: ClaimLetterFailedCriterion[];
    };
    return {
      perUlbEligible: new Map(parsed.perUlbEligible),
      standaloneCriteria: parsed.standaloneCriteria,
      rowTalliesByFormId: new Map(parsed.rowTalliesByFormId),
      perUlbFailedCriteria: new Map(parsed.perUlbFailedCriteria),
      criteriaColumns: parsed.criteriaColumns,
      rowEvidenceByFormId: new Map(),
    };
  }

  async evaluateStateLevelGate(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
  ): Promise<ClaimLetterStateLevelGate> {
    const enabledSources = await this.formJsonService.findEnabledClaimEligibilitySources(designYearId);
    const stateLevelSources = enabledSources.filter(
      (doc) =>
        doc.claimEligibility?.ownerLevel === 'STATE' &&
        doc.claimEligibility.applicableInstallments.includes(installment),
    );

    const stateOid = new Types.ObjectId(stateId);
    const sources = await Promise.all(
      stateLevelSources.map((doc) => this.evaluator.evaluate(doc, { stateId: stateOid, designYearId, installment })),
    );

    return { sources, passed: sources.every((s) => s.result !== 'FAILED') };
  }

  /**
   * Runs every enabled ULB-bulk-evaluable source for this design year/installment (SLB, Annual
   * Accounts x2, Elected Body row, FC Unspent row) and merges the results into one per-ULB
   * verdict, plus two differently-shaped tally lists depending on whether the criterion already
   * has a state-level checklist line to attach to (see `ClaimLetterUlbLevelEligibility`'s own
   * field docs). `expectedUlbIds` is a parameter, not re-derived here, since callers
   * (`getEligibilitySummary`, the ULB-options/rows services)
   * already resolve `ExpectedUlbSetService` themselves for other reasons — avoids a duplicate query.
   *
   * A source qualifies for ULB-bulk evaluation when either `ownerLevel === 'ULB'` (SLB, Annual
   * Accounts — no state action to gate on at all) or `evaluationLevel === 'FORM_AND_ROW'` (Elected
   * Body, FC Unspent — state-owned for the pass/fail line, but still carries a row-level tally).
   */
  async resolveUlbLevelEligibility(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
    expectedUlbIds: string[],
  ): Promise<ClaimLetterUlbLevelEligibility> {
    const enabledSources = await this.formJsonService.findEnabledClaimEligibilitySources(designYearId);
    const ulbBulkSources = enabledSources.filter(
      (doc) =>
        doc.claimEligibility?.applicableInstallments.includes(installment) &&
        (doc.claimEligibility.ownerLevel === 'ULB' || doc.claimEligibility.evaluationLevel === 'FORM_AND_ROW'),
    );

    const stateOid = new Types.ObjectId(stateId);
    const results = await Promise.all(
      ulbBulkSources.map(async (doc) => ({
        doc,
        ...(await this.evaluator.evaluateUlbBulk(doc, { stateId: stateOid, designYearId, expectedUlbIds })),
      })),
    );

    const perUlbEligible = new Map<string, boolean>(expectedUlbIds.map((id) => [id, true]));
    const perUlbFailedCriteria = new Map<string, ClaimLetterFailedCriterion[]>();
    const standaloneCriteria: UlbCriterionSummary[] = [];
    const rowTalliesByFormId = new Map<number, UlbEligibilityTally>();
    const rowEvidenceByFormId = new Map<number, Map<string, RowEligibilityEvidence>>();
    const criteriaColumns: ClaimLetterFailedCriterion[] = [];

    for (const { doc, perUlb, tally, rowEvidenceByUlbId } of results) {
      const config = doc.claimEligibility!;
      const label = config.displayLabel ?? doc.type ?? 'Form';
      const shortLabel = config.shortLabel ?? label;
      const failedCriterion: ClaimLetterFailedCriterion = { type: doc.type ?? '', label, shortLabel };
      // One entry per source, regardless of pass/fail — see the field's own docblock.
      criteriaColumns.push(failedCriterion);

      for (const [ulbId, bucket] of perUlb) {
        if (bucket !== 'INELIGIBLE') continue;
        perUlbEligible.set(ulbId, false);
        const failed = perUlbFailedCriteria.get(ulbId);
        if (failed) failed.push(failedCriterion);
        else perUlbFailedCriteria.set(ulbId, [failedCriterion]);
      }

      if (config.ownerLevel === 'ULB') {
        standaloneCriteria.push({
          displayLabel: config.displayLabel,
          displayDescription: config.displayDescription,
          tally,
        });
      } else {
        rowTalliesByFormId.set(doc.formId ?? 0, tally);
        rowEvidenceByFormId.set(doc.formId ?? 0, rowEvidenceByUlbId ?? new Map());
      }
    }

    return {
      perUlbEligible,
      standaloneCriteria,
      rowTalliesByFormId,
      perUlbFailedCriteria,
      criteriaColumns,
      rowEvidenceByFormId,
    };
  }

  /**
   * Every ULB currently locked (`ACTIVE` or `ACKNOWLEDGED`) into *some* claim-letter batch for this
   * state/year/installment — the authoritative "already claimed" set, shared by the ULB-options
   * picker (which excludes a specific batch via `excludeClaimLetterId` so that batch's own picks
   * still read as normal, pickable rows) and the final-batch completeness check (which omits
   * `excludeClaimLetterId` entirely, so a batch's own already-drafted ULBs correctly count as
   * claimed rather than remaining).
   */
  async resolveClaimedUlbIds(
    stateId: string,
    designYearId: string,
    installment: number,
    excludeClaimLetterId?: string,
  ): Promise<Set<string>> {
    const filter: FilterQuery<ClaimLetterUlbLockDocument> = {
      state: new Types.ObjectId(stateId),
      year: new Types.ObjectId(designYearId),
      installment,
      lockState: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
    };
    if (excludeClaimLetterId) filter.claimLetter = { $ne: new Types.ObjectId(excludeClaimLetterId) };

    const locks = await this.ulbLockModel.find(filter).select('ulbId').lean<{ ulbId: Types.ObjectId }[]>().exec();
    return new Set(locks.map((l) => String(l.ulbId)));
  }

  /**
   * Expected ULBs not yet locked into any batch — deliberately does NOT filter by current
   * eligibility (`perUlbEligible`): an ULB that's ineligible right now (e.g. hasn't submitted SLB
   * yet) could still become eligible later, and if the final batch submits while it sits
   * unresolved it's stranded for the rest of the installment. So "remaining" here means "not yet
   * claimed," full stop — used to block submission of the final batch (`ClaimLetterService.submit`)
   * and to drive the FE's proactive "N ULBs must be in your final batch" warning.
   */
  async resolveRemainingUlbIds(
    stateId: string,
    designYearId: string,
    installment: number,
    expectedUlbIds: string[],
  ): Promise<string[]> {
    const claimedUlbIds = await this.resolveClaimedUlbIds(stateId, designYearId, installment);
    return expectedUlbIds.filter((id) => !claimedUlbIds.has(id));
  }

  /**
   * Bulk-resolves each ULB's Installment-1 Devolution allocation — plain data resolution, never
   * routed through the evaluator dispatcher (that dispatcher is for pass/fail eligibility checks,
   * not amount lookups). Reads whatever Devolution form exists for
   * this State/year/installment regardless of its current status (the eligibility *gate* above is
   * what decides whether that status is acceptable) so the picker can still show last-known
   * figures even while Devolution is temporarily returned.
   *
   * Depends on devolution-formula's dataset-versioning invariant — filters rows by
   * `datasetVersion: form.activeDatasetVersion` below, so this is only correct as long as that
   * invariant holds. See `devolution-formula/docs/adr/0001-dataset-versioning.md` (this method is
   * listed there as an external consumer) before changing anything on either side of this read.
   */
  async resolveDevolutionAllocations(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
  ): Promise<Map<string, DevolutionAllocation>> {
    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(designYearId);

    const form = await this.devolutionFormModel
      .findOne({ state: stateOid, year: yearOid, installment })
      .select('_id activeDatasetVersion')
      .lean<{ _id: Types.ObjectId; activeDatasetVersion: number }>()
      .exec();

    const result = new Map<string, DevolutionAllocation>();
    if (!form) return result;

    // Which row-level field holds this installment's amount — resolved dynamically so this stays
    // correct once Installment 2 claims are enabled, rather than always reading installment1Amount.
    const installmentAmountField = installment === 1 ? 'installment1Amount' : 'installment2Amount';

    const rows = await this.devolutionRowModel
      .find({
        form: form._id,
        datasetVersion: form.activeDatasetVersion,
        isActive: true,
        ulbId: { $ne: null },
        [installmentAmountField]: { $gt: 0 },
      })
      .select(`ulbId ${installmentAmountField}`)
      .lean<
        { _id: Types.ObjectId; ulbId: Types.ObjectId; installment1Amount?: number; installment2Amount?: number }[]
      >()
      .exec();

    for (const row of rows) {
      result.set(String(row.ulbId), {
        allocatedAmount: row[installmentAmountField] as number,
        formDocumentId: String(form._id),
        rowDocumentId: String(row._id),
        datasetVersion: form.activeDatasetVersion,
      });
    }

    return result;
  }

  /**
   * Sum of `claimedAmount` across every ULB-child of this state/year/installment's batches whose
   * `currentFormStatus` is in `statuses` — generalized from the original acknowledged-only query so
   * "already claimed" (status 7), "claim in progress" (status 5), and "claim in draft" (status 2)
   * can all share one implementation instead of three drifting copies. `excludeClaimLetterId` omits
   * one specific batch from the sum — used when a specific batch is in view, so it never nets
   * against its own claim twice (once via this bucket, once via its own `currentSelectedClaim`).
   * `isAbandoned`/`assemblyStatus` filters matter here in a way they didn't for the old
   * acknowledged-only query: a status-7 batch is never abandoned or mid-build in practice, but
   * status 2/5 batches genuinely can be either, and must be excluded to stay correct.
   */
  async computeClaimedAmountByStatuses(
    stateId: string,
    designYearId: string,
    installment: number,
    statuses: number[],
    excludeClaimLetterId?: string,
  ): Promise<number> {
    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(designYearId);

    const matchingParents = await this.batchModel
      .find({
        state: stateOid,
        year: yearOid,
        installment,
        currentFormStatus: { $in: statuses },
        isAbandoned: false,
        assemblyStatus: 'READY',
        ...(excludeClaimLetterId ? { _id: { $ne: new Types.ObjectId(excludeClaimLetterId) } } : {}),
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    if (matchingParents.length === 0) return 0;

    const result = await this.batchUlbModel
      .aggregate<{
        _id: null;
        total: number;
      }>([
        { $match: { claimLetter: { $in: matchingParents.map((p) => p._id) } } },
        { $group: { _id: null, total: { $sum: '$claimedAmount' } } },
      ])
      .exec();
    return result[0]?.total ?? 0;
  }

  /**
   * Same three totals `getClaimStatusBreakdown` needs (acknowledged/in-review/in-draft), but in one
   * `find` + one `aggregate` instead of three of each — the three `computeClaimedAmountByStatuses`
   * calls it used to make differ only in which status they match and which parent IDs they sum
   * over, so both collapse into a single query apiece once results are bucketed by status in JS.
   */
  private async computeClaimedAmountsByStatusBuckets(
    stateId: string,
    designYearId: string,
    installment: number,
    excludeClaimLetterId?: string,
  ): Promise<{ totalAlreadyAcknowledged: number; totalClaimInProgress: number; totalClaimInDraft: number }> {
    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(designYearId);

    type Bucket = 'totalAlreadyAcknowledged' | 'totalClaimInProgress' | 'totalClaimInDraft';
    const statusToBucket: Record<number, Bucket> = {
      [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]: 'totalAlreadyAcknowledged',
      [FORM_STATUS.UNDER_REVIEW_BY_MOHUA]: 'totalClaimInProgress',
      [FORM_STATUS.IN_PROGRESS]: 'totalClaimInDraft',
    };

    const result = { totalAlreadyAcknowledged: 0, totalClaimInProgress: 0, totalClaimInDraft: 0 };

    const matchingParents = await this.batchModel
      .find({
        state: stateOid,
        year: yearOid,
        installment,
        currentFormStatus: { $in: Object.keys(statusToBucket).map(Number) },
        isAbandoned: false,
        assemblyStatus: 'READY',
        ...(excludeClaimLetterId ? { _id: { $ne: new Types.ObjectId(excludeClaimLetterId) } } : {}),
      })
      .select('_id currentFormStatus')
      .lean<{ _id: Types.ObjectId; currentFormStatus: number }[]>()
      .exec();
    if (matchingParents.length === 0) return result;

    const bucketByParentId = new Map<string, Bucket>();
    for (const parent of matchingParents) {
      const bucket = statusToBucket[parent.currentFormStatus];
      if (bucket) bucketByParentId.set(String(parent._id), bucket);
    }

    const totals = await this.batchUlbModel
      .aggregate<{
        _id: Types.ObjectId;
        total: number;
      }>([
        { $match: { claimLetter: { $in: matchingParents.map((p) => p._id) } } },
        { $group: { _id: '$claimLetter', total: { $sum: '$claimedAmount' } } },
      ])
      .exec();

    for (const { _id, total } of totals) {
      const bucket = bucketByParentId.get(String(_id));
      if (bucket) result[bucket] += total;
    }

    return result;
  }

  /**
   * Sum of `claimedAmount` across every ULB-child of this state/year/installment's OTHER
   * claim-letter batches that have already reached `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` — moved here
   * (out of `ClaimLetterAssemblyService`) so both the build pipeline and the read-only
   * eligibility-summary endpoint share one query instead of risking drift between two copies.
   */
  async computeTotalAlreadyAcknowledged(stateId: string, designYearId: string, installment: number): Promise<number> {
    return this.computeClaimedAmountByStatuses(stateId, designYearId, installment, [
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    ]);
  }

  /**
   * The four claimed/available fields of `ClaimLetterFinancialOverview`, given an already-resolved
   * `totalInstallmentAllocation` (callers already have it from `resolveDevolutionAllocations`, so it
   * isn't re-derived here). `excludeClaimLetterId` is threaded through to all three status buckets —
   * see `computeClaimedAmountByStatuses` for why that matters when a specific batch is in view.
   */
  async getClaimStatusBreakdown(
    stateId: string,
    designYearId: string,
    installment: number,
    totalInstallmentAllocation: number,
    excludeClaimLetterId?: string,
  ): Promise<ClaimLetterClaimStatusBreakdown> {
    const { totalAlreadyAcknowledged, totalClaimInProgress, totalClaimInDraft } =
      await this.computeClaimedAmountsByStatusBuckets(stateId, designYearId, installment, excludeClaimLetterId);

    return {
      totalAlreadyAcknowledged,
      totalClaimInProgress,
      totalClaimInDraft,
      availableToClaim: sumAmountsExactly([
        totalInstallmentAllocation,
        -totalAlreadyAcknowledged,
        -totalClaimInProgress,
        -totalClaimInDraft,
      ]),
    };
  }

  /**
   * State-wide financial context, independent of any one batch — the full picture of where this
   * state/year/installment's claimable pool stands (plan: claim-letter summary placement). Used by
   * the "Generate Claim Letter" list page and the "New Claim Letter" create page, both of which call
   * this via `eligibility-summary` rather than reading a batch's own (possibly stale, or entirely
   * absent) embedded snapshot. `excludeClaimLetterId` is only passed by `buildChildren()`, which
   * already has a parent `_id` to exclude itself with; the two read-only pages above call this
   * without it, since there's no "self" to exclude yet.
   */
  async getFinancialOverview(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
    excludeClaimLetterId?: string,
  ): Promise<ClaimLetterFinancialOverview> {
    const allocationByUlbId = await this.resolveDevolutionAllocations(stateId, designYearId, installment);
    const totalInstallmentAllocation = sumAmountsExactly([...allocationByUlbId.values()].map((a) => a.allocatedAmount));
    const breakdown = await this.getClaimStatusBreakdown(
      stateId,
      designYearId,
      installment,
      totalInstallmentAllocation,
      excludeClaimLetterId,
    );

    return { totalInstallmentAllocation, ...breakdown };
  }
}
