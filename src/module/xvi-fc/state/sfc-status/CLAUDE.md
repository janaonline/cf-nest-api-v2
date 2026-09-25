# SFC Status

State-facing feature: a single SFC Status form document per (state, year). No batching, no
multi-document workflow — a State reads the form, saves a draft, and final-submits it.

## Layout

Flat — no `services/`/`helpers/` subfolders (unlike `claim-letter`, which needs them for its
multi-service pipeline):

- `sfc-status.controller.ts` — 5 endpoints: `GET questions` (static config), `GET dump` (Excel
  export), `GET :stateId/:yearId` (hydrated read), `POST save-draft`, `POST final-submit`.
- `sfc-status.service.ts` — all business logic. Each write endpoint follows the same pattern:
  existence check → upsert → separate history-insert call.
- `dto/`, `types/` — request DTOs and response shapes.

## The one tradeoff worth knowing before touching writes

`saveDraft`/`finalSubmit` update the form document and insert a history record as two separate,
**non-transactional** writes — if the history insert fails, the form update has already persisted.
This is a deliberate, accepted tradeoff, not an oversight: history rows are an audit trail of status
transitions, never the source of truth for anything — every access-control/status decision reads
`currentFormStatus`/`data` straight off the form document, which has already durably persisted by
the time `createHistoryEntry` runs. A failed insert leaves a gap in the audit trail, never a
functional inconsistency, so it isn't judged worth a cross-collection transaction for what amounts
to a supplementary log write. If you're adding a new write path here, decide explicitly whether it
needs the same treatment or genuinely needs transactional atomicity — don't assume one or the other.

The form update itself is guarded against a concurrent status change (e.g. a final submit racing a
draft save): both writes include `currentFormStatus` in their filter, and a first-save race that
hits the unique index is caught too. See `xvi-fc-concurrent-write.util.ts` (shared with GTC and
Devolution Formula).

`createHistoryEntry` also no-ops when `fromStatus === toStatus` — a re-save that leaves the form
`IN_PROGRESS` writes nothing (older `xvifc_sfc_logs` rows from before this guard still have
same-status `UPDATE_DRAFT` entries). `action` uses the shared `FormHistoryAction` enum
(`src/common/constants/form-status.constants.ts` — one enum for every state form, not per-form).

No ADRs exist for this module (unlike `claim-letter`) — there's no cross-cutting concurrency
machinery (no transactions, locking, idempotency keys, or batch/reservation logic) that would
warrant one.

## Discretionary whole-state exemption awareness

SFC Status (formId 22, see `sfc-status.schema.ts`'s `SFC_FORM_ID`) is a consumer of the
discretionary Request Exemption flow's **whole-state** branch (`module/xvi-fc/state/request-exemption`
+ `module/xvi-fc/mohua/request-exemption`, `ulb: null` documents) — a state can file an SFC
exemption request there, and this module reflects the outcome without ever writing to its own
`XviFcSfcStatus` collection (a pure display-only overlay, same principle as Annual Accounts' own
per-ULB version — see `common/services/CLAUDE.md`'s `ExemptionResolverService` section):

- `getForm` calls the private `resolveExemptionStatusForResponse(stateId, yearId)` and returns
  `exemptionStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null` + `exemptionMohuaRemarks` alongside
  the hydrated form.
- `saveDraft` and `finalSubmit` both call the private `assertNotBlockedByExemption(stateId, yearId)`
  right after `assertStateAccess`, before any DB read — throws `ConflictException` (409, not 403 —
  see request-exemption's `docs/adr/0002-eligibility-gating-and-race-window.md`) while the exemption
  is Pending (under MoHUA review) or Approved. Once Rejected, SFC Status's own
  `currentFormStatus`/`assertCanStateEditForm`/`assertCanStateFinalSubmitForm` govern normally again.
  `finalSubmit` calls this twice — see the same ADR's "SFC `finalSubmit` race window" — to narrow the
  TOCTOU gap between its validation steps and its write.

Both private methods are SFC Status's own copies of `AnnualAccountsService`'s
`resolveExemptionStatusForResponse`/`assertNotBlockedByPendingExemption`, not shared code — SFC
Status has exactly one form (not per-section), so there's no repeated-per-section logic here to
factor out. `ExemptionResolverService.resolveDiscretionary` itself is shared (its `ulbId: null`
overload, added for this).

The dependency also runs the other way: `request-exemption.service.ts`'s
`assertTargetStateFormsEligible` (filing time) and `request-exemption-mohua.service.ts`'s
`assertSectionStillEligible` (approve time) each directly query `XviFcSfcStatus` to block a whole-
state SFC exemption request once SFC Status itself already has real progress (i.e. is no longer
Not Started/In Progress/Returned by MoHUA — `STATE_EDITABLE_STATUS_IDS`). Filing/approving an
exemption for a form the state has already submitted would otherwise silently succeed (nothing
here stops the SFC Status document itself from advancing independently) — see the root `CLAUDE.md`
module-layout note for both modules.
