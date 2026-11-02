import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { FilterQuery, Model, Types } from 'mongoose';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import {
  DISCRETIONARY_PENDING_STATUS,
  DISCRETIONARY_REJECTED_STATUS,
} from 'src/module/xvi-fc/common/services/exemption-resolver.service';
import type {
  ClaimEligibilityEvaluationLevel,
  ClaimEligibilityOwnerLevel,
  EligibilityEvaluationResult,
  FormEligibilityEvidence,
  RowEligibilityEvidence,
  UlbEligibilityBucket,
  UlbEligibilityTally,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
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

/** A discretionary exemption worth flagging on a ULB's row: one under MoHUA review (it counts), or a
 *  rejected one the ULB now fails on. `label` is the criterion's short label. */
export interface ClaimLetterExemptionNote {
  label: string;
  status: 'UNDER_REVIEW' | 'REJECTED';
}

/** One ULB-bulk criterion with every ULB's bucket, for the claim letter's annexure tables. */
export interface ClaimLetterCriterionDetail {
  formId: number;
  type: string;
  label: string;
  /** `letterColumnLabel ?? displayLabel ?? type`. */
  letterColumnLabel: string;
  displayOrder: number | null;
  formJsonId: string;
  ruleVersion: number;
  ownerLevel: ClaimEligibilityOwnerLevel;
  evaluationLevel: ClaimEligibilityEvaluationLevel;
  acceptedFormStatuses: FormStatusType[];
  buckets: Map<string, UlbEligibilityBucket>;
  /** FORM_AND_ROW criteria only (empty otherwise). */
  rowEvidence: Map<string, RowEligibilityEvidence>;
  /** ULB-owned criteria only (empty otherwise): each ULB's document and exemption, for the snapshot. */
  formEvidence: Map<string, FormEligibilityEvidence>;
  /** Discretionary request status by ULB: 5 under review, 6 rejected, 7 approved. */
  discretionaryExemptions: Map<string, number>;
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
  /** Exemptions under review or rejected, by ULB, for the row badges. */
  perUlbExemptionNotes: Map<string, ClaimLetterExemptionNote[]>;
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
  /** One display build per cache key at a time (this process), so requests made together on a cold
   *  cache (the detail page loads the claim and its ULB rows at once) share one State-wide build. */
  private readonly displayBuilds = new Map<string, Promise<unknown>>();

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

    return this.shareDisplayBuild(key, async () => {
      const result = await this.evaluateStateLevelGate(stateId, designYearId, installment);
      await this.redis.set(key, JSON.stringify(result), ClaimLetterEligibilityService.DISPLAY_CACHE_TTL_SECONDS);
      return result;
    });
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

    const full = await this.shareDisplayBuild(key, async () => {
      const allExpectedUlbIds =
        fullExpectedUlbIds ?? (await this.expectedUlbSetService.resolve(stateId, designYearId)).map((u) => u.ulbId);
      const built = await this.resolveUlbLevelEligibility(stateId, designYearId, installment, allExpectedUlbIds);
      await this.redis.set(
        key,
        this.serializeUlbLevelEligibility(built),
        ClaimLetterEligibilityService.DISPLAY_CACHE_TTL_SECONDS,
      );
      return built;
    });
    return this.narrowUlbLevelEligibility(full, expectedUlbIds);
  }

  private shareDisplayBuild<T>(key: string, build: () => Promise<T>): Promise<T> {
    let pending = this.displayBuilds.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = build().finally(() => this.displayBuilds.delete(key));
      this.displayBuilds.set(key, pending);
    }
    return pending;
  }

  /** This batch's ULBs relying on an exemption still under MoHUA review. Display only (cached). */
  async countBatchUlbsWithExemptionUnderReview(
    claimLetterId: Types.ObjectId,
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
  ): Promise<number> {
    const children = await this.batchUlbModel
      .find({ claimLetter: claimLetterId })
      .select('ulbId')
      .lean<{ ulbId: Types.ObjectId }[]>()
      .exec();
    if (children.length === 0) return 0;
    const ulbIds = children.map((c) => String(c.ulbId));
    const { perUlbExemptionNotes } = await this.resolveUlbLevelEligibilityForDisplay(
      stateId,
      designYearId,
      installment,
      ulbIds,
    );
    return ulbIds.filter((id) => perUlbExemptionNotes.get(id)?.some((n) => n.status === 'UNDER_REVIEW')).length;
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
      perUlbExemptionNotes: new Map([...full.perUlbExemptionNotes].filter(([id]) => subset.has(id))),
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
      perUlbExemptionNotes: [...value.perUlbExemptionNotes.entries()],
    });
  }

  private deserializeUlbLevelEligibility(raw: string): ClaimLetterUlbLevelEligibility {
    const parsed = JSON.parse(raw) as {
      perUlbEligible: [string, boolean][];
      standaloneCriteria: UlbCriterionSummary[];
      rowTalliesByFormId: [number, UlbEligibilityTally][];
      perUlbFailedCriteria: [string, ClaimLetterFailedCriterion[]][];
      /** Absent in an entry cached before this field existed (30-second TTL). */
      perUlbExemptionNotes?: [string, ClaimLetterExemptionNote[]][];
    };
    return {
      perUlbEligible: new Map(parsed.perUlbEligible),
      standaloneCriteria: parsed.standaloneCriteria,
      rowTalliesByFormId: new Map(parsed.rowTalliesByFormId),
      perUlbFailedCriteria: new Map(parsed.perUlbFailedCriteria),
      perUlbExemptionNotes: new Map(parsed.perUlbExemptionNotes ?? []),
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
    const perUlbExemptionNotes = new Map<string, ClaimLetterExemptionNote[]>();
    const standaloneCriteria: UlbCriterionSummary[] = [];
    const rowTalliesByFormId = new Map<number, UlbEligibilityTally>();
    const rowEvidenceByFormId = new Map<number, Map<string, RowEligibilityEvidence>>();
    const perCriterion: ClaimLetterCriterionDetail[] = [];

    for (const {
      doc,
      perUlb,
      tally,
      rowEvidenceByUlbId,
      formEvidenceByUlbId,
      discretionaryExemptionStatusByUlbId,
    } of results) {
      const config = doc.claimEligibility!;
      const label = config.displayLabel ?? doc.type ?? 'Form';
      const shortLabel = config.shortLabel ?? label;
      const failedCriterion: ClaimLetterFailedCriterion = { type: doc.type ?? '', label, shortLabel };
      perCriterion.push({
        formId: doc.formId ?? 0,
        type: doc.type ?? '',
        label,
        letterColumnLabel: config.letterColumnLabel ?? label,
        displayOrder: config.displayOrder ?? null,
        formJsonId: String(doc._id),
        ruleVersion: config.ruleVersion,
        ownerLevel: config.ownerLevel,
        evaluationLevel: config.evaluationLevel,
        acceptedFormStatuses: config.acceptedFormStatuses,
        buckets: perUlb,
        rowEvidence: rowEvidenceByUlbId ?? new Map<string, RowEligibilityEvidence>(),
        formEvidence: formEvidenceByUlbId ?? new Map<string, FormEligibilityEvidence>(),
        discretionaryExemptions: discretionaryExemptionStatusByUlbId,
      });

      for (const [ulbId, bucket] of perUlb) {
        if (bucket !== 'INELIGIBLE') continue;
        perUlbEligible.set(ulbId, false);
        const failed = perUlbFailedCriteria.get(ulbId);
        if (failed) failed.push(failedCriterion);
        else perUlbFailedCriteria.set(ulbId, [failedCriterion]);
      }

      for (const [ulbId, status] of discretionaryExemptionStatusByUlbId) {
        const bucket = perUlb.get(ulbId);
        const noteStatus =
          status === DISCRETIONARY_PENDING_STATUS && bucket === 'EXEMPTED'
            ? 'UNDER_REVIEW'
            : status === DISCRETIONARY_REJECTED_STATUS && bucket === 'INELIGIBLE'
              ? 'REJECTED'
              : null;
        if (!noteStatus) continue;
        const note: ClaimLetterExemptionNote = { label: shortLabel, status: noteStatus };
        const notes = perUlbExemptionNotes.get(ulbId);
        if (notes) notes.push(note);
        else perUlbExemptionNotes.set(ulbId, [note]);
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
      perUlbExemptionNotes,
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
