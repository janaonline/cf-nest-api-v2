import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { S3Service } from 'src/core/s3/s3.service';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock, ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import {
  CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES,
  CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES,
} from '../../constants/claim-letter.constants';
import { deleteBuildingParentArtifacts } from '../../helpers/claim-letter-build-cleanup.helpers';
import { amountsAreEqual } from '../../helpers/claim-letter-financial.helpers';
import type { ClaimLetterFinancialSummaryDisplay } from '../../types/claim-letter.types';

export interface StaleBuildCleanupResult {
  cleanedCount: number;
  claimLetterIds: string[];
}

export interface ClaimLetterReconciliationReport {
  staleBuildingClaims: Array<{ claimLetterId: string; createdAt: Date }>;
  orphanedActiveLocks: Array<{ lockId: string; claimLetterId: string }>;
  acknowledgedLocksWithoutTerminalClaim: Array<{ lockId: string; claimLetterId: string }>;
  terminalClaimsWithoutAcknowledgedLock: Array<{ claimLetterId: string; missingUlbIds: string[] }>;
  financialMismatches: Array<{
    claimLetterId: string;
    storedSelectedAllocation: number;
    actualSelectedAllocation: number;
    storedCurrentSelectedClaim: number;
    actualCurrentSelectedClaim: number;
  }>;
  supersessionLinkMismatches: Array<{ claimLetterId: string; issue: string }>;
  missingSignedFiles: Array<{ claimLetterId: string; path: string }>;
  staleEditLocksWithChildCountMismatch: Array<{
    claimLetterId: string;
    editLockAcquiredAt: Date;
    expectedUlbCount: number;
    actualChildCount: number;
  }>;
}

/**
 * See docs/adr/0002-batching-and-locks.md for the stale-`BUILDING`-row recovery design this
 * implements. `cleanupStaleBuilds` also runs on its own schedule (`runScheduledStaleBuildCleanup`
 * below), and remains directly callable (script/admin endpoint) too — same method either way, no
 * controller route in V1. Two distinct responsibilities kept separate on purpose:
 * `cleanupStaleBuilds` is the only *automatic* remediation (deletes genuinely stale BUILDING
 * parents, mirroring ClaimLetterAssemblyService's own compensating-rollback pattern);
 * `detectAnomalies` is report-only and never mutates — a submitted/acknowledged claim is exactly
 * the data this whole design exists to protect, so anything beyond stale-BUILDING cleanup is
 * surfaced for manual review only.
 *
 * This cron is now a *backstop-of-a-backstop* for the BUILDING case: `ClaimLetterAssemblyService`
 * also reclaims a stale BUILDING parent inline, the moment a later request actually conflicts with
 * the slot/ULBs it's sitting on (see `reclaimBlockingStaleBuilds` there, which shares this
 * service's own delete logic via `deleteBuildingParentArtifacts`). That inline path only fires on
 * contention, though — if a crashed build's slot/ULBs are never requested again by anyone, nothing
 * reclaims them reactively, so this hourly sweep remains the only mechanism that guarantees a dead
 * row doesn't sit forever. Unlike `updateDraft`'s edit-lock claim (below), a stale BUILDING row
 * isn't self-contained to one draft — it occupies a shared, scarce resource (1-of-3 batch slots,
 * specific ULBs) that any other future request might need, which is why this cron could not simply
 * be removed the way the edit-lock's was.
 *
 * `updateDraft`'s edit-lock claim (`ClaimLetterAssemblyService`'s `editLockToken`) deliberately has
 * no cron/cleanup counterpart here — it's a self-expiring lease (`CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES`),
 * checked inline by every guard that reads it, so a stale claim un-sticks itself the moment anyone
 * next acts on that claim. `detectAnomalies`'s `staleEditLocksWithChildCountMismatch` still reports
 * on it here, but only as a diagnostic — nothing in this service needs to *release* that lock.
 */
