# Claim Letter — Implementation Progress

Plan: C:\Users\Navinder Singh\.claude\plans\lets-start-on-a-lovely-prism.md

- [x] Phase 1 — Foundation types & helpers — files: `common/types/claim-eligibility.type.ts`, `state/claim-letter/helpers/claim-letter-financial.helpers.ts`, `state/claim-letter/helpers/claim-letter-content-hash.helpers.ts` — tests: 21 passing (`claim-letter-financial.helpers.spec.ts`, `claim-letter-content-hash.helpers.spec.ts`) — status: done
- [x] Phase 2 — Mongoose schemas — files: `schemas/xvi-fc/state/claim-letter-batch.schema.ts`, `claim-letter-batch-ulb.schema.ts`, `claim-letter-ulb-lock.schema.ts`, `claim-letter-batch-history.schema.ts`, `claim-letter-eligibility-source-snapshot.schema.ts`; `form-json/schemas/form-json.schema.ts` + `interfaces/form-json.interface.ts` + `dto/claim-eligibility-config.dto.ts` + `dto/create-form-json.dto.ts` (claimEligibility field) — tests: 84 passing across 7 suites — status: done
- [x] Phase 3 — Shared infra (ULB set + evaluator) — files: `common/constants/expected-ulb-set.constants.ts`, `common/services/expected-ulb-set.service.ts`, `common/services/claim-eligibility-evaluator.service.ts`, `common/xvi-fc-common.module.ts` (wired), `form-json.service.ts` (+`findEnabledClaimEligibilitySources`, fixed create/update to actually persist `claimEligibility`) — tests: 192 passing across 13 suites in `xvi-fc/common` + `form-json` — status: done
- [x] Phase 4 — Module skeleton + read-only endpoints — files: `claim-letter.module.ts`, `claim-letter.controller.ts`, `constants/claim-letter.constants.ts`, `dto/get-claim-letter-{ulb-options,ulb-rows,history}-query.dto.ts`, `helpers/claim-letter-installment.helpers.ts`, `services/eligibility/claim-letter-eligibility.service.ts`, `services/ulb-options/claim-letter-ulb-options.service.ts`, `services/ulb-rows/claim-letter-ulb-rows.service.ts`, `services/main/claim-letter.service.ts`, `types/claim-letter.types.ts`; registered in `xvi-fc.module.ts`. Endpoints: eligibility-summary, ulb-options (all ULBs annotated eligible/ineligible, eligible-first sort, lock-exclusion), history, detail, ulbs (with read-time eligibility re-verification). Extended `claim-letter-financial.helpers.ts` with `mapFinancialSummaryToDisplay` — tests: 66 passing across 8 suites — status: done
- [x] Phase 5 — Assembly pipeline — files: `services/assembly/claim-letter-assembly.service.ts` (transactional batch-slot + lock allocation, chunked child insert, revalidate/verify/finalize, compensating rollback), `services/history/claim-letter-history.service.ts` (create-draft history write); `claim-letter.module.ts` gained `Year` to `forFeature` + both new providers; `constants/claim-letter.constants.ts` gained `CLAIM_LETTER_CHILD_INSERT_CHUNK_SIZE` — tests: 23 (assembly) + 4 (history) new, 92 passing across all 10 claim-letter suites total — status: done
- [x] Phase 6 — Draft mutation endpoints — files: `services/assembly/claim-letter-assembly.service.ts` extended with `updateDraft`/`abandonDraft` (+ private `diffLocks`/`compensateUpdateFailure`/`verifyAndFinalizeUpdate`, reusing Phase 5's verification helpers unchanged); `services/main/claim-letter.service.ts` extended with `uploadSignedFile` (reuses existing `XviFcFileRefDto` + `FileInfoNormalizerService`, no new normalization logic) and `submit`; `claim-letter.controller.ts` gained 5 routes (`POST .../draft` create, `PATCH .../draft` update, `POST .../abandon`, `POST .../signed-file`, `POST .../submit`); new DTOs `claim-letter-ulb-selection.dto.ts`, `create-claim-letter-draft.dto.ts`, `update-claim-letter-draft.dto.ts`; constants gained `CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB` — tests: 128 passing across all 10 claim-letter suites total (up from 92). **Not done**: the plan's "manual end-to-end smoke test against a seeded dev DB" criterion — no live MongoDB/app server was available in this environment, and it structurally depends on Phase 9's seed payload existing anyway; only the mocked service/controller specs were run. Recommend exercising create→select→edit→upload→submit manually once Phase 9's seed payload is pushed. — status: done (pending manual smoke test)
- [x] Phase 7 — History + idempotency audit — audited `claim-letter-assembly.service.ts` + `claim-letter.service.ts` against plan §9/§10: history is written exactly on create-draft (null→IN_PROGRESS), submit (IN_PROGRESS→UNDER_REVIEW_BY_MOHUA), and abandon (IN_PROGRESS→IN_PROGRESS + reason), never on draft-update or file-upload; every mutating endpoint's idempotency filter matches §10's table exactly (buildRequestId unique index, `{_id,currentFormStatus,revision}`, `{_id,currentFormStatus,isAbandoned}`, natural file overwrite, `{_id,currentFormStatus}`); all lock releases scoped by `claimLetter`/`buildRequestId`, never the bare business key — confirmed against `claim-letter-batch.schema.ts`/`claim-letter-ulb-lock.schema.ts` indexes. Found one real gap: no test asserted history was *never* called during `uploadSignedFile` — added that assertion plus explicit not-called assertions on the already-abandoned/already-submitted idempotent-retry paths in `claim-letter.service.spec.ts` and `claim-letter-assembly.service.spec.ts` (no new schema/service code needed — the contracts already held, only test coverage was incomplete) — tests: 128 passing across all 10 claim-letter suites (unchanged count, added assertions to existing tests) — status: done
- [x] Phase 8 — Hardening (recovery/reconciliation/parked mechanisms) — files: `services/recovery/claim-letter-recovery.service.ts` (+spec) — `cleanupStaleBuilds` (automatic remediation, deletes genuinely stale BUILDING parents past a threshold, mirroring the assembly service's own compensating-rollback pattern) + `detectAnomalies` (report-only, 6 anomaly categories: orphaned active locks, acknowledged locks without a terminal claim, terminal claims missing an acknowledged lock, financial-summary drift vs. live child sums, one-sided/duplicate supersession links, signed files missing from S3 — never auto-mutates); `services/assembly/claim-letter-assembly.service.ts` extended with `createNewVersion` (§7.6 — carries forward the previous version's own ULB/amount selections through the full build pipeline with fresh eligibility+locks, links `supersedes`/`supersededBy` atomically at finalize, no controller route) and `acknowledgeLocks` (§7.8 — `ACTIVE→ACKNOWLEDGED`, scoped by `claimLetter`, no controller route); extracted a shared private `verifyPersistedChildren` helper reused by all three finalize paths (create/update/version) — pure refactor, no behavior change, re-verified against existing Phase 5/6 tests; `constants/claim-letter.constants.ts` gained `CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES`; `claim-letter.module.ts` gained `ClaimLetterRecoveryService` + `S3Service` providers (same direct-provider pattern as `fc-unspent-declaration.module.ts`) — tests: 143 passing across all 11 claim-letter suites total (up from 128) — status: done
- [x] Phase 9 — Seed payload + final verification — produced `src/module/xvi-fc/xvifc-claim-letter-payload-23072026.json` (mirrors `xvifc-payload-19072026.json`'s exact convention: a `{"devolutionFormula": {...}}` wrapper) containing the existing Devolution formJson entry (`design_year: 67d7d136d3d038946a5239e9`, `formId: 24`) verbatim, augmented with a `claimEligibility` block (`enabled: true`, `ownerLevel: STATE`, `evaluationLevel: FORM`, `evaluator.type: FORM_STATUS` reading `xvifc_devolution_forms.currentFormStatus`, `applicableInstallments: [1]`, `acceptedFormStatuses: [7]` i.e. `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` — **flagged for review**: the brain doc doesn't state an explicit accepted-status list for this gate; `[7]` was chosen as "Devolution must be MoHUA-finalized before a State can claim against it," the most defensible reading, but this is a business call the user should confirm/adjust before pushing). Payload validated syntactically (`JSON.parse`) and structurally — ran it through the actual `ClaimEligibilityConfigDto` with `class-validator` (`whitelist + forbidNonWhitelisted`), zero violations. This file is a temporary hand-off artifact per the user's explicit instruction: **not deleted yet** — stays in the repo until the user confirms they've pushed it to the DB via their own API, then it should be deleted. Final full-suite regression run (2026-07-23): 2353 passing / 2357 total, only the 2 pre-existing unrelated `annual_accounts` failures, zero new regressions — status: done (pending user DB push + file deletion)

## Addendum — backend prerequisite fixes for the frontend (2026-07-24)

Found while planning the Claim Letter UI (not part of the original 9 phases): three real gaps that
blocked the frontend from working, fixed before any UI code was written.

1. **Shared response mapper + `revision`.** Extracted `ClaimLetterService`'s private `toBatchSummary()`
   into a standalone `helpers/claim-letter-summary.helpers.ts` → `mapClaimLetterBatchDocToSummary()`,
   added `revision: number` to `ClaimLetterBatchSummary` (`types/claim-letter.types.ts`). Wired
   `ClaimLetterAssemblyService.createDraft`/`updateDraft`/`abandonDraft` through the same mapper
   (previously returned raw Mongoose lean docs, inconsistent with `getDetail`/`listHistory`/`submit`/
   `uploadSignedFile`) via thin public wrappers over renamed `*Raw` private methods — internal pipeline
   logic untouched. Every claim-letter mutating/reading endpoint now returns the identical
   `ClaimLetterBatchSummary` shape, and the UI can read `revision` off any of them for
   `PATCH .../draft`'s required `expectedRevision`.
2. **Claim Letter's own `formjsons` entry.** New `CLAIM_LETTER_FORM_ID = 26` (confirmed free by
   grepping every existing formId usage — 22/23/24/25/30/31/32 taken). `ClaimLetterService.getDetail()`
   now loads `questions` via the existing generic `FormJsonService.findActiveByDesignYearAndFormId()`
   (same call every other state form's own `getForm()` already makes — no new config/validator service
   built), attached as an optional `questions?: FieldConfig[]` on `ClaimLetterBatchSummary`, populated
   only by `getDetail`. Missing/unseeded degrades to `questions: []` with a logged warning, not a 500.
   Added the `claimLetter` entry (formId 26, one `signedClaimFile` field, no download-template action —
   no PDF generation exists in V1) to the existing `xvifc-claim-letter-payload-23072026.json`.
