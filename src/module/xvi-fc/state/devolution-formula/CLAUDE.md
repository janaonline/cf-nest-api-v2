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

## Form status history log

`schemas/xvi-fc/state/devolution-formula-form-history.schema.ts` (collection
`xvifc_devolution_form_logs`) is an append-only log of `currentFormStatus` transitions, mirroring
`sfc-status-history.schema.ts`. `action` uses the shared `FormHistoryAction` enum
(`src/common/constants/form-status.constants.ts` — one enum for every state form, not per-form).

**The real `NOT_STARTED→IN_PROGRESS` transition happens in `DevolutionFormulaExcelService
.validateExcel`, not `saveDraft`** — the actual flow is upload Excel → validate → click Save, and
`validateExcel`'s upsert is what first flips a brand-new form to `IN_PROGRESS`. It logs that
transition itself (guarded the same way: no row when `fromStatus === toStatus`) inside its own
transaction. This was originally missed (only `saveDraft`/`finalSubmit` were wired up), so the
form's real first transition went silently unlogged — `saveDraft` saw `fromStatus === toStatus`
and correctly no-opped. **Any new write path that can change `currentFormStatus` needs its own
history-log call** — the no-op guard doesn't compose across services.

`saveDraft`/`finalSubmit` insert their own row as a separate, non-transactional, best-effort call
(a logging failure is caught/logged, never fails the request — same tradeoff as
`sfc-status.service.ts`). No MoHUA workflow exists yet, so only `CREATE_DRAFT`/`FINAL_SUBMIT` are
ever logged.

Both writes are guarded against a concurrent status change (`currentFormStatus` in the write
filter; `saveDraft`'s upsert also catches the unique-index race on a first save) - same guard as
SFC Status and GTC, see `xvi-fc-concurrent-write.util.ts`.

`snapshot` is populated on `FINAL_SUBMIT` with the active dataset version's row content — because
the Excel-upload transaction *hard-deletes* the previous version's rows on every re-upload (see the
ADR below), and there's no row-history collection, this is the only surviving record of what was
submitted. `null` on `CREATE_DRAFT`.

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
- That whole-Rupee check is strict on purpose (previous paragraph), but a formula-computed Excel
  cell (e.g. a 50/50 installment split) routinely leaves IEEE-754 noise in its raw stored value —
  something like `63579869.999999996` — that Excel's own display formatting rounds away, so the
  cell *looks* like a clean integer to the person who uploaded it. `DevolutionFormulaExcelService`'s
  `parseDataRow()` runs the three amount fields through `snapToWholeRupee`
  (`helpers/devolution-formula-tolerance.helpers.ts`) before anything else sees them, snapping a
  value to the nearest integer only when it's within `FLOAT_EQUALITY_EPSILON` (0.001) of one — far
  tighter than any real fractional Rupee amount, so a genuine decimal (a real `X.50`) still
  correctly fails `isWholeNumber` unchanged. This is a single ingestion-time fix, not a loosening of
  `isWholeNumber`/`validateRow`/`validatePortalRowEdit` themselves: it runs once, before the
  validator ever sees the value, so every downstream consumer (validation, persistence,
  `totalAllocatedSum`, the regenerated error-Excel) sees the corrected whole number.
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
- `recalculateFormSummary` (`services/row/devolution-formula-row.service.ts`, runs after every
  portal row edit) never recomputes `missingUlbCount`/`duplicateUlbCount` itself — only a fresh
  Excel parse (`validateExcel`/`revalidateExcel`) can introduce or clear those. It reads back the
  persisted `missingUlbCount` and factors it into `validationStatus`, so a routine row edit can't
  silently flip the form to `VALID` while a still-outstanding missing-ULB gap exists (mirrors
  `elected-urban-local-bodies`'s equivalent, which includes its own `missingDbUlbCount === 0` check
  the same way).

## Row-level claim-lock enforcement (PMU Review feature)

`assertNoActiveClaimLockForUlb` (`services/row/devolution-formula-row.service.ts`) queries
`ClaimLetterUlbLock` directly (`{state, year, installment, ulbId, lockState: 'ACTIVE'}`) and throws
`ConflictException` — the only call site is `updateRow`'s single-portal-row-edit path. This is
Devolution's own edit-lock mechanism (not a new `FORM_STATUS`): a ULB claimed in an active claim
letter can't have its allocation figures edited out from under that claim, but the whole form's own
`currentFormStatus` is never touched by claim activity (see the root PMU Review plan's Part F for
why this mechanism is Devolution-specific — SFC/GTC have no per-ULB data to lock, and Elected
Body/FC Unspent gate per-ULB edits via their own row `rowStatus` instead once Feature 2's
claim-driven write-back lands).

`recalculateFormSummary` needed no change for this: it sums whatever is currently persisted
per-row regardless of lock status, so a locked row's frozen values and an edited row's new values
both land in `totalAllocatedSum` the same way they always did — the lock only blocks the edit
itself, not the reconciliation read.

**Known gap, not fixed here (deliberately out of scope for this check)**: this lock is enforced
only against `updateRow`'s single-row portal edit. A full Excel re-upload
(`DevolutionFormulaExcelService.validateExcel`/`revalidateExcel`) hard-deletes and recreates every
row in the new dataset version (see the ADR above) — including a locked ULB's row — with no lock
check of its own. A State could still displace a locked ULB's allocation data via a full
Excel re-upload while a claim letter holds it. Flagged, not fixed: wiring the Excel-upload path to
the same lock check is a larger, separately-scoped change (it touches the ADR-governed
dataset-versioning transaction), not a stub-implementation task.

## Known gaps (tracked as TODOs in code, not implemented here)

- Installment 2 is unconditionally locked pending real integration with claim-letter's
  acknowledgment status (`isInstallment2Unlocked` in `services/main/devolution-formula.service.ts`).
