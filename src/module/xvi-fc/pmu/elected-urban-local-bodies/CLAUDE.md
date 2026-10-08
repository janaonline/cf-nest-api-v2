# Elected Urban Local Bodies (PMU Review)

PMU-side review stage for the Elected Urban Local Bodies (EULB) form filed in
`state/elected-urban-local-bodies` — a new stage ahead of MoHUA (no MoHUA review module exists for
this form today; see that folder's `CLAUDE.md`'s "Row-level review status" section). Like every
other PMU reviewer in this codebase, it has no schema of its own: it registers and reads/writes the
State module's own four Mongoose models directly (`ElectedUrbanLocalBodiesForm`/`-FormHistory`/
`-Row`/`-RowHistory`) — Mongoose model bindings are per-module, not exclusive, so both modules
touching the same collections is the established xvi-fc pattern (mirrors
`mohua/fc-unspent-declaration`'s own split from its STATE sibling).

## Layout

- `elected-urban-local-bodies-pmu-review.controller.ts` — 7 REST endpoints under
  `xvi-fc/pmu/elected-urban-local-bodies`: cross-state worklist, review metadata (GET), paginated
  row list (GET), bulk row approve/reject, and complete-form approve/reject. View endpoints are
  guarded by `REVIEW_STATE_SUBMISSIONS_PMU`, mutating ones by `APPROVE_STATE_SUBMISSIONS_PMU`.
- `elected-urban-local-bodies-pmu-review.module.ts` — wiring; registers the State module's 4
  schemas (read/write) plus `Ulb`/`State` (read-only, for the eligible-ULB count and worklist).
- `services/elected-urban-local-bodies-pmu-review.service.ts` — form-level concerns: the cross-state
  worklist, review metadata (GET), and complete-form approve/reject.
- `services/elected-urban-local-bodies-pmu-rows.service.ts` — row-level concerns: the paginated,
  searchable/filterable row list and the two bulk row-decision endpoints.
- `services/elected-urban-local-bodies-pmu-row-review-domain.service.ts` — primitives shared by both
  services above (parent lookup, row loading/transitions, parent transition + history, the
  all-rows-approved completion check), so the row-level and complete-form flows never diverge. Thin
  by design: it mostly adapts the shared `PmuRowReviewHelper`/`StateFormPmuReviewHelper` (see
  "Shared building blocks" below) to EULB's own models and dataset-versioning.
- `constants/elected-urban-local-bodies-pmu-review.constants.ts` — pagination defaults/cap for the
  row list.
- `dto/get-eulb-pmu-rows-query.dto.ts` — row-list query params (search/page/limit/rowStatus); the
  mutation DTOs (`BulkApprovePmuRowsDto`, `BulkRejectPmuRowsDto`, `RejectPmuFormDto`) are shared
  across every PMU reviewer and live in `xvi-fc/common/dto/`, not here.
- `types/elected-urban-local-bodies-pmu-review.types.ts` — lean row/form projections and response
  shapes used throughout this module.

## This is the same `rowStatus` the State side writes, not a separate review field

`state/elected-urban-local-bodies/CLAUDE.md`'s "Row-level review status" section already covers the
full lifecycle; the short version this module depends on: `finalSubmit` sets every active row's
`rowStatus` to `UNDER_REVIEW_BY_PMU`, and this module advances that *same* field directly —
`UNDER_REVIEW_BY_PMU` → `UNDER_REVIEW_BY_MOHUA` on approve, or → `RETURNED_BY_PMU` on reject (with
`rejectionRemark` set). There is no PMU-specific status value and no separate per-row "PMU decision"
field layered on top — PMU has no status of its own once approved, so an approved row lands directly
on the same `UNDER_REVIEW_BY_MOHUA` a (currently nonexistent) MoHUA reviewer would also use. The
complete-form analog: `currentFormStatus`/`pmuRemarks` on the parent, and
`FormHistoryAction.PMU_APPROVE`/`PMU_REJECT` entries in `ElectedUrbanLocalBodiesFormHistory` (see
that same state CLAUDE's "Form status history log" section — `CREATE_DRAFT`/`FINAL_SUBMIT` are
logged by the State side, `PMU_APPROVE`/`PMU_REJECT` by this module).

## Reads vs. writes relative to `state/elected-urban-local-bodies`

- **Writes**: `ElectedUrbanLocalBodiesRow.rowStatus`/`rejectionRemark` (row-level transitions, both
  bulk and complete-form); `ElectedUrbanLocalBodiesForm.currentFormStatus`/`pmuRemarks` (complete-form
  decisions); one `ElectedUrbanLocalBodiesRowHistory` entry per row transition and one
  `ElectedUrbanLocalBodiesFormHistory` entry per parent transition (skipped when the transition is a
  no-op). Never touches the row's own domain data (`electedBodyStatus`, `dateOfConstitution`,
  `dateOfExpiry`, `remarks`, etc.) or `activeDatasetVersion` — those stay exclusively State-owned.