3. Tests: `mapClaimLetterBatchDocToSummary` covered via `getDetail`'s existing spec coverage; new
   `getDetail` tests for `questions` present/absent; assembly-service specs updated to assert on the
   mapped summary shape (added a `zeroFinancialSummary` fixture + `financialSummary` on `parentDoc()`,
   since the mapper reads it unconditionally). 145 passing across all 11 claim-letter suites (up from
   143). Full-suite regression (2026-07-24): 2355 passing / 2359 total, only the 2 pre-existing unrelated
`annual_accounts` failures, zero new regressions.

Full UI plan is being re-presented fresh (per explicit user instruction) now that this lands, before
any frontend code is written.

## Addendum — production-readiness review fixes (2026-07-30)

Found via a full submit/draft API review (backend + frontend), not part of the original 9 phases.
Three fixes applied, all in `claim-letter-assembly.service.ts` / `claim-letter-recovery.service.ts`:

1. **Cross-tenant idempotency-key leak.** `checkIdempotentRetry` looked up an existing batch by the
   globally-unique `buildRequestId` alone, with no check that the resolved doc belonged to the
   requesting state — every other mutation in the file re-validates against the resolved
   document's actual `state` field, this was the one path that didn't. A STATE user reusing (or
   colliding with) another state's `idempotencyKey` on `createDraft` would get that other state's
   claim-letter batch back. Fixed by scoping the lookup to `{buildRequestId, state: stateOid}`.
   Dormant in the shipped UI (never sends `idempotencyKey` today) but live in the API contract for
   any direct caller. Added a regression test asserting the state-scoped query shape.
