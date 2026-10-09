# GTC PMU Review

PMU-side review (approve/reject) of State's GTC submissions, before MoHUA review - the `pmu`
counterpart of `state/gtc` (read that module's CLAUDE.md first for what a GTC submission actually
is: form-level, installment-scoped, no rows). Same shape as the other 4 PMU review services
(`sfc-status`, `devolution-formula`, `elected-urban-local-bodies`, `fc-unspent-declaration`) -
approve/reject only, no row-level counterpart to share mechanics with, so the shared
`StateFormPmuReviewHelper` is called directly here rather than through a per-form "domain service"
layer (see `GtcPmuReviewService`'s own class docblock for the full rationale, shared verbatim with
`SfcStatusPmuReviewService`'s).

## Layout

Flat, same shape as `state/gtc` itself:

- `gtc-pmu-review.controller.ts` - 4 endpoints: `GET worklist/:yearId` (cross-state worklist),
  `GET :stateId/:yearId/:installment` (review metadata), `POST :stateId/:yearId/:installment/approve`,
  `POST :stateId/:yearId/:installment/reject`.
- `gtc-pmu-review.module.ts` - wiring; registers its own copies of the `XviFcGtc`/`XviFcGtcHistory`/
  `State` models, decoupled from `state/gtc`'s own module (same convention every PMU review module
  follows).
- `services/gtc-pmu-review.service.ts` - all business logic.
- `types/gtc-pmu-review.types.ts` - lean projection + response-shape interfaces.

## What a PMU review actually does

- `getWorklist` and `getReviewMetadata` are read-only - the latter hydrates `formJson` questions
  against the stored `data` the same way `state/gtc`'s own `getForm` does, via the shared
  `FormQuestionHydratorService`.
- `approveCompleteForm`/`rejectCompleteForm` write only workflow-status fields on the *same*
  `XviFcGtc` document State writes to (`currentFormStatus`, `updatedBy`, and `pmuRemarks` on reject)
  - never the form's own `data` bag. Approve moves `UNDER_REVIEW_BY_PMU -> UNDER_REVIEW_BY_MOHUA`
  (PMU is an internal pre-screen, not a status-bearing stage of its own); reject moves to
  `RETURNED_BY_PMU` and requires a non-empty `pmuRemarks`.
- Both transitions are two separate, non-transactional writes (a form update, then a history insert
  that no-ops when `fromStatus === toStatus`) - identical to `state/gtc`'s own convention; see
  `../../state/gtc/CLAUDE.md`'s "The one tradeoff worth knowing before touching writes".
- The history insert omits `data` entirely (never re-copies `form.data`, which neither action
  touches) - see `common/services/CLAUDE.md`'s "Only snapshot data when it could actually have
  changed".

## Not connected to GTC's installment-2 unlock gap

`state/gtc/CLAUDE.md`'s "Known gaps" flags installment 2 as unconditionally locked behind a
hardcoded `isInstallment2Unlocked` stub in `gtc.service.ts`, pending a design year's installment-2
questionnaire actually being authored. This module is **not** that unlock mechanism and doesn't
touch it: nothing here reads or sets `installmentAccess`/`isInstallment2Unlocked`, and `installment`
is handled generically - 1 and 2 go through identical code paths in this controller and service.
A PMU approval of an installment-2 GTC form would work exactly like installment 1 the moment such a
document exists; the reason it doesn't happen in practice today is that `state/gtc`'s own
`finalSubmit` already rejects `installment: 2` with `installment2Locked` before a document can ever
reach PMU. Wiring a PMU decision into that unlock would be a new, separate decision - not something
this module already does.

## Why `parseInstallment` is duplicated here

`GtcPmuReviewController.parseInstallment` duplicates `state/gtc`'s own `GtcController.parseInstallment`
(identical validation) rather than importing it. This module is deliberately decoupled from
`state/gtc`'s controller/service (its own module, its own model registrations), and a validation
helper this small isn't worth an import across the actor boundary - `pmu/devolution-formula`'s own
PMU controller makes the same call for its own installment param.

## Dependencies

- Schema: no PMU-specific collection exists (`src/schemas/xvi-fc/` only has `state/` and `ulb/`
  subfolders) - this module reads and writes `XviFcGtc`/`XviFcGtcHistory` directly
  (`src/schemas/xvi-fc/state/gtc-form.schema.ts`, `gtc-form-history.schema.ts`), the same
  collections `state/gtc`'s own `GtcService` owns, plus its `GTC_FORM_ID`/`GTC_INSTALLMENTS`/
  `GtcInstallment` constants (`state/gtc/constants/gtc.constants.ts`).
- Shared PMU infrastructure (common to all 5 PMU review services): `StateFormPmuReviewHelper` (the
  transition + history-write primitives), `buildPmuWorklistRows`
  (`common/utils/pmu-worklist.util.ts` - the cross-state/installment join and `NOT_STARTED`
  synthesis, plus that same function's `stateId`/`status`/`sortBy`/`sortDir`/`page`/`limit`
  filtering, sorting, and pagination of the resulting row list - see its own doc comment),
  `assertPmuReviewerAccess`/`canPmuViewForm`/`assertCanPmuMutateForm`
  (`common/utils/xvi-fc-reviewer-access.util.ts`, `xvi-fc-form-status-access.util.ts`),
  `buildPmuReviewerFormPermissions`, `XvifcFormActorsService`, `FormQuestionHydratorService`,
  `FormJsonService`.

## No ADRs exist for this module

Same reasoning as `state/gtc` and `sfc-status`: no transactions, locking, idempotency keys, or
batch/reservation logic here - just a status-gated pair of sequential writes already covered by
`state/gtc`'s own CLAUDE.md. If a future change makes this module itself the installment-2 unlock
trigger (see above), that would be genuinely load-bearing and should get its own ADR here rather
than an inline comment.
