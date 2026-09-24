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

- **`ONCE_EVER`'s write path.** A second submission in a different design year is rejected at the
  application level (`BankAccountService.assertNoCrossYearBankAccountRecord`, a
  `ConflictException`) — `{ulb, designYear}` stays as the upsert key/unique index as-is, so the S3
  proof-file path scheme (which is keyed off the *original* submission's design year) never needed
  to change. The frontend redirects the ULB to the year the record actually lives in before this
  guard would ever trigger in normal use; the guard exists for direct API calls and multiple tabs.
  Originally left as an accepted, theoretical race for two concurrent requests targeting different
  years (both could pass the preflight check before either commits) — since closed at the DB level
  by a second, additive index: `submissionScope` denormalized onto `XviFcBankAccount` at write time,
  with a `{ulb: 1}` partial unique index scoped to `submissionScope: 'ONCE_EVER'` docs. This doesn't
  touch `{ulb, designYear}` or the S3 path scheme — it's a second, independent index; a concurrent
  duplicate insert now fails with a DB-level duplicate-key error, caught and translated into the
  same `ConflictException` the preflight check throws in the non-racing case.
- **Extending exemption/`ONCE_EVER` to forms beyond SLB/Bank Account.** A pure `formJsonConfig` data
  change plus a small per-form code change (the GET-flow stub-materialization glue, and — for a form
  with its own bespoke status enum, e.g. Annual Accounts — an equivalent terminal status). See
  `src/master/form-json-config/CLAUDE.md`'s "How to add a new form" walkthrough.
- **A distinct dashboard status for auto-exemption.** Separate from, and must never be confused with,
  the unrelated discretionary flow's own dead `EXEMPTION_REQUESTED` status (below).
- **No backfill migration.** The old Express app and its data are untouched; new ULBs onboard with
  `startYear: null` (no restriction) until an admin deliberately sets one.
- **The discretionary STATE → MoHUA exemption flow — filing covers Elected Body/Audited/Provisional
  AFS uniformly; the MoHUA decide step never grants anything downstream, for any of the three.**
  `module/xvi-fc/state/request-exemption` (formId 34, schema
  `xvifc_eligibility_exemptions`) has the STATE-side: one document per `{ulb, year}` (DB-enforced
  via a unique index — a state filing several requests in flight at once, for different ULBs, means
  several documents, one per ULB, not one per request), holding a `data[]` entry per requested
  `formId` (23 Elected Body / 30 Audited AFS / 31 Provisional AFS) so a ULB can have multiple
  independently-tracked reasons without needing more than one document. Final-submit only — no
  draft step, by design; see `xvi-fc-eligibility-exemption.schema.ts`'s own doc-comments (on both
  the document and the entry) for the full reasoning. `Permission.RECOMMEND_EXEMPTIONS`-gated,
  transitioning straight to `UNDER_REVIEW_BY_MOHUA` (no STATE-review leg). Different actors,
  different lifecycle, different audit needs from this automatic mechanism — kept as a fully
  separate collection/module, not folded into `Ulb.yearAccess`.
  `module/xvi-fc/mohua/request-exemption` (`RequestExemptionMohuaService.approve`/`.reject`) is the
  MoHUA-side decide endpoint, now built — and deliberately **never writes to the target form's own
  collection at all**, for any formId, on either approve or reject. An earlier version did (writing
  `EXEMPTED_ACKNOWLEDGED` into Annual Accounts on approve for formId 30/31 only, materializing a stub
  document if none existed), but that repeatedly conflicted with invariants owned by
  `AnnualAccountsService` itself — most notably `sectionType: 'audited'`'s role as a universal
  per-`{ulb, year}` anchor (`findOrInitialize`), which the discretionary-grant write path didn't know
  about or preserve, producing orphaned/invisible documents. "Approved" is instead a pure
  display-only overlay, exactly like "Pending"/"Rejected" already were: `approve` only flips the
  exemption entry's own `currentFormStatus`; every consumer (`AnnualAccountsService.
  listUlbSubmissions`'s exemption overlay, `assertNotBlockedByPendingExemption`'s ULB write-gating,
  the ULB-facing exemption banner) reads that live entry via `ExemptionResolverService.
  resolveDiscretionary(Bulk)` directly, never a copy written elsewhere. `approve` does still run a
  **read-only** eligibility check for formId 30/31 (blocks with a 409 if the target Annual Accounts
  section already has real progress beyond `ULB_EDITABLE_STATUS_IDS` — approving an exemption for a
  section the ULB has substantially already submitted would be nonsensical) — formId 23 (Elected
  Body) skips this check entirely, since `ElectedUrbanLocalBodiesForm` has no `ulb` field at all (one
  whole-state document per `{state, year}`, not per-ULB) and so has no per-ULB progress to check.
  This is no longer a "known gap" the way an earlier version of this flow had one — since nothing is
  written downstream for *any* formId now, 23/30/31 are fully uniform; there's no asymmetry left to
  document. `AnnualAccountsService.listUlbSubmissions`'s exemption overlay
  (`EXEMPTION_PENDING`/`EXEMPTION_REJECTED`/`EXEMPTION_APPROVED`/`AUTO_EXEMPTED`, display-layer
  only, not real `form_status` values) is Audited/Provisional-only — `/ulb-submissions` never lists
  Elected Body at all (it's a STATE form, not a ULB one; that page's whole premise is ULB-submitted
  forms). The dead dashboard `EXEMPTION_REQUESTED` status
  (`state/dashboard/state-dashboard.constants.ts`) remains unwired — explicitly deferred, not part
  of this feature's current scope. A state-level (not per-ULB) exemption — e.g. for SFC Status,
  which has no `ulb` field at all and so can never be reached by this per-ULB mechanism — is a
  distinct, separately-deferred idea; see the request-exemption feature's own planning notes.

## References

- `../CLAUDE.md` — mechanics (Layout, how reads/writes work, invariants).
- `src/master/form-json-config/CLAUDE.md` — the config side, formId registry, how to extend to a new
  form.
