# Claim Letter Fixes and Claim Letter Review - Implementation Plan

## 0. How to use this document

- If you have only worked on the ULB forms (Annual Accounts, SLB, Bank Account, DUR), read
  sections 1 to 3 before writing any code. They explain the State side this task builds on.
- Section 4 lists decisions already agreed with the product owner. Do not re-decide them. If one
  looks wrong once you are in the code, stop and ask.
- Section 5 lists design points that came out of reading the code. They are all confirmed with
  the product owner, and they explain why some phases change PMU or State code.
- Work phase by phase (section 6). Each phase has backend, frontend, tests and a "Done when"
  check. Finish a phase's checks before starting the next.
- Repos: backend `cf-nest-api-v2` (NestJS + Mongoose), frontend `cityfinance-ng-ui-v2`
  (Angular 20). Backend paths are relative to `cf-nest-api-v2/src/`, frontend paths to
  `cityfinance-ng-ui-v2/src/app/features/xvi-fc-module/`, unless written in full.

---

## 1. Background: State forms and PMU review

### 1.1 Who submits what

- **ULB forms** - Annual Accounts audited (formId 30) and provisional (31), SLB (32), Bank Account
  (33), DUR (36). The ULB submits, the State reviews, and approval lands on status 8
  (`APPROVED_BY_STATE`). SLB has no State review and lands on 8 at submit.
