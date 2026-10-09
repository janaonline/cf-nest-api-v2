# SFC Status (PMU Review)

PMU-side review of the State-submitted SFC Status form (see `state/sfc-status/CLAUDE.md` — read
that first for the form itself). Form-level only: approve/reject the one document per (state,
year), no rows, no installments. PMU is an internal pre-screen before MoHUA (`XVIFC_PMU` role, see
`auth/enum/role.enum.ts`), not a status-bearing stage of its own: approving lands the form directly
on `UNDER_REVIEW_BY_MOHUA` rather than some PMU-specific "approved" status. No `mohua/sfc-status`
module exists yet to receive that handoff — same situation as `pmu/elected-urban-local-bodies`.

## Layout

- `sfc-status-pmu-review.controller.ts` — 4 endpoints under `xvi-fc/pmu/sfc-status`: cross-state
  `GET worklist/:yearId`, `GET :stateId/:yearId` (review metadata), `POST :stateId/:yearId/approve`,
  `POST :stateId/:yearId/reject`.
- `sfc-status-pmu-review.service.ts` — all business logic.
- `sfc-status-pmu-review.module.ts` — wiring; registers its own Mongoose models for the same
  `XviFcSfcStatus`/`XviFcSfcStatusHistory` collections `state/sfc-status` uses, independently of
  that module (see Dependencies below) — the two modules are deliberately decoupled.
- `types/sfc-status-pmu-review.types.ts` — lean read/write projection plus response shapes.
- `dto/` — empty. This module has no DTO of its own; `reject` reuses the shared
  `RejectPmuFormDto` (`xvi-fc/common/dto/reject-pmu-form.dto.ts`), the same one every other PMU
  review controller uses.

## Why no domain-service layer

FC Unspent Declaration's and Elected Urban Local Bodies' PMU reviewers each have a form-level
service *and* a row-level service sharing primitives through an intermediate per-form "domain
service" layer. SFC Status has no rows, so there's only one controller-facing service — it calls
the shared `StateFormPmuReviewHelper` (`xvi-fc/common/services/state-form-pmu-review.helper.ts`)
directly. That extra layer only earns its keep where two controller-facing services need the same
primitives.

## Route ordering: `worklist/:yearId` before `:stateId/:yearId`

Both are 2-segment GET routes, and Express/Nest matches the first registered handler whose
method+path pattern match — so `worklist/:yearId` must be declared (in both the controller and,
for the same reason, `getWorklist` ahead of `getReviewMetadata` in the service) before
`:stateId/:yearId`, or a request to `/worklist/<yearId>` would be routed to `getReviewMetadata`
with `stateId` bound to the literal string `'worklist'`. Same ordering convention as every other
PMU review controller in `xvi-fc`.

## Status handling: approve/reject outcomes

- Approve: `UNDER_REVIEW_BY_PMU` → `UNDER_REVIEW_BY_MOHUA` directly (no PMU "approved" status —
  see the purpose paragraph above).
- Reject: `UNDER_REVIEW_BY_PMU` → `RETURNED_BY_PMU`, with `pmuRemarks` set from the request body.
  `form-status.constants.ts`'s `getActorForStatus` maps `RETURNED_BY_PMU` to `'STATE'`, confirming
  the state is expected to act on it next (this module doesn't re-verify the state-side edit gate
  itself — that's `state/sfc-status`'s own `assertCanStateEditForm`).
- `pmuRemarks` is only ever set by `rejectCompleteForm`'s `$set`; nothing in this module clears it
  on a later approve, so a form that was once rejected and later approved will still carry the
  stale remark in storage even though the UI/worklist no longer surfaces it as the active reason
  (current status has moved past `RETURNED_BY_PMU`). Not treated as a bug here — same
  "supplementary, not authoritative" relationship every status-history field in this codebase has
  to `currentFormStatus`.
- Both mutating endpoints are gated by `assertCanPmuMutateForm`, which only allows
  `UNDER_REVIEW_BY_PMU` — approve/reject can't be called twice or out of sequence.
- The history insert omits `data` entirely (never re-copies `form.data`, which neither action
  touches) - see `common/services/CLAUDE.md`'s "Only snapshot data when it could actually have
  changed".

## No ADRs for this module

There's no concurrency/locking/idempotency machinery here beyond what the shared
`StateFormPmuReviewHelper` already provides (documented at its own definition). The
non-transactional form-update + history-insert tradeoff is `state/sfc-status`'s own accepted
decision (see that module's CLAUDE.md, "The one tradeoff worth knowing before touching writes") —
this module just reuses it via the shared helper, it isn't a new decision made here. Nothing else
in this folder is load-bearing enough to warrant a `docs/adr/`.

## Dependencies (relative to `state/sfc-status`)

- There is no PMU-specific schema/collection (`src/schemas/xvi-fc/` only has `state/` and `ulb/`
  subfolders) — this module reads *and writes* `state/sfc-status`'s own `XviFcSfcStatus`
  (`xvifc_sfc`) and `XviFcSfcStatusHistory` (`xvifc_sfc_logs`) collections directly, via its own
  model registrations (not an import of `state/sfc-status`'s module).
- Writes only `currentFormStatus`, `updatedBy`, and (on reject) `pmuRemarks` via `$set`. Never
  writes or re-snapshots `data` — the state's form payload — at all; only reads it to surface in
  the GET review response (see the "history insert omits `data`" bullet above).
- Any change to `XviFcSfcStatus`'s field names/shape in `state/sfc-status` directly affects this
  service's `$set`/`.select()` field lists and the `PmuFormLeanWithPopulate`/`SfcStatusPmuFormLean`
  types here — there's no separate migration path to forget, but also no independence to rely on.
- Does **not** read or surface `request-exemption`'s whole-state exemption overlay (unlike
  `state/sfc-status`'s own `getForm` — see that module's CLAUDE.md, "Discretionary whole-state
  exemption awareness"). A state blocked by a pending/approved whole-state exemption never reaches
  `UNDER_REVIEW_BY_PMU` to begin with, since `saveDraft`/`finalSubmit` are blocked upstream of PMU
  — so there's nothing to layer here.
- `assertCanPmuMutateForm`/`canPmuViewForm` (`xvi-fc-form-status-access.util.ts`),
  `buildPmuReviewerFormPermissions` (`xvi-fc-reviewer-permissions.util.ts`),
  `assertPmuReviewerAccess` (`xvi-fc-reviewer-access.util.ts`), `StateFormPmuReviewHelper`, and
  `buildPmuWorklistRows` (`pmu-worklist.util.ts`) are shared across all 5 PMU review modules (GTC,
  Devolution Formula, Elected Urban Local Bodies, FC Unspent Declaration, SFC Status) — genuinely
  shared, not SFC-specific, so they're documented at their own definitions, not duplicated here.
