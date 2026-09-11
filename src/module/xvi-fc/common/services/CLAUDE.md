# Dynamic Year Access

Scope: this file documents Dynamic Year Access only — `YearAccessService`, `Ulb.startYear`/
`Ulb.yearAccess`, and the three other services in this folder that consume them
(`ExpectedUlbSetService`, `ClaimEligibilityEvaluatorService`, `ExemptionResolverService`). `file-info-normalizer.service.ts`,
`file-url-normalizer.service.ts`, and `xvifc-form-actors.service.ts` are unrelated utilities that
happen to sit in the same directory and aren't covered here.

Replaces the old module's hardcoded `Ulb.access_20xx` boolean fields (six fixed years, decoded by
string-matching the label, whole-year-only). Two admin-set facts on `Ulb`, both optional and
edit-anytime via `PATCH master/ulb/:id/year-access` (never a blocking approval gate), drive
everything else.

## Layout

- `year-access.service.ts` — the mechanism. `getEntry`/`peekEntry`/`isYearEnabled`/`isFormExempt`/
  `setSeedExemptions`.
- `expected-ulb-set.service.ts` — claim-letter's expected-ULB-set query; `startYear`, when set, is
  the cutoff instead of `dateOfConstitution`.
- `claim-eligibility-evaluator.service.ts` — the `EXEMPTED` eligibility bucket.
- `exemption-resolver.service.ts` — the shared "is this (ulb, formId, year) exempt, and why"
  resolver every read-only display consumer (e.g. the SLB review table) should call instead of
  re-deriving the doc-exists-or-no-doc-and-exempt check itself. Wraps `peekEntry` only, never
  writes. Scoped to the automatic mechanism only — a future discretionary STATE→MoHUA
  exemption-request flow (unbuilt; see the ADR's "Deferred" section) would be a second source this
  resolver folds in later, not a reason to bypass it today.
- `../utils/design-year-label.util.ts` — `formatYearLabel`/`parseStartCalendarYear`, the
  `number ⇄ "YYYY-YY"` conversion every piece below relies on.
- `../constants/xvifc-cycle.constants.ts` — `isWithinXvifcCycle`, the fixed 2026-27…2030-31 award
  period bound, and `hasDesignYearStarted`, a calendar-year-vs-now check (defaults to real "now",
  takes an explicit `referenceDate` for tests). Not part of Dynamic Year Access itself, but used by
  `XviFcService.getYears()` to scope the shared, multi-finance-commission `Year` collection down to
  the 16th FC cycle and to gate any year whose own calendar year hasn't arrived yet. For a ULB
  caller, `getYears()` then tags each remaining year with `isEnabled` via a **direct, literal**
  read of `Ulb.yearAccess[year].yearEnabled` — it does not go through `YearAccessService` at all
  (no `getEntry`/`peekEntry`, no `computeEntry` fallback), so a year with no key in `yearAccess` at
  all comes back `isEnabled: false`, not "compute what it should be." This is a deliberate
  divergence from every other consumer in this file (which all read live/computed access via
  `peekEntry`) — by design, `getYears()` only trusts what's already been explicitly materialized.
  One exception: `ulb.startYear == null` is itself the documented "no restriction" fact (see Data
  model below), already sitting on the same `findById` read `getYears()` does — it isn't computed
  or fetched specially, so a missing `yearAccess` entry for an unrestricted ULB comes back
  `isEnabled: true`, not `false`. A ULB with a non-null `startYear` still gets `false` for any year
  with no entry, exactly as above — this exception only ever widens what's already known to be
  true from data already in hand, it never triggers a `YearAccessService` call.
  `hasDesignYearStarted` is then AND-ed on top for every caller (ULB and STATE/ADMIN alike) — a
  future year (e.g. "2027-28" while the current calendar year is 2026) is always `isEnabled: false`
  regardless of `yearAccess` or scope; it's a hard override that can only turn a year off, never on.
- `src/master/form-json-config/` — the per-formId config this service reads
  (`isApplicableForExemption`, `exemptionGraceYears`, `submissionScope`). See its own CLAUDE.md.
- `src/schemas/ulb.schema.ts` — `startYear`, `yearAccess`, `registrationReason` (`UlbYearAccessEntry`
  is defined here too, next to the field it types).
- `src/master/ulb/ulb.service.ts` (`updateYearAccess`/`getYearAccess`) + `ulb.controller.ts` — the
  ADMIN write/read endpoints. Live outside this folder (they're ULB-CRUD, not xvi-fc), but they're
  the only caller of `setSeedExemptions`.

## Data model

```ts
// Ulb
startYear: number | null;            // starting calendar year of the ULB's first participating
                                      // design year. null = no restriction (sees every year,
                                      // matches the old fields' default-true behavior).
yearAccess: Record<string, {         // sparse, lazily materialized, keyed by design year label
  yearEnabled: boolean;
  yearId: ObjectId;
  disabledFormIds: number[];         // formId not listed here defaults to mandatory
}>;
registrationReason: string | null;   // NEW_CONSTITUTION | SPLIT | MERGER | EXISTING_ULB_ONBOARDING
                                      // — informational only, never read by any logic
```

Only the seed entry (`yearAccess[formatYearLabel(startYear)]`) is ever admin-edited directly. Every
other year is derived from it the first time a consumer needs it.

## How reads work

`getEntry(ulb, year)` returns `yearAccess[year.year]` directly if present — a plain property lookup,
no fallback condition. If absent, it computes the entry (see below), persists it, then returns it.
`isYearEnabled`/`isFormExempt` are thin wrappers over `getEntry`.

`peekEntry(ulb, year)` computes the same result but never writes — used by
`ClaimEligibilityEvaluatorService.buildExemptionLookup` when scoring hundreds of ULBs in one pass, so
a single eligibility check doesn't materialize hundreds of `yearAccess` entries as a side effect. The
normal per-ULB GET flow still uses `getEntry`, so the entry gets materialized (and cached in the doc)
the first real time a ULB visits that year.

## How writes work — lazy materialization

`setSeedExemptions(ulb, seedYear, disabledFormIds)` is the only path an admin write ever takes — it
sets `yearAccess[seedLabel] = { yearEnabled: true, yearId: seedYear._id, disabledFormIds }` and
nothing else. Called by `UlbService.updateYearAccess`, which resolves `seedYear` from `startYear`
and rejects the call if no matching `Year` document exists yet.

Every later year is computed by `computeEntry` the first time `getEntry` needs it, then written once
by `persistEntry`:
- `yearEnabled` = `startYear == null || year's starting calendar year >= startYear`.
- `disabledFormIds` = the seed entry's `disabledFormIds`, filtered to formIds whose
  `formJsonConfig.exemptionGraceYears` still covers this year's distance from `startYear`
  (`computeDisabledFormIds`, 1-indexed — the seed year itself is index 1).

`persistEntry` only writes if the key is still absent (`$exists: false` guard) — a concurrent request
that already materialized the same entry wins without a redundant write; the computed value is
deterministic for the same `(ulb, year)` pair either way, so this is safe without a lock.

**Invalidation on `startYear` change**: `UlbService.updateYearAccess` wipes the entire `yearAccess`
map (`$set: { yearAccess: {} }`, atomically alongside the `startYear` write itself) whenever
`startYear` actually changes to a different value. Every entry's `computeEntry` result depends on
`startYear`, so an already-materialized entry frozen under the *old* value would otherwise silently
drift out of sync with it forever (`getEntry`/`peekEntry` never recompute an existing entry). A
no-op resubmit of the same `startYear` value does not wipe anything. `setSeedExemptions` still runs
after the wipe (when `disabledFormIds` is provided in the same request) to re-establish the new seed
entry; every other year recomputes lazily the next time something touches it.

## Invariants worth knowing before you change adjacent code

- **Golden rule**: if a real form document already exists for `(ulb, year, form)`, none of this ever
  touches it — no automatic re-creation, no re-classification. An already-started ULB a state wants
  excused goes through the separate discretionary STATE→MoHUA flow (not built yet), not this one.
- Once an entry is materialized, `yearEnabled`/`disabledFormIds` are read directly. No code path
  falls back to `dateOfConstitution` or any other condition once `yearAccess[label]` exists — with
  one deliberate exception: an admin changing `startYear` itself invalidates the whole map (see
  "Invalidation on `startYear` change" above), specifically because every entry's correctness
  depends on `startYear` in the first place.
- `submissionScope: 'ONCE_EVER'` forms (e.g. Bank Account/PFMS) never appear in `disabledFormIds` —
  they aren't "exempted," they're "already satisfied elsewhere." They're looked up by `{ulb}` alone
  on GET, returning the same record regardless of which year is requested. The write path guards
  against the underlying `{ulb, designYear}` unique index otherwise letting a second submission in
  a different year create an ambiguous duplicate — see `BankAccountService.assertNoCrossYearBankAccountRecord`.
- `FORM_STATUS.EXEMPTED_ACKNOWLEDGED` (`src/common/constants/form-status.constants.ts`) is terminal
  and ownerless — set once, automatically, by the exempted form's own service; never a manual
  ULB/STATE/MoHUA action.

## Before changing this, read the ADR

`docs/adr/0001-dynamic-year-access-design.md` in this folder — the alternatives that were considered
and rejected (inferring newness from `dateOfConstitution`, a separate `noPriorDataFormIds` field, a
`Map`-typed sub-schema, hand-maintained per-year entries) and what's deliberately deferred.
