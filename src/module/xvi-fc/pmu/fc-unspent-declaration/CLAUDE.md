# FC Unspent Declaration (PMU Review)

PMU-side pre-screen for the FC Unspent Declaration form filed in `state/fc-unspent-declaration` — a
new review stage inserted *ahead of* the existing, untouched `mohua/fc-unspent-declaration`, not a
replacement for it (see "PMU vs MoHUA" below for how the two actually differ). Registers the same
four State-owned schemas MoHUA's module also registers — Mongoose model bindings are per-module, not
exclusive, so three modules (state/mohua/pmu) reading/writing the same collections is the
established xvi-fc pattern, not a new one introduced here. No PMU-specific schema collection exists
(`src/schemas/xvi-fc/` only has `state/`/`ulb/`) — this module reads and writes `state/fc-unspent-
declaration`'s own form/row/history collections directly.

## Layout

- `fc-unspent-pmu-review.controller.ts` — 7 thin REST endpoints under
  `xvi-fc/pmu/fc-unspent-declaration`, all guarded by `REVIEW_STATE_SUBMISSIONS_PMU` (GETs) or
  `APPROVE_STATE_SUBMISSIONS_PMU` (mutations). `worklist/:yearId` is declared before `:stateId/:yearId`
  so Express's first-match routing doesn't swallow it as `getReviewMetadata(stateId: 'worklist', ...)`.
- `fc-unspent-pmu-review.module.ts` — wiring; registers the 4 State schemas plus `State` itself
  (needed for the cross-state worklist join).
- `services/fc-unspent-pmu-review.service.ts` — form-level concerns: cross-state worklist, review
  metadata (GET), and complete-form approve/reject.
- `services/fc-unspent-pmu-rows.service.ts` — row-level concerns: the paginated row list and the two
  bulk row-decision endpoints.
- `services/fc-unspent-pmu-row-review-domain.service.ts` — shared primitives (parent lookup, row
  loading, row/parent transitions + history, the bulk-action auto-approve check) used by both of the
  above, so the row-level and complete-form flows never diverge. Mechanical CRUD/bulk-write plumbing
  is delegated to the generic, cross-feature `StateFormPmuReviewHelper`/`PmuRowReviewHelper`
  (`common/services/`) — read those two classes' own docblocks before changing transition/history
  mechanics here; what stays in this file is exactly what's form-specific (the row snapshot shape,
  `auditRevision` bookkeeping).
- `types/fc-unspent-pmu-review.types.ts`, `dto/get-fc-unspent-pmu-rows-query.dto.ts` — supporting.
  The bulk-approve/bulk-reject/reject-form DTOs are *not* local to this folder — they're the shared
  `common/dto/bulk-approve-pmu-rows.dto.ts` / `bulk-reject-pmu-rows.dto.ts` / `reject-pmu-form.dto.ts`,
  used identically by every row-bearing PMU review controller (unlike MoHUA's module, which still
  has its own form-specific copies of these).
- `constants/fc-unspent-pmu-review.constants.ts` — this module's own pagination defaults/cap for the
  row list. Deliberately **not** the State/MoHUA-shared `FC_UNSPENT_PAGINATION_MAX_LIMIT` (also used
  by the STATE-side ULB-options picker) — a PMU-only cap here can change without touching either of
  those unrelated callers.

## PMU vs MoHUA: two distinct, sequential stages, not duplicates

Do not assume PMU review is redundant with, or a subset/superset of, MoHUA review — they gate on
different statuses and MoHUA's own module was deliberately left unmodified:

- **State's own `finalSubmit`** (`state/fc-unspent-declaration`) now lands a Yes-branch form on
  `UNDER_REVIEW_BY_PMU`, not `UNDER_REVIEW_BY_MOHUA` — PMU review was inserted as a gate *before*
  MoHUA ever sees the form. Rows likewise start at `UNDER_REVIEW_BY_PMU`.
