# 0001 - Dataset versioning on Excel upload

## Status

Accepted

## Context

Each Devolution Formula form (one per state/year/installment) has a set of per-ULB rows populated
by Excel upload. A State may re-upload a corrected Excel file at any time, replacing the previous
dataset entirely. Two concurrent uploads for the same form must never corrupt each other's rows or
be handed the same version number.

## Decision

- Each form document tracks `activeDatasetVersion` (starts at 0, incremented on every successful
  upload/revalidate).
- Rows are scoped by `(form, datasetVersion)` — a row belongs to exactly one version. The form's
  `activeDatasetVersion` is the single source of truth for which version is "live"; any row with a
  lower `datasetVersion` is stale.
- The version swap (`DevolutionFormulaExcelService.validateExcel`,
  `services/excel/devolution-formula-excel.service.ts:378-442`) happens as one atomic operation,
  entirely inside one Mongo transaction:
  1. `findOneAndUpdate` with `$inc: { activeDatasetVersion: 1 }` (upsert) — atomic; two concurrent
     requests can never be handed the same new version number, since MongoDB serializes the
     increment.
  2. Mark the previous version's rows `isActive: false`.
  3. Insert the new version's rows.
  4. Delete the previous version's rows.
  5. Commit; abort on any failure. The transaction guarantees all four data-changing steps land
     together or none do — there's never a window where rows from two versions are both "active" —
     and no manual rollback/cleanup code is needed.
- This replaced an earlier read-then-increment pattern
  (`currentVersion = existingDoc.activeDatasetVersion ?? 0; newVersion = currentVersion + 1`) that
  let two concurrent uploads compute the identical `datasetVersion`, corrupting each other's rows
  via the `{form, datasetVersion, ulbId}` unique index, and needed a manual, version-number-keyed
  rollback on failure.
- `classifyAndThrowMongoWriteConflict` (same file, ~lines 93-120) distinguishes a genuine row-level
  business duplicate (the same ULB twice in one upload) from a form-level/transaction write
  conflict on transaction abort, so the two failure modes get honest, different error messages
  instead of one generic one.

## Consumers

Everything below reads `activeDatasetVersion` and/or filters rows by it — check here before
changing the versioning contract:

- **Inside devolution-formula**: `services/row/devolution-formula-row.service.ts` (row-count/
  allocation recompute), `validators/devolution-formula.validator.ts`,
  `services/main/devolution-formula.service.ts`, `types/devolution-formula.types.ts`.
- **Outside devolution-formula**:
  - `claim-letter/services/eligibility/claim-letter-eligibility.service.ts`'s
    `resolveDevolutionAllocations` reads whatever Devolution form exists for a state/year/installment
    and filters rows by `datasetVersion: form.activeDatasetVersion` to resolve per-ULB claim
    allocations.
  - `fc-unspent-declaration` reads it at 3 call sites: `services/main/fc-unspent-declaration.service.ts`'s
    `resolveDevolutionDependency` (gates editability on whether an active dataset exists),
    `services/ulb-options/fc-unspent-ulb-options.service.ts` (scopes the ULB-options aggregation),
    and `services/rows/fc-unspent-declaration-row.service.ts`'s `resolveAllocationsForUlbIds`
    (resolves per-ULB allocation amounts, same purpose as claim-letter's read).
  - Both are real cross-module dependencies — their computations are only correct as long as this
    invariant holds.

## Consequences

Any change to how `activeDatasetVersion` is allocated, or to how rows are scoped by it, must be
checked against every consumer above, not just this module's own call sites — claim-letter and
fc-unspent-declaration will silently compute wrong allocation amounts (or gate editability
incorrectly) if the invariant breaks, with no local signal inside devolution-formula that anything
is wrong.
