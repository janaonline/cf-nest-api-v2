import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FormJsonService } from 'src/form-json/form-json.service';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import type {
  EligibilityEvaluationResult,
  UlbEligibilityTally,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
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

export interface ClaimLetterStateLevelGate {
  sources: EligibilityEvaluationResult[];
  passed: boolean;
}

export interface DevolutionAllocation {
  /** Crore-denominated, read directly from Devolution's own stored value — no unit conversion. */
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

export interface ClaimLetterUlbLevelEligibility {
  /** Merged verdict across every ULB-bulk-evaluable criterion (SLB, Annual Accounts x2, Elected
   *  Body row, FC Unspent row) — a ULB must be ELIGIBLE or EXEMPTED on every one, not INELIGIBLE
   *  on any, to end up `true` here. Consumed by the picker/getUlbs/buildChildren (plan Part C). */
  perUlbEligible: Map<string, boolean>;
  /** Tallies for criteria with no state-level checklist line of their own (SLB, Provisional,
   *  Audited) — there's no state action to gate on, so these surface as a separate informational
   *  block rather than a pass/fail line (plan's architecture decision). */
  standaloneCriteria: UlbCriterionSummary[];
  /** Tallies for criteria that DO already have a state-level line (Elected Body, FC Unspent),
   *  keyed by `formId` so the caller can merge each into that line's own `ulbBreakdown` rather
   *  than rendering a second, separate entry for the same requirement. */
  rowTalliesByFormId: Map<number, UlbEligibilityTally>;
  /** Display labels of every ULB-bulk criterion a ULB was bucketed INELIGIBLE on — e.g. `['Service
   *  Level Benchmarks (SLB)']` — so callers (the ULB-options picker) can tell the State specifically
   *  *which* form is blocking a given ULB instead of a single generic reason code. A ULB with no
   *  entry here (or an empty array) failed no ULB-bulk criterion. */
  perUlbFailedCriteria: Map<string, string[]>;
}

/**
 * Evaluates the State-level claim eligibility gate and resolves Devolution allocation amounts —
 * kept as two deliberately separate methods (plan §4): the gate answers "can this State claim at
 * all," allocation resolution answers "how much, per ULB." Neither branches on a hardcoded formId
 * — the gate loops generically over whatever `formjsons` documents have an enabled
 * `claimEligibility` config for this design year (today: length 1, Devolution's own entry).
 */
@Injectable()
export class ClaimLetterEligibilityService {
  constructor(
    private readonly formJsonService: FormJsonService,
    private readonly evaluator: ClaimEligibilityEvaluatorService,
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
  ) {}

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
   * has a state-level checklist line to attach to (plan's architecture decision — see
   * `ClaimLetterUlbLevelEligibility`'s own field docs). `expectedUlbIds` is a parameter, not
   * re-derived here, since callers (`getEligibilitySummary`, the ULB-options/rows services)
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
    const perUlbFailedCriteria = new Map<string, string[]>();
    const standaloneCriteria: UlbCriterionSummary[] = [];
    const rowTalliesByFormId = new Map<number, UlbEligibilityTally>();

    for (const { doc, perUlb, tally } of results) {
      const config = doc.claimEligibility!;
      const label = config.displayLabel ?? doc.type ?? 'Form';

      for (const [ulbId, bucket] of perUlb) {
        if (bucket !== 'INELIGIBLE') continue;
        perUlbEligible.set(ulbId, false);
        const failed = perUlbFailedCriteria.get(ulbId);
        if (failed) failed.push(label);
        else perUlbFailedCriteria.set(ulbId, [label]);
      }

      if (config.ownerLevel === 'ULB') {
        standaloneCriteria.push({
          displayLabel: config.displayLabel,
          displayDescription: config.displayDescription,
          tally,
        });
      } else {
        rowTalliesByFormId.set(doc.formId ?? 0, tally);
      }
    }

    return { perUlbEligible, standaloneCriteria, rowTalliesByFormId, perUlbFailedCriteria };
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
   * routed through the evaluator dispatcher (plan §4). Reads whatever Devolution form exists for
   * this State/year/installment regardless of its current status (the eligibility *gate* above is
   * what decides whether that status is acceptable) so the picker can still show last-known
   * figures even while Devolution is temporarily returned.
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
    const [totalAlreadyAcknowledged, totalClaimInProgress, totalClaimInDraft] = await Promise.all([
      this.computeClaimedAmountByStatuses(
        stateId,
        designYearId,
        installment,
        [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA],
        excludeClaimLetterId,
      ),
      this.computeClaimedAmountByStatuses(
        stateId,
        designYearId,
        installment,
        [FORM_STATUS.UNDER_REVIEW_BY_MOHUA],
        excludeClaimLetterId,
      ),
      this.computeClaimedAmountByStatuses(
        stateId,
        designYearId,
        installment,
        [FORM_STATUS.IN_PROGRESS],
        excludeClaimLetterId,
      ),
    ]);

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