- **State condition forms** - the State submits them, PMU reviews, and PMU approval lands on
  status 5 (`UNDER_REVIEW_BY_MOHUA`).
  - **Form-level**: SFC (22), GTC (35, one document per installment), Devolution Formula (24,
    one document per installment; holds each ULB's allocation). A decision on these affects
    every ULB in the State.
  - **Row-level**: Elected Body (23) and FC Unspent (25). A parent form plus one row per ULB.
    Each row has its own `rowStatus`. A decision on a row affects only that ULB.
- **Claim Letter** (formId 26) - the State groups eligible ULBs into a batch and submits it to
  MoHUA. MoHUA reviewing that batch is what this task builds.

### 1.2 Status ids (`common/constants/form-status.constants.ts`)

| Id | Name | Notes |
|---|---|---|
| 1 | NOT_STARTED | |
| 2 | IN_PROGRESS | Claim Letter drafts |
| 3 | UNDER_REVIEW_BY_STATE | |
| 4 | RETURNED_BY_STATE | |
| 5 | UNDER_REVIEW_BY_MOHUA | State forms after PMU approval; submitted claim batches |
| 6 | RETURNED_BY_MOHUA | Already reopens editing for the owner (see editable sets below) |
| 7 | SUBMISSION_ACKNOWLEDGED_BY_MOHUA | Terminal |
| 8 | APPROVED_BY_STATE | ULB forms after State approval |
| 9 | AWAITING_CLAIM_LETTER | Not used after this task (section 4.7) |
| 12 | EXEMPTED_ACKNOWLEDGED | Terminal, set by exemptions |
| 13 | UNDER_REVIEW_BY_PMU | |
| 14 | RETURNED_BY_PMU | |

Editable sets live in `module/xvi-fc/common/utils/xvi-fc-form-status-access.util.ts`:
`ULB_EDITABLE_STATUSES` (1, 2, 4, 6), `STATE_EDITABLE_STATUSES` (1, 2, 6, 14) and
`STATE_EDITABLE_ROW_STATUSES` (null, 14, 6). Because 6 is in all three, a MoHUA return already
reopens editing for the owner. The exception is the row resubmit flow (section 5, A1).

Annual Accounts keeps a string status plus a numeric `form_status_id` per section
(`schemas/xvi-fc/annual-account.schema.ts`). Always write both.

### 1.3 PMU review - the pattern to reuse

- Code: `module/xvi-fc/pmu/<form>/` (5 modules). Rationale: `module/xvi-fc/common/services/CLAUDE.md`
  section "PMU Review shared mechanics". Closest reference for row-level work:
  `module/xvi-fc/pmu/elected-urban-local-bodies/` and its `CLAUDE.md`.
- PMU owns no schema. Each PMU module registers the State module's own models and writes their
  status fields. Follow the same approach for the forms this task changes.
- Shared helpers, all in `module/xvi-fc/common/`. Reuse them, do not copy them:
  - `services/state-form-pmu-review.helper.ts` - `StateFormPmuReviewHelper.transitionForm`,
    `writeHistoryIfChanged`. They don't depend on a form's shape.
  - `services/pmu-row-review.helper.ts` - `PmuRowReviewHelper`: `getActiveRows`,
    `loadActiveRowsByIds`, `loadActiveRowsBySelectAllMatching`, `filterNotInStatus`,
    `transitionRows` (one `bulkWrite` + one `insertMany`), `getRowStatusTally`, `getRowSummary`;
    and `resolveSettledFormStatus`.
  - `utils/xvi-fc-reviewer-access.util.ts` - `assertReviewerAccess(user, scope, message)`,
    `assertPmuReviewerAccess`, `assertPmuOrMohuaViewerAccess` (PMU, MoHUA, DoE, ADMIN).
  - `utils/xvi-fc-reviewer-permissions.util.ts` - `buildReviewerFormPermissions`.
  - `dto/bulk-approve-pmu-rows.dto.ts`, `dto/bulk-reject-pmu-rows.dto.ts`,
    `dto/select-all-matching-pmu-rows.dto.ts` - either explicit ids (capped at 1000) or
    `selectAllMatching` plus `excludeRowIds`, resolved on the server.
- Known PMU gap. Do not copy it. PMU writes filter by `_id` only, so two concurrent decisions
  can both succeed. This task closes that gap for its own writes (section 4.6).

---

## 2. Background: the claim eligibility engine

- Every source form's formJson (`formjsons` collection, keyed by `design_year` + `formId`) has a
  `claimEligibility` block. The current payload for every form is `xvifc-payload-08102026.json`
  at the backend repo root.
  - Type: `module/xvi-fc/common/types/claim-eligibility.type.ts`.
  - Validation: `master/form-json/dto/claim-eligibility-config.dto.ts`.
- **Key fields:**
  - `ownerLevel` (STATE / ULB) and `evaluationLevel` (FORM / FORM_AND_ROW).
  - `applicableInstallments` and `acceptedFormStatuses`.
  - `source` - collection and field mapping, plus `rowCollection` / `parentCollection` for
    row-level forms.
  - `evaluator.config` - row match rules, and `installmentField` for per-installment documents.
  - `exemption.allowed`.
  - `approval` / `rejection` - currently `NO_ACTION` and read by nothing. This task starts
    reading them (section 4.5).
- **Loading and evaluating:**
  - `FormJsonService.findEnabledClaimEligibilitySources(yearId)` loads every enabled source. It
    is Redis-cached and the cache is cleared on any form-json write.
  - `ClaimEligibilityEvaluatorService` (`module/xvi-fc/common/services/claim-eligibility-evaluator.service.ts`):
    - `evaluate` - one State-level source, returning PASSED / EXEMPTED / FAILED with evidence.
    - `evaluateUlbBulk` - per-ULB results for a whole State in one query (ULB form sources) or
      per-row evidence (row sources).
- **Exemptions** come in three kinds:
  - Automatic, for new ULBs (Dynamic Year Access): either no document at all, or a stub
    document at status 12.
  - Discretionary per ULB: an approved Request Exemption (formId 34).
  - Discretionary whole-State: an approved Request Exemption for the State (for example SFC).
- Criteria are data, not code. Adding or removing a criterion is a formjson change. Keep it that
  way - never add per-criterion `if` branches.

---

## 3. Background: Claim Letter today

Code: `module/xvi-fc/state/claim-letter/`. Read its `CLAUDE.md` and
`docs/adr/0001-idempotent-retry.md`, `0002-batching-and-locks.md`, `0003-workflow-transitions.md`.

- **Batch** - `ClaimLetterBatch`, collection `xvifc_claim_letter_batches`. One document per
  State + year + installment + batchNumber + version.
  - Up to 3 batch slots (hardcoded today).
  - `assemblyStatus` BUILDING/READY is a build guard, not a workflow status.
  - Other fields this task uses: `revision` (optimistic concurrency), `editLockToken` (a
    5-minute lease), `supersedes` / `supersededBy`, `isAbandoned`, `mohuaRemarks`,
    `resolvedAt` / `resolvedBy`, `dependencyInvalidated`.
- **Child** - `ClaimLetterBatchUlb`, collection `xvifc_claim_letter_batch_ulbs`. One per ULB per
  batch version. It holds the allocation (from that ULB's Devolution Formula row), the claimed
  amount, and an `eligibilitySources` snapshot of the evidence the claim relied on.
- **Lock** - `ClaimLetterUlbLock`, collection `xvifc_claim_letter_ulb_locks`.
  - Unique per State + year + installment + ULB, with `lockState` ACTIVE or ACKNOWLEDGED.
  - It stops a ULB from being in two claims at once.
  - Devolution Formula row edits already check it (`assertNoActiveClaimLockForUlb` in
    `module/xvi-fc/state/devolution-formula/services/row/devolution-formula-row.service.ts`).
- **History** - `ClaimLetterBatchHistory`, collection `xvifc_claim_letter_batch_logs`.
- **Flow today** - draft (2), then upload the signed letter, then submit (5). Nothing happens
  after that yet.
- **Rules today:**
  - Each ULB's claim must be within 90-110% of its allocation (formId 26 `meta`).
  - The last batch slot can't be submitted while any expected ULB is unclaimed
    (`assertFinalBatchIsComplete` in `services/main/claim-letter.service.ts`).
- **Built but never called:**
  - `ClaimLetterAssemblyService.createNewVersion` and `acknowledgeLocks`.
  - The history field `rejectedSourceRefs`.
  - The batch fields `dependencyInvalidated` / `dependencyInvalidationReason`.
- **Cron** - `ClaimLetterRecoveryService.runScheduledStaleBuildCleanup`
  (`services/recovery/claim-letter-recovery.service.ts`) runs hourly and deletes drafts stuck in
  BUILDING. `detectAnomalies` is report-only and nothing runs it.
- **Frontend** - `state-module/claim-letter/`: list, detail, ULB table, ULB picker, eligibility
  checklist, summary tiles, document preview. It is switched off by the hardcoded
  `claimLetterSubmissionEnabled = false` in `claim-letter-list.component.ts`.
- **No production data** exists for Claim Letter, so its schemas and field names can change
  freely, with no backward-compatibility code.

---

## 4. Decisions (agreed)

### 4.1 Who reviews

- MoHUA reviews claims directly. There is no PMU stage for claims. New backend module:
  `module/xvi-fc/mohua/claim-letter-review/`.
- No new permissions:
  - **Decide** (approve / return): `APPROVE_STATE_SUBMISSIONS`, held by MoHUA admin only, plus
    a MoHUA/ADMIN scope assert (`assertReviewerAccess(user, Scope.MOHUA, ...)`).
  - **Read**: `REVIEW_STATE_SUBMISSIONS_PMU`, which every MoHUA subrole, PMU and DoE already
    hold as their read gate, plus `assertPmuOrMohuaViewerAccess`. So MoHUA reviewer and viewer,
    DoE and PMU see everything read-only.
  - DoE writes are already blocked by `DoeReadOnlyGuard`.

### 4.2 Batch lifecycle

```
IN_PROGRESS (2) --submit--> UNDER_REVIEW_BY_MOHUA (5) --approve--> SUBMISSION_ACKNOWLEDGED_BY_MOHUA (7)
                                                      --return---> RETURNED_BY_MOHUA (6)
RETURNED_BY_MOHUA (6) --new version--> new IN_PROGRESS draft (same slot, version + 1, supersedes link)
RETURNED_BY_MOHUA (6) --abandon------> isAbandoned, locks released, slot freed
```

- MoHUA can decide only at status 5.
- A decision always covers the whole batch. There is no partial approval.
- **New version after a return:**
  - `createNewVersion` creates an IN_PROGRESS draft prefilled with the returned version's ULBs
    and amounts.
  - The State may change amounts, drop ULBs or add newly eligible ULBs. Dropping is not allowed
    in the closing batch.
  - A new signed letter is always required.
  - The returned version gets `supersededBy`.
- **Abandoning a returned batch** releases its locks and frees the slot.
- The State cannot withdraw a batch once it is submitted.
- If the closing batch is returned for a ULB form issue, the State cannot drop that ULB. It
  waits for the ULB to fix the form.

### 4.3 Return (rejection)

- **What can be returned.** One return can combine any mix of:
  - **State form items** - SFC, GTC, Devolution Formula, and Elected Body or FC Unspent as a
    whole form (the parent, for example a wrong signed list or declaration PDF).
  - **ULB items** - for selected ULBs, any of their ULB forms (AFS, PFS, SLB, Bank Account, DUR)
    and their row-level items (Elected Body row, FC Unspent row).
  - **Claim letter issue** - a remark only (wrong signed PDF, wrong amounts, missing signature).
    No form status changes.
- **Remarks.** Every item needs a remark: trimmed, maximum 1000 characters
  (`REVIEW_REMARKS_MAX_LENGTH`). The UI offers "apply remark to selected" plus a per-item
  override.
- **Only what the batch relied on.** MoHUA can return only sources this batch pinned with result
  PASSED. Exempted sources are shown as exempted and can never be returned.
- **Effects** - all in one transaction:
  - The batch moves to 6, and `mohuaRemarks`, `resolvedAt` and `resolvedBy` are set.
  - Each returned State form moves to 6. The State edits it and resubmits, and it goes through
    PMU again.
  - Each returned ULB form moves from 8 to 6. The ULB edits and resubmits, and the State
    approves it again.
  - Each returned row's `rowStatus` moves to 6. Its parent stays at 5 (A1). A
    whole-form return moves the parent to 6.
  - Children with returned items get `returnedItems[]` and `isReturned: true`.
  - Every other open batch (status 2 or 5) that pinned a returned State form gets
    `dependencyInvalidated: true` plus a `DEPENDENCY_INVALIDATION` history entry. Approved
    batches are never touched. A row return never invalidates other batches, because a ULB is
    only ever in one batch.
  - Locks stay ACTIVE. They belong to the batch until it gets a new version or is abandoned.
- **After commit**, emails go to the State (every item) and to each ULB with returned forms (its
  own items only).

### 4.4 Approve

- Approval is allowed only if re-verification passes:
  - Re-run the evaluator for the State gate and for this batch's ULBs. Never use the cached
    `*ForDisplay` methods.
  - Compare the results with the pinned `eligibilitySources`.
  - Block with a 409 and the list of problems only if a pinned source no longer passes, or its
    exemption was revoked.
  - Harmless changes (a source moved from 5 to 7, a ULB became exempt) are recorded in the
    history `data` but don't block.
- **Effects** - all in one transaction:
  - The batch moves to 7, with `resolvedAt`, `resolvedBy` and an optional remark.
  - `acknowledgeLocks` moves the batch's locks to ACKNOWLEDGED.
  - Source acknowledgements per 4.5.
  - History for all of the above.

### 4.5 When a source moves to 7

- A source form's own status changes only when MoHUA returns it (to 6), or when no later claim
  can depend on it (to 7).
- **"No later claim can depend on it" means:**
  - **ULB-owned forms and row-level rows** (per ULB): this batch's installment is the last one in
    the source's `applicableInstallments`. They move with that ULB's batch approval.
  - **Per-installment State forms** (Devolution Formula and GTC, which have
    `evaluator.config.installmentField`): when that installment's claim cycle closes.
  - **Per-year State forms** (SFC, and the Elected Body and FC Unspent parents): when the claim
    cycle of the last installment in `applicableInstallments` closes.
- **Cycle close** for an installment means no expected ULB is left unclaimed, and every live
  batch of that installment is at 7. A live batch is one that is neither abandoned nor
  superseded. Check it after every approval.
- **In V1 (Installment 1 only):**
  - DUR moves to 7 with each ULB's approval.
  - The Installment 1 Devolution Formula and GTC documents move to 7 at cycle close.
  - Everything else stays at its accepted status (5 or 8). Screens show "Acknowledged in Batch N"
    from the claim data.
- Exempted sources (status 12, or a discretionary exemption) are never written.
- **Data decides what, code decides when.** Target statuses come from formJson:
  - `claimEligibility.approval` is `SET_FORM_STATUS` (or `SET_ROW_STATUS` for row sources)
    with target 7.
  - `claimEligibility.rejection` is the same with target 6.
  - Code decides only when to apply them.

### 4.6 Data integrity

1. **Freeze sources while a claim uses them.** A ULB with any claim lock (ACTIVE or
   ACKNOWLEDGED) cannot be changed under that claim:
   - State undo on its ULB forms is blocked.
   - Elected Body post-submission updates for its row are blocked.
   - Devolution Formula row edits and Excel re-uploads must keep its amounts (A2).
2. **Store the evidence.** Every child stores one `eligibilitySources` entry per applicable
   criterion: document, row, status, revision or dataset version, and exemption kind and id.
3. **Re-verify at approval** (4.4).
4. **Atomic, conditional writes.** One Mongo transaction per decision covers the batch,
   children, locks, source statuses and every history row.
   - Every source write filters on its expected current status, for example
     `{ _id, currentFormStatus: 5 }`, `{ _id, rowStatus: 5 }`, or for Annual Accounts
     `{ _id, form_status_id: 8 }`.
   - The transaction aborts unless `matchedCount` equals the expected count.
   - The batch write filters on `revision` (compare-and-set).
   - `bulkActionId` and `requestId` make a retry safe.
5. **Propagate returns** through `dependencyInvalidated` (4.3).
6. **Reconcile.** New anomaly checks go into `detectAnomalies` (Phase 7).
7. **Synchronous, not queued.** The worst case is 500 ULBs x about 7 sources: roughly 3,500
   status updates plus history rows, which is 10-15 bulk calls in one transaction. Only the
   notifications are asynchronous, queued after commit.

### 4.7 ULB claim status comes from locks, not status 9

- No status 9 writes. ULB forms stay at 8 while they're in a claim, and move to 7 or 6 only when
  MoHUA decides.
- A ULB's claim status is derived from its lock plus that lock's batch: none, In claim draft,
  Under review by MoHUA, Returned by MoHUA, or Acknowledged by MoHUA (Batch N).
- One shared backend helper resolves it for many ULBs at once: one `$in` query on locks and one
  on batches.
- Shown on:
  - the ULB dashboard and each ULB form page
  - the State ULB submissions list and the State's per-ULB review page
  - MoHUA's state-detail ULB list and its ULB detail page
  - the PMU row tables

### 4.8 Exemptions keep their detail

- Every child stores an entry for every applicable criterion, including the ULB-owned form
  sources, which aren't stored today.
- Each entry records an explicit exemption kind and id.
- `formDocumentId` may be null, but only when the result is EXEMPTED.
- `appliedExemptionIds` is populated.
- Exempted entries are never returnable and are never written on approval.

### 4.9 History matches the other State forms

- The batch history uses the same field names as the State form histories (SFC, Devolution
  Formula, GTC, Elected Body, FC Unspent): `action` (`FormHistoryAction`), `fromStatus`,
  `toStatus`, `changedBy`, `changedAt`, `ip`, `userAgent`, `remarks`, `data`, `snapshot`,
  `isActive`, `isDeleted`.
  - It keeps its claim-specific fields: `installment`, `batchNumber`, `version`, `requestId`,
    `bulkActionId`, `rejectedSourceRefs`.
- **What each entry saves:**
  - On `FINAL_SUBMIT`: `data` (the batch payload) and `snapshot` (one compact entry per child).
  - On decisions, abandon and new version: `snapshot: null`. Nothing in the data changed, and
    the existing rule is to snapshot only when data could change.
- **Child history** is shaped like the Elected Body / FC Unspent row history.
- **Source forms changed by a decision** log into their own history collection. The claim
  reference goes in `data`, or in `snapshot` for row histories.
- SLB gets a history collection. Today it has none.

### 4.10 Money rules

- The per-ULB 90-110% variance stays (formId 26 `meta`).
- **Closing batch.** This is the batch after which no expected ULB is left unclaimed. Its submit
  requires the total claimed across the installment's live batches to equal the sum of the
  State's Devolution Formula `installment1Amount`. The last slot is always a closing batch,
  because of the existing final-batch rule.
- **Devolution Formula split check** (new uploads and submits only):
  - Each installment column must sum to half of the grant, G = round(basic + performance) from
    `grantAllocation`.
  - `installment1 = floor(G / 2)` and `installment2 = G - installment1`, so an odd rupee goes to
    Installment 2.

### 4.11 Out of scope

- **Installment 2 claims.** Keep the `assertInstallmentSupported` guard. Every rule here is keyed
  by installment, so enabling Installment 2 later means lifting guards, not redesigning.
- **The stage after approval** (forwarding to DoE, Office Memorandum). `FINAL_SUBMIT_TO_DOE` and
  `ISSUE_OFFICE_MEMORANDUM` exist as permissions only.
- **Dashboards.** The State dashboard claim tiles, weekly State summary counts and MoHUA overview
  claim stage keep their current "Coming soon" or stubbed state.
- **Migration scripts.** Database changes to config go through the existing APIs:
  `POST/PATCH form-json` and `xvi-fc/side-menu`.

---

## 5. Confirmed design points from code findings

All four are confirmed with the product owner.

### A1 - A MoHUA row return keeps the parent at 5 (Phase 8)

When MoHUA returns one Elected Body or FC Unspent row, only that row goes back through PMU. The
parent form stays at 5 throughout.

**Why not the PMU approach.** The PMU approach would move the row and the parent to 6 (and both
to 13 on resubmit). While the parent is at 6 or 13, the form fails the State-level check:
- the State can't build or edit drafts
- MoHUA can't approve any other open batch
- other open batches get marked "dependency invalidated"
- the State could edit or re-upload the whole form, not just the returned row

The business rule is that row-level decisions affect only the relevant ULBs. With the parent at
5, only that ULB is ineligible (its row isn't at 5 or 7), and other batches are untouched.

**What the code does today.**
- A State row resubmit handles only rows at 14, and moves the parent to 13
  (`module/xvi-fc/state/elected-urban-local-bodies/services/row/elected-urban-local-bodies-row.service.ts`,
  around lines 266-340).
- PMU row decisions require the parent at 13 (`assertCanPmuMutateForm` in both
  `pmu/*-pmu-rows.service.ts`).

**What changes**, for Elected Body and FC Unspent alike, all inside existing code:
1. **State row edit and resubmit.** A row at 6 can be edited while the parent is at 5.
   Resubmitting moves only the row to 13 and leaves the parent untouched. This extends the
   existing `ROW_RESUBMIT` path.
2. **PMU row decisions.** PMU can approve or reject rows at 13 while the parent is at 5. Widen
   the gate in the two `*-pmu-rows.service.ts` files for rows only. PMU's whole-form approve and
   reject stay blocked while the parent is at 5.
3. **Settle step.** `maybeSettleAfterBulkAction` leaves a parent that is at 5 unchanged.
   `resolveSettledFormStatus` itself stays as it is.
4. **PMU visibility.** The PMU worklist filters on the parent's status, so a resubmitted row
   under a parent at 5 would be invisible. Add a "rows pending" count to the worklist rows, and
   let the row table show these rows as pending.

**Where the PMU approach still applies:**
- PMU rejecting rows before any claim exists, which is unchanged.
- MoHUA returning the whole form (for example a wrong signed list or declaration PDF). There the
  parent moves to 6, because the problem affects the whole form.

### A2 - Locked ULBs' data stays frozen when a returned form is edited (Phases 3 and 8)

The Devolution Formula Excel re-upload has no claim-lock check today. Only the row edit does.
- After a Devolution Formula return, a row edit or re-upload must keep the amounts of every ULB
  with a claim lock, or fail validation.
- After a whole-form Elected Body or FC Unspent return, a re-upload must keep the row values of
  locked ULBs.

### A3 - The closing batch needs settled siblings (Phase 1)

By the end of an installment, the claims across all batches must add up exactly to the
allocation. The check runs when the State submits the closing batch (the batch that claims the
last unclaimed ULBs), and it adds up every live batch.

**The problem.** The check can count a batch that later disappears. Example, with an allocation
of 100:
- Batch 1 (40) is approved.
- Batch 2 (30) is a draft.
- Batch 3 (30) is the closing batch. 40 + 30 + 30 = 100, so it passes.
- Later batch 2 is abandoned. Its ULBs are released and its 30 drops out, so the real total is
  70.

**The rule.** The closing batch can be submitted only when every other live batch of the
installment is at 5 or 7. Any draft or returned batch must be submitted or abandoned first.

**The case this rule can't prevent.** A sibling that was at 5 when the closing batch went in
could later be returned by MoHUA and then abandoned. The cycle-close rule (4.5) covers it:
- The installment only counts as finished when every expected ULB is in an approved batch and
  the total matches. Only then do Devolution Formula and GTC move to 7.
- Abandoning a batch frees its slot, so the State can claim those ULBs again. That new batch
  becomes the closing batch and goes through the same check.

### A4 - DoE and PMU get the review screens read-only (Phase 9)

Because they have read access, the worklist and detail routes are also registered for DoE (the
shared `MOHUA_DASHBOARD_ROUTES` list) and in the PMU module. The backend `permissions` hide the
actions.

---

## 6. Phases

### Part 1 - Claim Letter

#### Phase 1 - Claim Letter correctness (backend and payload)

**Backend**

1. **Batch limit from config.**
   - Add `maxBatchCount` to formId 26 `meta`. Read it in `ClaimLetterFormJsonService.loadFormConfig`
     next to the variance band, defaulting to 3 when the config isn't seeded (same fallback as
     the variance band).
   - Replace every `CLAIM_LETTER_MAX_BATCH_NUMBER` use with the configured value: slot
     allocation (`resolveBatchSlotInfo`, `allocateBatchNumber`, `reserveBatchSlotAndLocks`),
     `assertFinalBatchIsComplete`, and claim context (`batchSlotsMax`).
   - Remove the `batchNumber` enum `[1, 2, 3]` from `claim-letter-batch.schema.ts` and
     `claim-letter-batch-history.schema.ts`, and the `ClaimLetterBatchNumber = 1 | 2 | 3` type
     (use `number`, minimum 1).
   - Guard: per State and installment, the effective maximum is the larger of the config value
     and the highest live batch number, so lowering the config never strands a live batch.
2. **Closing-batch total check** (4.10) in `ClaimLetterService.submit`, next to
   `assertFinalBatchIsComplete`.
   - Include the sibling rule from A3.
   - Use the existing `resolveDevolutionAllocations` for the expected total; don't add a new
     query for it.
   - Error through `throwXviFcValidationError({ _form: [...] })` with a new code (for example
     `claimTotalMismatch`) carrying the expected amount, actual amount and difference.
   - Add `installmentAllocationTotal` and `claimedTotalIfSubmitted` to the claim context so the
     UI can warn before submit.
3. **Devolution Formula split check** (4.10).
   - Where: `module/xvi-fc/state/devolution-formula/services/excel/devolution-formula-excel.service.ts`
     (next to `allocationBalanced`, around line 362) and in the Devolution Formula `finalSubmit`.
   - Use `resolveGrantAllocation`.
   - A failure sets form validation to INVALID with a new error code.
4. **Evaluator `isDeleted`.** Add an optional `isDeleted` key to
   `ClaimEligibilitySourceFieldMapping` (type and DTO). When it's mapped, the evaluator adds
   `{ [field]: { $ne: true } }` to form, row and parent queries.
5. **Transition tables.**
   - In `common/utils/form-status-transitions.ts`, add `8 -> 7` and `8 -> 6` (ULB forms decided
     through a claim).
   - Put the claim batch's own transitions (2 -> 5, 5 -> 6, 5 -> 7) in a claim-letter-local map,
     not in the shared table. The ULB services (`annual_accounts`, `bank-account`, `dur`, and
     `src/forms/services/form-submission-status.service.ts`) validate against the shared table
     and must not gain `2 -> 5`.
6. **Stale comments.** Fix the ones that promise status 9 (`schemas/xvi-fc/annual-account.schema.ts`
   lines 7-10 and `common/utils/form-status-transitions.ts` lines 26-30), and the evaluator
   comment that says SLB has no `state` field (around line 268).

**Payload** (`xvifc-payload-08102026.json`; commit it, it is currently untracked)

- SLB (formId 32):
  - `acceptedFormStatuses` changes from `[3]` to `[5, 7, 8]`. SLB lands on 8, so today every
    submitted SLB counts as ineligible.
  - Add the `state` and `isActive` field mappings.
- Add `isDeleted` mappings for `xvifc_sfc`, `xvifc_elected_ulb_forms`, `xvifc_unspent_state_forms`
  and `xvifc_slb_forms`.
- Add `maxBatchCount: 3` to formId 26 `meta`.

**Tests**

- Slot allocation with config values, including a lowered config.
- Closing-batch total pass and fail, including the sibling rule.
- Devolution Formula split pass and fail, including an odd total.
- Evaluator `isDeleted` filtering.
- Transition table entries.

**Done when** the batch limit comes from config, a closing batch with a wrong total is rejected,
and SLB-submitted ULBs evaluate as eligible.

#### Phase 2 - Evidence and exemption detail (backend)

1. **Bug.** `toEligibilitySourceSnapshot` (claim-letter assembly service, around line 713)
   throws when `formDocumentId` is null. But the evaluator returns EXEMPTED with no document
   for a State that has an approved whole-State exemption and never created the form, so that
   State can never create a claim.
   - Allow null `formDocumentId` in the method and in `claim-letter-eligibility-source-snapshot.schema.ts`,
     but only when `result === 'EXEMPTED'`.
2. **Per-ULB evidence for ULB form sources.** `evaluateUlbBulkFormStatus` also returns
   `formEvidenceByUlbId`: document id or null, resolved status, result, exemption kind and
   exemption id.
   - Mirror the existing `rowEvidenceByUlbId`.
   - Same query, a few more selected fields.
   - `buildExemptionLookup` already separates automatic from discretionary exemptions; carry
     that through.
3. **Exemption kind on every snapshot entry.**
   - Add `exemptionKind: 'AUTO_NEW_ULB_NO_DOCUMENT' | 'AUTO_NEW_ULB_STUB' | 'DISCRETIONARY_ULB' | 'DISCRETIONARY_STATE' | null`
     and the per-ULB `exemptionId`.
   - Replace the generic `ROW_EXEMPTED` reason code with the specific kind.
4. **Every criterion on every child.** `buildChildEligibilitySources` (around line 744) builds
   one entry per FORM and per FORM_AND_ROW source for the ULB. Today it builds only
   FORM_AND_ROW entries.
5. **`appliedExemptionIds`** is populated on each child (today it's always `[]`, around line
   680).
6. **Content hash.** Bump `CLAIM_LETTER_CONTENT_HASH_VERSION` from 5 to 6, and check that
   `assertEligibilitySourcesValid` and `verifyPersistedChildren` still hold.

**Tests** - one snapshot per exemption kind, an exempted State source with no document, all
criteria present on each child, and the content hash.

**Done when** a draft for a State with mixed exempt ULBs records every criterion and its
exemption kind for every ULB.

#### Phase 3 - Claim status from locks and freeze guards

**Backend**

1. **Claim status helper.** Add a shared service in `module/xvi-fc/common/services/` (for example
   `claim-status-lookup.service.ts`, exported from `XviFcCommonModule`):
   - Signature: `resolveForUlbs(stateId, yearId, installment, ulbIds)`.
   - Returns `Map<ulbId, { status, claimLetterId, batchNumber, version }>`, with status one of
     `NONE | IN_DRAFT | UNDER_REVIEW | RETURNED | ACKNOWLEDGED`.
   - Two queries in total, regardless of how many ULBs.
2. **Shared lock guard.** Move `assertNoActiveClaimLockForUlb` out of
   `devolution-formula-row.service.ts` into common (for example `assertUlbNotInClaim`). It
   blocks on any lock, ACTIVE or ACKNOWLEDGED. Call it from:
   - Annual Accounts `undoSectionApproval` and `undoDocumentDecision` (`module/xvi-fc/ulb/annual_accounts/annual_accounts.service.ts`)
   - Bank Account `undoApproval` (`module/xvi-fc/ulb/bank-account/bank-account.service.ts`)
   - DUR `undoDurApproval` (`module/xvi-fc/ulb/dur/dur.service.ts`)
   - any SLB path that moves a form out of 8 (find them first)
   - Elected Body post-submission updates for rows of locked ULBs (`module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service.ts`)
   - Devolution Formula row edit (switch the existing caller) and the Devolution Formula Excel
     re-upload (A2)

   Search for every write of `form_status_id` / `currentFormStatus` in `module/xvi-fc/ulb` to
   make sure no other path leaves 8. The `canUndo*` flags in the read responses must be `false`,
   with a reason, when the ULB is locked.
3. **Claim status on read endpoints.** Add it to the endpoints behind the screens in 4.7, with
   one helper call per request, never one per row:
   - the ULB forms dashboard and each ULB form GET
   - the State ULB submissions list and per-ULB review GET
   - `module/xvi-fc/mohua/overview/mohua-state-ulbs.service.ts` (including its Excel export)
     and the MoHUA ULB forms GET
   - the PMU row GETs (Elected Body, FC Unspent, Devolution Formula)

**Frontend**

1. **Label and badge functions.** Add `claimStatusLabel()` and `claimStatusBadgeClass()` in
   `common/`. Render them as `badge rounded-pill`, like every other status. There is no shared
   badge component, so don't create one.
2. **Use the existing slots only, with no new layout:**
   - `ulb-module/ulb-forms/` (`CONDITION_STATUS_DISPLAY` / the condition row subtitle).
   - Each ULB form page's `LOCKED_BANNER_MESSAGE` banner (`ulb-forms/upload-documents/`,
     `dur/`, `xvi-fc-bank-account/`, `slb/`). Replace the dead `AWAITING_CLAIM_LETTER` texts
     there with the claim-status message.
   - A new column in `state-module/ulb-submissions/` (`displayedColumns`).
   - The `.approval-banner` message in `state-module/ulb-submissions/annual-account-review/`
     when undo is blocked.
   - `mohua-module/state-detail/` `ULB_COLUMNS`, and the `mohua-module/ulb-detail/` header card.
   - `pmu-module/row-review-detail/`, next to the row badge.

**Tests** - the helper (bulk, every status), each guarded undo path, the Elected Body
post-submission block, the Devolution Formula re-upload guard, the frontend label and class
functions, and one component per slot type.

**Done when** a locked ULB's State undo is blocked with a clear message, and every listed screen
shows the ULB's claim status.

#### Phase 4 - Cron and pagination

**Cron** (`services/recovery/claim-letter-recovery.service.ts`)

1. Write a `logger.log` line on every run: start time, stale builds found, cleaned, failed and
   duration. It runs even when the count is 0.
2. Remove the per-batch loop. Use one query for the stale BUILDING parents, then bulk-delete
   their children, locks and parents in bounded chunks. Extend `deleteBuildingParentArtifacts`
   to take many ids.
3. Add a daily cron for `detectAnomalies`. It only logs its findings and never writes. It runs
   daily rather than hourly because it does S3 lookups.
4. Add the env flag `XVIFC_CLAIM_LETTER_CRONS_ENABLED`. Both cron methods no-op unless it is
   exactly `'true'`, the same way the reminder crons work. Add it to the root `CLAUDE.md` env
   table, with a warning that leaving it unset means stuck drafts are never cleaned.

**Pagination**

1. Lower `CLAIM_LETTER_PAGINATION_MAX_LIMIT` from 100 to 25 for every Claim Letter list endpoint.
2. Frontend: lower `CLAIM_LETTER_ULB_ROWS_PAGE_SIZE` from 100 to 25.
   `ClaimLetterService.getAllUlbs` fetches page 1, then the remaining pages concurrently with a
   bounded concurrency. The editable draft table needs every row for its totals. No design
   change.
3. The document endpoints (`getAllUlbRows`, `GET :claimLetterId/document`, `.../document/pdf`)
   render a whole document, so they stay unpaginated. They are not list endpoints.

**Tests** - the cron logs for zero and non-zero runs, flag off means no-op, chunked cleanup, the
daily anomaly run, and the page-limit validation.

**Done when** every run logs a line, no database call happens inside a loop, and no Claim Letter
list returns more than 25 rows.

#### Phase 5 - Part 1 frontend fixes and cleanups

1. **Batch limit.** The UI already reads `batchSlotsMax`, `canCreate` and `nextBatchNumber` from
   the backend. Remove the `1 | 2 | 3` batch type in `claim-letter.models.ts` and any leftover
   hardcoded 3.
2. **Closing-batch total.** Show the mismatch in the detail page's existing final-batch alert
   (acknowledgement bar), using the new claim context values. The backend error stays the source
   of truth.
3. **Devolution Formula split error.** Display it through the existing Devolution Formula error
   display.
4. **Cleanups:**
   - One `FORM_STATUS` constant. Claim Letter detail (and any other importer) uses
     `common/constants/form-status.constants.ts`, not the partial copy in
     `shared/form-progress/form-progress.component.ts`. Remove the copy once nothing imports it.
   - Remove the unused MoHUA placeholder `mohua-module/review-state-submissions/` and its route.
     It shares the selector `app-review-state-submissions` with the PMU worklist.
   - Add `menuGroup` to the `claim-letter/new` and `claim-letter/:claimLetterId` routes in
     `state-module/state-module.routes.ts`, so the sidebar item stays highlighted.

**Tests** - update the specs of every touched component.

**Done when** Part 1 works end to end in the UI, with no visual change to Claim Letter beyond the
new messages.

### Part 2 - Claim Letter Review

#### Phase 6 - Review foundations (backend)

1. **`FormHistoryAction`** (`common/constants/form-status.constants.ts`): add `MOHUA_APPROVE`,
   `MOHUA_REJECT`, `ABANDON`, `NEW_VERSION` and `DEPENDENCY_INVALIDATION`.
2. **Batch history schema** (`schemas/xvi-fc/state/claim-letter-batch-history.schema.ts`). Rename
   freely to the 4.9 field set: drop `actionSource`, `reason` and `ipAddress`.
   - `rejectedSourceRefs` entries gain an `itemType`: `STATE_FORM`, `ULB_FORM`, `ROW` or `LETTER`.
   - Update `ClaimLetterHistoryService.recordTransition` and every caller.
   - `FINAL_SUBMIT`: `data` holds the signed file reference, `financialSummary`, `ulbCount`,
     `contentHash` and `stateEligibilitySources`. `snapshot` holds one entry per child (ulbId,
     ulbSnapshot, allocated, claimed, eligibility results without the `evidence` blobs).
   - Keep the ADR 0003 rule: no history entry for `updateDraft` or the signed-file upload.
3. **Child schema** (`claim-letter-batch-ulb.schema.ts`).
   - Add `returnedItems[]` (`{ itemType, formId, formDocumentId, rowDocumentId, remark }`) and
     `isReturned` (default false).
   - Add the index `{ claimLetter: 1, isReturned: 1 }`.
   - Declare every field. Mongoose strict mode silently drops undeclared fields from `bulkWrite`,
     as happened before with Elected Body's `rejectionRemark`.
4. **Child history** - a new `xvifc_claim_letter_batch_ulb_logs` collection, shaped like
   `elected-urban-local-bodies-row-history.schema.ts`.
   - Fields: `claimUlb`, `claimLetter`, `state`, `year`, `previousStatus`, `currentStatus`
     (the batch transition), `snapshot` (the child's `returnedItems`), `createdBy`, `updatedBy`,
     `ipAddress`, `userAgent`.
5. **SLB history** - a new `xvifc_slb_form_logs` collection in `schemas/xvi-fc/ulb/`, with the
   same shape as the State form histories plus `state`.
   - Fields: `slbForm`, `ulb`, `state`, `year`, `action`, `fromStatus`, `toStatus`, `changedBy`,
     `changedAt`, `ip`, `userAgent`, `remarks`, `data`, `isActive`, `isDeleted`.
   - Make the existing SLB status changes (submit and so on) write to it as well.
6. **Source writers.** Define one interface in common (`ClaimSourceWriter`) and one
   implementation per formId, registered by formId.
   - **Contract.** `acknowledge(items, ctx, session)` and `returnItems(items, ctx, session)`.
     Each does one `bulkWrite` with status-conditional filters and one `insertMany` into that
     form's own history, and returns the matched count.
   - **Location.** The writers live in `module/xvi-fc/mohua/claim-letter-review/writers/` and
     register the source models there, the same way PMU modules do.
   - **State forms** (SFC 22, Devolution Formula 24, GTC 35, and the Elected Body 23 and
     FC Unspent 25 parents): follow each form's history shape and the `writeHistoryIfChanged`
     convention. Store the remark in the form's `mohuaRemarks` field, which the State pages
     already show through `app-returned-reason-banner`. Add the field to any schema that lacks
     it.
   - **Rows** (Elected Body, FC Unspent): reuse `PmuRowReviewHelper.transitionRows` with
     `buildSnapshot` and `rejectionRemark`.
   - **Annual Accounts**: reuse the field set and `buildDecisionRecord` from `decideMohuaSection`.
     It writes `form_status`, `form_status_id`, `mohuaDecision` and `modifiedBy`, and logs to
     `xvifc_annualaccount_form_logs` with `actorStage: 'MOHUA'`. Extract that mapping into a
     helper in `ulb/annual_accounts` that both the endpoint and the writer call until Phase 11.
   - **Bank Account**: do the same with `decideMohuaBankAccount` (`xvifc_bankaccount_form_logs`).
   - **DUR and SLB**: follow their existing return-remark fields (find them first). DUR logs to
     `xvifc_dur_forms_logs`; SLB logs to the new history.
   - **Claim reference.** Every history entry carries `claimLetterId`, `batchNumber`, `version`
     and `bulkActionId` in `data`, or in `snapshot` for row histories.
   - **Targets and exemptions.** Target statuses come from `claimEligibility.approval` /
     `.rejection`. Writers skip EXEMPTED entries.
7. **Payload.** Set `approval` / `rejection` on all 10 source forms to target 7 and target 6,
   using `SET_ROW_STATUS` for the row sources.

**Tests**

- Each writer, for both acknowledge and return.
- A status-conditional filter mismatch aborts the transaction.
- Exempted entries are skipped.
- History shapes match the form's own history.
- The history service.

**Done when** the writers can acknowledge and return any source form in bulk inside a
transaction, each with its own history.

#### Phase 7 - MoHUA Claim Letter Review module (backend)

Module: `module/xvi-fc/mohua/claim-letter-review/`. Lay it out like
`pmu/elected-urban-local-bodies/`: controller, module, review / rows / decision services, dto,
types, constants, writers and `CLAUDE.md`.
- Register Claim Letter's models and the writers.
- Import `XviFcCommonModule` and `FormJsonModule`.
- Export `ClaimLetterEligibilityService` from `ClaimLetterModule` and reuse it for
  re-verification.
- Register the module in `module/xvi-fc/xvi-fc.module.ts`.

**Endpoints** - `@Controller('xvi-fc/mohua/claim-letter-review')`, using `PermissionGuard` +
`@RequirePermissions` (no `@Roles`) and `ParseObjectIdPipe`, with literal routes declared before
`:param` routes:

| Verb and path | Permission | Purpose |
|---|---|---|
| `GET worklist/:yearId` | `REVIEW_STATE_SUBMISSIONS_PMU` | Batches at 5, 6 or 7 across States. Filters: state, status, installment. Sort, max 25 per page, summary counts. A claim-specific aggregation over batches (state names via `$lookup`, `$facet` for summary + page), returning the same `rows` / `summary` / meta shape as the PMU worklist so `app-review-worklist` works. Excludes abandoned, superseded and BUILDING batches. |
| `GET :claimLetterId` | same | Batch summary; `stateEligibilitySources` with exemption detail; a re-verification preview (drift list); `permissions { canApprove, canReturn }`; `mohuaRemarks`; history. |
| `GET :claimLetterId/ulbs` | same | ULB x criterion grid. For each ULB, each criterion's result (Passed, Exempted with its kind, or Returned). Search on name or census code (`escapeRegex`), filters by criterion, result and returned, max 25 per page. |
| `GET :claimLetterId/history` | same | Batch history, paginated. |
| `POST :claimLetterId/approve` | `APPROVE_STATE_SUBMISSIONS` | Body `{ expectedRevision, remark? }`. |
| `POST :claimLetterId/return` | `APPROVE_STATE_SUBMISSIONS` | Body below. |

```ts
// POST :claimLetterId/return
{
  expectedRevision: number;
  letterRemark?: string;                       // "Claim letter issue"
  stateFormItems?: { formId: number; remark: string }[];
  ulbItemGroups?: {
    formIds: number[];                         // ULB forms and/or row sources
    remark: string;                            // applied to every ULB in the group
    ulbIds?: string[];                         // explicit, max 1000
    selectAllMatching?: { search?: string; criterionFormId?: number; result?: string };
    excludeUlbIds?: string[];
    remarkOverrides?: { ulbId: string; formId: number; remark: string }[];
  }[];
}
```

- At least one item is required.
- The server expands groups into (ULB, formId) items, removes duplicates, and validates each one
  against this batch's pinned PASSED sources. Exempted or unknown items fail with a 400 and the
  list.
- Use exactly one selection mode per group (explicit ids or select-all-matching), the same way
  PMU's `assertExactlyOneSelectionMode` works.

**Access**

- GETs call `assertPmuOrMohuaViewerAccess`.
- POSTs call `assertReviewerAccess(user, Scope.MOHUA, ...)`, which allows MoHUA and ADMIN.

**Approve flow** - in order:
1. Load the batch and require status 5.
2. Re-verify per 4.4. Drift returns a 409.
3. Start the transaction.
4. CAS the batch on `revision` and set it to 7.
5. `acknowledgeLocks`.
6. Run the writers' `acknowledge` for the sources that qualify under 4.5.
7. Check cycle close, and acknowledge the per-installment State sources if the cycle closed.
8. Write the history entries.
9. Commit.

**Return flow** - in order:
1. Validate and expand the items.
2. Start the transaction.
3. CAS the batch on `revision` and set it to 6 with `mohuaRemarks`.
4. Flag the affected children.
5. Run the writers' `returnItems`.
6. Invalidate dependent open batches.
7. Write the history entries.
8. Commit.
9. Enqueue the notification job.

**Notifications**

- After commit, enqueue one job on `EMAIL_QUEUE`. It sends one email to the State with every
  item, and one email per ULB with that ULB's items.
- Add new DB-backed email templates, seeded on boot the same way as
  `module/xvi-fc/common/reminders/form-returned-notification.service.ts`.
- A failed email never fails the decision.

**Recovery checks** - add to `detectAnomalies`:
- An approved batch whose pinned sources have left their accepted status.
- A returned State form whose dependent open batches aren't marked `dependencyInvalidated`.
- A source at 6 with no matching return history.

**Tests**

- **Worklist:** filters, summary, page cap.
- **Grid:** search, filters, pages.
- **Approve:** happy path, drift 409, revision conflict 409, cycle-close acknowledgements, a
  retry with the same `bulkActionId`.
- **Return:** mixed items, select-all-matching with excludes, an exempted item rejected,
  letter-only, dependency invalidation, a row return leaving the parent at 5, a whole-form
  Elected Body return.
- **Concurrency and failure:** two simultaneous decisions; a `matchedCount` mismatch aborting the
  transaction; notifications enqueued only after commit.

**Done when** MoHUA can approve or return a 500-ULB batch through the API, with every source,
history and lock change made in one transaction.

#### Phase 8 - State side of a returned batch (backend)

Code: `module/xvi-fc/state/claim-letter/`.

1. **Permissions.** Add `canAbandon` (draft or returned) and `canCreateNewVersion` (returned
   and not superseded) to `ClaimLetterPermissions` (`helpers/claim-letter-permissions.helpers.ts`).
   Both use the existing `PREPARE_GRANT_LETTERS`.
2. **Abandon a returned batch.** Extend `abandonDraft` to accept status 6. It releases the
   batch's locks, sets `isAbandoned` and writes an `ABANDON` history entry. Same endpoint.
3. **New version.** Add `POST :claimLetterId/new-version` (`PREPARE_GRANT_LETTERS`). It calls
   `createNewVersion` (its first caller) and writes `NEW_VERSION` history on the new version.
   It is idempotent the same way draft creation is (ADR 0001).
4. **Responses.**
   - The detail and ULB rows responses carry `mohuaRemarks`, each child's `returnedItems` and
     `isReturned`, and `dependencyInvalidated` with its reason.
   - The ULB rows endpoint can filter on `isReturned`.
5. **Clearing invalidation.** A successful `updateDraft` re-evaluation clears
   `dependencyInvalidated`. Submitting a batch that is still invalidated is blocked.
6. **Row return round trip (A1)**, for Elected Body and FC Unspent:
   - The State can edit and resubmit a row at 6 while the parent is at 5. The row moves to 13
     and the parent is untouched. This extends the existing `ROW_RESUBMIT` path.
   - PMU can decide rows at 13 while the parent is at 5. Widen `assertCanPmuMutateForm`'s use in
     both `pmu/*-pmu-rows.service.ts` for that case only. PMU's whole-form approve and reject
     stay blocked at 5.
   - The settle step (`maybeSettleAfterBulkAction`) leaves a parent that is at 5 unchanged.
   - PMU visibility: add a "rows pending" count to the PMU worklist rows (backend
     `buildPmuWorklistRows` response and the frontend worklist column). The row table shows these
     rows as pending.
   - A whole-form return still moves the parent to 6 and follows the normal PMU flow.
7. **Docs.** Update `state/claim-letter/CLAUDE.md` and `docs/adr/0003-workflow-transitions.md`
   (decisions, abandon, new version). Add a new ADR for the review design.

**Tests**

- Abandoning a returned batch releases its locks, and the slot can be reused.
- A new version is prefilled, linked through `supersedes`, keeps its locks, and requires a new
  signed file.
- Invalidation is cleared or blocks submit as described.
- The row return round trip for both row-level forms, including PMU's existing flows (regression).
- PMU's whole-form approve and reject stay blocked while the parent is at 5.
- The PMU worklist shows the pending-row count for a parent at 5.

**Done when** a returned batch can be fixed and resubmitted as a new version, or abandoned, and a
returned row goes back through PMU without the parent leaving status 5.

#### Phase 9 - MoHUA review screens (frontend)

Folder: `mohua-module/claim-letter-review/`. Follow the State and PMU pages' styles exactly. No
new design.

1. **Routes.**
   - Add `claim-letter-review` (worklist) and `claim-letter-review/:claimLetterId` (detail), both
     with `data: { menuGroup: 'claim-letter-review' }`.
   - Register them in `MOHUA_ROUTES`, in `MOHUA_DASHBOARD_ROUTES` (for DoE) and in
     `pmu-module/pmu-module.routes.ts` (A4).
   - Add each role's sidebar row through the existing `xvi-fc/side-menu` API (featureKey
     `claim-letter-review`), then clear the side-menu cache
     (`DELETE xvi-fc/admin/cache/side-menu`).
2. **Service** - `claim-letter-review.service.ts`: `providedIn: 'root'`, base URL
   `xvi-fc/mohua/claim-letter-review/`, using the PMU services' `ensureSuccessfulResponse`
   pattern.
3. **Worklist page.**
   - Copy the layout and filter fieldset of `pmu-module/review-state-submissions/`. Copy only:
     that component is tied to `PMU_FORM_OPTIONS`.
   - Reuse `shared/review-worklist` (`serverPage`, 25 per page), `shared/status-summary-cards`,
     and `shared/status-history-pill` with a claim history loader.
   - Keep the filters in the query params.
4. **Detail page.** Use the same skeleton as the PMU detail pages: `app-xvifc-breadcrumb`, the
   eyebrow and title, and `app-form-progress`. Reuse `app-claim-letter-summary-tiles`, the
   signed-letter link (`SignedUrlDirective`) and `app-claim-letter-document-preview-dialog`.
   - **State forms panel** - each pinned State source with its result and exemption kind,
     selectable for return.
   - **ULB grid** - the Bootstrap `table table-sm table-hover align-middle` convention used by the
     PMU row table and the claim ULB table.
     - One column per criterion, showing Passed, Exempted (with its kind) or Returned.
     - Search with a 300 ms debounce, filters by criterion and result, 25 per page with
       Prev/Next.
   - **Bulk selection.** Extract the selection model and the "Select all N matching" banner from
     `pmu-module/row-review-detail/pmu-row-review-detail.component.ts` into a shared piece (for
     example `shared/bulk-selection/`). Switch PMU over to it, then use it here.
   - **Return builder.**
     - MoHUA picks the item types, selects ULBs and the forms to return for them, writes remarks
       (with "apply to selected" and per-item override), and confirms a summary before submit.
     - Extend `pmu-module/row-review-detail/dialogs/pmu-bulk-reject-rows-dialog/` with optional
       per-item remarks and apply-to-selected. Keep its contract that the caller sends the
       request.
   - **Approve** - through `shared/review-acknowledgment` (it confirms first and renders nothing
     without permission). Show the re-verification drift from the GET before enabling approve.
     A 409 shows the returned list.
   - **Errors and toasts** - `extractFormLevelErrorMessage`, `getXviFcFieldErrorMessage`, and
     `UtilityService.triggerSnackbar`.

**Tests**

- The service (`HttpTestingController`).
- The worklist page.
- The detail page: select-all-matching, building the return payload, approve with drift.
- The extended dialog.
- A PMU regression test for the extracted selection.

**Done when** MoHUA admin can approve or return a 500-ULB batch from the UI without opening ULBs
one by one, and DoE, PMU and MoHUA viewers see the same screens read-only.

#### Phase 10 - State, ULB and PMU screens for review outcomes (frontend)

1. **State Claim Letter detail** (`state-module/claim-letter/detail/`), with no design change:
   - Add `app-returned-reason-banner` after `app-form-progress`, with `mohuaRemarks` (add the
     field to `ClaimLetterBatchSummary`).
   - Show flagged ULBs in `app-claim-ulb-table`'s existing hidden warning-icon slot, with a
     tooltip. This needs a new input (for example `flaggedRemarksByUlbId`).
   - List returned State-form and letter items in the existing alert style.
   - Show abandon (the existing `abandonDraft` and confirm dialog) behind `permissions.canAbandon`.
   - Add a "Start new version" button in `.acknowledgement-inner` behind
     `permissions.canCreateNewVersion`. It navigates the same way `createDraft` does.
   - Show the `dependencyInvalidated` warning in the existing alert style.
2. **Claim status displays.** The Phase 3 displays cover the returned and acknowledged states.
3. **PMU screens (A1).** The PMU worklist (`pmu-module/review-state-submissions/`) shows the new
   "rows pending" count, so a resubmitted row under a parent at 5 is visible. The row table
   (`pmu-module/row-review-detail/`) lets PMU approve or reject those rows. The whole-form bar
   stays hidden while the parent is at 5.
4. **ULB form pages.** A MoHUA return shows in the existing returned-banner slots
   (`.section-returned-banner`, `.returned-notice-banner`), with MoHUA's remark.
5. **Go live.** Flip `claimLetterSubmissionEnabled` to `true` in `claim-letter-list.component.ts`
   after the end-to-end check in section 9 passes.

**Tests** - specs for the detail page states (returned, invalidated, abandon, new version), the
ULB table flag input, the ULB returned banners, and the PMU worklist pending-row count and row
actions under a parent at 5.

**Done when** the State, the ULB and PMU each see exactly what MoHUA returned, and the State can
act on it.

#### Phase 11 - Retire old MoHUA decision paths and finish docs

This is the last phase. Do it only after Claim Letter Review works end to end.

1. **Backend.** Remove `module/xvi-fc/mohua/fc-unspent-declaration/` and its registration in
   `xvi-fc.module.ts`. Remove the `decideMohuaSection` (Annual Accounts) and
   `decideMohuaBankAccount` (Bank Account) endpoints, with their routes, DTOs and specs. Keep
   the extracted field-mapping helpers that the writers use.
2. **Frontend.** Remove `mohua-module/fc-unspent-review/`, its routes, service and specs, and any
   callers of the two decide endpoints. Search for them first.
3. **Sidebar.** Remove the `fc-unspent-review` row through the side-menu API, then clear the
   cache.
4. **Comments.** Update every comment that references the retired module
   (`pmu/fc-unspent-declaration/*`, `mohua/request-exemption/request-exemption-mohua.service.ts`
   around line 66), and the root `CLAUDE.md`.
5. **Docs.**
   - Run `/xvifc-backend-verify-and-update-docs src/module/xvi-fc/mohua/claim-letter-review`,
     then the same for `src/module/xvi-fc/state/claim-letter`.
   - Update `module/xvi-fc/common/services/CLAUDE.md` (writers, claim status helper, lock guard).
   - Update the root `CLAUDE.md` (module layout, env flag).

**Done when** MoHUA has exactly one decision path (Claim Letter Review), and the docs describe the
code as it is.

---

## 7. Payload changes (`xvifc-payload-08102026.json`)

Commit the file - it is currently untracked. Apply the changes to the database through
`POST/PATCH form-json`. No scripts.

| Form | Change | Phase |
|---|---|---|
| SLB (32) | `acceptedFormStatuses` from `[3]` to `[5, 7, 8]`; add `state`, `isActive` and `isDeleted` mappings | 1 |
| SFC (22), Elected Body (23), FC Unspent (25) | add `isDeleted` mapping | 1 |
| Claim Letter (26) | `meta.maxBatchCount: 3` | 1 |
| All 10 sources | `approval` / `rejection` with `SET_FORM_STATUS` (or `SET_ROW_STATUS`) and target 7 / 6 | 6 |

---

## 8. Coding rules

- Understand the existing architecture and business rules before coding. Don't change code just
  to change it.
- Reuse the State-module and PMU implementations, backend and frontend. Never write the same
  thing in two places. If something needed is embedded in a component or service, extract it and
  reuse it.
- **Frontend:**
  - Follow the existing State form styles: Angular Material 20 plus Bootstrap 5 utilities and
    bootstrap-icons.
  - Use the layout mixins in `styles/_shared-layout.scss` and the page skeleton
    (`top-accent`, `content-stack`, eyebrow, `h1.page-title`, `page-subtitle`).
  - No design changes unless explicitly given. No design changes to the existing Claim Letter
    screens.
- Implement both frontend and backend fully.
- Use hyphens, not em dashes, in code, comments and docs.
- Add comments only when genuinely necessary.
- Keep the relevant ADRs and `CLAUDE.md` files up to date.
- **Database access:**
  - No database queries inside loops. Use indexed queries and bulk operations (`insertMany`,
    `updateMany`, `bulkWrite`).
  - `Promise.all` for independent operations; keep sequential order where one step depends on
    another.
- **Pagination:** always on the backend, with a maximum page size of 25. The backend is the
  source of truth for validation, authorization and business rules.
- **Backend conventions:**
  - `PermissionGuard` + `@RequirePermissions` (no `@Roles`), and `ParseObjectIdPipe` for ids.
  - `xviFcSuccess` responses and `throwXviFcValidationError` for field errors.
  - `escapeRegex` for every search.
  - Declare literal routes before `:param` routes.
  - Declare every schema field before writing it.
- Refer to PMU Review for bulk decisions, efficient database operations, concurrency handling
  and review patterns, and reuse its shared helpers.
- Add tests for business rules, bulk decisions, partial returns, concurrency and failure
  recovery:
  - Backend: Jest, models mocked via `getModelToken`.
  - Frontend: Karma/Jasmine, standalone `TestBed`, `HttpTestingController`.
- At the end, run `/xvifc-backend-verify-and-update-docs <folder>` for each new or changed
  feature folder.

---

## 9. End-to-end verification

Run these against a dev database, with the payload loaded through the API, after Phase 10:

1. **Assemble.** A State with mixed eligible and exempt ULBs builds a draft. Every child shows
   every criterion with its exemption kind, and the ULB pages show "In claim draft".
2. **Freeze.** A State undo on a locked ULB's AFS is blocked with a clear message.
3. **Submit.** The batch is submitted and appears in MoHUA's worklist. DoE and PMU see it
   read-only.
4. **Return.** MoHUA returns the batch with:
   - an SFC issue
   - AFS for 40 ULBs, selected through select-all-matching with 2 excluded
   - one Elected Body row
   - a letter remark
   Check:
   - every source is at 6 with its own history entry
   - the parent of the returned Elected Body row is still at 5
   - other open batches are marked `dependencyInvalidated`
   - the State and the affected ULBs receive their emails
5. **Fix.**
   - The ULB fixes AFS, and the State approves it again.
   - The State fixes SFC, and PMU approves it.
   - The State fixes the row, and PMU approves it while the parent stays at 5.
6. **New version.** The State creates a new version, changes an amount, uploads a new signed
   letter and submits.
7. **Approve with drift.** MoHUA approves while one source is no longer accepted: a 409 with the
   list. Fix the source and approve again: the batch moves to 7, the locks are ACKNOWLEDGED, DUR
   moves to 7, and the other sources stay at their accepted status.
8. **Close the cycle.** The remaining ULBs are claimed in the closing batch. A wrong total is
   rejected and the exact total is accepted. Approval closes the cycle, and the Installment 1
   Devolution Formula and GTC documents move to 7.
9. **Abandon.** A returned batch is abandoned: its locks are released and the slot can be
   reused.
10. **Concurrency.** Two MoHUA admins approving at the same time: one succeeds, the other gets a
    409.
11. **Cron.** It logs every run, does nothing when the flag is unset, and the daily anomaly
    report shows nothing for a clean dataset.
