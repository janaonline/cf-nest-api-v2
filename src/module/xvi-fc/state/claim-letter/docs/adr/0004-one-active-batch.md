# 0004 - One active batch per State/year/installment

## Status

Accepted (2026-10-27). Meant to be lifted later; see Consequences.

## Context

ADR 0002 lets a State hold up to 3 batches per (state, year, installment). The claim letter's row J
and its "All ULBs of the State not yet eligible" list (List 2) are State-wide: they count every ULB
of the State that fails a condition at the moment the letter is built, and rows C-K use the State's
total ULBs as the denominator. When two batches are prepared side by side, each letter is a snapshot
taken at a different moment, and nothing ties one batch's List 2 to the ULBs another batch is
claiming. A ULB can appear as "not yet eligible" in batch 1's signed letter and be claimed in
batch 2, and both letters reach MoHUA.

The program team chose to process one batch at a time for now; simultaneous batches are a stated
future need.

## Decision

At most one batch per (state, year, installment) is *active*: the earliest-created batch that is
`READY`, not abandoned, not superseded, and in `IN_PROGRESS`, `UNDER_REVIEW_BY_SO`, `RETURNED_BY_SO`
or `RETURNED_BY_MOHUA`. Any later batch in those statuses is blocked (409 `CLAIM_LETTER_BATCH_BLOCKED`,
message naming the active batch) for:
- preview and .docx download (`ClaimLetterDocumentService.loadParent`);
- letter-details save (`ClaimLetterLetterDetailsService.save`; `canEdit` is false on GET);
- the final PDF (`ClaimLetterFinalPdfService`);
- submit (`ClaimLetterSubmitService.submit`);
- creating a new draft (`ClaimLetterAssemblyService.createDraftRaw`, after the idempotency check and
  before the slot reservation).

Summaries carry `blockedByBatchNumber` / `blockedReason`, `canFinalSubmit` is false while blocked,
and the claim context reports `canCreate: false` with `createBlockedReason`, so the UI can explain
the block instead of failing on click. ULB edits, signed-file upload and abandon are not blocked:
abandoning the active batch is how a State unblocks the next one.

The whole rule lives in `ClaimLetterActiveBatchService` (one indexed query on the
`{ state, year, installment, currentFormStatus }` prefix, oldest first, limit 1). No other file
decides which batch is active. The rule only orders batches that are themselves active: an
abandoned or finished batch is never "blocked" (no lookup, no block reason), the same for the detail
page, the history list and every guard. An abandoned batch is refused on its own terms instead (409
"This claim batch was abandoned." for preview, .docx, signed-file upload and submit).

## Consequences

- A letter the SO approved (`UNDER_REVIEW_BY_MOHUA`, 5) is treated as approved and is not active, so
  the State can start its next batch (2026-11-02). MoHUA's final step (5 -> 7) is not used for now.
  Risk once MoHUA's own return (5 -> 6) is built: that letter turns active again and, being the
  oldest, blocks any newer batch; close it on return the way the SO return does (status 16 +
  `isAbandoned`), or keep 6 out of `ACTIVE_STATUSES`.
- Two creates racing past `assertCanCreate` can both succeed (the check is not inside the slot
  reservation transaction). The rule still holds because "active" is derived, not stored: the
  older one proceeds and the newer one is blocked like any later batch.
- Lifting the rule means more than deleting the guard: row J and List 2 must stop being per-letter
  snapshots (for example, exclude ULBs locked in other active batches, or re-check them at submit),
  otherwise concurrent letters contradict each other as described above.
