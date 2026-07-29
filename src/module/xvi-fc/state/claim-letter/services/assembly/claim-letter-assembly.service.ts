import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
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
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import {
  CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE,
  CLAIM_LETTER_MAX_BATCH_NUMBER,
} from '../../constants/claim-letter.constants';
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
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import type { ClaimLetterBatchSummary } from '../../types/claim-letter.types';

export interface ClaimLetterUlbSelectionInput {
  ulbId: string;
  /** Crore-denominated — the client's natural input unit, and also this service's storage unit. */
  claimedAmount: number;
}

export interface CreateClaimLetterDraftInput {
  stateId: string;
  yearId: string;
  installment: number;
  ulbSelections: ClaimLetterUlbSelectionInput[];
  /** Client-suppliable idempotency key; a fresh one is generated when omitted. */
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

/**
 * The claim-letter creation pipeline (plan §7) — the most concurrency-sensitive piece of this
 * feature, since a State's legally binding grant claim must never let two drafts double-claim the
 * same ULB or the same batch slot. Structured in 4 stages:
 *   1-2. One short transaction: allocate a batch number + acquire all ULB locks, all-or-nothing.
 *   3.   Chunked, non-transactional child assembly (scales to 700+ ULBs without one giant transaction).
 *   4.   Revalidate against live data, verify, and finalize BUILDING -> READY with an
 *        expected-state filter; any failure from here compensates by deleting the BUILDING
 *        parent/children and releasing only this build's own locks.
 */
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
  ) {}

  /** Thin public wrapper so every claim-letter mutating endpoint returns the same mapped
   *  `ClaimLetterBatchSummary` shape `ClaimLetterService`'s own endpoints do — the internal
   *  pipeline below is unchanged and still deals in raw documents throughout. */
  async createDraft(input: CreateClaimLetterDraftInput): Promise<ClaimLetterBatchSummary> {
    const raw = await this.createDraftRaw(input);
    return mapClaimLetterBatchDocToSummary(raw);
  }

  private async createDraftRaw(input: CreateClaimLetterDraftInput): Promise<Record<string, unknown>> {
    this.assertStateAccess(input.user, input.stateId);
    assertInstallmentSupported(input.installment);

    const ulbIds = input.ulbSelections.map((s) => s.ulbId);
    if (ulbIds.length === 0) throw new BadRequestException('At least one ULB must be selected.');
    if (new Set(ulbIds).size !== ulbIds.length) {
      throw new BadRequestException('Duplicate ULB selected — each ULB may appear only once.');
    }

    const buildRequestId = input.buildRequestId ?? randomUUID();
    if (input.buildRequestId) {
      const idempotent = await this.checkIdempotentRetry(input.buildRequestId);
      if (idempotent) return idempotent;
    }

    const stateOid = new Types.ObjectId(input.stateId);
    const yearOid = new Types.ObjectId(input.yearId);
    const userOid = new Types.ObjectId(input.user._id);

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

  // ─── Idempotent retry (plan §10) ────────────────────────────────────────────

  private async checkIdempotentRetry(buildRequestId: string): Promise<Record<string, unknown> | null> {
    const existing = await this.batchModel.findOne({ buildRequestId }).lean().exec();
    if (!existing) return null;
    if (existing.assemblyStatus === 'READY') return existing;
    throw new ConflictException(
      'A build with this idempotency key is already in progress or failed. Retry with a new key.',
    );
  }

  // ─── Steps 1-2: one transaction — allocate batch number + acquire all locks (plan §7.2) ────

  private async reserveBatchSlotAndLocks(
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
    throw new ConflictException(
      `All ${CLAIM_LETTER_MAX_BATCH_NUMBER} claim slots are already in use for this installment.`,
    );
  }

  // ─── Step 3: resolve sources + build children, chunked, not transactional (plan §7.3) ──────

  private async buildChildren(
    parent: ClaimLetterBatchDocument,
    selections: ClaimLetterUlbSelectionInput[],
    userOid: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<BuildResult> {
    const [gate, allocationByUlbId, ulbLevelEligibility] = await Promise.all([
      this.eligibilityService.evaluateStateLevelGate(String(stateOid), String(yearOid), installment as 1 | 2),
      this.eligibilityService.resolveDevolutionAllocations(String(stateOid), String(yearOid), installment as 1 | 2),
      // Re-verified here too, not just at picker time (plan §7.3) — a ULB's SLB/Annual Accounts/
      // Elected Body/FC Unspent status can change between being picked and the draft being saved.
      this.eligibilityService.resolveUlbLevelEligibility(
        String(stateOid),
        String(yearOid),
        installment as 1 | 2,
        selections.map((s) => s.ulbId),
      ),
    ]);

    if (!gate.passed) {
      const reason = gate.sources.find((s) => s.result === 'FAILED')?.reasonCode ?? 'STATE_GATE_FAILED';
      throw new BadRequestException(`State is not eligible to claim: ${reason}`);
    }

    const ulbSnapshotById = await this.resolveUlbSnapshots(
      selections.map((s) => s.ulbId),
      stateOid,
    );

    const invalid: string[] = [];
    const children: BuiltChild[] = [];

    for (const selection of selections) {
      const ulb = ulbSnapshotById.get(selection.ulbId);
      const allocation = allocationByUlbId.get(selection.ulbId);
      // Prefer a human-meaningful identifier for error reporting over the raw Mongo id — falls
      // back to the submitted ulbId only when no snapshot resolved at all (unknown/inactive ULB).
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
      if (!isClaimedAmountWithinVariance(allocation.allocatedAmount, claimedAmount)) {
        invalid.push(identifier);
        continue;
      }

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
        ),
      });
    }

    if (invalid.length > 0) {
      throw new BadRequestException(
        `The following ULBs are ineligible or have an invalid claimed amount: ${invalid.join(', ')}`,
      );
    }

    for (let i = 0; i < children.length; i += CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE) {
      const chunk = children.slice(i, i + CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE);
      await this.batchUlbModel.bulkWrite(
        chunk.map((c) => ({ insertOne: { document: c.document } })),
        { ordered: false },
      );
    }

    const totalInstallmentAllocation = sumAmountsExactly([...allocationByUlbId.values()].map((a) => a.allocatedAmount));
    // Self-excludes `parent._id` so this batch's own claim (still counted separately below via
    // `currentSelectedClaim`) never nets out of totalClaimInProgress/totalClaimInDraft twice —
    // correct regardless of whether `parent` is currently a fresh draft or an existing one being
    // re-saved (it's always excluded from whichever status bucket it currently occupies).
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
      requestedUlbIds: selections.map((s) => s.ulbId),
      children,
      gatePassed: gate.passed,
      stateEligibilitySources: gate.sources
        .filter((s) => s.result === 'PASSED' || s.result === 'EXEMPTED')
        .map((s) => this.toEligibilitySourceSnapshot(s)),
      financialSummary: {
        totalInstallmentAllocation,
        totalAlreadyAcknowledged,
        totalClaimInProgress,
        totalClaimInDraft,
        availableToClaim,
        selectedAllocation,
        currentSelectedClaim,
        // = availableToClaim − currentSelectedClaim — accounts for other concurrent batches
        // (draft/under-review), not just this state's already-acknowledged claims.
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
      eligibilitySources: [],
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

  /**
   * Only ever called on PASSED/EXEMPTED results (a FAILED result would have already blocked the
   * whole draft in buildChildren) — formDocumentId/statusAtEvaluation are null only on FAILED
   * results (see FormStatusEvidenceV1), so a null here means a real bug upstream, not a case to
   * silently paper over with a fabricated ObjectId.
   */
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

  // ─── Step 4: revalidate, verify, finalize (plan §7.5) ───────────────────────

  /** Shared by all three finalize paths (create/update/version-regen) — revalidates against
   *  live data, verifies persisted children match the build, and computes the content hash. */
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

    // TEMPORARY DIAGNOSTIC — remove once the "Child assembly is incomplete" 409 is root-caused.
    this.logger.debug(
      `[DIAG] verifyPersistedChildren: parent=${String(parent._id)} ` +
        `requestedUlbIds=${JSON.stringify(built.requestedUlbIds)} ` +
        `persistedCount=${persistedChildren.length} ` +
        `persistedUlbIds=${JSON.stringify(persistedChildren.map((c) => String(c['ulbId'])))}`,
    );

    this.assertChildrenComplete(built.requestedUlbIds, persistedChildren);
    this.assertChildrenMatchParentIdentity(persistedChildren, parent, stateOid, yearOid, installment);
    this.assertFinancialTotalsMatch(persistedChildren, built.financialSummary);
    this.assertEligibilitySourcesValid(persistedChildren);
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
        throw new ConflictException('Eligibility changed during assembly. Please retry.');
      }
    }
  }

  private assertChildrenComplete(requestedUlbIds: string[], persistedChildren: Record<string, unknown>[]): void {
    if (persistedChildren.length !== requestedUlbIds.length) {
      throw new ConflictException('Child assembly is incomplete. Please retry.');
    }
    const persistedSet = new Set(persistedChildren.map((c) => String(c['ulbId'])));
    if (persistedSet.size !== persistedChildren.length) {
      throw new ConflictException('Duplicate ULB detected during assembly. Please retry.');
    }
    for (const ulbId of requestedUlbIds) {
      if (!persistedSet.has(ulbId)) throw new ConflictException('Child assembly is incomplete. Please retry.');
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
        throw new ConflictException('Child identity mismatch detected. Please retry.');
      }
    }
  }

  private assertFinancialTotalsMatch(
    persistedChildren: Record<string, unknown>[],
    financialSummary: BuildResult['financialSummary'],
  ): void {
    const sumAllocated = sumAmountsExactly(persistedChildren.map((c) => c['allocatedAmount'] as number));
    const sumClaimed = sumAmountsExactly(persistedChildren.map((c) => c['claimedAmount'] as number));
    if (
      !amountsAreEqual(sumAllocated, financialSummary.selectedAllocation) ||
      !amountsAreEqual(sumClaimed, financialSummary.currentSelectedClaim)
    ) {
      throw new ConflictException('Financial totals mismatch detected. Please retry.');
    }
  }

  private assertEligibilitySourcesValid(persistedChildren: Record<string, unknown>[]): void {
    for (const child of persistedChildren) {
      const sources = (child['eligibilitySources'] as Array<{ result: string }> | undefined) ?? [];
      for (const source of sources) {
        if (source.result !== 'PASSED' && source.result !== 'EXEMPTED') {
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
      if (!lockedSet.has(ulbId)) throw new ConflictException('Missing lock for a selected ULB. Please retry.');
    }
  }

  // ─── PATCH .../draft: diff-based update, reusing the create machinery (plan §7.5) ───

  async updateDraft(
    claimLetterId: string,
    selections: ClaimLetterUlbSelectionInput[],
    expectedRevision: number,
    user: AuthUser,
  ): Promise<ClaimLetterBatchSummary> {
    const raw = await this.updateDraftRaw(claimLetterId, selections, expectedRevision, user);
    return mapClaimLetterBatchDocToSummary(raw);
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

    const parent = await this.batchModel.findOne({ _id: claimLetterId, assemblyStatus: 'READY' }).exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    this.assertStateAccess(user, String(parent.state));
    if (parent.currentFormStatus !== FORM_STATUS.IN_PROGRESS) {
      throw new ConflictException('Draft cannot be edited unless it is IN_PROGRESS.');
    }
    if (parent.revision !== expectedRevision) {
      throw new ConflictException('This draft was changed by someone else. Please refresh and retry.');
    }

    const stateOid = parent.state as unknown as Types.ObjectId;
    const yearOid = parent.year as unknown as Types.ObjectId;
    const installment = parent.installment;
    const userOid = new Types.ObjectId(user._id);

    const currentChildren = await this.batchUlbModel
      .find({ claimLetter: parent._id })
      .select('ulbId')
      .lean<{ ulbId: Types.ObjectId }[]>()
      .exec();
    const currentUlbIdSet = new Set(currentChildren.map((c) => String(c.ulbId)));
    const requestedUlbIdSet = new Set(ulbIds);
    const addedUlbIds = ulbIds.filter((id) => !currentUlbIdSet.has(id));
    const removedUlbIds = [...currentUlbIdSet].filter((id) => !requestedUlbIdSet.has(id));

    await this.diffLocks(parent, addedUlbIds, removedUlbIds, stateOid, yearOid, installment);

    try {
      // Children aren't required to preserve document identity across an edit (only frozen
      // claim *versions* are immutable, per plan §7.7) — delete-and-rebuild the full set is
      // simpler and safer than a true per-field diff, and also sidesteps a duplicate-key
      // collision that reusing a retained ULB's existing child document would otherwise risk.
      await this.batchUlbModel.deleteMany({ claimLetter: parent._id });
      const built = await this.buildChildren(parent, selections, userOid, stateOid, yearOid, installment);
      return await this.verifyAndFinalizeUpdate(parent, built, stateOid, yearOid, installment, expectedRevision);
    } catch (err) {
      await this.compensateUpdateFailure(
        parent._id,
        addedUlbIds,
        removedUlbIds,
        stateOid,
        yearOid,
        installment,
        parent.buildRequestId,
      );
      throw err;
    }
  }

  private async diffLocks(
    parent: ClaimLetterBatchDocument,
    addedUlbIds: string[],
    removedUlbIds: string[],
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
  ): Promise<void> {
    if (addedUlbIds.length === 0 && removedUlbIds.length === 0) return;

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      if (removedUlbIds.length > 0) {
        await this.lockModel.deleteMany(
          { claimLetter: parent._id, ulbId: { $in: removedUlbIds.map((id) => new Types.ObjectId(id)) } },
          { session },
        );
      }

      if (addedUlbIds.length > 0) {
        const sortedAdded = [...addedUlbIds].sort();
        try {
          await this.lockModel.insertMany(
            sortedAdded.map((ulbId) => ({
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
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /** Reverses a committed lock diff when the subsequent child rebuild/finalize fails. */
  private async compensateUpdateFailure(
    parentId: Types.ObjectId,
    addedUlbIds: string[],
    removedUlbIds: string[],
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    buildRequestId: string,
  ): Promise<void> {
    if (addedUlbIds.length === 0 && removedUlbIds.length === 0) return;

    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      if (addedUlbIds.length > 0) {
        await this.lockModel.deleteMany(
          { claimLetter: parentId, ulbId: { $in: addedUlbIds.map((id) => new Types.ObjectId(id)) } },
          { session },
        );
      }
      if (removedUlbIds.length > 0) {
        await this.lockModel.insertMany(
          removedUlbIds.map((ulbId) => ({
            state: stateOid,
            year: yearOid,
            installment,
            ulbId: new Types.ObjectId(ulbId),
            claimLetter: parentId,
            buildRequestId,
          })),
          { session, ordered: true },
        );
      }
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  private async verifyAndFinalizeUpdate(
    parent: ClaimLetterBatchDocument,
    built: BuildResult,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    installment: number,
    expectedRevision: number,
  ): Promise<Record<string, unknown>> {
    const { contentHash } = await this.verifyPersistedChildren(
      parent,
      built,
      stateOid,
      yearOid,
      installment,
      parent.buildRequestId,
    );

    // No history write here — draft edits are not workflow transitions (plan §9/§19.2).
    const updated = await this.batchModel
      .findOneAndUpdate(
        { _id: parent._id, currentFormStatus: FORM_STATUS.IN_PROGRESS, revision: expectedRevision },
        {
          $set: {
            ulbCount: built.requestedUlbIds.length,
            financialSummary: built.financialSummary,
            contentHash,
            contentHashVersion: CLAIM_LETTER_CONTENT_HASH_VERSION,
            stateEligibilitySources: built.stateEligibilitySources,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<Record<string, unknown> | null>()
      .exec();

    if (!updated) {
      throw new ConflictException('This draft was changed by someone else. Please refresh and retry.');
    }
    return updated;
  }

  // ─── POST .../abandon (plan §7.5) ────────────────────────────────────────────

  async abandonDraft(claimLetterId: string, user: AuthUser): Promise<ClaimLetterBatchSummary> {
    const raw = await this.abandonDraftRaw(claimLetterId, user);
    return mapClaimLetterBatchDocToSummary(raw);
  }

  private async abandonDraftRaw(claimLetterId: string, user: AuthUser): Promise<Record<string, unknown>> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    this.assertStateAccess(user, String(parent['state']));

    if (parent['isAbandoned']) return parent;
    if (parent['currentFormStatus'] !== FORM_STATUS.IN_PROGRESS) {
      throw new ConflictException('Draft cannot be abandoned unless it is IN_PROGRESS.');
    }

    const session = await this.connection.startSession();
    let updated: Record<string, unknown> | null = null;
    try {
      session.startTransaction();

      // Guard the update FIRST — only touch locks/history once we know the abandon actually
      // applies, so a concurrent status change never leaves released locks with no matching
      // status transition.
      updated = await this.batchModel
        .findOneAndUpdate(
          { _id: claimLetterId, currentFormStatus: FORM_STATUS.IN_PROGRESS, isAbandoned: false },
          { $set: { isAbandoned: true, abandonedAt: new Date(), abandonedBy: new Types.ObjectId(user._id) } },
          { new: true, session },
        )
        .lean<Record<string, unknown> | null>()
        .exec();

      if (updated) {
        // Deleted, not flagged, so the ULB is immediately selectable elsewhere (plan §7.5).
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

    // findOneAndUpdate matched nothing — a concurrent request changed status/isAbandoned first.
    const current = await this.batchModel.findById(claimLetterId).lean<Record<string, unknown> | null>().exec();
    if (current?.['isAbandoned']) return current;
    throw new ConflictException('Draft could not be abandoned. Please retry.');
  }

  // ─── Version regeneration (plan §7.6) — mechanism only, no State-facing endpoint in V1 ───

  /**
   * Ties to brain §15.8 (new version on MoHUA rejection — that flow itself is out of scope).
   * Carries forward the previous version's own ULB/amount selections but re-runs the full
   * build pipeline (fresh eligibility evaluation, fresh locks, fresh children) rather than
   * copying or mutating the previous version's documents — a superseded version stays exactly
   * as it was (plan §7.7 immutability).
   */
  async createNewVersion(previousClaimId: string, reason: string, user: AuthUser): Promise<Record<string, unknown>> {
    const previous = await this.batchModel
      .findOne({ _id: previousClaimId, assemblyStatus: 'READY' })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!previous) throw new NotFoundException(`Claim letter ${previousClaimId} not found`);
    this.assertStateAccess(user, String(previous['state']));
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

  /** Same all-or-nothing pattern as `reserveBatchSlotAndLocks` (plan §7.2), but for an explicit
   *  {batchNumber, version} pair instead of allocating the next free batch slot. A concurrent
   *  regeneration attempt racing for the same version hits the same unique index and gets a
   *  clear conflict to retry against — no auto-retry, matching the create-draft precedent. */
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

      // Atomically link predecessor -> successor — `supersedes` was already set on the new
      // parent at creation time (identity data, not workflow state); `supersededBy` on the old
      // parent is only set once the new version is provably finalized, in the same transaction.
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

  // ─── Acknowledgement lock transition (plan §7.8) — mechanism only, no caller in V1 ───

  /** Permanent database-level guarantee against a second acknowledged claim for the same
   *  State/year/installment/ULB — scoped by `claimLetter`, never the bare business key. */
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
    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      await this.batchUlbModel.deleteMany({ claimLetter: parentId }, { session });
      await this.lockModel.deleteMany({ claimLetter: parentId, buildRequestId }, { session });
      await this.batchModel.deleteOne({ _id: parentId, assemblyStatus: 'BUILDING' }, { session });
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

  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
