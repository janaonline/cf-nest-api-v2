# Devolution Formula

State-facing feature: a per (state, year, installment) form holding per-ULB grant allocation
figures, populated via Excel upload and editable row-by-row after that.

## Layout

- `services/main/devolution-formula.service.ts` — form-level orchestration: get form, save draft,
  final submit, permissions/status, installment access.
- `services/excel/devolution-formula-excel.service.ts` — Excel upload/validate/revalidate/dump.
  Owns the dataset-versioning transaction — see the ADR below before touching it.
- `services/row/devolution-formula-row.service.ts` — per-row edits and form-total recompute.
- `services/form-json/devolution-formula-form-json.service.ts` — form question config.
- `validators/`, `helpers/`, `dto/`, `types/`, `constants/` — supporting, mostly self-contained.

## Before changing dataset/version logic, read the ADR

- [docs/adr/0001-dataset-versioning.md](docs/adr/0001-dataset-versioning.md) — the atomic
  version-swap pattern on Excel upload, and its consumers. Notably: `claim-letter`'s eligibility
  service depends on this invariant from outside this module — changes here can silently break
  claim allocation amounts with no local signal that anything broke.

## Known gaps (tracked as TODOs in code, not implemented here)

- Installment 2 is unconditionally locked pending real integration with claim-letter's
  acknowledgment status (`isInstallment2Unlocked` in `services/main/devolution-formula.service.ts`).
- Row-level claim-lock enforcement is a no-op stub (`assertNoActiveClaimLockForUlb` in
  `services/row/devolution-formula-row.service.ts`) — the `claim-letter` module it depends on now
  exists but this hasn't been wired up to it yet.
