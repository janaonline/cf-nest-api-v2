# Request Exemption

State-facing feature: lets a State ask MoHUA to exempt a ULB (or, for a small set of reasons, the whole
state) from a specific eligibility requirement, scoped by `(state, year, ulb | null)`. Two branches share
one document/collection — per-ULB (`exemptionFor: 'ULB'`, e.g. Elected Body/Audited AFS/Provisional AFS)
and whole-state (`exemptionFor: 'STATE'`, e.g. SFC Status). There is no draft step: `finalSubmit` is the
only write path, and every submission is final-submitted straight to `UNDER_REVIEW_BY_MOHUA`.

## Before changing anything here, read the relevant ADR

- [docs/adr/0001-document-shape-and-write-concurrency.md](docs/adr/0001-document-shape-and-write-concurrency.md)
  — why one collection holds two document shapes, the wholesale-replace-not-edit per-`formId` write
  semantics, and the write-concurrency mechanics both this module's writer and MoHUA's decide-time writer
  depend on.
- [docs/adr/0002-eligibility-gating-and-race-window.md](docs/adr/0002-eligibility-gating-and-race-window.md)
  — the fail-fast-at-filing / re-verify-at-decision eligibility pattern, why each target form's check is
  shaped differently, the 409-vs-403 convention, and the SFC `finalSubmit` race window this module's
  checks depend on staying closed.

## Layout

- `request-exemption.service.ts` — all of the feature's logic: `getForm`, `getReasonOptions`,
  `finalSubmit`, `list`, plus the private eligibility/validation helpers. Read this file first.
- `request-exemption.controller.ts` — 4 thin REST endpoints under `xvi-fc/state/request-exemption`,
  guarded by `RECOMMEND_EXEMPTIONS` (write, and the "start new request" form) or `VIEW_STATE_FORMS`
  (list, reason-options).
- `request-exemption.module.ts` — wiring; registers the 6 Mongoose models `finalSubmit`'s eligibility
  checks read across (own collection + form log, Annual Accounts, SFC Status, Elected Body form/row).
- `request-exemption.types.ts` — response-shape interfaces only, no logic.
- `dto/save-request-exemption.dto.ts` — `SaveRequestExemptionDto`/`RequestExemptionDataDto`, the
  submitted payload shape (handles frontend string/`''`-vs-`undefined` quirks via `class-transformer`).
- `dto/get-request-exemption-list-query.dto.ts` — `list()`'s query params (page/limit/search/reasonForExemption/status).
- `helpers/request-exemption-form-json.helpers.ts` — 2 pure functions: filter fields by type, validate
  raw `formjsons.data` structure.
- `services/form-json/request-exemption-form-json.service.ts` — Redis-backed loader (via the shared
  `FormJsonService`) for this form's field config and, from it, per-year reason `{id, label}` options.

## Reason options are sourced live from `formjsons`, not hardcoded

Every reason-formId allow-list, label, and filter option in this module — submission validation, the
"Exemption Status" list's filter dropdown and row labels, conflict/ineligibility messages — comes from
`RequestExemptionFormJsonConfigService.loadReasonOptions`, which reads formId 34's `formjsons` document
live (`REASON_FIELD_KEY_ULB`/`REASON_FIELD_KEY_STATE`). A year-over-year change to which reasons are
offered needs only a `formjsons` data edit, never a code change. `REASON_FIELD_KEY_STATE` is loaded with
`required: false` (missing field returns `[]` instead of throwing) so the backend can deploy before that
field exists in `formjsons`/the frontend; `REASON_FIELD_KEY_ULB` keeps `required: true` since it has
always existed and its absence is a real config error.

## exemptionFor branching: ULB vs STATE