@Injectable()
export class ClaimLetterRecoveryService {
  private readonly logger = new Logger(ClaimLetterRecoveryService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name)
    private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
    @InjectModel(ClaimLetterUlbLock.name)
    private readonly lockModel: Model<ClaimLetterUlbLockDocument>,
    private readonly s3Service: S3Service,
  ) {}

  // ─── Automatic remediation ───────────────────────────────────────────────────

  /**
   * Without this, a crash/restart mid-assembly (between `ClaimLetterAssemblyService`'s two
   * transactions) leaves a `BUILDING` parent and its ULB locks stuck forever — `cleanupStaleBuilds`
   * existed to fix exactly that but, before this, was never actually invoked by anything in
   * production (no cron, no admin route, no script). Runs hourly against the 30-minute staleness
   * threshold, so worst case a stuck build's locks/batch-slot are freed within ~90 minutes of the
   * crash if nothing else claims them sooner — this only ever needs to catch a rare process crash
   * mid-`createDraft` (the sole reachable path that can leave a doc stuck `BUILDING`), not a
   * time-sensitive condition, so an hourly sweep is deliberately relaxed rather than matched to any
   * other job's cadence. In practice this ~90-minute worst case is now rare even for a crash: the
   * common case (someone else's request conflicts with the exact stale slot/ULBs) self-heals
   * immediately via `ClaimLetterAssemblyService.reclaimBlockingStaleBuilds` — this sweep only ends
   * up being the thing that actually cleans a row up when nobody happens to request that same
   * slot/those same ULBs again.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runScheduledStaleBuildCleanup(): Promise<void> {
    try {
      const result = await this.cleanupStaleBuilds();
      if (result.cleanedCount > 0) {
        this.logger.warn(
          `Cleaned up ${result.cleanedCount} stale BUILDING claim-letter batch(es): ` +
            result.claimLetterIds.join(', '),
        );
      }
    } catch (err) {
      this.logger.error(
        'Scheduled stale claim-letter build cleanup failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async cleanupStaleBuilds(
    staleThresholdMinutes: number = CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES,
  ): Promise<StaleBuildCleanupResult> {
    const staleBefore = new Date(Date.now() - staleThresholdMinutes * 60_000);
    const stale = await this.batchModel
      .find({ assemblyStatus: 'BUILDING', createdAt: { $lt: staleBefore } })
      .select('_id buildRequestId')
      .lean<{ _id: Types.ObjectId; buildRequestId: string }[]>()
      .exec();

    const claimLetterIds: string[] = [];
    for (const doc of stale) {
      await this.cleanupOneStaleBuild(doc._id, doc.buildRequestId);
      claimLetterIds.push(String(doc._id));
    }
    return { cleanedCount: claimLetterIds.length, claimLetterIds };
  }

  /** Never touches ACKNOWLEDGED locks or READY/submitted claims — scoped to exactly one
   *  BUILDING parent and the locks owned by its own buildRequestId. Delete body is
   *  shared with ClaimLetterAssemblyService's inline reclaim-on-conflict path — see
   *  deleteBuildingParentArtifacts's own doc comment. */
  private async cleanupOneStaleBuild(parentId: Types.ObjectId, buildRequestId: string): Promise<void> {
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

  // ─── Report-only reconciliation detection ────────────────────────────────────

  async detectAnomalies(
    staleThresholdMinutes: number = CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES,
  ): Promise<ClaimLetterReconciliationReport> {
    const [
      staleBuildingClaims,
      orphanedActiveLocks,
      acknowledgedLocksWithoutTerminalClaim,
      terminalClaimsWithoutAcknowledgedLock,
      financialMismatches,
      supersessionLinkMismatches,
      missingSignedFiles,
      staleEditLocksWithChildCountMismatch,
    ] = await Promise.all([
      this.findStaleBuildingClaims(staleThresholdMinutes),
      this.findOrphanedActiveLocks(),
      this.findAcknowledgedLocksWithoutTerminalClaim(),
      this.findTerminalClaimsWithoutAcknowledgedLock(),
      this.findFinancialMismatches(),
      this.findSupersessionLinkMismatches(),
      this.findMissingSignedFiles(),
      this.findStaleEditLocksWithChildCountMismatch(),
    ]);

    return {
      staleBuildingClaims,
      orphanedActiveLocks,
      acknowledgedLocksWithoutTerminalClaim,
      terminalClaimsWithoutAcknowledgedLock,
      financialMismatches,
      supersessionLinkMismatches,
      missingSignedFiles,
      staleEditLocksWithChildCountMismatch,
    };
  }

  private async findStaleBuildingClaims(
    staleThresholdMinutes: number,
  ): Promise<ClaimLetterReconciliationReport['staleBuildingClaims']> {
    const staleBefore = new Date(Date.now() - staleThresholdMinutes * 60_000);
    const docs = await this.batchModel
      .find({ assemblyStatus: 'BUILDING', createdAt: { $lt: staleBefore } })
      .select('_id createdAt')
      .lean<{ _id: Types.ObjectId; createdAt: Date }[]>()
      .exec();
    return docs.map((d) => ({ claimLetterId: String(d._id), createdAt: d.createdAt }));
  }

  private async findOrphanedActiveLocks(): Promise<ClaimLetterReconciliationReport['orphanedActiveLocks']> {
    const activeLocks = await this.lockModel
      .find({ lockState: 'ACTIVE' })
      .select('_id claimLetter')
      .lean<{ _id: Types.ObjectId; claimLetter: Types.ObjectId }[]>()
      .exec();
    if (activeLocks.length === 0) return [];

    const claimIds = [...new Set(activeLocks.map((l) => String(l.claimLetter)))];
    const existing = await this.batchModel
      .find({ _id: { $in: claimIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const existingSet = new Set(existing.map((d) => String(d._id)));

    return activeLocks
      .filter((l) => !existingSet.has(String(l.claimLetter)))
      .map((l) => ({ lockId: String(l._id), claimLetterId: String(l.claimLetter) }));
  }

  private async findAcknowledgedLocksWithoutTerminalClaim(): Promise<
    ClaimLetterReconciliationReport['acknowledgedLocksWithoutTerminalClaim']
  > {
    const ackLocks = await this.lockModel
      .find({ lockState: 'ACKNOWLEDGED' })
      .select('_id claimLetter')
      .lean<{ _id: Types.ObjectId; claimLetter: Types.ObjectId }[]>()
      .exec();
    if (ackLocks.length === 0) return [];

    const claimIds = [...new Set(ackLocks.map((l) => String(l.claimLetter)))];
    const claims = await this.batchModel
      .find({ _id: { $in: claimIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id currentFormStatus')
      .lean<{ _id: Types.ObjectId; currentFormStatus: number }[]>()
      .exec();
    const statusByClaim = new Map(claims.map((c) => [String(c._id), c.currentFormStatus]));

    return ackLocks
      .filter((l) => statusByClaim.get(String(l.claimLetter)) !== FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA)
      .map((l) => ({ lockId: String(l._id), claimLetterId: String(l.claimLetter) }));
  }

  private async findTerminalClaimsWithoutAcknowledgedLock(): Promise<
    ClaimLetterReconciliationReport['terminalClaimsWithoutAcknowledgedLock']
  > {
    const terminalClaims = await this.batchModel
      .find({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, isAbandoned: false })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    if (terminalClaims.length === 0) return [];
    const claimIds = terminalClaims.map((c) => c._id);

    const [children, ackLocks] = await Promise.all([
      this.batchUlbModel
        .find({ claimLetter: { $in: claimIds } })
        .select('claimLetter ulbId')
        .lean<{ claimLetter: Types.ObjectId; ulbId: Types.ObjectId }[]>()
        .exec(),
      this.lockModel
        .find({ claimLetter: { $in: claimIds }, lockState: 'ACKNOWLEDGED' })
        .select('claimLetter ulbId')
        .lean<{ claimLetter: Types.ObjectId; ulbId: Types.ObjectId }[]>()
        .exec(),
    ]);

    const childrenByClaim = new Map<string, Set<string>>();
    for (const c of children) {
      const key = String(c.claimLetter);
      if (!childrenByClaim.has(key)) childrenByClaim.set(key, new Set());
      childrenByClaim.get(key)?.add(String(c.ulbId));
    }
    const ackByClaim = new Map<string, Set<string>>();
    for (const l of ackLocks) {
      const key = String(l.claimLetter);
      if (!ackByClaim.has(key)) ackByClaim.set(key, new Set());
      ackByClaim.get(key)?.add(String(l.ulbId));
    }

    const result: ClaimLetterReconciliationReport['terminalClaimsWithoutAcknowledgedLock'] = [];
    for (const claim of terminalClaims) {
      const key = String(claim._id);
      const expectedUlbIds = childrenByClaim.get(key) ?? new Set<string>();
      const ackUlbIds = ackByClaim.get(key) ?? new Set<string>();
      const missingUlbIds = [...expectedUlbIds].filter((id) => !ackUlbIds.has(id));
      if (missingUlbIds.length > 0) result.push({ claimLetterId: key, missingUlbIds });
    }
    return result;
  }

  private async findFinancialMismatches(): Promise<ClaimLetterReconciliationReport['financialMismatches']> {
    const readyClaims = await this.batchModel
      .find({ assemblyStatus: 'READY' })
      .select('_id financialSummary')
      .lean<{ _id: Types.ObjectId; financialSummary: ClaimLetterFinancialSummaryDisplay }[]>()
      .exec();
    if (readyClaims.length === 0) return [];
    const claimIds = readyClaims.map((c) => c._id);

    const sums = await this.batchUlbModel
      .aggregate<{ _id: Types.ObjectId; allocated: number; claimed: number }>([
        { $match: { claimLetter: { $in: claimIds } } },
        {
          $group: {
            _id: '$claimLetter',
            allocated: { $sum: '$allocatedAmount' },
            claimed: { $sum: '$claimedAmount' },
          },
        },
      ])
      .exec();
    const sumByClaim = new Map(sums.map((s) => [String(s._id), s]));

    const result: ClaimLetterReconciliationReport['financialMismatches'] = [];
    for (const claim of readyClaims) {
      const key = String(claim._id);
      const actual = sumByClaim.get(key) ?? { allocated: 0, claimed: 0 };
      const stored = claim.financialSummary;
      if (
        !amountsAreEqual(stored.selectedAllocation, actual.allocated) ||
        !amountsAreEqual(stored.currentSelectedClaim, actual.claimed)
      ) {
        result.push({
          claimLetterId: key,
          storedSelectedAllocation: stored.selectedAllocation,
          actualSelectedAllocation: actual.allocated,
          storedCurrentSelectedClaim: stored.currentSelectedClaim,
          actualCurrentSelectedClaim: actual.claimed,
        });
      }
    }
    return result;
  }

  private async findSupersessionLinkMismatches(): Promise<
    ClaimLetterReconciliationReport['supersessionLinkMismatches']
  > {
    const linked = await this.batchModel
      .find({ $or: [{ supersedes: { $ne: null } }, { supersededBy: { $ne: null } }] })
      .select('_id supersedes supersededBy')
      .lean<{ _id: Types.ObjectId; supersedes: Types.ObjectId | null; supersededBy: Types.ObjectId | null }[]>()
      .exec();
    if (linked.length === 0) return [];

    const byId = new Map(linked.map((d) => [String(d._id), d]));
    const result: ClaimLetterReconciliationReport['supersessionLinkMismatches'] = [];

    // One-sided link: A.supersededBy = B, but B.supersedes does not point back to A.
    for (const doc of linked) {
      if (doc.supersededBy) {
        const target = byId.get(String(doc.supersededBy));
        if (!target || String(target.supersedes) !== String(doc._id)) {
          result.push({
            claimLetterId: String(doc._id),
            issue: `supersededBy points to ${String(doc.supersededBy)} but that claim's supersedes link is not reciprocated`,
          });
        }
      }
    }

    // Duplicate supersession: two or more claims both claim to supersede the same predecessor.
    const successorsByPredecessor = new Map<string, string[]>();
    for (const doc of linked) {
      if (doc.supersedes) {
        const key = String(doc.supersedes);
        if (!successorsByPredecessor.has(key)) successorsByPredecessor.set(key, []);
        successorsByPredecessor.get(key)?.push(String(doc._id));
      }
    }
    for (const [predecessorId, successorIds] of successorsByPredecessor) {
      if (successorIds.length > 1) {
        for (const successorId of successorIds) {
          result.push({
            claimLetterId: successorId,
            issue: `duplicate supersession — ${predecessorId} is claimed as superseded by multiple versions: ${successorIds.join(', ')}`,
          });
        }
      }
    }

    return result;
  }

  private async findMissingSignedFiles(): Promise<ClaimLetterReconciliationReport['missingSignedFiles']> {
    const withFiles = await this.batchModel
      .find({ signedClaimFile: { $ne: null } })
      .select('_id signedClaimFile')
      .lean<{ _id: Types.ObjectId; signedClaimFile: { path: string } | null }[]>()
      .exec();
    const candidates = withFiles.filter(
      (d): d is { _id: Types.ObjectId; signedClaimFile: { path: string } } => !!d.signedClaimFile?.path,
    );
    if (candidates.length === 0) return [];

    const checks = await Promise.allSettled(candidates.map((d) => this.s3Service.headObject(d.signedClaimFile.path)));
    const result: ClaimLetterReconciliationReport['missingSignedFiles'] = [];
    checks.forEach((check, i) => {
      if (check.status === 'rejected') {
        result.push({ claimLetterId: String(candidates[i]._id), path: candidates[i].signedClaimFile.path });
      }
    });
    return result;
  }

  /**
   * Flags only the *concerning* subset of stale edit locks — ones where the persisted child count
   * doesn't match `ulbCount`, meaning the interrupted `updateDraft` crashed mid delete/insert
   * rather than before touching children at all. The lock itself already self-clears the moment
   * anyone next acts on that claim (see `CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES`); a genuine count
   * mismatch is what still needs a human to reconcile from history, so it's surfaced here rather
   * than auto-repaired. Deliberately ignores `detectAnomalies`'s `staleThresholdMinutes` param —
   * that's sized for the BUILDING-cleanup case (a multi-stage assembly), a different concept from
   * this lock's own lease duration (a single delete+insert rebuild).
   */
  private async findStaleEditLocksWithChildCountMismatch(): Promise<
    ClaimLetterReconciliationReport['staleEditLocksWithChildCountMismatch']
  > {
    const staleBefore = new Date(Date.now() - CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES * 60_000);
    const staleLocked = await this.batchModel
      .find({ editLockToken: { $ne: null }, editLockAcquiredAt: { $lt: staleBefore } })
      .select('_id ulbCount editLockAcquiredAt')
      .lean<{ _id: Types.ObjectId; ulbCount: number; editLockAcquiredAt: Date }[]>()
      .exec();
    if (staleLocked.length === 0) return [];

    const claimIds = staleLocked.map((d) => d._id);
    const counts = await this.batchUlbModel
      .aggregate<{
        _id: Types.ObjectId;
        count: number;
      }>([{ $match: { claimLetter: { $in: claimIds } } }, { $group: { _id: '$claimLetter', count: { $sum: 1 } } }])
      .exec();
    const countByClaim = new Map(counts.map((c) => [String(c._id), c.count]));

    const result: ClaimLetterReconciliationReport['staleEditLocksWithChildCountMismatch'] = [];
    for (const claim of staleLocked) {
      const actualChildCount = countByClaim.get(String(claim._id)) ?? 0;
      if (actualChildCount !== claim.ulbCount) {
        result.push({
          claimLetterId: String(claim._id),
          editLockAcquiredAt: claim.editLockAcquiredAt,
          expectedUlbCount: claim.ulbCount,
          actualChildCount,
        });
      }
    }
    return result;
  }
}