2. **Stale-build recovery never actually ran.** `ClaimLetterRecoveryService.cleanupStaleBuilds()`
   (Phase 8) was fully built and tested but never invoked by anything — no `@Cron`, no admin route,
   no script — so a crash/restart mid-assembly permanently stranded ULB locks and burned a batch
   slot with zero automatic remediation. Added `runScheduledStaleBuildCleanup()`, `@Cron`'d hourly
   (deliberately relaxed vs. `annual-account-status-sync.service.ts`'s 5-minute polling pattern it
   otherwise mirrors — that job polls an external OCR service for expected routine status updates,
   this one is a rare-crash safety net where a ~90-minute worst-case recovery window is fine), calling
   the unchanged `cleanupStaleBuilds()` and logging cleanups/failures without ever throwing out of the
   cron tick.
3. **No logging in the concurrency-critical assembly service.** Zero `Logger` usage anywhere in the
   file, and the global `HttpExceptionFilter` only logs 5xx, so every compensating rollback
   (`abortBuild`, `compensateUpdateFailure`) and every drift/integrity `ConflictException`
   (`assertNoDrift`, `assertChildrenComplete`, `assertChildrenMatchParentIdentity`,
   `assertFinancialTotalsMatch`, `assertEligibilitySourcesValid`, `assertLocksPresent`) was
   completely invisible server-side. Added a `Logger` and targeted `warn`/`error` calls at exactly
   those points (left the routine, expected optimistic-concurrency 409s — e.g. "changed by someone
   else, please retry" — unlogged, since those are normal user-driven races, not anomalies).

Two findings from the same review were deliberately **not** fixed in this initial pass (user chose
to scope it to the three above): a non-transactional race window in `updateDraft`'s child rebuild
(fixed below, same day), and confirming every deployed MongoDB is a replica set (transactions
require one; this is an environment/ops check, not a code change — still open).

Tests: 209 passing across all 12 claim-letter suites (up from 205 — 4 new: 1 idempotency-scoping
regression test, 2 for the new scheduled-cleanup cron method, plus assertions tightened on the
existing idempotent-retry test). Full-suite regression (2026-07-30): 3050 passing / 3056 total,
only the 2 pre-existing unrelated failures (`annual-account-ocr-api.service.spec.ts`,
`data-collection.service.spec.ts` — neither touched by this change), zero new regressions.

## Addendum — updateDraft edit-lock (2026-07-30, same day as above)

Closed the remaining finding from the same review: `updateDraftRaw` checked `revision`/
`currentFormStatus` as plain in-memory reads, then unconditionally deleted and rebuilt all child
rows outside any session/transaction, untagged by any per-request identifier. Two concurrent
`PATCH .../draft` calls passing the same in-memory revision check could interleave their delete/
insert against the same child rows — in the common "same ULB set, different amount" edit case,
`diffLocks` no-ops entirely (nothing added/removed), so there was zero serialization between the
revision check and the destructive delete/insert. This self-healed in practice via
`verifyPersistedChildren`'s sanity checks (financial totals almost never coincidentally match
between two different human-entered edits) but wasn't a guaranteed invariant.

