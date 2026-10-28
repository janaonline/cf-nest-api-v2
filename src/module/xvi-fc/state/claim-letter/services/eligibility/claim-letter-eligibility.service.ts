import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { FilterQuery, Model, Types } from 'mongoose';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import type {
  ClaimEligibilityEvaluationLevel,
  EligibilityEvaluationResult,
  RowEligibilityEvidence,
  UlbEligibilityBucket,
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
  /** Whole Rupees, as Devolution stores it. */
  allocatedAmount: number;
  formDocumentId: string;
  rowDocumentId: string;
  datasetVersion: number;
}

export interface ClaimLetterFinancialOverview {
  totalInstallmentAllocation: number;
  /** Claimed in MoHUA-acknowledged batches. */
  totalAlreadyAcknowledged: number;
  /** Claimed in batches under MoHUA review (not drafts). */
  totalClaimInProgress: number;
  totalClaimInDraft: number;
  /** Allocation minus the three claimed totals. */
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

/** A ULB-bulk criterion's identity and labels. Compare `type`, never `label`: display copy changes. */
export interface ClaimLetterFailedCriterion {
  type: string;
  label: string;
  shortLabel: string;
}

/** One ULB-bulk criterion with every ULB's bucket, for the claim letter's annexure tables. */
export interface ClaimLetterCriterionDetail {
  formId: number;
  type: string;
  label: string;
  /** `letterColumnLabel ?? displayLabel ?? type`. */
  letterColumnLabel: string;
  displayOrder: number | null;
  evaluationLevel: ClaimEligibilityEvaluationLevel;
  buckets: Map<string, UlbEligibilityBucket>;
  /** FORM_AND_ROW criteria only (empty otherwise). */
  rowEvidence: Map<string, RowEligibilityEvidence>;
  approvedExemptionUlbIds: Set<string>;
}

export interface ClaimLetterUlbLevelEligibility {
  /** False when any ULB-bulk criterion has the ULB INELIGIBLE. */
  perUlbEligible: Map<string, boolean>;
  /** Tallies for ULB-owned criteria, which have no State checklist line of their own. */
  standaloneCriteria: UlbCriterionSummary[];
  /** Tallies for State-owned FORM_AND_ROW criteria, merged into that criterion's checklist line. */
  rowTalliesByFormId: Map<number, UlbEligibilityTally>;
  /** The criteria each ULB is INELIGIBLE on, so the picker can name the blocking form. */
  perUlbFailedCriteria: Map<string, ClaimLetterFailedCriterion[]>;
  /** Every enabled ULB-bulk criterion, pass or fail. */
  criteriaColumns: ClaimLetterFailedCriterion[];
  /** FORM_AND_ROW row evidence by formId, then ulbId; assembly snapshots it on each child. Not cached:
   *  always empty from the `*ForDisplay` methods. */
  rowEvidenceByFormId: Map<number, Map<string, RowEligibilityEvidence>>;
  /** Every criterion with its per-ULB buckets, sorted by displayOrder then formId (the letter's
   *  columns). Not cached, like rowEvidenceByFormId. */
  perCriterion: ClaimLetterCriterionDetail[];
}

/**
 * The State-level gate, per-ULB criteria, Devolution allocations and claimed totals. Generic over
 * every formjson with an enabled `claimEligibility` for the design year; no formId is hardcoded.
 */
@Injectable()
export class ClaimLetterEligibilityService {
  /** Covers one ULB-picker session; short enough that real changes show promptly. */
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

  /** Cached; read-only display paths only. Create, edit, submit and the letter evaluate fresh, so no
   *  decision ever rests on stale eligibility. */
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

  /** Display-only, like evaluateStateLevelGateForDisplay. Caches the whole State's result, so every
   *  caller shares it, then narrows the per-ULB maps to `expectedUlbIds`. */
  async resolveUlbLevelEligibilityForDisplay(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
    expectedUlbIds: string[],
    /** The full State expected set, when the caller already has it (saves a fetch on a miss). */
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
      criteriaColumns: full.criteriaColumns,
      rowEvidenceByFormId: new Map(),
      perCriterion: [],
    };
  }

  /** Maps as entry arrays; rowEvidenceByFormId and perCriterion are left out (display never reads them). */
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
      perCriterion: [],
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

  /** Merges every enabled ULB-bulk source (ULB-owned, or State-owned FORM_AND_ROW with per-ULB rows)
   *  into one verdict per ULB. Callers pass the ULB ids because they have already resolved them. */
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
    const perCriterion: ClaimLetterCriterionDetail[] = [];

    for (const { doc, perUlb, tally, rowEvidenceByUlbId, approvedExemptionUlbIds } of results) {
      const config = doc.claimEligibility!;
      const label = config.displayLabel ?? doc.type ?? 'Form';
      const shortLabel = config.shortLabel ?? label;
      const failedCriterion: ClaimLetterFailedCriterion = { type: doc.type ?? '', label, shortLabel };
      criteriaColumns.push(failedCriterion);
      perCriterion.push({
        formId: doc.formId ?? 0,
        type: doc.type ?? '',
        label,
        letterColumnLabel: config.letterColumnLabel ?? label,
        displayOrder: config.displayOrder ?? null,
        evaluationLevel: config.evaluationLevel,
        buckets: perUlb,
        rowEvidence: rowEvidenceByUlbId ?? new Map<string, RowEligibilityEvidence>(),
        approvedExemptionUlbIds,
      });

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

    // Unset displayOrder sorts last (Infinity - Infinity is NaN, so formId breaks the tie).
    const order = (c: ClaimLetterCriterionDetail) => c.displayOrder ?? Infinity;
    perCriterion.sort((a, b) => order(a) - order(b) || a.formId - b.formId);

    return {
      perUlbEligible,
      standaloneCriteria,
      rowTalliesByFormId,
      perUlbFailedCriteria,
      criteriaColumns,
      rowEvidenceByFormId,
      perCriterion,
    };
  }

  /** ULBs locked in any batch. The picker excludes its own batch, so its picks stay selectable; the
   *  remaining-ULB count does not. */
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

  /** Expected ULBs in no batch, eligible or not: an ineligible ULB may still qualify before the final
   *  batch closes the installment. */
  async resolveRemainingUlbIds(
    stateId: string,
    designYearId: string,
    installment: number,
    expectedUlbIds: string[],
  ): Promise<string[]> {
    const claimedUlbIds = await this.resolveClaimedUlbIds(stateId, designYearId, installment);
    return expectedUlbIds.filter((id) => !claimedUlbIds.has(id));
  }

  /** Reads regardless of Devolution status (the gate judges it), so figures still show while the form
   *  is returned. Relies on devolution-formula/docs/adr/0001-dataset-versioning.md. */
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

  /** Claimed total over READY, non-abandoned batches in `statuses`, optionally excluding one batch. */
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

  /** The three status totals from one find and one aggregate. Abandoned and BUILDING batches are
   *  excluded, since drafts can be either. */
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

  async computeTotalAlreadyAcknowledged(stateId: string, designYearId: string, installment: number): Promise<number> {
    return this.computeClaimedAmountByStatuses(stateId, designYearId, installment, [
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    ]);
  }

  /** The claimed and available fields for an already summed allocation. `excludeClaimLetterId` keeps
   *  a batch from counting its own claim twice. */
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

  /** State-wide figures for the eligibility summary and claim context, not any batch's own snapshot. */
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