`RequestExemptionService.validateAndSanitize` validates the `'ULB'` and `'STATE'` branches of
`RequestExemptionDataDto` separately, not as a union: the `'ULB'` branch requires `ulb` and validates
`reasonForExemption` against that year's per-ULB reason ids; the `'STATE'` branch forces `ulb` to `null`
regardless of what the client sent (a stray value is silently discarded, not a validation error) and
validates `reasonForExemptionState` against that year's whole-state reason ids instead. This per-branch
validation is load-bearing, not cosmetic — it's what guarantees a whole-state (`ulb: null`) document can
never carry a per-ULB-only `formId` (30/31), which is exactly what lets `finalSubmit` skip the per-ULB
eligibility check entirely on the STATE branch without re-deriving that guarantee anywhere else.

`exemptionFor` itself is optional on the DTO, defaulting to `'ULB'` in the service when absent, so the
backend can deploy ahead of `formjsons`/the frontend sending the field at all.

## list() filters and paginates in memory

`list()` fetches every document for `{state, year}` in one `.find()`, flattens each document's `data[]`
into one row per `(document, entry)` pair, then applies `reasonForExemption`/`status`/`search` filters and
pagination in plain JS rather than a Mongo aggregation. This is deliberate: the candidate set is already
bounded by how many distinct ULBs have ever filed a request for that state+year (plus at most one
whole-state document), each holding at most one entry per that year's offered reasons — nowhere near
large enough for an `$unwind` aggregation to be worth the complexity.

## Invariants worth knowing before you change adjacent code

- Only 3 statuses are ever reachable for any entry: `UNDER_REVIEW_BY_MOHUA`, `RETURNED_BY_MOHUA`,
  `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` — no draft, no STATE-review leg (enforced by
  `REQUEST_EXEMPTION_STATUS_FILTER_VALUES` in the list query DTO and the schema's own entry doc-comment).
- `STATE_FORM_IDS_WITH_REAL_PROGRESS_CHECK` and `AFS_SECTION_TYPE_BY_FORM_ID`
  (`request-exemption.service.ts`) are deliberately small, unshared local copies — mirrored
  independently in `AnnualAccountsService`'s `SECTION_FORM_IDS` (inverse direction) and
  `RequestExemptionMohuaService`'s own `AFS_SECTION_TYPE_BY_FORM_ID` — matching this codebase's existing
  convention for small structural formId lookup tables rather than a shared cross-module export. Extend
  all relevant copies the day a new formId needs a real-progress check.
- Every exemption-block response is a `ConflictException` (409), never `ForbiddenException` (403) — see
  ADR 0002.

## Known gaps

- The form-log collection (`xvifc_eligibility_exemption_form_logs`) only ever writes an entry on
  `SUBMITTED` today — there's no `APPROVED`/`RETURNED` log row and no "get logs" read endpoint yet.
  Logging from day one is deliberate so adding those later needs no backfill.
- The `{'data.currentFormStatus': 1}` index on the main collection is forward-looking for a MoHUA review
  queue that doesn't exist yet.

## Dependencies

**Inbound** (what this module reads from elsewhere):
- Elected Body's live `claimEligibility.evaluator.config.rowEligibleValues` (via `FormJsonService`,
  formId 23) — drives `assertElectedBodyRowNotAlreadyEligible`.
- `XviFcAnnualAccount` (Audited/Provisional AFS section status) and `XviFcSfcStatus` (SFC Status) —
  drive the "real progress" checks in `assertTargetFormsEligible`/`assertTargetStateFormsEligible`.

**Outbound** (what depends on this module's state from outside):
- `SfcStatusService` (`state/sfc-status/`) — blocks `finalSubmit` on a Pending/Approved SFC exemption
  (`assertNotBlockedByExemption`) and overrides `getForm`'s `canEdit`/`canFinalSubmit` to `false` while
  one is live.
- `AnnualAccountsService` (`ulb/annual_accounts/`) — same pattern for `canUpload`
  (`assertNotBlockedByPendingExemption`, `getProcessingStatus`).
- `RequestExemptionMohuaService` (`mohua/request-exemption/`) — the decide-time (approve/reject)
  counterpart; re-verifies eligibility and writes the same document shape this module's writer does.

See [docs/adr/0002-eligibility-gating-and-race-window.md](docs/adr/0002-eligibility-gating-and-race-window.md)
for how these outbound dependents stay correct as state and time both move.
