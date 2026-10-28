import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { FORM_STATUS, isTerminalStatus } from 'src/common/constants/form-status.constants';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock, ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import type {
  EligibilityEvaluationResult,
  RowEligibilityEvidence,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import {
  CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE,
  CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES,
  CLAIM_LETTER_MAX_BATCH_NUMBER,
  CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES,
} from '../../constants/claim-letter.constants';
import { deleteBuildingParentArtifacts } from '../../helpers/claim-letter-build-cleanup.helpers';
import { assertInstallmentSupported } from '../../helpers/claim-letter-installment.helpers';
import {
  amountsAreEqual,
  buildClaimLetterFileBaseName,
  computeDifferenceAmount,
  computeDifferencePercentageBasisPoints,
  isClaimedAmountWithinVariance,
  sumAmountsExactly,
} from '../../helpers/claim-letter-financial.helpers';
import {
  computeClaimLetterContentHash,
  CLAIM_LETTER_CONTENT_HASH_VERSION,
} from '../../helpers/claim-letter-content-hash.helpers';
import { ClaimLetterEligibilityService, DevolutionAllocation } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import type { ClaimLetterBatchSummary } from '../../types/claim-letter.types';

export interface ClaimLetterUlbSelectionInput {
  ulbId: string;
  /** Whole Rupees. */
  claimedAmount: number;
}

/** Same ULBs with the same claimed amounts as the current rows (order ignored; duplicates are
 *  rejected before this runs). */
function sameSelections(selections: ClaimLetterUlbSelectionInput[], children: Record<string, unknown>[]): boolean {
  if (selections.length !== children.length) return false;
  const claimed = new Map(children.map((c) => [String(c['ulbId']), c['claimedAmount']]));
  return selections.every((s) => claimed.get(s.ulbId) === s.claimedAmount);
}

export interface CreateClaimLetterDraftInput {
  stateId: string;
  yearId: string;
  installment: number;
  ulbSelections: ClaimLetterUlbSelectionInput[];
  /** The DTO's `idempotencyKey`; generated when omitted (ADR 0001). */
  buildRequestId?: string;
  user: AuthUser;
}

interface BuiltChild {
  ulbId: string;
  document: Record<string, unknown>;
}

interface ClaimLetterUlbSnapshotLookup {
  name: string;
  censusCode: string | null;
  sbCode: string | null;
}

interface BuildResult {
  requestedUlbIds: string[];
  children: BuiltChild[];
  gatePassed: boolean;
  stateEligibilitySources: Record<string, unknown>[];
  financialSummary: {
    totalInstallmentAllocation: number;
    totalAlreadyAcknowledged: number;
    totalClaimInProgress: number;
    totalClaimInDraft: number;
    availableToClaim: number;
    selectedAllocation: number;
    currentSelectedClaim: number;
    remainingIfAcknowledged: number;
  };
}

/** Validated but not yet persisted: every business-rule check has already passed. */
interface PreparedChildren {
  requestedUlbIds: string[];
  children: BuiltChild[];
  gatePassed: boolean;
  stateEligibilitySources: Record<string, unknown>[];
  allocationByUlbId: Map<string, DevolutionAllocation>;
}

/** A conflict that may be a reclaimable stale BUILDING row, unlike live contention (ADR 0002). */
class ReclaimableConflictException extends ConflictException {}

/** Creates, edits and abandons batches; writes locks and children (recovery's stale-build cleanup only
 *  deletes them, through the shared helper). Build stages, the drift re-check and rollback:
 *  docs/adr/0002-batching-and-locks.md; retries: docs/adr/0001-idempotent-retry.md. */
@Injectable()
export class ClaimLetterAssemblyService {
  private readonly logger = new Logger(ClaimLetterAssemblyService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name)
    private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
    @InjectModel(ClaimLetterUlbLock.name)
    private readonly lockModel: Model<ClaimLetterUlbLockDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
    @InjectModel(Year.name)
    private readonly yearModel: Model<Year>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly historyService: ClaimLetterHistoryService,
    private readonly formJsonConfigService: ClaimLetterFormJsonService,
    private readonly activeBatchService: ClaimLetterActiveBatchService,
  ) {}

  /** Public methods return the mapped summary; the `*Raw` pipeline works on raw documents. */
  async createDraft(input: CreateClaimLetterDraftInput): Promise<ClaimLetterBatchSummary> {
    const raw = await this.createDraftRaw(input);
    return mapClaimLetterBatchDocToSummary(raw, input.user);
  }

  private async createDraftRaw(input: CreateClaimLetterDraftInput): Promise<Record<string, unknown>> {
    assertStateAccess(input.user, input.stateId);
    assertInstallmentSupported(input.installment);

    const ulbIds = input.ulbSelections.map((s) => s.ulbId);
    if (ulbIds.length === 0) throw new BadRequestException('At least one ULB must be selected.');
    if (new Set(ulbIds).size !== ulbIds.length) {
      throw new BadRequestException('Duplicate ULB selected — each ULB may appear only once.');
    }

    const stateOid = new Types.ObjectId(input.stateId);
    const yearOid = new Types.ObjectId(input.yearId);
    const userOid = new Types.ObjectId(input.user._id);

    const buildRequestId = input.buildRequestId ?? randomUUID();
    if (input.buildRequestId) {
      const idempotent = await this.checkIdempotentRetry(input.buildRequestId, stateOid);
      if (idempotent) return idempotent;
    }
    // Best-effort (ADR 0004): the preview / download / submit guards are the hard rule.
    await this.activeBatchService.assertCanCreate({ state: stateOid, year: yearOid, installment: input.installment });

    const parent = await this.reserveBatchSlotAndLocks(
      stateOid,
      yearOid,
      input.installment,
      ulbIds,
      buildRequestId,
      userOid,
    );

    try {
      const built = await this.buildChildren(
        parent,
        input.ulbSelections,
        userOid,
        stateOid,
        yearOid,
        input.installment,
      );
      return await this.verifyAndFinalize(parent, built, stateOid, yearOid, input.installment, userOid, buildRequestId);
    } catch (err) {
      await this.abortBuild(parent._id, buildRequestId);
      throw err;
    }
  }

  // ─── Idempotent retry (docs/adr/0001-idempotent-retry.md) ───────────────────

  /** Scoped by state too: the key is client-supplied, so alone it could return another State's batch (ADR 0001). */
  private async checkIdempotentRetry(
    buildRequestId: string,
    stateOid: Types.ObjectId,
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.batchModel.findOne({ buildRequestId, state: stateOid }).lean().exec();
    if (!existing) return null;
    if (existing.assemblyStatus === 'READY') return existing;
    throw new ConflictException(
      'A build with this idempotency key is already in progress or failed. Retry with a new key.',
    );
  }

  // ─── Steps 1-2: allocate batch number + acquire all locks (docs/adr/0002-batching-and-locks.md) ───

  /** One reclaim-and-retry on a reclaimable conflict, in a fresh session: MongoDB aborts the whole
   *  transaction on a write conflict, so the failed session cannot retry. */
  private async reserveBatchSlotAndLocks(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    ulbIds: string[],
    buildRequestId: string,
    userOid: Types.ObjectId,
  ): Promise<ClaimLetterBatchDocument> {
    try {
      return await this.attemptReserveBatchSlotAndLocks(
        stateOid,
        yearOid,
        installment,
        ulbIds,
        buildRequestId,
        userOid,
      );
    } catch (err) {
      if (!(err instanceof ReclaimableConflictException)) throw err;
      const reclaimed = await this.reclaimBlockingStaleBuilds(stateOid, yearOid, installment, ulbIds);
      if (!reclaimed) throw err; // Nothing stale: a live conflict.
      // Exactly one retry; whatever it throws is final.
      return this.attemptReserveBatchSlotAndLocks(stateOid, yearOid, installment, ulbIds, buildRequestId, userOid);
    }
  }

  private async attemptReserveBatchSlotAndLocks(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    ulbIds: string[],
    buildRequestId: string,
    userOid: Types.ObjectId,
  ): Promise<ClaimLetterBatchDocument> {
    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const batchNumber = await this.allocateBatchNumber(stateOid, yearOid, installment, session);

      const stateDoc = await this.stateModel.findById(stateOid).select('code').session(session).lean().exec();
      if (!stateDoc) throw new NotFoundException(`State ${String(stateOid)} not found`);
      const yearDoc = await this.yearModel
        .findById(yearOid)
        .select('year')
        .session(session)
        .lean<{ year: string } | null>()
        .exec();
      if (!yearDoc) throw new NotFoundException(`Year ${String(yearOid)} not found`);

      const fileBaseName = buildClaimLetterFileBaseName(
        (stateDoc as { code: string }).code,
        yearDoc.year,
        installment as 1 | 2,
      );

      let parent: ClaimLetterBatchDocument;
      try {
        [parent] = await this.batchModel.create(
          [
            {
              state: stateOid,
              year: yearOid,
              installment,
              batchNumber,
              version: 1,
              buildRequestId,
              fileBaseName,
              ulbCount: ulbIds.length,
              createdBy: userOid,
              updatedBy: userOid,
            },
          ],
          { session },
        );
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          // Live contention: the slot scan ran in this same transaction (ADR 0002).
          throw new ConflictException('This claim batch slot was just taken by another request. Please retry.');
        }
        throw err;
      }

      // Deterministic order reduces lock-contention/deadlock risk across overlapping requests.
      const sortedUlbIds = [...ulbIds].sort();
      try {
        await this.lockModel.insertMany(
          sortedUlbIds.map((ulbId) => ({
            state: stateOid,
            year: yearOid,
            installment,
            ulbId: new Types.ObjectId(ulbId),
            claimLetter: parent._id,
            buildRequestId,
          })),
          { session, ordered: true },
        );
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          throw new ReclaimableConflictException(
            'One or more selected ULBs are already locked in another active claim.',
          );
        }
        throw err;
      }

      await session.commitTransaction();
      return parent;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  private async allocateBatchNumber(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    session: ClientSession,
  ): Promise<1 | 2 | 3> {
    const used = await this.batchModel
      .find({ state: stateOid, year: yearOid, installment, isAbandoned: false })
      .select('batchNumber')
      .session(session)
      .lean<{ batchNumber: 1 | 2 | 3 }[]>()
      .exec();
    const usedSet = new Set(used.map((d) => d.batchNumber));

    for (const candidate of [1, 2, 3] as const) {
      if (!usedSet.has(candidate)) return candidate;
    }
    // Reclaimable: a stale BUILDING row holding a slot would fail every retry the same way.
    throw new ReclaimableConflictException(
      `All ${CLAIM_LETTER_MAX_BATCH_NUMBER} claim slots are already in use for this installment.`,
    );
  }

  /** Checks slot holders and ULB lock owners in one pass, since only one retry follows. Same staleness
   *  rule as the hourly sweep; returns whether anything was reclaimed. */
  private async reclaimBlockingStaleBuilds(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    ulbIds: string[],
  ): Promise<boolean> {
    const [slotOccupants, lockOwners] = await Promise.all([
      this.batchModel
        .find({ state: stateOid, year: yearOid, installment, isAbandoned: false, assemblyStatus: 'BUILDING' })
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>()
        .exec(),
      this.lockModel
        .find({
          state: stateOid,
          year: yearOid,
          installment,
          ulbId: { $in: ulbIds.map((id) => new Types.ObjectId(id)) },
        })
        .select('claimLetter')
        .lean<{ claimLetter: Types.ObjectId }[]>()
        .exec(),
    ]);
    const candidateIds = new Set(slotOccupants.map((d) => String(d._id)));
    for (const l of lockOwners) candidateIds.add(String(l.claimLetter));
    if (candidateIds.size === 0) return false;

    const staleBefore = new Date(Date.now() - CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES * 60_000);
    const staleCandidates = await this.batchModel
      .find({
        _id: { $in: [...candidateIds].map((id) => new Types.ObjectId(id)) },
        assemblyStatus: 'BUILDING',
        createdAt: { $lt: staleBefore },
      })
      .select('_id buildRequestId')
      .lean<{ _id: Types.ObjectId; buildRequestId: string }[]>()
      .exec();
    if (staleCandidates.length === 0) return false;

    for (const doc of staleCandidates) {
      this.logger.warn(`Reclaiming stale BUILDING claim-letter build ${String(doc._id)} blocking a new reservation.`);
      await this.reclaimStaleBuildArtifacts(doc._id, doc.buildRequestId);
    }
    return true;
  }

  /** Deleting nothing is success, so two requests reclaiming the same row at once is safe. */
  private async reclaimStaleBuildArtifacts(parentId: Types.ObjectId, buildRequestId: string): Promise<void> {
    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      await deleteBuildingParentArtifacts(
        { batchModel: this.batchModel, batchUlbModel: this.batchUlbModel, lockModel: this.lockModel },
        parentId,
        buildRequestId,
        session,
      );
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // ─── Step 3: resolve sources + build children, chunked, not transactional (docs/adr/0002-batching-and-locks.md) ───

  private async buildChildren(
    parent: ClaimLetterBatchDocument,
    selections: ClaimLetterUlbSelectionInput[],
    userOid: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<BuildResult> {
    const prepared = await this.prepareChildren(parent, selections, userOid, stateOid, yearOid, installment);
    await this.persistChildren(prepared.children);
    return this.finishBuildResult(parent, prepared, stateOid, yearOid, installment);
  }

  /** Validates every selection in memory and throws before any write, so a rejection never deletes anything. */
  private async prepareChildren(
    parent: ClaimLetterBatchDocument,
    selections: ClaimLetterUlbSelectionInput[],
    userOid: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<PreparedChildren> {
    const [gate, allocationByUlbId, varianceConfig] = await Promise.all([
      this.eligibilityService.evaluateStateLevelGate(String(stateOid), String(yearOid), installment as 1 | 2),
      this.eligibilityService.resolveDevolutionAllocations(String(stateOid), String(yearOid), installment as 1 | 2),
      this.formJsonConfigService.loadVarianceConfig(String(yearOid)),
    ]);

    if (!gate.passed) {
      const reason = gate.sources.find((s) => s.result === 'FAILED')?.reasonCode ?? 'STATE_GATE_FAILED';
      throw new BadRequestException(`State is not eligible to claim: ${reason}`);
    }

    // Only after the gate passes: ULB-level eligibility is the heaviest fetch here.
    const [ulbSnapshotById, ulbLevelEligibility] = await Promise.all([
      this.resolveUlbSnapshots(
        selections.map((s) => s.ulbId),
        stateOid,
      ),
      // Re-checked, not trusted from the picker: eligibility can change in between.
      this.eligibilityService.resolveUlbLevelEligibility(
        String(stateOid),
        String(yearOid),
        installment as 1 | 2,
        selections.map((s) => s.ulbId),
      ),
    ]);

    // Always PASSED/EXEMPTED once the gate passed; the result filter is defensive.
    const formAndRowSources = gate.sources.filter(
      (s) => s.evaluationLevel === 'FORM_AND_ROW' && (s.result === 'PASSED' || s.result === 'EXEMPTED'),
    );

    const invalid: string[] = [];
    const children: BuiltChild[] = [];

    for (const selection of selections) {
      const ulb = ulbSnapshotById.get(selection.ulbId);
      const allocation = allocationByUlbId.get(selection.ulbId);
      // Census / SB code in the error where known; the raw id only for an unknown or inactive ULB.
      const identifier = ulb?.censusCode ?? ulb?.sbCode ?? selection.ulbId;
      if (!ulb || !allocation) {
        invalid.push(identifier);
        continue;
      }
      if (!(ulbLevelEligibility.perUlbEligible.get(selection.ulbId) ?? true)) {
        invalid.push(identifier);
        continue;
      }
      const claimedAmount = selection.claimedAmount;
      if (
        !isClaimedAmountWithinVariance(
          allocation.allocatedAmount,
          claimedAmount,
          varianceConfig.lowerPercent,
          varianceConfig.upperPercent,
        )
      ) {
        invalid.push(identifier);
        continue;
      }

      const eligibilitySources = this.buildChildEligibilitySources(
        selection.ulbId,
        formAndRowSources,
        ulbLevelEligibility.rowEvidenceByFormId,
      );

      children.push({
        ulbId: selection.ulbId,
        document: this.buildChildDocument(
          parent,
          selection.ulbId,
          ulb,
          allocation,
          claimedAmount,
          userOid,
          stateOid,
          yearOid,
          installment,
          eligibilitySources,
        ),
      });
    }

    if (invalid.length > 0) {
      throw new BadRequestException(
        `The following ULBs are ineligible or have an invalid claimed amount: ${invalid.join(', ')}`,
      );
    }

    return {
      requestedUlbIds: selections.map((s) => s.ulbId),
      children,
      gatePassed: gate.passed,
      stateEligibilitySources: gate.sources
        .filter((s) => s.result === 'PASSED' || s.result === 'EXEMPTED')
        .map((s) => this.toEligibilitySourceSnapshot(s)),
      allocationByUlbId,
    };
  }

  /** Chunked, outside a transaction (ADR 0002); validation is done, so a failure here is infrastructure. */
  private async persistChildren(children: BuiltChild[]): Promise<void> {
    for (let i = 0; i < children.length; i += CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE) {
      const chunk = children.slice(i, i + CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE);
      await this.batchUlbModel.bulkWrite(
        chunk.map((c) => ({ insertOne: { document: c.document } })),
        { ordered: false },
      );
    }
  }

  /** Re-inserts deleted children verbatim (same `_id`s) when an update fails after the delete. */
  private async restoreChildren(snapshot: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < snapshot.length; i += CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE) {
      const chunk = snapshot.slice(i, i + CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE);
      await this.batchUlbModel.bulkWrite(
        chunk.map((document) => ({ insertOne: { document } })),
        { ordered: false },
      );
    }
  }

  private async finishBuildResult(
    parent: ClaimLetterBatchDocument,
    prepared: PreparedChildren,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<BuildResult> {
    const { children, allocationByUlbId } = prepared;
    const totalInstallmentAllocation = sumAmountsExactly([...allocationByUlbId.values()].map((a) => a.allocatedAmount));
    // Excludes this batch, whose claim is counted once, in currentSelectedClaim.
    const { totalAlreadyAcknowledged, totalClaimInProgress, totalClaimInDraft, availableToClaim } =
      await this.eligibilityService.getClaimStatusBreakdown(
        String(stateOid),
        String(yearOid),
        installment,
        totalInstallmentAllocation,
        String(parent._id),
      );
    const selectedAllocation = sumAmountsExactly(children.map((c) => c.document['allocatedAmount'] as number));
    const currentSelectedClaim = sumAmountsExactly(children.map((c) => c.document['claimedAmount'] as number));

    return {
      requestedUlbIds: prepared.requestedUlbIds,
      children,
      gatePassed: prepared.gatePassed,
      stateEligibilitySources: prepared.stateEligibilitySources,
      financialSummary: {
        totalInstallmentAllocation,
        totalAlreadyAcknowledged,
        totalClaimInProgress,
        totalClaimInDraft,
        availableToClaim,
        selectedAllocation,
        currentSelectedClaim,
        // Net of other drafts and batches under review too, not only acknowledged ones.
        remainingIfAcknowledged: sumAmountsExactly([availableToClaim, -currentSelectedClaim]),
      },
    };
  }

  private buildChildDocument(
    parent: ClaimLetterBatchDocument,
    ulbId: string,
    ulb: ClaimLetterUlbSnapshotLookup,
    allocation: DevolutionAllocation,
    claimedAmount: number,
    userOid: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    eligibilitySources: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      claimLetter: parent._id,
      state: stateOid,
      year: yearOid,
      installment,
      batchNumber: parent.batchNumber,
      version: parent.version,
      ulbId: new Types.ObjectId(ulbId),
      ulbSnapshot: { name: ulb.name, censusCode: ulb.censusCode, sbCode: ulb.sbCode },
      allocatedAmount: allocation.allocatedAmount,
      claimedAmount,
      differenceAmount: computeDifferenceAmount(allocation.allocatedAmount, claimedAmount),
      differencePercentageBasisPoints: computeDifferencePercentageBasisPoints(
        allocation.allocatedAmount,
        claimedAmount,
      ),
      devolutionSource: {
        formDocumentId: new Types.ObjectId(allocation.formDocumentId),
        rowDocumentId: new Types.ObjectId(allocation.rowDocumentId),
        datasetVersion: allocation.datasetVersion,
        allocatedAmount: allocation.allocatedAmount,
        installment,
      },
      eligibilitySources,
      appliedExemptionIds: [],
      createdBy: userOid,
      updatedBy: userOid,
    };
  }

  private async resolveUlbSnapshots(
    ulbIds: string[],
    stateOid: Types.ObjectId,
  ): Promise<Map<string, ClaimLetterUlbSnapshotLookup>> {
    const docs = await this.ulbModel
      .find({ _id: { $in: ulbIds.map((id) => new Types.ObjectId(id)) }, state: stateOid, isActive: true })
      .select('name censusCode sbCode')
      .lean<{ _id: Types.ObjectId; name: string; censusCode?: string; sbCode?: string }[]>()
      .exec();

    const map = new Map<string, ClaimLetterUlbSnapshotLookup>();
    for (const doc of docs) {
      map.set(String(doc._id), {
        name: doc.name,
        censusCode: doc.censusCode ?? null,
        sbCode: doc.sbCode ?? null,
      });
    }
    return map;
  }

  /** Only PASSED/EXEMPTED results get here, and those always have formDocumentId; a missing one is an
   *  upstream bug, so this fails rather than inventing an id. */
  private toEligibilitySourceSnapshot(result: EligibilityEvaluationResult): Record<string, unknown> {
    if (!result.formDocumentId) {
      throw new ConflictException('Cannot snapshot an eligibility result with no source document. Please retry.');
    }
    return {
      formId: result.formId,
      formJsonId: new Types.ObjectId(result.formJsonId),
      ruleVersion: result.ruleVersion,
      formType: result.formType,
      formDocumentId: new Types.ObjectId(result.formDocumentId),
      rowDocumentId: result.rowDocumentId ? new Types.ObjectId(result.rowDocumentId) : null,
      statusAtEvaluation: result.statusAtEvaluation,
      rowStatusAtEvaluation: result.rowStatusAtEvaluation ?? null,
      revision: result.revision ?? null,
      datasetVersion: result.datasetVersion ?? null,
      result: result.result,
      exemptionId: result.exemptionId ? new Types.ObjectId(result.exemptionId) : null,
      reasonCode: result.reasonCode,
      evidence: result.evidence,
    };
  }

  /** Per FORM_AND_ROW source: its State-level result plus this ULB's row evidence, both already in
   *  memory. No evidence means the source's no-row default passed the ULB. */
  private buildChildEligibilitySources(
    ulbId: string,
    formAndRowSources: EligibilityEvaluationResult[],
    rowEvidenceByFormId: Map<number, Map<string, RowEligibilityEvidence>>,
  ): Record<string, unknown>[] {
    return formAndRowSources.map((source) => {
      const evidence = rowEvidenceByFormId.get(source.formId)?.get(ulbId);
      const merged: EligibilityEvaluationResult = evidence
        ? {
            ...source,
            rowDocumentId: evidence.rowDocumentId,
            rowStatusAtEvaluation: evidence.rowStatusAtEvaluation,
            datasetVersion: evidence.datasetVersion,
            result: evidence.bucket === 'EXEMPTED' ? 'EXEMPTED' : 'PASSED',
            reasonCode: evidence.bucket === 'EXEMPTED' ? 'ROW_EXEMPTED' : 'ROW_STATUS_ACCEPTED',
          }
        : { ...source, rowDocumentId: null, rowStatusAtEvaluation: null, reasonCode: 'ROW_DEFAULT_NO_ROW' };
      return this.toEligibilitySourceSnapshot(merged);
    });
  }

  // ─── Step 4: revalidate, verify, finalize (docs/adr/0002-batching-and-locks.md) ──────────────

  /** Shared by the create, update and new-version finalize paths. */
  private async verifyPersistedChildren(
    parent: ClaimLetterBatchDocument,
    built: BuildResult,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    buildRequestId: string,
  ): Promise<{ persistedChildren: Record<string, unknown>[]; contentHash: string }> {
    await this.assertNoDrift(built, stateOid, yearOid, installment);

    const persistedChildren = await this.batchUlbModel
      .find({ claimLetter: parent._id })
      .lean<Record<string, unknown>[]>()
      .exec();

    this.assertChildrenComplete(parent._id, built.requestedUlbIds, persistedChildren);
    this.assertChildrenMatchParentIdentity(persistedChildren, parent, stateOid, yearOid, installment);
    this.assertFinancialTotalsMatch(parent._id, persistedChildren, built.financialSummary);
    this.assertEligibilitySourcesValid(parent._id, persistedChildren);
    await this.assertLocksPresent(parent._id, buildRequestId, built.requestedUlbIds);

    const contentHash = computeClaimLetterContentHash({
      state: String(stateOid),
      year: String(yearOid),
      installment: installment as 1 | 2,
      batchNumber: parent.batchNumber,
      version: parent.version,
      children: persistedChildren.map((c) => ({
        ulbId: String(c['ulbId']),
        allocatedAmount: c['allocatedAmount'] as number,
        claimedAmount: c['claimedAmount'] as number,
      })),
    });

    return { persistedChildren, contentHash };
  }

  private async verifyAndFinalize(
    parent: ClaimLetterBatchDocument,
    built: BuildResult,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    userOid: Types.ObjectId,
    buildRequestId: string,
  ): Promise<Record<string, unknown>> {
    const { contentHash } = await this.verifyPersistedChildren(
      parent,
      built,
      stateOid,
      yearOid,
      installment,
      buildRequestId,
    );

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const finalized = await this.batchModel
        .findOneAndUpdate(
          { _id: parent._id, assemblyStatus: 'BUILDING', buildRequestId },
          {
            $set: {
              assemblyStatus: 'READY',
              financialSummary: built.financialSummary,
              contentHash,
              contentHashVersion: CLAIM_LETTER_CONTENT_HASH_VERSION,
              stateEligibilitySources: built.stateEligibilitySources,
            },
          },
          { new: true, session },
        )
        .lean<Record<string, unknown> | null>()
        .exec();

      if (!finalized) {
        await session.abortTransaction();
        return this.resolveAlreadyFinalized(parent._id);
      }

      await this.historyService.recordTransition(
        {
          claimLetter: parent._id,
          state: stateOid,
          year: yearOid,
          installment: installment as 1 | 2,
          batchNumber: parent.batchNumber,
          version: parent.version,
          fromStatus: null,
          toStatus: FORM_STATUS.IN_PROGRESS,
          actionSource: 'DIRECT_STATE_REVIEW',
          changedBy: userOid,
          requestId: buildRequestId,
        },
        session,
      );

      await session.commitTransaction();
      return finalized;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  private async resolveAlreadyFinalized(parentId: Types.ObjectId): Promise<Record<string, unknown>> {
    const current = await this.batchModel.findById(parentId).lean<Record<string, unknown> | null>().exec();
    if (current && current['assemblyStatus'] === 'READY') return current;
    throw new ConflictException('Claim build could not be finalized. Please retry.');
  }

  private async assertNoDrift(
    built: BuildResult,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<void> {
    const [freshGate, freshAllocations] = await Promise.all([
      this.eligibilityService.evaluateStateLevelGate(String(stateOid), String(yearOid), installment as 1 | 2),
      this.eligibilityService.resolveDevolutionAllocations(String(stateOid), String(yearOid), installment as 1 | 2),
    ]);

    if (freshGate.passed !== built.gatePassed) {
      this.logger.warn(
        `Claim-letter build aborted: state-level eligibility gate changed mid-assembly ` +
          `(state=${String(stateOid)}, year=${String(yearOid)}, installment=${installment}).`,
      );
      throw new ConflictException('Eligibility changed during assembly. Please retry.');
    }

    for (const child of built.children) {
      const fresh = freshAllocations.get(child.ulbId);
      const used = child.document['devolutionSource'] as { rowDocumentId: Types.ObjectId; datasetVersion: number };
      if (
        !fresh ||
        fresh.allocatedAmount !== child.document['allocatedAmount'] ||
        fresh.rowDocumentId !== String(used.rowDocumentId) ||
        fresh.datasetVersion !== used.datasetVersion
      ) {
        this.logger.warn(
          `Claim-letter build aborted: devolution allocation changed mid-assembly for ULB ${child.ulbId} ` +
            `(state=${String(stateOid)}, year=${String(yearOid)}, installment=${installment}).`,
        );
        throw new ConflictException('Eligibility changed during assembly. Please retry.');
      }
    }
  }

  private assertChildrenComplete(
    claimLetterId: Types.ObjectId,
    requestedUlbIds: string[],
    persistedChildren: Record<string, unknown>[],
  ): void {
    if (persistedChildren.length !== requestedUlbIds.length) {
      this.logger.error(
        `Claim-letter ${String(claimLetterId)}: child assembly incomplete — expected ${requestedUlbIds.length} ` +
          `children, found ${persistedChildren.length}.`,
      );
      throw new ConflictException('Child assembly is incomplete. Please retry.');
    }
    const persistedSet = new Set(persistedChildren.map((c) => String(c['ulbId'])));
    if (persistedSet.size !== persistedChildren.length) {
      this.logger.error(`Claim-letter ${String(claimLetterId)}: duplicate ULB detected among persisted children.`);
      throw new ConflictException('Duplicate ULB detected during assembly. Please retry.');
    }
    for (const ulbId of requestedUlbIds) {
      if (!persistedSet.has(ulbId)) {
        this.logger.error(
          `Claim-letter ${String(claimLetterId)}: requested ULB ${ulbId} missing from persisted children.`,
        );
        throw new ConflictException('Child assembly is incomplete. Please retry.');
      }
    }
  }

  private assertChildrenMatchParentIdentity(
    persistedChildren: Record<string, unknown>[],
    parent: ClaimLetterBatchDocument,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): void {
    for (const child of persistedChildren) {
      if (
        String(child['state']) !== String(stateOid) ||
        String(child['year']) !== String(yearOid) ||
        child['installment'] !== installment ||
        child['batchNumber'] !== parent.batchNumber ||
        child['version'] !== parent.version
      ) {
        this.logger.error(
          `Claim-letter ${String(parent._id)}: child ${String(child['_id'])} identity mismatch against parent.`,
        );
        throw new ConflictException('Child identity mismatch detected. Please retry.');
      }
    }
  }

  private assertFinancialTotalsMatch(
    claimLetterId: Types.ObjectId,
    persistedChildren: Record<string, unknown>[],
    financialSummary: BuildResult['financialSummary'],
  ): void {
    const sumAllocated = sumAmountsExactly(persistedChildren.map((c) => c['allocatedAmount'] as number));
    const sumClaimed = sumAmountsExactly(persistedChildren.map((c) => c['claimedAmount'] as number));
    if (
      !amountsAreEqual(sumAllocated, financialSummary.selectedAllocation) ||
      !amountsAreEqual(sumClaimed, financialSummary.currentSelectedClaim)
    ) {
      this.logger.error(
        `Claim-letter ${String(claimLetterId)}: financial totals mismatch — ` +
          `sumAllocated=${sumAllocated} vs selectedAllocation=${financialSummary.selectedAllocation}, ` +
          `sumClaimed=${sumClaimed} vs currentSelectedClaim=${financialSummary.currentSelectedClaim}.`,
      );
      throw new ConflictException('Financial totals mismatch detected. Please retry.');
    }
  }

  private assertEligibilitySourcesValid(
    claimLetterId: Types.ObjectId,
    persistedChildren: Record<string, unknown>[],
  ): void {
    for (const child of persistedChildren) {
      const sources = (child['eligibilitySources'] as Array<{ result: string }> | undefined) ?? [];
      for (const source of sources) {
        if (source.result !== 'PASSED' && source.result !== 'EXEMPTED') {
          this.logger.error(
            `Claim-letter ${String(claimLetterId)}: child ${String(child['_id'])} has an invalid eligibility source ` +
              `result (${source.result}).`,
          );
          throw new ConflictException('Invalid eligibility source detected. Please retry.');
        }
      }
    }
  }

  private async assertLocksPresent(
    claimLetterId: Types.ObjectId,
    buildRequestId: string,
    requestedUlbIds: string[],
  ): Promise<void> {
    const locks = await this.lockModel
      .find({ claimLetter: claimLetterId, buildRequestId })
      .select('ulbId')
      .lean<{ ulbId: Types.ObjectId }[]>()
      .exec();
    const lockedSet = new Set(locks.map((l) => String(l.ulbId)));
    for (const ulbId of requestedUlbIds) {
      if (!lockedSet.has(ulbId)) {
        this.logger.error(
          `Claim-letter ${String(claimLetterId)}: missing lock for selected ULB ${ulbId} (buildRequestId=${buildRequestId}).`,
        );
        throw new ConflictException('Missing lock for a selected ULB. Please retry.');
      }
    }
  }

  // ─── PATCH .../draft: diff-based update, reusing the create machinery (docs/adr/0002-batching-and-locks.md) ───

  async updateDraft(
    claimLetterId: string,
    selections: ClaimLetterUlbSelectionInput[],
    expectedRevision: number,
    user: AuthUser,
  ): Promise<ClaimLetterBatchSummary> {
    const raw = await this.updateDraftRaw(claimLetterId, selections, expectedRevision, user);
    return mapClaimLetterBatchDocToSummary(raw, user);
  }

  private async updateDraftRaw(
    claimLetterId: string,
    selections: ClaimLetterUlbSelectionInput[],
    expectedRevision: number,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const ulbIds = selections.map((s) => s.ulbId);
    if (ulbIds.length === 0) throw new BadRequestException('At least one ULB must be selected.');
    if (new Set(ulbIds).size !== ulbIds.length) {
      throw new BadRequestException('Duplicate ULB selected — each ULB may appear only once.');
    }

    // Plain read first, so an unauthorized caller gets 403 rather than a 409 from the claim filter.
    const existing = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!existing) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, String(existing['state']));

    // Edit lock taken atomically with the status / revision check, so two concurrent PATCHes cannot
    // interleave their child rebuilds. Released on every path below.
    const editToken = randomUUID();
    const parent = await this.batchModel
      .findOneAndUpdate(
        {
          _id: claimLetterId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          revision: expectedRevision,
          // Self-expiring lease: an expired lock counts as free (ADR 0002).
          $or: [{ editLockToken: null }, { editLockAcquiredAt: { $lt: this.editLockStaleBefore() } }],
        },
        { $set: { editLockToken: editToken, editLockAcquiredAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!parent) {
      throw await this.buildUpdateClaimConflictError(claimLetterId, expectedRevision);
    }

    const stateOid = parent.state as unknown as Types.ObjectId;
    const yearOid = parent.year as unknown as Types.ObjectId;
    const installment = parent.installment;
    const userOid = new Types.ObjectId(user._id);

    // Full documents: restored verbatim if anything below fails after the delete.
    const currentChildren = await this.batchUlbModel
      .find({ claimLetter: parent._id })
      .lean<Record<string, unknown>[]>()
      .exec();

    // Nothing changed: keep the draft, its revision and the uploaded signed letter as they are.
    if (sameSelections(selections, currentChildren)) {
      await this.releaseEditLock(parent._id, editToken);
      const current = await this.batchModel.findById(parent._id).lean<Record<string, unknown> | null>().exec();
      if (!current) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
      return current;
    }

    const currentUlbIdSet = new Set(currentChildren.map((c) => String(c['ulbId'])));
    const requestedUlbIdSet = new Set(ulbIds);
    const addedUlbIds = ulbIds.filter((id) => !currentUlbIdSet.has(id));
    const removedUlbIds = [...currentUlbIdSet].filter((id) => !requestedUlbIdSet.has(id));

    // Validated before any write, so a rejection changes no lock and no child. Only the added ULBs
    // are locked here; the removed ones keep their locks until the final write (ADR 0002).
    let prepared: PreparedChildren;
    try {
      prepared = await this.prepareChildren(parent, selections, userOid, stateOid, yearOid, installment);
      await this.addLocks(parent, addedUlbIds, stateOid, yearOid, installment);
    } catch (err) {
      // addLocks rolled back its own transaction; only the edit lock is held.
      await this.releaseEditLock(parent._id, editToken);
      throw err;
    }

    try {
      // Children are deleted and rebuilt (only frozen versions are immutable, ADR 0002).
      await this.batchUlbModel.deleteMany({ claimLetter: parent._id });
      try {
        await this.persistChildren(prepared.children);
      } catch (err) {
        // Restore the old set rather than leave the draft short of children.
        await this.restoreChildren(currentChildren);
        throw err;
      }

      const built = await this.finishBuildResult(parent, prepared, stateOid, yearOid, installment);

      try {
        return await this.verifyAndFinalizeUpdate(
          parent,
          built,
          removedUlbIds,
          stateOid,
          yearOid,
          installment,
          editToken,
        );
      } catch (err) {
        // Persisted but unconfirmed: put the previous, still-valid set back.
        await this.batchUlbModel.deleteMany({ claimLetter: parent._id });
        await this.restoreChildren(currentChildren);
        throw err;
      }
    } catch (err) {
      // Undo while still holding the edit lock, so another edit never sees the half-done locks.
      try {
        await this.releaseAddedLocks(parent._id, addedUlbIds);
      } finally {
        await this.releaseEditLock(parent._id, editToken);
      }
      throw err;
    }
  }

  /** Re-reads the batch to say why the edit-lock claim did not match. */
  private async buildUpdateClaimConflictError(
    claimLetterId: string,
    expectedRevision: number,
  ): Promise<NotFoundException | ConflictException> {
    const current = await this.batchModel.findById(claimLetterId).lean<Record<string, unknown> | null>().exec();
    if (!current || current['assemblyStatus'] !== 'READY') {
      return new NotFoundException(`Claim letter ${claimLetterId} not found`);
    }
    if (current['currentFormStatus'] !== FORM_STATUS.IN_PROGRESS) {
      return new ConflictException('Draft cannot be edited unless it is IN_PROGRESS.');
    }
    if (current['editLockToken'] && this.isEditLockActive(current['editLockAcquiredAt'])) {
      return new ConflictException('This draft is currently being edited elsewhere. Please retry in a moment.');
    }
    if (current['revision'] !== expectedRevision) {
      return new ConflictException('This draft was changed by someone else. Please refresh and retry.');
    }
    return new ConflictException('This draft was changed by someone else. Please refresh and retry.');
  }

  /** Lease cutoff: a lock taken before this is free. Queries use it directly; lean docs use isEditLockActive. */
  private editLockStaleBefore(): Date {
    return new Date(Date.now() - CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES * 60_000);
  }

  private isEditLockActive(acquiredAt: unknown): boolean {
    if (!acquiredAt) return false;
    return new Date(acquiredAt as string | Date) >= this.editLockStaleBefore();
  }

  /** Token-guarded, so it never clears a later edit's lock (one taken after this lease expired). */
  private async releaseEditLock(parentId: Types.ObjectId, editToken: string): Promise<void> {
    await this.batchModel.updateOne(
      { _id: parentId, editLockToken: editToken },
      { $set: { editLockToken: null, editLockAcquiredAt: null } },
    );
  }

  /** Locks the added ULBs, all or none. Removed ULBs are released at finalize, not here. */
  private async addLocks(
    parent: ClaimLetterBatchDocument,
    addedUlbIds: string[],
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<void> {
    if (addedUlbIds.length === 0) return;

    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      try {
        await this.lockModel.insertMany(
          [...addedUlbIds].sort().map((ulbId) => ({
            state: stateOid,
            year: yearOid,
            installment,
            ulbId: new Types.ObjectId(ulbId),
            claimLetter: parent._id,
            buildRequestId: parent.buildRequestId,
          })),
          { session, ordered: true },
        );
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          throw new ConflictException('One or more selected ULBs are already locked in another active claim.');
        }
        throw err;
      }
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /** Undoes addLocks after a failed edit. The removed ULBs' locks were never released. */
  private async releaseAddedLocks(parentId: Types.ObjectId, addedUlbIds: string[]): Promise<void> {
    if (addedUlbIds.length === 0) return;
    this.logger.warn(
      `Releasing ${addedUlbIds.length} added lock(s) after a failed claim-letter update for ${String(parentId)}.`,
    );
    await this.lockModel.deleteMany({
      claimLetter: parentId,
      ulbId: { $in: addedUlbIds.map((id) => new Types.ObjectId(id)) },
    });
  }

  private async verifyAndFinalizeUpdate(
    parent: ClaimLetterBatchDocument,
    built: BuildResult,
    removedUlbIds: string[],
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    editToken: string,
  ): Promise<Record<string, unknown>> {
    const { contentHash } = await this.verifyPersistedChildren(
      parent,
      built,
      stateOid,
      yearOid,
      installment,
      parent.buildRequestId,
    );

    // The draft write and the release of the removed ULBs' locks commit together, so a removed ULB
    // is never free while the edit can still fail (ADR 0002). The edit token stands in for the
    // revision guard (abandon and submit refuse while it is held) and is cleared in the same write.
    // No history row: edits are not transitions (ADR 0003).
    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      const updated = await this.batchModel
        .findOneAndUpdate(
          { _id: parent._id, currentFormStatus: FORM_STATUS.IN_PROGRESS, editLockToken: editToken },
          {
            $set: {
              ulbCount: built.requestedUlbIds.length,
              financialSummary: built.financialSummary,
              contentHash,
              contentHashVersion: CLAIM_LETTER_CONTENT_HASH_VERSION,
              stateEligibilitySources: built.stateEligibilitySources,
              editLockToken: null,
              editLockAcquiredAt: null,
              // The uploaded signed letter no longer matches the edited ULBs (ADR 0003).
              signedClaimFile: null,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<Record<string, unknown> | null>()
        .exec();
      if (!updated) {
        // Only if the lease expired mid-update and another edit took the lock, or after a manual DB change.
        throw new ConflictException('This draft was changed by someone else. Please refresh and retry.');
      }
      if (removedUlbIds.length > 0) {
        await this.lockModel.deleteMany(
          { claimLetter: parent._id, ulbId: { $in: removedUlbIds.map((id) => new Types.ObjectId(id)) } },
          { session },
        );
      }
      await session.commitTransaction();
      return updated;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // ─── POST .../abandon (docs/adr/0002-batching-and-locks.md) ─────────────────

  async abandonDraft(claimLetterId: string, user: AuthUser): Promise<ClaimLetterBatchSummary> {
    const raw = await this.abandonDraftRaw(claimLetterId, user);
    return mapClaimLetterBatchDocToSummary(raw, user);
  }

  private async abandonDraftRaw(claimLetterId: string, user: AuthUser): Promise<Record<string, unknown>> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, String(parent['state']));

    if (parent['isAbandoned']) return parent;
    if (parent['currentFormStatus'] !== FORM_STATUS.IN_PROGRESS) {
      throw new ConflictException('Draft cannot be abandoned unless it is IN_PROGRESS.');
    }

    const session = await this.connection.startSession();
    let updated: Record<string, unknown> | null = null;
    try {
      session.startTransaction();

      // Status first: locks and history change only once the abandon is known to apply.
      updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterId,
            currentFormStatus: FORM_STATUS.IN_PROGRESS,
            isAbandoned: false,
            // Same self-expiring lease as updateDraftRaw.
            $or: [{ editLockToken: null }, { editLockAcquiredAt: { $lt: this.editLockStaleBefore() } }],
          },
          { $set: { isAbandoned: true, abandonedAt: new Date(), abandonedBy: new Types.ObjectId(user._id) } },
          { new: true, session },
        )
        .lean<Record<string, unknown> | null>()
        .exec();

      if (updated) {
        // Deleted, not flagged, so the ULB is immediately selectable elsewhere.
        await this.lockModel.deleteMany({ claimLetter: parent['_id'], lockState: 'ACTIVE' }, { session });
        await this.historyService.recordTransition(
          {
            claimLetter: updated['_id'] as Types.ObjectId,
            state: updated['state'] as Types.ObjectId,
            year: updated['year'] as Types.ObjectId,
            installment: updated['installment'] as 1 | 2,
            batchNumber: updated['batchNumber'] as 1 | 2 | 3,
            version: updated['version'] as number,
            fromStatus: FORM_STATUS.IN_PROGRESS,
            toStatus: FORM_STATUS.IN_PROGRESS,
            actionSource: 'DIRECT_STATE_REVIEW',
            reason: 'ABANDONED_BY_STATE',
            changedBy: new Types.ObjectId(user._id),
            requestId: randomUUID(),
          },
          session,
        );
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    if (updated) return updated;

    // Matched nothing: a concurrent status change, or an updateDraft holding the edit lock.
    const current = await this.batchModel.findById(claimLetterId).lean<Record<string, unknown> | null>().exec();
    if (current?.['isAbandoned']) return current;
    if (current?.['editLockToken'] && this.isEditLockActive(current['editLockAcquiredAt'])) {
      throw new ConflictException('This draft is currently being edited. Please retry in a moment.');
    }
    throw new ConflictException('Draft could not be abandoned. Please retry.');
  }

  // ─── Version regeneration - mechanism only, no caller in V1 (docs/adr/0003-workflow-transitions.md) ───

  /** For the future MoHUA-rejection flow: rebuilds the previous version's selections through the full
   *  pipeline and never modifies the previous version (ADR 0002). */
  async createNewVersion(previousClaimId: string, reason: string, user: AuthUser): Promise<Record<string, unknown>> {
    const previous = await this.batchModel
      .findOne({ _id: previousClaimId, assemblyStatus: 'READY' })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!previous) throw new NotFoundException(`Claim letter ${previousClaimId} not found`);
    assertStateAccess(user, String(previous['state']));
    if (previous['isAbandoned']) {
      throw new ConflictException('Cannot regenerate a version for an abandoned draft.');
    }
    if (isTerminalStatus(previous['currentFormStatus'] as number)) {
      throw new ConflictException('Cannot regenerate a version for a claim that has reached a terminal status.');
    }

    const stateOid = previous['state'] as Types.ObjectId;
    const yearOid = previous['year'] as Types.ObjectId;
    const installment = previous['installment'] as number;
    const batchNumber = previous['batchNumber'] as 1 | 2 | 3;
    const previousVersion = previous['version'] as number;
    const previousId = previous['_id'] as Types.ObjectId;
    const userOid = new Types.ObjectId(user._id);

    const previousChildren = await this.batchUlbModel
      .find({ claimLetter: previousId })
      .select('ulbId claimedAmount')
      .lean<{ ulbId: Types.ObjectId; claimedAmount: number }[]>()
      .exec();
    if (previousChildren.length === 0) {
      throw new ConflictException('Previous claim version has no ULBs to carry forward.');
    }
    const selections: ClaimLetterUlbSelectionInput[] = previousChildren.map((c) => ({
      ulbId: String(c.ulbId),
      claimedAmount: c.claimedAmount,
    }));

    const buildRequestId = randomUUID();
    const nextVersion = previousVersion + 1;

    const parent = await this.reserveVersionSlotAndLocks(
      stateOid,
      yearOid,
      installment,
      batchNumber,
      nextVersion,
      previousId,
      selections.map((s) => s.ulbId),
      buildRequestId,
      userOid,
    );

    try {
      const built = await this.buildChildren(parent, selections, userOid, stateOid, yearOid, installment);
      return await this.verifyAndFinalizeVersion(
        parent,
        built,
        stateOid,
        yearOid,
        installment,
        userOid,
        buildRequestId,
        previousId,
        reason,
      );
    } catch (err) {
      await this.abortBuild(parent._id, buildRequestId);
      throw err;
    }
  }

  /** Like attemptReserveBatchSlotAndLocks for a given {batchNumber, version}; a racing regeneration
   *  hits the unique index and gets a conflict, with no reclaim-and-retry. */
  private async reserveVersionSlotAndLocks(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    batchNumber: 1 | 2 | 3,
    version: number,
    previousId: Types.ObjectId,
    ulbIds: string[],
    buildRequestId: string,
    userOid: Types.ObjectId,
  ): Promise<ClaimLetterBatchDocument> {
    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const stateDoc = await this.stateModel.findById(stateOid).select('code').session(session).lean().exec();
      if (!stateDoc) throw new NotFoundException(`State ${String(stateOid)} not found`);
      const yearDoc = await this.yearModel
        .findById(yearOid)
        .select('year')
        .session(session)
        .lean<{ year: string } | null>()
        .exec();
      if (!yearDoc) throw new NotFoundException(`Year ${String(yearOid)} not found`);

      const fileBaseName = buildClaimLetterFileBaseName(
        (stateDoc as { code: string }).code,
        yearDoc.year,
        installment as 1 | 2,
      );

      let parent: ClaimLetterBatchDocument;
      try {
        [parent] = await this.batchModel.create(
          [
            {
              state: stateOid,
              year: yearOid,
              installment,
              batchNumber,
              version,
              buildRequestId,
              fileBaseName,
              ulbCount: ulbIds.length,
              supersedes: previousId,
              createdBy: userOid,
              updatedBy: userOid,
            },
          ],
          { session },
        );
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          throw new ConflictException(
            'This claim was already regenerated into a newer version by another request. Please retry against the current version.',
          );
        }
        throw err;
      }

      const sortedUlbIds = [...ulbIds].sort();
      try {
        await this.lockModel.insertMany(
          sortedUlbIds.map((ulbId) => ({
            state: stateOid,
            year: yearOid,
            installment,
            ulbId: new Types.ObjectId(ulbId),
            claimLetter: parent._id,
            buildRequestId,
          })),
          { session, ordered: true },
        );
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          throw new ConflictException('One or more selected ULBs are already locked in another active claim.');
        }
        throw err;
      }

      await session.commitTransaction();
      return parent;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  private async verifyAndFinalizeVersion(
    parent: ClaimLetterBatchDocument,
    built: BuildResult,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    userOid: Types.ObjectId,
    buildRequestId: string,
    previousId: Types.ObjectId,
    reason: string,
  ): Promise<Record<string, unknown>> {
    const { contentHash } = await this.verifyPersistedChildren(
      parent,
      built,
      stateOid,
      yearOid,
      installment,
      buildRequestId,
    );

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const finalized = await this.batchModel
        .findOneAndUpdate(
          { _id: parent._id, assemblyStatus: 'BUILDING', buildRequestId },
          {
            $set: {
              assemblyStatus: 'READY',
              financialSummary: built.financialSummary,
              contentHash,
              contentHashVersion: CLAIM_LETTER_CONTENT_HASH_VERSION,
              stateEligibilitySources: built.stateEligibilitySources,
            },
          },
          { new: true, session },
        )
        .lean<Record<string, unknown> | null>()
        .exec();

      if (!finalized) {
        await session.abortTransaction();
        return this.resolveAlreadyFinalized(parent._id);
      }

      // `supersedes` was set at creation; `supersededBy` only now, once the new version is final.
      await this.batchModel.updateOne({ _id: previousId }, { $set: { supersededBy: parent._id } }, { session });

      await this.historyService.recordTransition(
        {
          claimLetter: parent._id,
          state: stateOid,
          year: yearOid,
          installment: installment as 1 | 2,
          batchNumber: parent.batchNumber,
          version: parent.version,
          fromStatus: null,
          toStatus: FORM_STATUS.IN_PROGRESS,
          actionSource: 'DIRECT_STATE_REVIEW',
          reason,
          changedBy: userOid,
          requestId: buildRequestId,
        },
        session,
      );

      await session.commitTransaction();
      return finalized;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // ─── Acknowledgement lock transition - mechanism only, no caller in V1 (docs/adr/0003-workflow-transitions.md) ───

  /** Scoped by `claimLetter`, never the bare business key. */
  async acknowledgeLocks(claimLetterId: string | Types.ObjectId, session?: ClientSession): Promise<void> {
    const claimLetter = typeof claimLetterId === 'string' ? new Types.ObjectId(claimLetterId) : claimLetterId;
    await this.lockModel.updateMany(
      { claimLetter, lockState: 'ACTIVE' },
      { $set: { lockState: 'ACKNOWLEDGED' } },
      { session },
    );
  }

  // ─── Compensating rollback ───────────────────────────────────────────────────

  private async abortBuild(parentId: Types.ObjectId, buildRequestId: string): Promise<void> {
    this.logger.warn(
      `Aborting claim-letter build ${String(parentId)} (buildRequestId=${buildRequestId}) — rolling back children/locks/parent.`,
    );
    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      await deleteBuildingParentArtifacts(
        { batchModel: this.batchModel, batchUlbModel: this.batchUlbModel, lockModel: this.lockModel },
        parentId,
        buildRequestId,
        session,
      );
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  private isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const code = (err as { code?: unknown }).code;
    if (code === 11000) return true;
    const writeErrors = (err as { writeErrors?: Array<{ code?: unknown }> }).writeErrors;
    return Array.isArray(writeErrors) && writeErrors.some((w) => w.code === 11000);
  }
}
