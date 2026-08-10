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

## Outbound dependency: devolution-formula reads this module's status

`devolution-formula`'s `checkInstallment1Prereq` reads this form's `currentFormStatus` directly
(gate: EULB must be `UNDER_REVIEW_BY_MOHUA` before Devolution can submit Installment 1). Changing
when/how `finalSubmit` transitions status here has a real blast radius into devolution-formula's
Installment-1 gate — see `devolution-formula/CLAUDE.md`'s "Known gaps" section for the other side
of this dependency.
