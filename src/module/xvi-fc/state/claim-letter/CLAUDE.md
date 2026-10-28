# Claim Letter

State-facing feature: a State selects ULBs from its Devolution Formula allocation and assembles
them into a "claim letter" batch, which then moves through a State → MoHUA review workflow. V1
supports Installment 1 only.

## Before changing anything here, read the relevant ADR

Each decision below is cited from several files; read the ADR, not just the local comment:

- [docs/adr/0001-idempotent-retry.md](docs/adr/0001-idempotent-retry.md) - retry safety for create,
  edit and submit, and the concurrency model of each later mutation.
- [docs/adr/0002-batching-and-locks.md](docs/adr/0002-batching-and-locks.md) - the 3 batch slots,
  per-ULB locks, the build stages, stale-`BUILDING` recovery and the edit-lock lease.
- [docs/adr/0003-workflow-transitions.md](docs/adr/0003-workflow-transitions.md) - which mutations
  write history, when the signed letter is cleared, and the submit preconditions.
- [docs/adr/0004-one-active-batch.md](docs/adr/0004-one-active-batch.md) - one batch in progress per
  State/year/installment, and why lifting it brings back stale letters.

## Layout

- `claim-letter.controller.ts` - every route under `xvi-fc/state/claim-letter`. Reads need
  VIEW_STATE_FORMS; create, edit, abandon, signed-file upload and letter-details save need
  PREPARE_GRANT_LETTERS; submit needs FINAL_SUBMIT_TO_MOHUA.
- `services/assembly/` - writes a batch's locks and children: create, edit and abandon, plus
  `createNewVersion` and `acknowledgeLocks` (no caller in V1). The only other writer is the recovery
  cleanup, which deletes a stale `BUILDING` batch with its children and locks through the same
  shared helper. Everything else only reads, or writes the parent document alone.
- `services/eligibility/` - the State-level gate, per-ULB criteria, Devolution allocations and claimed
  totals. Its cached `*ForDisplay` methods serve read-only display paths only; create, edit, submit
  and the letter always evaluate fresh.
- `services/main/claim-letter.service.ts` - read paths (eligibility summary, claim context, detail,
  history) and the signed-file upload.
- `services/ulb-options/` - the ULB picker: every expected ULB with its ineligibility reason,
  eligible first.
- `services/ulb-rows/` - the batch's selected-ULB table, with a display-only eligibility re-check.
- `services/submit/` - submit (`IN_PROGRESS -> UNDER_REVIEW_BY_MOHUA`) and its checks (ADR 0003).
- `services/active-batch/` - the one-active-batch rule (ADR 0004); no other file decides it.
- `services/history/` - the only writer of `ClaimLetterBatchHistory` (ADR 0003).
- `services/recovery/` - the hourly stale-`BUILDING` cleanup (cron) and `detectAnomalies`, a
  read-only report.
- `services/document/claim-letter-document.service.ts` - the letter as a display-ready model (see
  "The letter").
- `services/document/claim-letter-docx.service.ts` - renders that model to an A4 .docx (`docx` npm):
  portrait covering letter, landscape annexure, yellow-highlighted placeholders, column widths from
  the column `kind`. Always built fresh, never from the preview cache; `generateForDownload` checks
  the mandatory letter details first, so every download path has that gate.
- `services/letter-details/` - the State-entered letter details (see "Letter details").
- `services/final-pdf/` - the final claim letter that goes to MoHUA (see "Final claim letter").
- `services/form-json/` - this feature's own formjson (formId 26, `CLAIM_LETTER_FORM_ID`): the
  `signedClaimFile` field, the claimed-vs-allocated band (`meta.varianceLowerPercent` /
  `varianceUpperPercent`, else `CLAIM_LETTER_VARIANCE_*_PERCENT`), `meta.letterDetailKeys`,
  `meta.letterDetailSkipPrefill` and `meta.mergeDocuments`. Invalid entries are logged and skipped.
  `loadFormConfig` fetches the document once per call and derives all of it; never add a second
  fetch for another part of the same document.