- **This module** (`canPmuMutateForm`/`assertCanPmuMutateForm`, `common/utils/xvi-fc-form-status-
  access.util.ts`) only lets a PMU user act while the form/row is `UNDER_REVIEW_BY_PMU`. PMU has no
  terminal status of its own once it approves — `approveCompleteForm`/`bulkApproveRows` land the
  form/rows directly on `UNDER_REVIEW_BY_MOHUA`, the exact status `mohua/fc-unspent-declaration`'s own
  (untouched) `assertCanMohuaMutateForm` already gates on. A PMU-approved form is therefore reachable
  by MoHUA's existing reviewer automatically, with no change needed on that side. PMU reject instead
  lands on `RETURNED_BY_PMU` (its own rejection status, mirroring MoHUA's `RETURNED_BY_MOHUA`).
- **View access is wider than mutate access**: `canPmuViewForm` also includes `NOT_STARTED`/
  `IN_PROGRESS`/`UNDER_REVIEW_BY_MOHUA`/`RETURNED_BY_MOHUA`/`SUBMISSION_ACKNOWLEDGED_BY_MOHUA` — PMU
  keeps read-only visibility into a form after it moves on to MoHUA, and the worklist needs to show
  every state regardless of how far along its form is. This is shared, cross-feature logic (see that
  util's own docblock), not specific to FC Unspent.
- **This module surfaces form-question data MoHUA's doesn't**: `getReviewMetadata` resolves the
  eligibility `threshold` and the main-form `questions` dynamically via `FcUnspentDeclarationFormJsonService
  .loadFormConfig()` + `getFcUnspentFieldsByType()` + `FormQuestionHydratorService` (same mechanism
  the State-side GET uses — see `state/fc-unspent-declaration/CLAUDE.md`'s `loadFormConfig()`
  paragraph). MoHUA's `getReviewMetadata` has no `questions` field at all and hardcodes
  `threshold: 10` — it predates this hydration and was deliberately left as-is.
- **This module alone has a cross-state worklist endpoint** (`getWorklist`, `GET worklist/:yearId`) —
  MoHUA's module has none. Built from the shared `buildPmuWorklistRows()` (`common/utils/pmu-
  worklist.util.ts`), the same cross-state join every other PMU review feature uses — including that
  function's own `stateId`/`status`/`sortBy`/`sortDir`/`page`/`limit` filtering, sorting, and
  pagination of the synthesized row list (see its own doc comment for why that happens after the
  join rather than on the state/form queries themselves).
- Permissions are on an entirely separate axis: `Scope.PMU` / `REVIEW_STATE_SUBMISSIONS_PMU` /
  `APPROVE_STATE_SUBMISSIONS_PMU`, vs MoHUA's `Scope.MOHUA` / `REVIEW_STATE_SUBMISSIONS` /
  `APPROVE_STATE_SUBMISSIONS` — a PMU user has no implicit MoHUA access or vice versa.

## The complete-form approve/reject branch logic

Mirrors `FcUnspentMohuaReviewService`'s own (see its CLAUDE.md's "The complete-form approve/reject
branch logic" section for the full write-up) one stage earlier: No-branch requires the persisted
`fcDeclaration` file, then approves directly onto `UNDER_REVIEW_BY_MOHUA` (not an acknowledgment —
PMU never acknowledges, it hands off). Yes-branch blocks (400, `rowsNotApprovable`) unless every
active row is `UNDER_REVIEW_BY_PMU` or already `UNDER_REVIEW_BY_MOHUA` (idempotent re-approval doesn't
re-write already-approved rows), then transitions the remaining `UNDER_REVIEW_BY_PMU` rows forward.
Reject blocks (400, `rowsAlreadyApproved`) if any row already reached `UNDER_REVIEW_BY_MOHUA` —
rejecting the form must never regress a row PMU already individually approved.

## Row-level bulk review and the auto-approve rule

Same shape as MoHUA's own (see its CLAUDE.md's "Row-level bulk review and the auto-acknowledge rule"
section) one stage earlier: `bulkApproveRows`/`bulkRejectRows` require every targeted row to be
`UNDER_REVIEW_BY_PMU` and the form to be Yes-branch. After a bulk approve,
`maybeApproveAfterBulkAction` moves the parent to `UNDER_REVIEW_BY_MOHUA` only once every active row
has individually reached that status. Bulk reject never approves the parent.

## Known gaps

- **No optimistic-concurrency check on the row/parent status write itself** — identical gap to the
  one `mohua/fc-unspent-declaration/CLAUDE.md`'s "Known gaps" section documents (same `_id`-only
  `bulkWrite`/`findOneAndUpdate` filters, inherited unchanged via the shared `PmuRowReviewHelper`/
  `StateFormPmuReviewHelper`). Not re-explained here; that section's fix pointer
  (`state/request-exemption`'s two-layer guard) applies the same way at this stage.
- A `RETURNED_BY_PMU` row/form has no way back to reviewable yet, same as `RETURNED_BY_MOHUA` on the
  MoHUA side — a future state-correction/resubmission phase is expected to add one for both stages.

No ADRs exist for this module. The one cross-cutting design decision here — PMU has no terminal
status of its own and hands off straight to `UNDER_REVIEW_BY_MOHUA` — isn't FC-Unspent-specific; it's
already the documented contract of the shared primitives every row-bearing PMU review module builds
on (`RowReviewStatus`'s own doc-comment in `common/constants/row-review-status.constants.ts`, and
`PmuRowReviewHelper`'s class docblock in `common/services/pmu-row-review.helper.ts`), so it's cited
from there rather than captured as a per-module ADR. Nothing else here rises to ADR weight beyond the
two Known gaps above.

## Dependencies

**Reads/writes `state/fc-unspent-declaration`'s own collections directly** (no PMU-specific schema):
the same `XviFcUnspentStateForm`/`...FormHistory`/`...FormRow`/`...FormRowHistory` models State and
MoHUA already register. This module adds a new write path (PMU's own status transitions) onto those
same documents — not a separate dataset. Row history carries a per-row field snapshot (not null — see
`buildSnapshot` in `FcUnspentPmuRowReviewDomainService.transitionRows`, which captures `rejectionRemark`
so a reason survives a later reject→edit→resubmit cycle); parent history writes `snapshot: []` (a PMU
review decision never edits row data, and the real row-data snapshot already lives on State's own
`FINAL_SUBMIT` entry in the same collection) but DOES resnapshot `data` (pre-existing behavior, kept
as-is — see `insertParentHistory`'s own docblock for why this diverges from the other 4 xvi-fc forms);
see `common/services/CLAUDE.md`'s "Only snapshot data when it could actually have changed".

**Relies on `state/fc-unspent-declaration`'s `finalSubmit`** landing Yes-branch forms/rows on
`UNDER_REVIEW_BY_PMU` rather than `UNDER_REVIEW_BY_MOHUA` — see "PMU vs MoHUA" above. If that routing
ever changes on the State side, this module's entire mutate-gating (`canPmuMutateForm`) stops
matching reality.

**Hands off to `mohua/fc-unspent-declaration`**, left entirely untouched: a PMU-approved form/row
lands on `UNDER_REVIEW_BY_MOHUA`, which that module's own `assertCanMohuaMutateForm`/
`canMohuaMutateForm` already gates on — no coordination beyond both modules agreeing on that one
status value.

**Inbound — reads devolution-formula's dataset-versioning invariant indirectly**: this module doesn't
read `activeDatasetVersion` itself, but the row data it reviews (`allocationAmount`/`allocationPerc`)
was already resolved against it by the State-side row service at save time — see
`devolution-formula/docs/adr/0001-dataset-versioning.md` and `state/fc-unspent-declaration/CLAUDE.md`'s
own "Dependencies" section for that invariant's source of truth.

**Outbound**: nothing outside this module reads PMU-specific state from here today (unlike
`eligibility`, which claim-letter reads off the State-side rows directly, upstream of PMU).
