# Claim Letter

State-facing feature: a State selects ULBs from its Devolution Formula allocation and assembles
them into a "claim letter" batch, which then moves through a State → MoHUA review workflow. V1
supports Installment 1 only.

## Before changing anything here, read the relevant ADR

The decisions below are referenced from multiple files each - read the linked ADR before
touching code that cites it, not just the local comment:

- [docs/adr/0001-idempotent-retry.md](docs/adr/0001-idempotent-retry.md) — client-retry safety for
  `createDraft`/`submit`.
- [docs/adr/0002-batching-and-locks.md](docs/adr/0002-batching-and-locks.md) — the 3-batch-slot
  cap, per-ULB locking, and stale-`BUILDING`-row recovery.
- [docs/adr/0003-workflow-transitions.md](docs/adr/0003-workflow-transitions.md) — which mutations
  write history, and why edits/uploads don't.
- [docs/adr/0004-one-active-batch.md](docs/adr/0004-one-active-batch.md) - one claim batch in
  progress per State/year/installment, and why lifting it brings back stale letters.

## Layout

- `services/assembly/` — the only place that creates/updates/abandons a batch (locks + children +
  status). Everything else is read-only or touches only the parent document.
- `services/eligibility/` — State-level gate + per-ULB criteria + Devolution allocation resolution.
  Has cached `*ForDisplay` variants for read-only UI consumers; the assembly pipeline never uses
  them (see the service's own doc comment on `evaluateStateLevelGateForDisplay`).
- `services/recovery/` — hourly stale-`BUILDING` cleanup (cron) + read-only reconciliation report.
- `services/history/` — the only writer of `ClaimLetterBatchHistory`; see ADR 0003 for what counts
  as a transition worth recording.
- `services/main/claim-letter.service.ts` — read paths + the signed-file upload (parent-only, no
  locks/children).
- `services/submit/claim-letter-submit.service.ts` - submit (`IN_PROGRESS -> UNDER_REVIEW_BY_MOHUA`)
  and its pre-transaction checks (fresh eligibility, final-batch completeness, edit-lock lease).
- `services/document/claim-letter-document.service.ts` - builds the claim letter as a display-ready
  model (`types/claim-letter-document.types.ts`: paragraphs of runs, `placeholder` runs for blank
  State fields) shared by the portal preview and the .docx, so the two can never disagree: the
  frontend renders the backend's text verbatim. Rows C-K and both annexure lists use fresh
  `resolveUlbLevelEligibility` over the State's expected ULB set (denominator = State total); that
  heavy part is cached in Redis per `revision` for 5 minutes as a `meta` key (everything but the
  rows) plus 100-row chunks per list, so opening the letter parses no rows and a 20-row preview page
  parses one chunk. Chunks are written first and live 30s longer than `meta`; concurrent cache misses
  share one build (per process). Keys expire on their own (a revision bump starts new ones). The
  .docx and Submit always evaluate fresh. Letter details and SFC values (row B) change without a
  revision bump, so they are merged per request.
- `services/document/claim-letter-docx.service.ts` - renders that model to an A4 .docx (`docx`
  npm): portrait covering letter, landscape annexure, yellow-highlighted placeholders. Layout
  ported from the approved Phase 0 samples; column widths come from the column `kind`. Always
  built fresh (never from the preview cache). `generateForDownload` checks the mandatory letter
  details first, so every download path has that gate. pdfkit is no longer used in this module.
- `services/letter-details/claim-letter-letter-details.service.ts` - the State-entered letter
  details (`letterDetails` on the batch). Fields, labels, validations and required flags are
  formjson-driven (formId 26 `meta.letterDetailKeys`, a flat list); the portal edits them inline in
  the letter preview, where each slot run carries its key in `field`. Any subset of keys is saved
  with `DynamicFormValidationService` (draft mode) plus type / option / strict-date checks; `evaluate`
  and `assertComplete` run final-mode validation for Download and Submit. A change that would remove
  an uploaded signed letter needs `confirmSignedFileRemoval` (409 `SIGNED_FILE_REMOVAL_NOT_CONFIRMED`
  otherwise); concurrent saves are caught by pinning `letterDetailsUpdatedAt` (409
  `LETTER_DETAILS_CHANGED`). `previous` is the State's latest saved details from another batch,
  minus `meta.letterDetailSkipPrefill` keys, for the UI's prefill button.
- `services/final-pdf/claim-letter-final-pdf.service.ts` - the final claim letter, the copy that
  goes to MoHUA: the signed letter followed by `meta.mergeDocuments` (Elected Body, GTC, Unspent
  Declaration, ATR). Each entry is only `{ label, formId, fileKeys, optional? }`: the document is
  found through that form's enabled `claimEligibility.source`, with the same query the eligibility
  check runs (`common/utils/claim-eligibility-source-query.util.ts`), so a new enclosure is a
  formjson change; a form without an enabled source is listed as not included. Merged with
  `pdf-lib` and cached on the batch as `finalClaimPdf` under a
  SHA-256 key of the ordered labels and upload paths (a re-upload always has a new path, so the key
  is the change detector; no rebuild otherwise). Concurrent requests for the same batch and key
  share one merge (per API process). Missing documents are listed; a missing non-`optional` one is
  in `missingRequired` (read from formjson on every request, never stored) and blocks Submit (400
  `FINAL_PDF_INCOMPLETE`, naming the document and its form). Unreadable ones are a 422 naming the
  form to fix. Both GETs need only VIEW_STATE_FORMS (any State user who can open
  the claim; a viewer may trigger a build, it is only a cache). A submitted batch serves its stored
  copy: no rebuild and no active-batch guard. Submit sends the key the page showed and gets 409
  `FINAL_PDF_OUTDATED` when stale. The summary's `finalClaimLetterStage` (DRAFT / SUBMITTED / null)
  tells the UI which copy to show. Scanned ink signatures only: a merge breaks a digital signature.
- `services/active-batch/claim-letter-active-batch.service.ts` - the one-active-batch guard
  (ADR 0004), used by the document, letter-details, final-PDF and submit paths and by create.
- `services/form-json/claim-letter-form-json.service.ts` — this feature's own `formjsons` document
  (formId `CLAIM_LETTER_FORM_ID`): `signedClaimFile` field config, the claimed-vs-allocated
  variance band (`meta.varianceLowerPercent`/`varianceUpperPercent`, falling back to
  `CLAIM_LETTER_VARIANCE_LOWER_PERCENT`/`UPPER_PERCENT` in `helpers/claim-letter-financial.helpers.ts`
  when unset), the letter-detail keys / skip-prefill keys, and the merge documents. Invalid entries
  are logged and skipped; no valid key means letter details are "not configured" (Download and
  Submit blocked). `loadFormConfig` fetches the document exactly once per caller and derives all of
  it - never chain a second independent fetch for another part of the same document.
- `helpers/` — pure functions (financial rounding, content hashing, summary mapping). No I/O.

## Invariants worth knowing before you change adjacent code

- At most `CLAIM_LETTER_MAX_BATCH_NUMBER` (3) non-abandoned batches per (state, year, installment) —
  DB-enforced, not just application-checked (ADR 0002).
- A frozen claim *version* is immutable — `createNewVersion` builds a new parent rather than
  mutating an existing READY one (ADR 0002, ADR 0003).
- Money is stored as whole Rupees (no decimals) throughout this feature, matching every other
  xvi-fc form — `claimedAmount`/`allocatedAmount` are `@IsInt()`/validator-enforced, not just
  conventionally whole. This feature has gone Crore-denominated decimals → briefly whole-Rupee
  integers → Rupees with unbounded decimal places → whole-Rupee integers again (current), all
  converted before production launch, so no stored-data migration exists for any of them. The
  decimal-precision attempt was abandoned because a proportional split of a total allocation across
  many ULBs (Devolution Formula) essentially never divides evenly, and letting amounts carry
  decimals let real sums drift from the target total by whole rupees, not just float noise (a real
  state's allocation total summed its rows ₹2.08 off) — whole numbers make that drift structurally
  impossible instead of tolerating it. `helpers/claim-letter-financial.helpers.ts` centralizes the
  amount arithmetic (sum/diff/variance-check); since every input is a whole Rupee, plain
  integer arithmetic is exact with no scaling needed, except the ±10% variance boundary, which
  cross-multiplies instead of dividing to stay exact without introducing a float division.
- The eligibility service's cached `*ForDisplay` methods are for read-only UI paths only — never
  call them from the assembly/mutation pipeline.
- The annexure's condition columns are never hardcoded - they come from
  `ClaimLetterUlbLevelEligibility.perCriterion` (one entry per enabled ULB-bulk criterion, sorted by
  `claimEligibility.displayOrder`, headed by `claimEligibility.letterColumnLabel`). Adding or removing
  a criterion is a formjson change. Two deliberate named exceptions: the 14th FC column prints the
  unspent amount (`FC_UNSPENT_STATE`), and compliance rows C-I map to criterion `type`s through the
  one `CLAIM_LETTER_ROW_CRITERIA` constant (the letter's rows are fixed text; a mapped criterion that
  is not enabled prints "Not applicable").
- Annexure cells, first match wins: MoHUA-approved discretionary exemption -> "Exemption requested";
  14th FC -> unspent amount in lakh or "Nil"; row-level criteria -> the row value as entered
  (+ " (pending review)" while not accepted), or "Yes" (exempt) / "Not submitted" without a row;
  others -> Yes / No (`helpers/claim-letter-letter.helpers.ts` `buildAnnexureCell`).
- Letter details: only the fields the OM uses are required (row A b and c, row B ATR date - set in
  formjson, not code); optional fields keep their length / format rules when filled and print a
  highlighted `< >` placeholder when blank. A key printed in the letter needs one slot in the
  document service (`CLAIM_LETTER_DETAIL_PLACEHOLDERS`); a key removed from formjson simply prints
  its placeholder.
- Submit runs, before its transaction: signed file present, letter details complete, this is the
  active batch (ADR 0004), fresh State gate + per-ULB eligibility of every batch ULB, every required
  enclosure present, and the reviewed final-PDF key still current. The update filter also pins `signedClaimFile.path` and
  `letterDetailsUpdatedAt` as read.
- Dates the State picks are stored as UTC-midnight ISO strings and printed "07 Oct 2026" with UTC
  getters (fixed month names, no locale); the as-on stamp is IST ("07 Oct 2026, 14:30").
- Each child's `eligibilitySources` is populated with real per-ULB evidence for `FORM_AND_ROW`
  sources (Elected Body, FC Unspent) — one snapshot per source, built in `prepareChildren` by
  merging that source's state-level result (`evaluateStateLevelGate`) with this ULB's row evidence
  (`ClaimLetterUlbLevelEligibility.rowEvidenceByFormId`, from `resolveUlbLevelEligibility`) — no
  extra query, both are already fetched. The parent's `stateEligibilitySources` stays form-status-only
  by design (`rowDocumentId`/`rowStatusAtEvaluation` are correctly `null` there — no single row
  applies to a whole state). `resolveUlbLevelEligibility` in `prepareChildren` is deliberately
  deferred until after the state gate passes (it's the heaviest of the method's fetches — a bulk
  find per ULB-bulk-evaluable source — and entirely wasted on a gate failure).
