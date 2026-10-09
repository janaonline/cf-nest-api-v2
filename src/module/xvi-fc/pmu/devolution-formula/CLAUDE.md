# Devolution Formula (PMU Review)

PMU-side review for the ULB-wise Allocation form filed in `state/devolution-formula` — a separate
module, decoupled from the State-side one (same split as every other PMU reviewer). `PMU`
(`XVIFC_PMU` permission group, `src/module/auth/enum/role.enum.ts`) is the actor that reviews a
State's submission before it reaches MoHUA — see that enum's own comment for the role's place in
the pipeline. This reviewer is form-level only: whole-form approve/reject, installment-scoped, plus
a read-only ULB-row listing so PMU isn't deciding blind. It never mutates row data (see "Read-only
row access" below).

## Layout

- `devolution-formula-pmu-review.controller.ts` — 5 endpoints under
  `xvi-fc/pmu/devolution-formula`: cross-state worklist, review metadata, read-only rows, approve,
  reject. View endpoints gated by `REVIEW_STATE_SUBMISSIONS_PMU`, the two mutating ones by
  `APPROVE_STATE_SUBMISSIONS_PMU`.
- `devolution-formula-pmu-review.module.ts` — wiring; registers the 3 **State-owned** schemas this
  module reads/writes (form, form-history, row) plus `State`, read-only for name lookups. No
  PMU-owned collection of its own — see "No side-channel collection" below.
- `services/devolution-formula-pmu-review.service.ts` — all business logic.
- `types/devolution-formula-pmu-review.types.ts` — response-shape interfaces.
- `constants/devolution-formula-pmu-review.constants.ts` — pagination defaults/cap for the row list.
- `dto/get-devolution-formula-pmu-rows-query.dto.ts` — row-list query params (`page`/`limit` only;
  unlike EULB/FC Unspent this read-only row list has no `search`/`rowStatus` filter).

## No side-channel collection — this module writes directly to the State's own documents

Unlike `mohua/request-exemption`'s review ("display-only overlay, never write to the target form" —
see that module's
[docs/adr/0001-display-only-overlay-no-target-form-writes.md](../../mohua/request-exemption/docs/adr/0001-display-only-overlay-no-target-form-writes.md)),
**that principle does not apply here**. This module has no collections of its own at all: the module
only registers `DevolutionFormulaForm`/`DevolutionFormulaFormHistory`/`DevolutionFormulaRow` — the
exact same Mongoose models `state/devolution-formula` uses — and `approve`/`reject` write
`currentFormStatus`/`pmuRemarks`/`updatedBy` straight onto the State's own form document via
`StateFormPmuReviewHelper.transitionForm`, then append to the State's own history collection via
`writeHistoryIfChanged` (`src/module/xvi-fc/common/services/state-form-pmu-review.helper.ts`).

This is a different situation, not an inconsistency: `mohua/request-exemption`'s overlay exists
because that flow is a separate, discretionary decision bolted onto an *already-settled* form that
another service already owns outright (writing into it directly caused real invariant conflicts —
see that ADR's Context). PMU review here is instead just another sequential stage of the *same*
status machine the State form already runs (`NOT_STARTED → IN_PROGRESS → … → UNDER_REVIEW_BY_PMU →
UNDER_REVIEW_BY_MOHUA`/`RETURNED_BY_PMU`) — one `currentFormStatus` field, one owner at a time,
enforced by `assertCanPmuMutateForm` only permitting a write while the form is actually
`UNDER_REVIEW_BY_PMU` (`src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util.ts`). There's
no second service independently inventing its own assumptions about the document — it's the same
state-machine contract `state/devolution-formula`'s own `saveDraft`/`finalSubmit` already write
under.

On reject, `toStatus` is `RETURNED_BY_PMU`, which `STATE_EDITABLE_STATUS_IDS` already includes
(`xvi-fc-form-status-access.util.ts`) — the State can resume editing immediately, the same as a
MoHUA rejection.

## Approve lands directly on `UNDER_REVIEW_BY_MOHUA`, with no status of its own

`approveCompleteForm` sets `toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA` directly — PMU is an
internal pre-screen stage, not a status-bearing stage in its own right once it signs off.

## Worklist synthesis

`getWorklist` crosses every active+published state with both installments and left-joins whatever
form document (if any) exists for each pair this year; a missing pair gets a synthesized
`NOT_STARTED` row (`buildPmuWorklistRows`, shared with every other PMU reviewer). This is the same
`doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED` convention every state-side service already
uses for a missing document, so `NOT_STARTED` here can't mean anything else. That same shared
function also applies `stateId`/`status` filtering, `sortBy`/`sortDir` sorting, and `page`/`limit`
pagination to the resulting row list — since this module is installment-scoped, one state's 2
installment rows can straddle a page boundary (see `pmu-worklist.util.ts`'s own doc comment).

## Read-only row access

`getRows` lists the active dataset version's rows (`datasetVersion: form.activeDatasetVersion ??
0, isActive: true`), genuinely paginated (`page`/`limit`, `skip`+`limit`+`countDocuments` — see
`constants/devolution-formula-pmu-review.constants.ts` for the default/max page size, the same
shape as every other PMU row list) purely so PMU isn't approving/rejecting the ULB-wise figures
blind — unlike SFC's/GTC's PMU reviewers, this form carries no per-row `data` snapshot on the form
document itself. `getReviewMetadata` does still return a small `questions` array (the 3
`DF_MAIN_FORM_FIELDS` summary fields — `ulbCount`/`excelFile`/`checkboxConfirmation`: the
live-computed active-ULB count, the uploaded allocation Excel, and the submission certification,
same hydration mechanism EULB's own PMU reviewer uses — `checkboxConfirmation` was previously
omitted here by mistake, always reading as unchecked regardless of what State submitted), not the
full per-row field list. **PMU never mutates row data** — no per-row approve/
reject/edit exists on this side, unlike `elected-urban-local-bodies`'s/`fc-unspent-declaration`'s
PMU reviewers, which do have a row-level domain service. The per-ULB claim-lock mechanism
(`assertNoActiveClaimLockForUlb`, see `state/devolution-formula/CLAUDE.md`'s "Row-level claim-lock
enforcement (PMU Review feature)") is unrelated to this module — it guards the State's own portal
row-edit path, not anything PMU does.

Row filtering by `activeDatasetVersion` depends on the dataset-versioning invariant owned by
`state/devolution-formula` — see its
[docs/adr/0001-dataset-versioning.md](../../state/devolution-formula/docs/adr/0001-dataset-versioning.md)
rather than re-deriving it here; this module is a read-only consumer of that invariant, same as
`claim-letter`'s and `fc-unspent-declaration`'s reads listed in that ADR's Consumers section (not
yet added there since this module reads only `isActive`/`datasetVersion`, no allocation-amount
computation of its own).

## No ADR

No ADR exists for this module — nothing here is new concurrency/locking machinery or a workaround:
form-status mutation goes through the shared, already-documented `StateFormPmuReviewHelper`
(non-transactional two-write convention, same as SFC/GTC/Devolution's own State-side writes — see
`state/devolution-formula/CLAUDE.md`'s "Form status history log"), row access is a plain read
scoped by an invariant `state/devolution-formula`'s own ADR already owns, and the worklist/
permission mechanics are shared, undocumented-here-on-purpose utilities common to every PMU
reviewer. Same reasoning as `gtc`'s and `sfc-status`'s "No ADRs exist for this module" lines.

## Known gaps

None known. This module is a thin, read-mostly reviewer with no bulk/row-mutation surface area to
accumulate gaps in.
