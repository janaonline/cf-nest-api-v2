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
  template, save draft, final submit.
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

## Outbound dependency: devolution-formula reads this module's status

`devolution-formula`'s `checkInstallment1Prereq` reads this form's `currentFormStatus` directly
(gate: EULB must be `UNDER_REVIEW_BY_MOHUA` before Devolution can submit Installment 1). Changing
when/how `finalSubmit` transitions status here has a real blast radius into devolution-formula's
Installment-1 gate — see `devolution-formula/CLAUDE.md`'s "Known gaps" section for the other side
of this dependency.
