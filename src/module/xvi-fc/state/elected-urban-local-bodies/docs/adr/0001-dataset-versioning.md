# 0001 - Dataset versioning on Excel upload/revalidate

## Status

Accepted

## Context

Each EULB form (one per state/year) has a set of per-ULB rows populated by Excel upload, and can
be revalidated later against the current active ULB registry. A State may re-upload or trigger a
revalidate at any time, replacing the previous dataset entirely. Two concurrent requests for the
same form must never corrupt each other's rows or be handed the same version number.

Same invariant and mechanism as devolution-formula's `docs/adr/0001-dataset-versioning.md` — this
ADR exists separately because EULB has its own two call sites implementing it, and nothing outside
EULB currently reads `activeDatasetVersion` (unlike devolution-formula's, which claim-letter
depends on) — see Consequences.

## Decision

- Each form document tracks `activeDatasetVersion` (starts at 0, incremented on every successful
  upload/revalidate-with-reparse).
- Rows are scoped by `(form, datasetVersion)` — a row belongs to exactly one version. The form's
  `activeDatasetVersion` is the single source of truth for which version is "live"; any row with a
  lower `datasetVersion` is stale.
- Implemented identically at **two** call sites in
  `services/excel/elected-urban-local-bodies-excel.service.ts`, both wrapping the same 5-step
  atomic pattern in one Mongo transaction (`$inc` the version → mark previous version's rows
  `isActive: false` → insert new version's rows → delete previous version's rows → commit; abort
  undoes all of it):
  1. `validateExcel` (~line 287-387) — the initial/re-upload path; upserts the form document.
  2. `revalidateExcel`'s re-parse branch (~line 800-887) — only runs when the form already exists
     (the caller throws `NotFoundException` first otherwise), so no upsert is needed, only the
     `$inc`.
- The `$inc: { activeDatasetVersion: 1 }` is atomic — two concurrent requests can never be handed
  the same new version number, since MongoDB serializes the increment. This replaced an earlier
  read-then-increment pattern (`currentVersion = existing.activeDatasetVersion ?? 0; newVersion =
  currentVersion + 1`) that let two concurrent uploads compute the identical `datasetVersion` and
  corrupt each other's rows.
- `classifyAndThrowMongoWriteConflict` (same file, ~lines 1141-1164) distinguishes a genuine
  row-level business duplicate (the same census code twice in one upload) from a form-level/
  transaction write conflict on transaction abort, so the two failure modes get honest, different
  error messages instead of one generic one — shared by both call sites above.

Note: `revalidateExcel` has a second branch (Case A, "active rows already exist — revalidate in
place") that updates rows via `bulkWrite` without touching `activeDatasetVersion` at all — that
path is a plain in-place field update, not a version swap, and isn't covered by this ADR.

## Consumers

Everything below reads `activeDatasetVersion` and/or filters rows by it:

- `services/row/elected-urban-local-bodies-row.service.ts`, `services/post-submission-update/elected-urban-local-bodies-post-submission-update.service.ts`,
  `services/main/elected-urban-local-bodies.service.ts`, `validators/elected-urban-local-bodies.validator.ts`,
  `types/elected-urban-local-bodies.types.ts` — all internal to this module.
- **No consumer outside `elected-urban-local-bodies` currently reads this field.** Compare
  devolution-formula's own ADR 0001, where claim-letter depends on the equivalent field from
  outside that module — that cross-module risk does not apply here today. If a future feature
  starts reading EULB row data by version from outside this module, revisit this note and add a
  Consumers cross-reference the same way devolution-formula's ADR does.

## Consequences

Any change to how `activeDatasetVersion` is allocated, or to how rows are scoped by it, must be
checked against **both** call sites above — they currently implement the identical pattern
independently (not via a shared helper), so a fix to one without the other would leave them
inconsistent.
