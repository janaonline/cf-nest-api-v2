# 0002 - Batch and lock reservation model

## Status

Accepted

## Context

A State may have at most `CLAIM_LETTER_MAX_BATCH_NUMBER` (3) logical claim batches per
(state, year, installment), and each ULB may only be locked into one active claim at a time. Both
are contended resources — concurrent requests from the same state must never both succeed at
claiming the same slot or the same ULB.

## Decision

**Batch slot allocation.** `allocateBatchNumber` scans currently-used slots (1, 2, or 3) inside a
transaction and picks the first free one. This scan-then-write has a race window between two
concurrent transactions; it's closed by a DB-level unique index on the batch document, so a
duplicate-key error on `batchModel.create()` is always a **fresh, live conflict** between two
requests committing around the same time — never a stale leftover (see below), because
`allocateBatchNumber` re-reads free slots inside the very same transaction immediately beforehand.

**ULB locking.** Creating or updating a draft inserts one lock document per selected ULB, in the
same transaction as the batch-slot reservation (create) or as its own transaction (update's lock
diff) — all-or-nothing. A duplicate-key failure on any lock means that ULB is already locked
elsewhere; the whole reservation aborts rather than partially locking.

**Stale `BUILDING` row recovery.** A process crash between the two transactions of `createDraft`
(reserve slot+locks, then build+finalize) leaves a `BUILDING` parent with no way to ever reach
`READY`. Two mechanisms reclaim it, sharing one delete routine
(`helpers/claim-letter-build-cleanup.helpers.ts#deleteBuildingParentArtifacts`) so they can't drift
from each other:
- **Reactive, inline** (`ClaimLetterAssemblyService.reclaimBlockingStaleBuilds`) — the moment a
  *new* request actually conflicts with the stale row's slot or ULBs, it gets exactly one
  reclaim-and-retry attempt before surfacing a normal conflict. This is why
  `ReclaimableConflictException` exists as a distinct exception type from a plain
  `ConflictException`: it's how the orchestrator (`reserveBatchSlotAndLocks`) tells "this conflict
  might be a reclaimable stale row" apart from "this is fresh, live contention" (the
  `batchModel.create()` duplicate-key case above), which is never worth a reclaim attempt.
- **Proactive, scheduled** (`ClaimLetterRecoveryService.runScheduledStaleBuildCleanup`, hourly cron)
  — a backstop for rows nobody happens to contend with, so a crashed build's resources aren't held
  forever just because no one else asks for that exact slot/ULBs again.

A row is only ever considered stale after `CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES` (30 minutes)
— deliberately generous, so no legitimate in-flight synchronous build is ever mistaken for stale.
This should only be tightened based on observed p99 build latency in production, not guessed.

**Child (ULB row) insertion.** Children are inserted in bounded chunks
(`CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE`, 200) outside the reservation transaction — a single
all-in-one transaction wouldn't scale to states with 700+ ULBs. Correctness for this
non-transactional step is instead enforced afterward: `verifyAndFinalize` re-checks child count,
identity, financial totals, and lock presence before flipping `BUILDING` → `READY`; any failure
compensates by deleting the `BUILDING` parent/children and releasing only this build's own locks.

**Edit-lock lease** (`updateDraft`'s `editLockToken`, `CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES` = 5) is
a separate, narrower mechanism from the above — self-expiring, checked inline by every guard that
reads it, with no cron counterpart. It only ever needs to cover one delete+insert child rebuild
(sub-second normally), not a multi-stage assembly, so it's much tighter than the stale-build
threshold and doesn't need a scheduled sweep — a stale claim un-sticks itself the instant anyone
next acts on that draft.

## Consequences

- Raising `CLAIM_LETTER_MAX_BATCH_NUMBER`, changing the stale-build threshold, or editing the
  shared delete helper without updating *both* reclaim paths (inline + cron) are all changes that
  need re-review against this design, not just a local edit.
- A frozen claim version is immutable once `READY` — `createNewVersion` (mechanism-only in V1, no
  State-facing endpoint yet) builds an entirely new parent via the same reservation pipeline rather
  than mutating an existing one, and links predecessor→successor (`supersedes`/`supersededBy`) only
  once the new version is provably finalized.