Fix mirrors `createDraft`'s existing reserve → build → finalize-or-compensate saga, applied to
`updateDraft`:
- `ClaimLetterBatch` schema gained `editLockToken: string | null` and `editLockAcquiredAt: Date | null`
  (both default `null`).
- `updateDraftRaw` now claims `editLockToken` atomically in one `findOneAndUpdate` alongside the
  `assemblyStatus`/`currentFormStatus`/`revision` check (replacing the old plain-read checks) —
  only the request that wins this claim may touch child rows. A failed claim produces a
  differentiated error (not found / wrong status / already being edited / stale revision) via new
  `buildUpdateClaimConflictError`, mirroring `submit()`'s existing re-fetch pattern.
  `verifyAndFinalizeUpdate`'s closing guard now checks `editLockToken` (which nothing else can have
  changed while held) instead of `revision` directly, and clears both lock fields in the same
  write as the `revision` increment. Every failure path (including a `diffLocks` failure, which
  previously had no edit-lock concept to worry about) releases the lock via new `releaseEditLock`.
- `abandonDraftRaw` and `ClaimLetterService.submit()` both gained `editLockToken: null` in their
  own atomic guards, and a differentiated "currently being edited" conflict message — otherwise
  either could act on a claim while an update is mid-rebuild, abandoning/submitting a transiently
  inconsistent child set. `uploadSignedFile` was deliberately left untouched — it only ever
  touches `signedClaimFile`, never children/financialSummary, so it doesn't participate in this
  race.
