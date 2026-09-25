# Request Exemption (MoHUA Review)

MoHUA-side decide (approve/reject) for the discretionary Request Exemption flow filed in
`state/request-exemption` — a separate module, deliberately decoupled from the STATE-side one
(mirrors `mohua/fc-unspent-declaration`'s own split from its STATE sibling). Much simpler than the
STATE-side module: one `data[]` entry decided per call, addressed by `{requestId, formId}` — no
bulk-row/eligibility machinery.

## Layout

- `request-exemption-mohua.service.ts` — all of the feature's logic: `approve`, `reject`, plus the
  private eligibility/access helpers. Read this file first.
- `request-exemption-mohua.controller.ts` — 2 thin REST endpoints under
  `xvi-fc/mohua/request-exemption`, both guarded by `APPROVE_STATE_SUBMISSIONS`.
- `request-exemption-mohua.module.ts` — wiring; registers this module's own 2 collections plus the
  4 target-form models `assertSectionStillEligible` reads across (read-only — see the ADR below).
- `request-exemption-mohua.types.ts` — the one shared response-shape interface.
- `dto/reject-request-exemption.dto.ts` — `RejectRequestExemptionDto`, just `mohuaRemarks`.

## Before changing approve/reject, read the ADR

- [docs/adr/0001-display-only-overlay-no-target-form-writes.md](docs/adr/0001-display-only-overlay-no-target-form-writes.md)
  — why this service never writes to a target form's own collection, and what every target-form
  service must do instead to reflect a decision.

This module also depends on two ADRs in `state/request-exemption`: its
[docs/adr/0001-document-shape-and-write-concurrency.md](../../state/request-exemption/docs/adr/0001-document-shape-and-write-concurrency.md)
(the entry shape and wholesale-replace convention both writers share) and
[docs/adr/0002-eligibility-gating-and-race-window.md](../../state/request-exemption/docs/adr/0002-eligibility-gating-and-race-window.md)
(the fail-fast-at-filing/re-verify-at-decision pattern `assertSectionStillEligible` runs the
decide-time half of, and the 409-not-403 convention `assertPending`/`assertUpdateMatched` follow).

## Two-layer race guard on decide

`assertPending` (a pre-transaction read) and `assertUpdateMatched` (the transactional
`findOneAndUpdate`'s own match check) together close the window between a double-click or two
reviewers deciding the same entry concurrently. Neither is sufficient alone: `assertPending` alone
would race past a decision made between its read and the write; `assertUpdateMatched` alone would
still pay for the (more expensive) `assertSectionStillEligible` read on a request that's already
decided.

## `assertSectionStillEligible` branches by formId, not by `doc.ulb`

formId 30/31 (Annual Accounts) and formId 22 (SFC Status) block approval when the real target form
already has progress beyond `ULB_EDITABLE_STATUS_IDS`/`STATE_EDITABLE_STATUS_IDS`; formId 23
(Elected Body) instead checks whether the ULB's current row value already satisfies the eligibility
requirement, via `assertElectedBodyRowNotAlreadyEligible` — Elected Body has no per-ULB
submission-status document to check the way 30/31 do. This is the decide-time half of the same three
checks `RequestExemptionService.assertTargetFormsEligible`/`assertTargetStateFormsEligible` run at
filing time — see `state/request-exemption`'s ADR 0002 above for why each is shaped differently.
