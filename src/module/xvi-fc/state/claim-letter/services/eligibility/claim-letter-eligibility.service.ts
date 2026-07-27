import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FormJsonService } from 'src/form-json/form-json.service';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
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

    const rows = await this.devolutionRowModel
      .find({
        form: form._id,
        datasetVersion: form.activeDatasetVersion,
        isActive: true,
        ulbId: { $ne: null },
        installment1Amount: { $gt: 0 },
      })
      .select('ulbId installment1Amount')
      .lean<{ _id: Types.ObjectId; ulbId: Types.ObjectId; installment1Amount: number }[]>()
      .exec();

    for (const row of rows) {
      result.set(String(row.ulbId), {
        allocatedAmount: row.installment1Amount,
        formDocumentId: String(form._id),
        rowDocumentId: String(row._id),
        datasetVersion: form.activeDatasetVersion,
      });
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
    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(designYearId);

    const acknowledgedParents = await this.batchModel
      .find({
        state: stateOid,
        year: yearOid,
        installment,
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    if (acknowledgedParents.length === 0) return 0;

    const result = await this.batchUlbModel
      .aggregate<{
        _id: null;
        total: number;
      }>([
        { $match: { claimLetter: { $in: acknowledgedParents.map((p) => p._id) } } },
        { $group: { _id: null, total: { $sum: '$claimedAmount' } } },
      ])
      .exec();
    return result[0]?.total ?? 0;
  }

  /**
   * State-wide financial context, independent of any one batch — the only two `financialSummary`
   * fields that mean anything before a specific batch exists (plan: claim-letter summary
   * placement). Used by the "Generate Claim Letter" list page and the "New Claim Letter" create
   * page, both of which call this via `eligibility-summary` rather than reading a batch's own
   * (possibly stale, or entirely absent) embedded snapshot.
   */
  async getFinancialOverview(
    stateId: string,
    designYearId: string,
    installment: 1 | 2,
  ): Promise<ClaimLetterFinancialOverview> {
    const [allocationByUlbId, totalAlreadyAcknowledged] = await Promise.all([
      this.resolveDevolutionAllocations(stateId, designYearId, installment),
      this.computeTotalAlreadyAcknowledged(stateId, designYearId, installment),
    ]);

    return {
      totalInstallmentAllocation: sumAmountsExactly([...allocationByUlbId.values()].map((a) => a.allocatedAmount)),
      totalAlreadyAcknowledged,
    };
  }
}