- `ClaimLetterRecoveryService` initially gained a crash-recovery counterpart — `cleanupStaleEditLocks()`
  `@Cron`'d hourly via `runScheduledStaleEditLockCleanup()` — **superseded later the same day, see
  the addendum below**: this was replaced with a self-expiring lease instead, so there is no
  edit-lock cron in the final design. `detectAnomalies()` gained a new report-only
  `staleEditLocksWithChildCountMismatch` bucket, flagging only the stale locks where the persisted
  child count doesn't match `ulbCount` (i.e. the interrupted update crashed mid delete/insert
  rather than before touching children at all) — surfaced for manual review rather than
  auto-repaired. This bucket **is** kept in the final design (see below).

Tests: 221 passing across all 12 claim-letter suites (up from 209 — new coverage for the atomic
claim's filter shape, the differentiated conflict messages, `diffLocks`-failure lock release,
`abandonDraftRaw`/`submit()` rejecting while locked, and `cleanupStaleEditLocks`/
`runScheduledStaleEditLockCleanup`/the new anomaly bucket). Full-suite regression (2026-07-30):
3059 passing / 3065 total, same 2 pre-existing unrelated failures as above, zero new regressions.
`tsc --noEmit` against a clean (non-incremental) output showed zero new type errors (one
pre-existing, unrelated error in `annual_accounts.service.ts`). **Superseded same day** — see
below.

## Addendum — updateDraft edit-lock: self-expiring lease instead of cron (2026-07-30, later same day)

User pushed back on the cron-based release above: if every claim/lock pattern in the codebase gets
its own bespoke `@Cron` sweep, that doesn't scale as an architecture, and cron isn't the only (or
best) way to solve "release a claim automatically if its holder crashes." Correct call. Redesigned
around the standard production pattern instead: a self-expiring **lease** (store *when* claimed,
treat it as invalid past a TTL, checked inline as part of the *next acquisition attempt* — no
scheduled sweeper needed), paired with the **fencing token** the design already had (the
`editLockToken`-guarded finalize, which rejects a write from a lease-holder who wakes up after
expiry). This is how Redis locks (`SET NX PX`), Kubernetes leader-election leases, and SQS
visibility timeouts all work.

- New constant `CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES = 5` (`constants/claim-letter.constants.ts`)
  — deliberately much tighter than `CLAIM_LETTER_STALE_BUILD_THRESHOLD_MINUTES`'s 30, since this
  only ever needs to cover one delete+insert rebuild (normally sub-second), not the full
  multi-stage assembly pipeline that threshold was sized for.
- All three guards that read `editLockToken` — `updateDraftRaw`'s upfront claim,
  `abandonDraftRaw`'s guard, and `ClaimLetterService.submit()`'s guard — changed from a bare
  `editLockToken: null` filter to `$or: [{editLockToken: null}, {editLockAcquiredAt: {$lt: staleBefore}}]`.
  All three needed the change together: if only the claim query tolerated staleness, a stale lock
  would still permanently block abandon/submit forever unless someone happened to trigger a fresh
  update first. Added matching private helpers (`editLockStaleBefore()`/`isEditLockActive()`) in
  both `ClaimLetterAssemblyService` and `ClaimLetterService` — duplicated across the two files
  rather than shared, matching this codebase's existing `hasStateAccess`/`assertStateAccess`
  precedent of small logic duplicated per-service rather than cross-service coupling.
