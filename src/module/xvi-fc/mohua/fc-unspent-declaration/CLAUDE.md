# FC Unspent Declaration (MoHUA Review)

MoHUA-side review for the FC Unspent Declaration form filed in `state/fc-unspent-declaration` — a
separate module, deliberately decoupled from that STATE-side module (no cross-module dependency
either way; mirrors `mohua/request-exemption`'s own split from its STATE sibling). Registers the
same four schemas the State module owns — Mongoose model bindings are per-module, not exclusive, so
both modules reading/writing the same collections is the established xvi-fc pattern, not a new one
introduced here.

## Layout

- `fc-unspent-mohua-review.controller.ts` — 6 thin REST endpoints under
  `xvi-fc/mohua/fc-unspent-declaration`, all guarded by `REVIEW_STATE_SUBMISSIONS` (GETs) or
  `APPROVE_STATE_SUBMISSIONS` (mutations).
- `fc-unspent-mohua-review.module.ts` — wiring; registers this module's own 4 schemas.
- `services/fc-unspent-mohua-review.service.ts` — form-level concerns: review metadata (GET) and
  complete-form approve/reject.
- `services/fc-unspent-mohua-rows.service.ts` — row-level concerns: the paginated row list and the
  two bulk row-decision endpoints.
- `services/fc-unspent-row-review-domain.service.ts` — shared primitives (parent lookup, row
  loading, row/parent transitions + history, the Yes-branch completion check) used by both of the
  above, so the row-level and complete-form flows never diverge. Exported from the module but not
  currently consumed outside this folder — reserved as the integration point for a later
  claim-acknowledgement hook (not yet implemented).
- `types/fc-unspent-mohua-review.types.ts`, `dto/` — supporting.

## The complete-form approve/reject branch logic

`approveCompleteForm` branches on `form.isFcUnspent`: No-branch requires the persisted declaration
file (`fcDeclaration`) to still exist, then acknowledges directly — no rows involved. Yes-branch
requires at least one active row, blocks (400, `rowsNotApprovable`) if any active row is anything
other than `UNDER_REVIEW_BY_MOHUA`/`SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (i.e. rejected, needs update,
or never submitted), then transitions the remaining `UNDER_REVIEW_BY_MOHUA` rows to
`SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (already-acknowledged rows are left untouched — no duplicate
history) before acknowledging the parent.

`rejectCompleteForm` mirrors this: No-branch returns directly to `RETURNED_BY_MOHUA`. Yes-branch is
allowed only when no active row has already reached `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (400,
`rowsAlreadyApproved` — rejecting the whole form must never regress an independently-approved row;
use row-level review instead), then the remaining `UNDER_REVIEW_BY_MOHUA` rows transition to
`RETURNED_BY_MOHUA` with the same remark.

## Row-level bulk review and the auto-acknowledge rule

`bulkApproveRows`/`bulkRejectRows` both require every targeted row to currently be
`UNDER_REVIEW_BY_MOHUA` (400, `notPending` otherwise) and require the form to be on the Yes-branch
(400, `notYesBranch` otherwise). After a bulk approve, `maybeAcknowledgeAfterBulkAction` acknowledges
the parent atomically — in the same transaction — only when *every* active row is now
`SUBMISSION_ACKNOWLEDGED_BY_MOHUA`; any row still `UNDER_REVIEW_BY_MOHUA`/`RETURNED_BY_MOHUA`/
`ACTION_REQUIRED`/`null` keeps the parent at `UNDER_REVIEW_BY_MOHUA`. A form with any
`RETURNED_BY_MOHUA` row can therefore never auto-acknowledge this way, nor via complete-form
approval (which also blocks on a non-reviewable row, above) — there is no state-correction/
resubmission phase yet that clears a rejected row back to reviewable. Bulk reject never acknowledges
the parent — rejecting rows can only ever keep the form under review.

## `transitionRows`' defensive re-filter and the parent-history no-op guard

`FcUnspentRowReviewDomainService.transitionRows` re-filters its input to rows whose `rowStatus`
actually differs from the target before writing, so a caller that forgets to pre-filter
already-decided rows can't write a same-status no-op history entry. `insertParentHistory` carries
the same guard at the parent level (no-op when `fromStatus === toStatus`) — defensive today since
every current caller already gates via `assertCanMohuaMutateForm` before reaching it, but kept in
case a future caller doesn't.

## Known gaps

- **No optimistic-concurrency check on the row/parent status write itself.** Both
  `transitionRows`' `bulkWrite` and `transitionParent`'s `findOneAndUpdate` filter only by `_id` —
  not by the row/form's expected current status at write time. The only gate is a pre-transaction
  read (`filterNotInStatus` for rows, `assertCanMohuaMutateForm` for the parent), so two concurrent
  decide actions on the same row or form (a double-click, or two reviewers) can both pass that read
  and then both write, producing a lost update and/or two inconsistent history entries instead of a
  clean conflict. `state/request-exemption`'s two-layer guard (`assertPending` +
  `assertUpdateMatched`, see its `docs/adr/0002-eligibility-gating-and-race-window.md`) is the
  pattern to adopt here if this needs closing — not implemented in this module today.
- A `RETURNED_BY_MOHUA` row has no way back to reviewable yet (see "Row-level bulk review" above) —
  a future state-correction/resubmission phase is expected to add one.

No ADRs exist for this module. The one gap worth naming (above) is a missing guard, not a design
decision, so it's recorded here rather than as an ADR.
