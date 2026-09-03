# Elected Urban Local Bodies (EULB)

State-facing feature: a per (state, year) form holding per-ULB elected-body status rows
(constituted/not, date of constitution/expiry), populated via Excel upload and editable
row-by-row. Also has a distinct **post-submission correction** workflow for fixing already-final-
submitted rows without a full resubmit.

## Layout

- `controllers/elected-urban-local-bodies.controller.ts` — self-documented via `@ApiOperation`
  Swagger decorators rather than inline comments; that's a deliberate, legitimate alternative style
  here, not missing documentation.
- `services/main/elected-urban-local-bodies.service.ts` — form-level orchestration: get form,
  template, save draft, final submit. `finalSubmit` runs inside a Mongo transaction (mirroring the
  pattern in `fc-unspent-declaration.service.ts`'s `finalSubmit`) because it writes both the parent
  form and a bulk row-status update in the same call.
- `services/excel/elected-urban-local-bodies-excel.service.ts` — Excel upload/validate/revalidate.
  Owns the dataset-versioning transaction — see the ADR below before touching it.
- `services/post-submission-update/elected-urban-local-bodies-post-submission-update.service.ts` —
  correction workflow for already-submitted rows: proposes changes, validates, and atomically
  applies them as one audited "batch" (see the inline comment on its transaction for the mechanism
  — it's self-contained enough not to need its own ADR).
- `services/row/elected-urban-local-bodies-row.service.ts` — per-row edits during the draft stage.
- `services/document/elected-urban-local-bodies-document.service.ts` (+ `-docx.service.ts`) — assembles
  and renders the "Elected Bodies List" declaration letter (Word doc, via the `docx` npm package) served
  by `GET :stateId/:yearId/elected-bodies-list-document`. Mirrors `claim-letter`'s document-service /
  renderer-service split. See "Elected Bodies List document" below.
- `services/form-json/`, `validators/`, `helpers/`, `dto/`, `types/`, `constants/` — supporting.

## Before changing dataset/version logic, read the ADR

- [docs/adr/0001-dataset-versioning.md](docs/adr/0001-dataset-versioning.md) — the atomic
  version-swap pattern, implemented independently at **two** call sites
  (`validateExcel` and `revalidateExcel`'s re-parse branch) — a fix to one without the other will
  leave them inconsistent.

## Row-level review status (`rowStatus`)

Each `ElectedUrbanLocalBodiesRow` has a `rowStatus` field (`null` pre-submission, set to
`FORM_STATUS.UNDER_REVIEW_BY_MOHUA` on `finalSubmit` for every active row in the current dataset
version), mirroring FC Unspent Declaration's row-review pattern — both draw from the shared
`RowReviewStatus`/`ROW_REVIEW_STATUS_VALUES` in
`src/module/xvi-fc/common/constants/row-review-status.constants.ts`, a restricted subset of
`FORM_STATUS`. Unlike FC Unspent, **no MoHUA-side per-row review exists yet for EULB** — there's no
row approve/reject endpoint, so `rowStatus` only ever reaches `UNDER_REVIEW_BY_MOHUA` today and
never advances further. The `post-submission-update` correction workflow does not read or write
`rowStatus`.

## electedBodyStatus: id is deliberately identical to its label

The `electedBodyStatus` field's DB-config options always have `id === label` (currently
`'Constituted'`, `'Not Constituted'`, `'6th Schedule'` — all three, not just the third one). This
is deliberate: Excel's list-validation dropdown has no separate display/value pair like an HTML
`<select>` — whatever text is in the list is exactly what gets written into the cell when picked —
so any divergence between `id` and `label` leaks the raw id into every Excel export/dropdown
unless it's bridged explicitly at the Excel boundary. An earlier version of this field used
`id: 'Exempt'` with `label: '6th Schedule'` and required a dedicated id↔label mapping layer
(lookup maps built from `options`, threaded through `getTemplate`/`dumpToExcel`/
`generateAndStoreErrorExcel`/`getErrorSheet`, plus upload-side normalization) purely to paper over
that mismatch. That approach was abandoned in favor of keeping `id` and `label` equal — every
service now reads/writes `row.electedBodyStatus` directly, with no field-specific special-casing.
Keep it that way: if a future rename needs the *label* to say something new, change the `id` to
match rather than reintroducing a mapping layer.

## dateOfExpiry's maxDate: `FIELD:<key>[+-]N[DMY]` cross-field date bound

`dateOfExpiry`'s `maxDate` is `"FIELD:dateOfConstitution+5Y"` — the expiry date can't be more than
5 years after `dateOfConstitution`'s own value, per row. This is the **only** cross-field date
bound anywhere in `xvi-fc` (the generic `DynamicFormValidationService.resolveDate()` only
understands `'TODAY'`/`'TODAY±N[DMY]'`/a literal ISO date, all resolvable from a single string with
no sibling-field lookup — EULB never routes through that service, so it wasn't extended). The
`FIELD:` grammar and its parsing (`parseFieldRelativeBoundary`, `applyDateOffset`,
`resolveExpiryMax`) live entirely in `validators/elected-urban-local-bodies.validator.ts`, and the
frontend mirrors the same token in `date-constraint-resolver.ts`'s `resolveDateConstraint` — keep
both in sync the same way the `TODAY` grammar already is (see that file's own comment).

Why it can't be precomputed once like every other bound: `extractDateConfig()` still parses this
into `EulbDateValidationConfig` at config-load time, but stores it as `expiryMaxRelative` (an
`{fieldKey, sign, amount, unit}` descriptor) rather than a resolved `Date` — the actual bound
depends on *that row's own* `dateOfConstitution` value, so `resolveExpiryMax()` is called per-row,
inside `validateCommonFields`/`validatePortalUpdateFields`, not once up front.

`validatePortalUpdateFields` is the one call site where this needs an extra parameter
(`effectiveDateOfConstitution`): a portal PATCH can update `dateOfExpiry` alone, without touching
`dateOfConstitution` in the same request, so there's no in-request base date to resolve against.
Its caller (`elected-urban-local-bodies-row.service.ts`) passes `dto.dateOfConstitution ??
row.dateOfConstitution ?? null` — the persisted row's value as a fallback. Every other validation
path (`validateDbUlbRow`/`validateExtraUlbRow`/`validatePostSubmissionRowUpdate`/`revalidateRow`)
already receives both fields together in the same row/dto, so no fallback plumbing is needed there.

The downloadable Excel template's `buildTemplateValidations()` (`services/main/`) can't embed a
precomputed constant either — its per-row `dateOfExpiry` data-validation formula instead builds an
`EDATE(<dateOfConstitution cell for this row>, <months>)` expression referencing the sibling
column's own cell, via the same `parseFieldRelativeBoundary` (exported for this purpose). The
prompt text is a static human-readable phrase ("... 5 years after Date on which the elected body is
in place.") rather than a formatted date, since Excel prompts can't be computed per row.

## Elected Bodies List document and `signedElectedbodyFile`

The `EULB_MAIN_FORM_FIELDS` group has two distinct file fields, both required at final submit —
do not conflate them:

- `electedBodyExcelFile` — the state's raw data upload (the ULB-wise elected-body status Excel).
  Drives the row-ingestion/validation pipeline (`services/excel/`).
- `signedElectedbodyFile` — a signed **PDF** of the declaration letter, uploaded after the state
  downloads and signs the Word doc rendered by `services/document/`. Same generic file-field
  wiring as `electedBodyExcelFile` (schema prop, DTO field, `getForm`/`saveDraft`/`finalSubmit`
  handling) — always extend both in lockstep if you add a third file field to this form.

`ElectedUrbanLocalBodiesDocumentService.getDocumentData()` refuses to build the letter (400,
`signedElectedbodyFile` field, code `noRows` or `rowsNotValid`) unless the active dataset has at
least one row and every active row is `validationStatus: 'VALID'` — the letter is a certification,
never a partial/unvalidated snapshot. Column headers are read live from
`EULB_EXTRA_ULB_PORTAL_FIELDS`'s field `label`s (never hardcoded), and the state name / ULB count /
grant-cycle year label (`designYearLabel`, resolved from the `Year` document by `yearId`, same
field name/shape as `claim-letter-document.service.ts`'s own `designYearLabel` — see that
service's `getDocumentData` for the identical pattern) are the only values interpolated into the
letter — the closing signature block (`[Name]`, `[Designation]`, `Government of [State Name]`,
etc.) is written as literal, non-interpolated text for the state to fill in by hand before signing.

### `signedElectedbodyFile`'s visibility is gated on Excel *validity*, not just presence

The `formjsons` config for `signedElectedbodyFile` carries a `visibleWhen` condition against
`electedBodyExcelValidationStatus` (`{ operator: 'equals', value: 'VALID' }`) — **not** one of this
form's own `FieldConfig` fields. `ElectedUrbanLocalBodiesService` (`services/main/`) injects it
into the `FormData` passed to `DynamicFormValidationService` at both `saveDraft` and `finalSubmit`,
sourced from the persisted `validationStatus` flag (the same one the `finalSubmit` hard-gate
already reads) — mirror this in both places if a third gated field is ever added. The frontend
mirrors the same key as a synthetic (non-`FieldConfig`) `FormControl`, added in
`elected-body-status.component.ts`'s `createFormControls()` from the `validationSummary` signal
(same non-backend-driven-control pattern as `fc-unspent-declaration.component.ts`'s
`unspentUlbData`).

`saveDraft` resets `validationStatus` to `'NOT_VALIDATED'` whenever the incoming
`electedBodyExcelFile` actually changes (detected via `FileInfoNormalizerService
.normalizeInboundFileInfo`'s own contract — its result is `undefined` only when nothing changed) —
without this, swapping in a brand-new, never-validated file would leave the previous file's
`'VALID'` flag in place until the next validate/revalidate call, letting
`signedElectedbodyFile` appear (and its own `required` validator be skipped or enforced) against a
stale status.