- `helpers/` - pure functions (amount arithmetic, content hash, summary mapping, permissions, letter
  text and annexure cells), except `claim-letter-build-cleanup.helpers.ts`, the delete shared by both
  stale-build reclaim paths.
- `constants/`, `types/`, `dto/` - limits and letter constants, response shapes, request validation.

## The letter

`ClaimLetterDocumentService` builds one model (`types/claim-letter-document.types.ts`: paragraphs of
runs, `placeholder` runs for blank State fields) for both the portal preview and the .docx, so the
two can never disagree; the frontend renders the backend's text verbatim.

- Rows C-K and both annexure lists come from a fresh `resolveUlbLevelEligibility` over the State's
  expected ULBs plus the batch's own; the State total is every row's denominator.
- Preview cache: that heavy part is kept in Redis per `revision` for 5 minutes, as a `meta` key
  (everything but the rows) plus 100-row chunks per list, so opening the letter parses no rows and a
  20-row page parses one chunk. Chunks are written first and live 30s longer than `meta`; concurrent
  misses share one build (per process). Keys expire on their own, and a revision bump starts new ones.
- Letter details and the SFC values (row B) change without a revision bump, so they are merged per
  request, never cached. The .docx and Submit always evaluate fresh.
- Annexure condition columns are never hardcoded: one per enabled ULB-bulk criterion
  (`ClaimLetterUlbLevelEligibility.perCriterion`, sorted by `claimEligibility.displayOrder`, headed by
  `claimEligibility.letterColumnLabel`), so adding or removing a criterion is a formjson change. Two
  named exceptions: the 14th FC column prints the unspent amount (`FC_UNSPENT_STATE`), and rows C-I map
  to criterion types through `CLAIM_LETTER_ROW_CRITERIA` (the rows are fixed text; a mapped criterion
  that is not enabled prints "Not applicable").
- Cell text is decided only in `buildAnnexureCell` (`helpers/claim-letter-letter.helpers.ts`), whose
  comment lists the rules.
- Dates the State picks are stored as UTC-midnight ISO strings and printed "07 Oct 2026" with UTC
  getters (fixed month names, no locale); the as-on stamp is IST ("07 Oct 2026, 14:30").

## Letter details

Stored as `letterDetails` on the batch. Fields, labels, validations and required flags all come from
formjson 26 (`meta.letterDetailKeys`, a flat list): only the fields the OM needs are required (row A
b and c, row B ATR date), and optional fields keep their length / format rules when filled. The
portal edits them inline in the preview, where each slot run carries its key in `field`.

- A save takes any subset of keys: `DynamicFormValidationService` in draft mode, plus type, option and
  strict-date checks. `evaluate` and `assertComplete` run final-mode validation for Download and
  Submit; no valid key configured means "not configured", which blocks both.
- A change that would remove an uploaded signed letter needs `confirmSignedFileRemoval` (else 409
  `SIGNED_FILE_REMOVAL_NOT_CONFIRMED`); concurrent saves fail on the pinned `letterDetailsUpdatedAt`
  (409 `LETTER_DETAILS_CHANGED`).
- `previous` is the State's latest saved details from another batch, minus the
  `meta.letterDetailSkipPrefill` keys, for the UI's prefill button.
- A key printed in the letter needs an entry in `CLAIM_LETTER_DETAIL_PLACEHOLDERS` and a slot in the
  document service; a key removed from formjson keeps printing its placeholder.

## Final claim letter

The copy that goes to MoHUA: the signed letter followed by `meta.mergeDocuments` (Elected Body, GTC,
Unspent Declaration, ATR), merged with `pdf-lib`.