- Removed `runScheduledStaleEditLockCleanup()` and `cleanupStaleEditLocks()` (and the now-unused
  `StaleEditLockCleanupResult` export) from `ClaimLetterRecoveryService` entirely — with all three
  guards self-healing inline, there's no remaining caller or purpose for an explicit sweep-and-clear
  method. `runScheduledStaleBuildCleanup`/`cleanupStaleBuilds` (finding #2's cron) are untouched —
  that case is structurally harder to de-cron the same way, since it's real rows on hard unique
  indexes (`buildRequestId`, `{state,year,installment,batchNumber,version}`, every ULB lock) that a
  future request can't just *ignore*, unlike a nullable flag. Explicitly out of scope for this pass.
- Kept `detectAnomalies()`'s `staleEditLocksWithChildCountMismatch` bucket — it answers a different
  question (did an interrupted rebuild leave children genuinely inconsistent, worth a human's
  attention) that lease expiry doesn't resolve on its own. Its internal staleness cutoff now uses
  `CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES` directly rather than `detectAnomalies`'s
  `staleThresholdMinutes` param (a different, BUILDING-oriented concept).
- Clarified for the record: the lease duration only ever governs how long a single in-flight
  *save* (`PATCH .../draft` request) can run before being presumed crashed — normally sub-second.
  It has zero relationship to how long a draft may sit unsubmitted, which remains unbounded by
  design (`currentFormStatus`-governed, no expiry) — a user saving a draft and returning 10 days
  later to submit is completely unaffected, since `editLockToken` is cleared the instant each
  save's server-side processing finishes.
- Noted for later, not actioned now: applying the same self-expiring-lease idea to finding #2's
  stale-`BUILDING` rows would require "lazy reclaim on conflict" (delete a stale conflicting row
  inline and retry, when a duplicate-key error is hit) rather than a bare TTL check, since real
  unique-index rows can't just be ignored the way a nullable flag can. Also noted: this codebase
  already has Redis as a global provider (OTP storage, BullMQ), which has native atomic lock
  primitives with TTL (`SET NX PX`) — if this claim/lease shape recurs in more features, a shared
  Redis-backed lock utility would be the more scalable long-term primitive than a bespoke
  Mongo-field lease per feature.

Tests: updated the 5 tests added in the previous pass that referenced the removed cron/cleanup
methods or asserted a bare `editLockToken: null` filter shape; added coverage for the `$or`
lease-expiry clause on all three guards and for the "fresh lock blocks, expired lock doesn't"
distinction on `updateDraft`/`abandonDraft`/`submit`. 220 passing across all 12 claim-letter suites.
Full-suite regression (2026-07-30): 3058 passing / 3064 total, same 2 pre-existing unrelated
failures as every prior pass (`annual-account-ocr-api.service.spec.ts`,
`data-collection.service.spec.ts` — neither touched by this change), zero new regressions.
`tsc --noEmit` against a clean (non-incremental) output showed zero new type errors.

All five findings from the original review are now resolved except the MongoDB-replica-set
environment check (#5, open ops item) and the deliberately-deferred finding-#2 lease/lazy-reclaim
idea noted above.

## Addendum — finding #2: lazy reclaim on conflict (2026-07-30, later same day)

Closed the deferred idea noted above: extended the hourly stale-`BUILDING` cron with inline
reclaim-on-conflict, so the common case (someone else's request actually needs the exact slot/ULBs
a crashed build is sitting on) self-heals immediately instead of waiting up to ~90 minutes for the
cron. Unlike the `editLockToken` redesign, **the cron is kept, unchanged** — lazy reclaim is purely
reactive (only fires on contention), whereas a stuck `BUILDING` row blocks a shared, scarce
resource (1-of-3 batch slots, specific ULBs) that *any other future request* might need, not just
whoever returns to one specific draft — if nobody ever requests that same slot/those same ULBs
again, only the cron ever frees it.

Two distinct conflict sources exist in `reserveBatchSlotAndLocks`, and only one is a stale-row
problem: the `batchModel.create()` duplicate-key conflict is always fresh, live contention between
two concurrently-committing requests (`allocateBatchNumber` re-reads a free slot inside the same
transaction immediately beforehand, so a stale row would already have been counted as "used" and
never selected) — ordinary client retry already self-heals it, untouched here. Two others **are**
stale-row problems, previously unaddressed: `allocateBatchNumber`'s "all 3 slots in use" throw
(deterministic given unchanged state — a stale row occupying a slot means every retry hits the
identical rejection forever) and the ULB-lock `insertMany` duplicate-key conflict (a stale lock
never clears on its own). Found the first of these two during this design pass — it wasn't part of
the original finding's framing, which only described the lock case.

- New file `helpers/claim-letter-build-cleanup.helpers.ts` — extracted the shared 3-collection
  delete (children, own-`buildRequestId` locks, the `BUILDING` parent itself) out of
  `ClaimLetterRecoveryService.cleanupOneStaleBuild` into a plain function
  (`deleteBuildingParentArtifacts`), now called by both the cron's cleanup and the new inline
  reclaim path — a shared plain function rather than cross-service DI, so neither service depends
  on the other.
- `claim-letter-assembly.service.ts`: renamed the existing `reserveBatchSlotAndLocks` body to
  `attemptReserveBatchSlotAndLocks`; added a thin `reserveBatchSlotAndLocks` orchestrator with the
  same name/signature (so `createDraftRaw`, its only call site, needed zero changes) that catches a
  new file-private `ReclaimableConflictException`, attempts `reclaimBlockingStaleBuilds` (one
  comprehensive scan of both the occupied-slots and requested-ULBs'-lock-owners dimensions
  together, since only one retry is allowed), and retries the whole reservation exactly once if
  anything was reclaimed. The retry has to live at this orchestrator boundary, not inside the
  attempt itself — MongoDB aborts the entire transaction on a write conflict, so there's no way to
  catch a duplicate-key error and keep using the same session to delete-and-retry. Both
  previously-plain-`ConflictException` throw sites (`allocateBatchNumber`'s "all slots used", the
  lock-`insertMany` duplicate-key catch) now throw the reclaimable variant instead; the
  `batchModel.create()` duplicate-key catch deliberately still throws the plain exception, per the
  always-fresh-contention proof above.
- Concurrent double-reclaim needs no special-casing: deleting 0 matching rows is a normal
  successful result, never an error (same property `abortBuild`/`cleanupOneStaleBuild` already
  relied on) — if two requests both reclaim the same stale parent, whichever commits first deletes
  it, the other's deletes just match nothing, and both proceed to their own retry independently.
- `claim-letter-recovery.service.ts`: `cleanupOneStaleBuild` now delegates to the shared helper (no
  behavior change); updated the class-level and `runScheduledStaleBuildCleanup` doc comments to
  describe the cron as a backstop-of-a-backstop now that the common contested-resource case
  self-heals inline.
- **Explicitly out of scope, ticketed rather than fixed** (confirmed with the user): `diffLocks`
  (`updateDraft` adding new ULBs to an existing draft) has the identical stale-lock shape and is
  genuinely reachable — left for a dedicated follow-up. `reserveVersionSlotAndLocks` (backs
  `createNewVersion`) has the same shape but is currently unreachable — `createNewVersion` has no
  State-facing endpoint in V1. Both noted here as open follow-up items, same treatment as the
  Redis-shared-lock idea deferred in the previous addendum.

Tests: 3 new scenarios in `claim-letter-assembly.service.spec.ts` (stale-lock reclaim then succeed;
mixed one-stale-one-live lock, still fails after exactly one retry but the stale one is still
cleaned up; stale batch-slot occupant reclaimed then succeeds), plus tightened assertions on the
existing "all 3 slots in use" and "already locked elsewhere" tests (now explicitly asserting no
wasted retry when nothing is reclaimable), plus a new `claim-letter-build-cleanup.helpers.spec.ts`
for the extracted helper. 225 passing across all 13 claim-letter suites (up from 220 — the new
helper file added a 13th suite). Full-suite regression (2026-07-30): 3063 passing / 3069 total,
same 2 pre-existing unrelated failures as every prior pass in this file
(`annual-account-ocr-api.service.spec.ts`, `data-collection.service.spec.ts`), zero new
regressions. `npm run build` clean. Lint clean except the same 3 pre-existing `no-unsafe-assignment`
errors already present in this spec file's earlier `editLockToken` tests, untouched by this change.

All five findings from the original review are now fully resolved except the MongoDB-replica-set
environment check (#5, open ops item, unchanged). The two newly-ticketed `diffLocks`/
`reserveVersionSlotAndLocks` items and the longer-term shared-Redis-lock idea remain the only open
follow-ups from this whole review.
