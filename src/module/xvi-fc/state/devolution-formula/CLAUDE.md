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

## Invariants worth knowing before you change adjacent code

- Row amounts (`totalGrantAllocation`, `installment1Amount`, `installment2Amount`) are whole Rupees
  only — no decimals. Enforced by `@IsInt()` on `UpdateRowDevolutionFormulaDto` (manual row-edit
  path) and by `DevolutionFormulaValidator`'s `isWholeNumber` check on the Excel-upload/revalidate
  path (`validateRow`/`validatePortalRowEdit`). This has gone back and forth — Crore-denominated
  decimals → whole-Rupee integers → unbounded-decimal Rupees → whole-Rupee integers again (current)
  — because letting rows carry decimals let real sums drift from `totalMoHUAAllocation` by whole
  rupees, not just float noise (a real state's ₹30,060,000,000 total summed its uploaded rows to
  ₹30,060,000,002.08). Requiring whole numbers makes that drift structurally impossible instead of
  tolerating it with a rounding/tolerance scheme; apportioning the total into whole-Rupee shares
  that sum exactly is the State's responsibility in the Excel they upload, not something this
  codebase reconciles for them.
- Row-level (`inst1 + inst2 === total`) and form-level (`totalAllocatedSum === totalMoHUAAllocation`)
  reconciliation are handled differently: the row-level check is plain exact-integer equality (both
  operands are already whole-number-validated in-process). The form-level check still goes through
  `amountsAreEqual`/`FLOAT_EQUALITY_EPSILON` in `helpers/devolution-formula-tolerance.helpers.ts`,
  kept only as a defensive backstop against `GrantAllocation`, an externally-written collection this
  codebase has no validator for — `totalMoHUAAllocation` is defensively `Math.round()`ed at every
  read site (`resolveGrantAllocation`/`resolveGrantAllocationSummary` in
  `services/main/devolution-formula.service.ts`, and the equivalent in
  `services/excel/devolution-formula-excel.service.ts`) so this codebase's own invariant holds
  regardless of what that external source stores.

## Known gaps (tracked as TODOs in code, not implemented here)

- Installment 2 is unconditionally locked pending real integration with claim-letter's
  acknowledgment status (`isInstallment2Unlocked` in `services/main/devolution-formula.service.ts`).
- Row-level claim-lock enforcement is a no-op stub (`assertNoActiveClaimLockForUlb` in
  `services/row/devolution-formula-row.service.ts`) — the `claim-letter` module it depends on now
  exists but this hasn't been wired up to it yet.
