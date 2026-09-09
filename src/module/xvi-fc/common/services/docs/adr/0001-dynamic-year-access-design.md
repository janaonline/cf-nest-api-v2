# ADR 0001: Dynamic Year Access design

## Status

Accepted, implemented.

## Context

The old module hardcoded ULB year-access as six boolean fields (`access_2021`…`access_2526`)
directly on the ULB record — capped at a fixed set of years, decoded by string-matching the year
label, and covering only whole-year visibility, not per-form nuance. It doesn't scale (a new year
needs a schema change) and can't express "this ULB is new to the system but is exempt from only one
specific form, not the whole year," nor "this form only ever needs to be submitted once, not every
year."

We needed a replacement that scales to unlimited future design years with no recurring admin
maintenance, doesn't infer a ULB's "newness" from a single date (a ULB can be newly registered for
reasons that don't mean "no historical data" — e.g. split off from an existing ULB), lets a
genuinely new ULB skip specific forms it structurally can't fill while remaining fully eligible for
grants and the claim letter, and lets an inherently one-time form (e.g. PFMS/Bank Account) be
submitted once and reused across every year.

## Decision

Two small, admin-set facts on `Ulb` — `startYear` and `yearAccess` — drive everything else, both
optional and edit-anytime, no blocking approval-time gate. A separate, stable, per-formId collection
(`formJsonConfig`) describes how each form behaves. Every other piece of state is either a trivial
comparison or a lazily materialized, bounded cache — never an unbounded structure that needs
revisiting as time passes. Full mechanics: `../CLAUDE.md` in this folder.

## Alternatives considered and rejected

- **Inferring "new ULB" from `dateOfConstitution`.** Rejected — a ULB can be newly registered for
  reasons unrelated to "has no historical data" (e.g. `SPLIT`, `MERGER`). `startYear` is a distinct,
  admin-set fact; `registrationReason` records why, but is informational only and is never read by
  any logic.
- **Embedding submission-behavior config inside `formJsons`.** Rejected — a form's data requirements
  (does it support new-ULB exemption, how many grace years, is it one-time) don't change per design
  year the way its questionnaire does. Embedding it there would mean re-entering the same value on
  every new year's document. Kept as a separate `formJsonConfig` collection, keyed by `formId` only.
- **A separate `noPriorDataFormIds` field alongside `disabledFormIds`.** Rejected — `disabledFormIds`
  on the seed `yearAccess` entry is the single source of truth for which forms are exempted. No
  duplicate field carrying the same meaning.
- **`yearAccess` as a Mongoose sub-schema `Map`.** Switched to a plain `Object`/`Record` type so
  `.lean()` reads and hydrated documents serialize identically — matches the existing
  `formjsons.meta` convention rather than introducing a new serialization shape.
- **Hand-maintaining every future year's entry.** Rejected — `yearAccess` is lazily materialized one
  entry at a time, computed from the seed entry plus each exempted form's `exemptionGraceYears`, the
  first time any consumer needs a `(ulb, year)` pair that isn't present yet. Nobody computes or
  remembers "how many years"; after the one-time write, every later read is a plain lookup.

## Consequences

- `yearAccess` stays small and bounded — sparse, only as many entries as years actually accessed by
  someone, never a per-year-forever ledger maintained in advance.
- Read paths do a single flat lookup once materialized — no live date comparison, no fallback branch,
  anywhere in the read path.
- `ExpectedUlbSetService` treats `startYear` as authoritative once set; only a ULB with no `startYear`
  yet falls back to the pre-existing `dateOfConstitution` cutoff — grandfathering the (mostly null)
  existing records rather than requiring a `startYear` backfill for the feature to work at all.
- `submissionScope: 'ONCE_EVER'` forms don't participate in `disabledFormIds`/exemption at all — a
  `ONCE_EVER` form is "already satisfied elsewhere," not "exempted." It's looked up by `{ulb}` alone
  on GET, returning the same record and its original year regardless of which year is requested, so
  the caller can redirect instead of showing a blank form for every other year. `getBankAccount`
  returns `submissionScope` alongside the record so the frontend drives that redirect off real
  config, not a hardcoded "this form is special" assumption - and `designYearLabel` (looked up only
  when the requested year doesn't already match, so the common case pays no extra query) so the
  frontend can update its cached "selected year" label without a second round trip.

## Deferred / explicitly out of scope

- **`ONCE_EVER`'s write path — resolved without a schema change.** A second submission in a
  different design year is now rejected at the application level
  (`BankAccountService.assertNoCrossYearBankAccountRecord`, a `ConflictException`) rather than by
  changing `submitBankAccount`'s upsert key or unique index — `{ulb, designYear}` stays as-is, so
  the S3 proof-file path scheme (which is keyed off the *original* submission's design year) never
  needed to change either. The frontend redirects the ULB to the year the record actually lives in
  before this guard would ever trigger in normal use; the guard exists for direct API calls, races,
  and multiple tabs.
- **Extending exemption/`ONCE_EVER` to forms beyond SLB/Bank Account.** A pure `formJsonConfig` data
  change plus a small per-form code change (the GET-flow stub-materialization glue, and — for a form
  with its own bespoke status enum, e.g. Annual Accounts — an equivalent terminal status). See
  `src/master/form-json-config/CLAUDE.md`'s "How to add a new form" walkthrough.
- **A distinct dashboard status for auto-exemption.** Separate from, and must never be confused with,
  the unrelated discretionary flow's own dead `EXEMPTION_REQUESTED` status (below).
- **No backfill migration.** The old Express app and its data are untouched; new ULBs onboard with
  `startYear: null` (no restriction) until an admin deliberately sets one.
- **The discretionary STATE → MoHUA exemption flow.** Already scaffolded elsewhere in the codebase
  (`xvi_fc_eligibility_exemptions`, `Permission.RECOMMEND_EXEMPTIONS`, a dead dashboard status) but
  not built. Different actors, different lifecycle (request → approve/reject), different audit needs
  from this automatic mechanism. If it's ever built: an approved discretionary exemption always
  additionally grants; a rejection has no bearing on this automatic one.

## References

- `../CLAUDE.md` — mechanics (Layout, how reads/writes work, invariants).
- `src/master/form-json-config/CLAUDE.md` — the config side, formId registry, how to extend to a new
  form.
