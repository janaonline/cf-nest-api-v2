# Claim Letter

State-facing feature: a State selects ULBs from its Devolution Formula allocation and assembles
them into a "claim letter" batch, which then moves through a State → MoHUA review workflow. V1
supports Installment 1 only.

## Before changing anything here, read the relevant ADR

The three decisions below are referenced from multiple files each — read the linked ADR before
touching code that cites it, not just the local comment:

- [docs/adr/0001-idempotent-retry.md](docs/adr/0001-idempotent-retry.md) — client-retry safety for
  `createDraft`/`submit`.
- [docs/adr/0002-batching-and-locks.md](docs/adr/0002-batching-and-locks.md) — the 3-batch-slot
  cap, per-ULB locking, and stale-`BUILDING`-row recovery.
- [docs/adr/0003-workflow-transitions.md](docs/adr/0003-workflow-transitions.md) — which mutations
  write history, and why edits/uploads don't.

## Layout

- `services/assembly/` — the only place that creates/updates/abandons a batch (locks + children +
  status). Everything else is read-only or touches only the parent document.
- `services/eligibility/` — State-level gate + per-ULB criteria + Devolution allocation resolution.
  Has cached `*ForDisplay` variants for read-only UI consumers; the assembly pipeline never uses
  them (see the service's own doc comment on `evaluateStateLevelGateForDisplay`).
- `services/recovery/` — hourly stale-`BUILDING` cleanup (cron) + read-only reconciliation report.
- `services/history/` — the only writer of `ClaimLetterBatchHistory`; see ADR 0003 for what counts
  as a transition worth recording.
- `services/main/claim-letter.service.ts` — read paths + the two parent-only mutations (signed-file
  upload, submit) that don't touch locks/children.
- `services/document/claim-letter-document.service.ts` — assembles the claim letter document
  (Covering Letter + Annexure 1 FC Disclosures + Annexure 2 City Conditions) consumed by the
  frontend's Preview Template dialog and Download Template PDF — read-only, built on top of
  `ClaimLetterUlbRowsService.getAllUlbRows()` rather than re-querying `ClaimLetterBatchUlb` directly.
- `helpers/` — pure functions (financial rounding, content hashing, summary mapping). No I/O.

## Invariants worth knowing before you change adjacent code

- At most `CLAIM_LETTER_MAX_BATCH_NUMBER` (3) non-abandoned batches per (state, year, installment) —
  DB-enforced, not just application-checked (ADR 0002).
- A frozen claim *version* is immutable — `createNewVersion` builds a new parent rather than
  mutating an existing READY one (ADR 0002, ADR 0003).
- Money is stored as Crore-denominated decimals throughout this feature, matching every other
  xvi-fc form — never paise/rupees. Exact (non-float-drift) arithmetic lives in
  `helpers/claim-letter-financial.helpers.ts`.
- The eligibility service's cached `*ForDisplay` methods are for read-only UI paths only — never
  call them from the assembly/mutation pipeline.
- Annexure 2's ("City Conditions") criteria columns are never hardcoded — they come from
  `ClaimLetterUlbLevelEligibility.criteriaColumns` (one entry per currently-enabled ULB-bulk
  criterion, regardless of pass/fail), itself derived from whatever `formjsons` documents have an
  enabled `claimEligibility` config. Adding/removing an eligibility criterion is a data change
  (a formjson doc), never a code change here or in the two frontend renderers — do not reintroduce
  named `CRITERION_TYPE_*` constants for Annexure 2 (Annexure 1's `eligible` column is the one
  deliberate exception, since that annexure *is* specifically the FC-disclosure check).
- Each child's `eligibilitySources` is populated with real per-ULB evidence for `FORM_AND_ROW`
  sources (Elected Body, FC Unspent) — one snapshot per source, built in `prepareChildren` by
  merging that source's state-level result (`evaluateStateLevelGate`) with this ULB's row evidence
  (`ClaimLetterUlbLevelEligibility.rowEvidenceByFormId`, from `resolveUlbLevelEligibility`) — no
  extra query, both are already fetched. The parent's `stateEligibilitySources` stays form-status-only
  by design (`rowDocumentId`/`rowStatusAtEvaluation` are correctly `null` there — no single row
  applies to a whole state). `resolveUlbLevelEligibility` in `prepareChildren` is deliberately
  deferred until after the state gate passes (it's the heaviest of the method's fetches — a bulk
  find per ULB-bulk-evaluable source — and entirely wasted on a gate failure).