- **Reads**: active rows scoped to the form's `activeDatasetVersion` (Excel re-upload hard-deletes
  prior versions' rows — see that CLAUDE's dataset-versioning ADR — so an unscoped query would risk
  resurrecting stale rows); `EulbFormJsonConfigService`/`getFieldsByType` for the review page's field
  config; `UlbEligibilityService.getEligibleUlbFilter` + a live `Ulb` count for the same
  active-ULB-count display the State side computes (see that CLAUDE's "active-ULB-count" section —
  this is a 7th read-only call site added to that convention, not a write).
- **No PMU-specific schema or collection exists** (`src/schemas/xvi-fc/` has only `state/` and
  `ulb/`), and none is needed — every PMU-specific fact (who reviewed what, when) is captured by
  reusing the State side's own row/form history collections with `PMU_APPROVE`/`PMU_REJECT`-tagged
  entries, the same way the State side's own `CREATE_DRAFT`/`FINAL_SUBMIT` entries already work.

## Shared PMU review building blocks this module delegates to

The domain service does not hand-roll bulk-write/history mechanics — it calls into
`PmuRowReviewHelper` and `StateFormPmuReviewHelper` (`xvi-fc/common/services/`), the same two
helpers every other PMU reviewer (gtc, sfc-status, devolution-formula, fc-unspent-declaration) calls
into. What's genuinely EULB-specific and stays in this folder's own domain service: the
`datasetVersion` scoping threaded through every row query/count, and the row/parent history
snapshot's field shape (`electedBodyStatus`/`dateOfConstitution`/`dateOfExpiry`/`remarks`, vs. FC
Unspent's `allocationAmount`/`eligibility`-shaped snapshot). EULB rows also have no `eligibility`
flag, so unlike FC Unspent's row summary there's no eligible/ineligible split in
`getRowSummary`/`EulbPmuRowSummary`.

## Worklist: left-join and synthesized `NOT_STARTED`

`getWorklist` lists every active+published state (the same `isActive`/`isPublish` filter
`master/state`'s own `findAll()` uses) left-joined against whatever EULB document exists for it this
year; a state with no document yet gets a synthesized `NOT_STARTED` row via
`doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED` — already how every state-side service treats a
missing document, so it can't mean anything else here.

## GET route declaration order

Only two of this controller's GET routes actually collide in shape: `worklist/:yearId` and
`:stateId/:yearId` are both 2-segment, so `worklist/:yearId` must stay registered first or Nest/
Express would match `:stateId/:yearId` first and treat `"worklist"` as a stateId. (`:stateId/:yearId/
rows` is a 3-segment route and was never at risk of this particular collision.)

## Known gaps

- **No optimistic-concurrency check on the row/parent status write itself** — inherited from the
  shared `PmuRowReviewHelper.transitionRows` (bulkWrite filters only by `_id`) and
  `StateFormPmuReviewHelper.transitionForm` (`findOneAndUpdate` filters only by `_id`), not something
  specific to this folder. The only gate is a pre-transaction read (`filterNotInStatus` for rows,
  `assertCanPmuMutateForm` for the parent), so two concurrent decide actions on the same row/form (a
  double-click, or two reviewers) can both pass that read and then both write. This is the same gap
  `mohua/fc-unspent-declaration/CLAUDE.md`'s "Known gaps" already documents for its own (separately
  coded) transition path — not closed in either place today. `state/request-exemption`'s two-layer
  guard (`assertPending` + `assertUpdateMatched`) remains the pattern to adopt if this ever needs
  closing, for every PMU/MoHUA reviewer at once, not just this one.

No ADRs exist for this module. The gap above is a missing guard shared with the rest of the PMU/
MoHUA review stack, not a design decision made in this folder — recorded here rather than as an ADR,
mirroring `mohua/fc-unspent-declaration/CLAUDE.md`'s own "No ADRs exist..." line.