- Each entry is only `{ label, formId, fileKeys, optional? }`: the document is found through that
  form's enabled `claimEligibility.source`, with the same query the eligibility check runs
  (`common/utils/claim-eligibility-source-query.util.ts`), so a new enclosure is a formjson change. A
  form without an enabled source, or whose source is not `ownerLevel: 'STATE'` with `fields.state`, is
  listed as not included, so another State's or a ULB's file is never merged.
- Cached on the batch as `finalClaimPdf` under a SHA-256 key of the ordered labels and upload paths. A
  re-upload always has a new path, so the key is the change detector; nothing rebuilds otherwise.
  Concurrent requests for the same batch and key share one merge (per process).
- A missing non-`optional` document is in `missingRequired` (read from formjson on every request,
  never stored) and blocks Submit (400 `FINAL_PDF_INCOMPLETE`, naming the document and its form). An
  unreadable one is a 422 naming the form to fix.
- Both GETs need only VIEW_STATE_FORMS; a viewer may trigger a build, since it is only a cache. A
  submitted batch serves its stored copy, with no rebuild and no active-batch guard.
- Submit sends the key the page showed and gets 409 `FINAL_PDF_OUTDATED` when it is stale, also
  when an older merge replaced the reviewed one after the check (the update filter pins the key). The
  summary's `finalClaimLetterStage` (DRAFT / SUBMITTED / null) tells the UI which copy to show.
- Scanned ink signatures only: a merge breaks a digital signature.

## Invariants worth knowing before you change adjacent code

- At most `CLAIM_LETTER_MAX_BATCH_NUMBER` (3) logical batches per (state, year, installment), and
  each ULB locked into one batch; both are enforced by unique indexes, not just application checks
  (ADR 0002).
- A frozen claim version is immutable: `createNewVersion` builds a new parent rather than mutating a
  READY one (ADR 0002, ADR 0003).
- Money is whole Rupees throughout, like every other xvi-fc form; `claimedAmount` is `@IsInt()`. The
  feature went Crore decimals -> whole Rupees -> Rupees with decimals -> whole Rupees, all before
  launch, so no stored-data migration exists. Decimals were dropped because splitting an allocation
  across many ULBs never divides evenly and real sums drifted from the target total (one State's rows
  summed ₹2.08 off); whole numbers make that drift impossible. `helpers/claim-letter-financial.helpers.ts`
  does all amount arithmetic with plain integers; the variance band cross-multiplies instead of
  dividing so it stays exact.
- Each child's `eligibilitySources` holds one snapshot per `FORM_AND_ROW` source (Elected Body, FC
  Unspent): the source's State-level result plus this ULB's row evidence
  (`ClaimLetterUlbLevelEligibility.rowEvidenceByFormId`), both already fetched. The parent's
  `stateEligibilitySources` stays form-level (`rowDocumentId` / `rowStatusAtEvaluation` null), since no
  single row applies to a whole State.
- Submit's checks all run before its transaction and are listed in ADR 0003; the update filter also
  pins `signedClaimFile.path`, `letterDetailsUpdatedAt` and `finalClaimPdf.sourceKey` as read.
- Abandon only sets `isAbandoned` (the status stays `IN_PROGRESS`) and releases the locks, so every
  path that acts on a batch checks the flag itself: preview, .docx, signed-file upload and submit
  reply 409 `CLAIM_LETTER_ABANDONED_MESSAGE`, and the one-active-batch rule ignores an abandoned
  batch (ADR 0004).
- An edit never frees a removed ULB before it succeeds: validation first, added locks next, removed
  locks released in the final write's transaction (ADR 0002).

## Known gaps

- Installment 2 is rejected on every path (`assertInstallmentSupported`).
- `createNewVersion` and `acknowledgeLocks` wait for the MoHUA rejection and approval steps (ADR 0003);
  until approval exists, a submitted batch stays active and blocks the next one (ADR 0004).
- `detectAnomalies` has no route or schedule; it is only callable from code.
