# 0003 - Workflow transitions and history

## Status

Accepted

## Context

Each claim-letter batch has a `currentFormStatus` reflecting where it sits in the State → MoHUA
review workflow. Not every write to a batch is a meaningful transition worth an audit trail - an
edit changes content, not workflow position.

## Decision

A history row (`ClaimLetterHistoryService.recordTransition`) is written **only** for these, in V1:
- Draft creation (`null` → `IN_PROGRESS`, in `ClaimLetterAssemblyService.createDraftRaw`).
- Submit (`IN_PROGRESS` → `UNDER_REVIEW_BY_MOHUA`, in `ClaimLetterSubmitService.submit`). Its row also
  records `submittedFiles`: the signed letter as uploaded and the final claim letter (`finalClaimPdf`).
- Abandon (`IN_PROGRESS` → `IN_PROGRESS`, a same-status transition recorded purely for audit
  purposes, in `ClaimLetterAssemblyService.abandonDraftRaw`).

It is **never** written for:
- `PATCH .../draft` (`updateDraft`) - edits change the ULB selection/amounts, not workflow
  position. Guarded by the edit-lock token rather than `revision` directly at the point the update
  commits (see ADR 0002's edit-lock lease) - nothing else can have changed `currentFormStatus`
  while that token is held, since abandon/submit both refuse to act while it's set.
- `uploadSignedFile` - attaches a file, doesn't move the workflow.
- `PATCH .../letter-details` (`ClaimLetterLetterDetailsService.save`) - the State's letter text,
  not workflow position.
- `GET .../final-pdf` (`ClaimLetterFinalPdfService`) - builds and caches a derived file
  (`finalClaimPdf`) on the batch.

**The signed letter is cleared, without a history row, when what it signed changes:**
- A ULB edit (`verifyAndFinalizeUpdate`) sets `signedClaimFile: null` with the revision bump. A save
  with the same ULBs and amounts is a no-op (no rebuild, no revision bump), so it keeps the file.
- A letter-details change does the same, but only with `confirmSignedFileRemoval: true` (409
  `SIGNED_FILE_REMOVAL_NOT_CONFIRMED` otherwise, so the UI can warn first). An unchanged save never
  clears it.

**Submit preconditions**, checked before its transaction: not abandoned (409; abandon keeps
`IN_PROGRESS`, so the filter also requires `isAbandoned: false`); signed file present; letter details
complete (formjson-required fields); this is the active batch (ADR 0004); fresh State gate and
per-ULB eligibility of every batch ULB (failing ULBs named); every non-optional enclosure in
`meta.mergeDocuments` present (400 `FINAL_PDF_INCOMPLETE`); and the `finalPdfSourceKey` the State
reviewed still matches the current merge sources (409 `FINAL_PDF_OUTDATED`); and, for the last batch
slot (`CLAIM_LETTER_MAX_BATCH_NUMBER`), no expected ULB left out of every batch. The update filter also
pins `signedClaimFile.path` and `letterDetailsUpdatedAt` as read, so a re-upload or letter-details
save racing the submit makes it fail instead of submitting content nobody reviewed. The submitted
batch keeps both `signedClaimFile` and `finalClaimPdf`; the final claim letter is the submission
artifact, and the final-PDF endpoints keep serving it (never rebuilt) after submit.

Every history write happens **inside the same DB transaction as the status change it records** - a
transition and its audit row can never diverge (one committing without the other landing).

Two mechanisms are wired but have no caller yet in V1 - built ahead of need, not speculative:
- `createNewVersion` - carries forward the previous version's ULB/amount selections through the
  full build pipeline (fresh eligibility, fresh locks, fresh children) rather than mutating the
  previous version, which stays exactly as it was. Exists for the future MoHUA-rejection flow
  (out of scope for V1); when wired up, it will need its own decision about whether/how it records
  history distinctly from a fresh `createDraft`.
- `acknowledgeLocks` - flips a claim's locks from `ACTIVE` to `ACKNOWLEDGED`, a permanent
  database-level guarantee against a second acknowledged claim for the same
  State/year/installment/ULB. No caller in V1; will be wired to whatever workflow step represents
  MoHUA's final acknowledgement.

## Consequences

- Adding a new mutation to this feature requires an explicit decision: is it a workflow transition
  (needs a history write, inside the same transaction as the status change) or not (doesn't get
  one)? Silently forgetting a history write on a real transition breaks the audit trail; adding one
  to a non-transition (like an edit) pollutes it with noise that doesn't represent workflow
  movement.
- When `createNewVersion` or `acknowledgeLocks` gain real callers, revisit this ADR - their history
  behavior wasn't validated against a real caller in V1.
