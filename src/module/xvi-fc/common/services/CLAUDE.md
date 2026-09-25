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
  resolver every read-only display consumer (e.g. the SLB review table, `AnnualAccountsService`'s
  `listUlbSubmissions`/`resolveExemptionStatusForResponse`, `SfcStatusService`'s own
  `resolveExemptionStatusForResponse`) should call instead of re-deriving the doc-exists-or-no-doc-
  and-exempt check itself. Two independent sources, both read-only:
  `resolveBulk`/`resolveBulk` wraps `peekEntry` for the AUTOMATIC mechanism (this file's own
  subject); `resolveDiscretionary`/`resolveDiscretionaryBulk` reads `xvifc_eligibility_exemptions`
  directly for the discretionary STATE→MoHUA Request Exemption flow
  (`module/xvi-fc/state/request-exemption` / `module/xvi-fc/mohua/request-exemption`) — a
  genuinely separate mechanism (different collection, different actors, different lifecycle), not
  folded into `Ulb.yearAccess` itself; this service is just the one place both are read from. Never
  writes to either source. `resolveDiscretionary` also resolves the **whole-state** branch of that
  same collection (`ulb: null` documents, e.g. SFC Status's formId 22) via a `ulbId: null` overload
  that additionally requires `stateId` — unlike a real ULB id, `ulb: null` alone isn't unique to one
  state (every state's whole-state exemption doc for a given year shares it), so the query must be
  scoped by `state` too in that branch. `resolveDiscretionaryBulk` has no whole-state variant (no
  caller needs one yet — only ever called with real ULB ids).
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

**Invalidation on `startYear` or seed `disabledFormIds` change**: both wipe the entire `yearAccess`
map before writing the new value, since every derived entry's `computeEntry` result depends on both
(`getEntry`/`peekEntry` never recompute an existing entry, so a frozen entry would otherwise drift out
of sync forever). `UlbService.updateYearAccess` does the wipe itself for `startYear`
(`$set: { yearAccess: {} }`, atomic with the `startYear` write; no-op on a same-value resubmit).
`YearAccessService.setSeedExemptions` does its own wipe for `disabledFormIds`, replacing the whole map
with just the fresh seed entry in one `$set`. Every other year recomputes lazily the next time
something touches it. Not covered: a `formJsonConfig` change (e.g. `exemptionGraceYears`) — an
already-materialized year keeps whatever that config looked like at materialization time; fixing that
needs either an unbounded per-ULB sweep or dropping the never-recompute cache for derived years, so
it's left as a known gap rather than folded into this fix.

## Invariants worth knowing before you change adjacent code

- **Authorize before touching a stub, not after**: `materializeExemptionStubIfNeeded` and
  `revalidateExemptionStubIfNeeded` both write (create/upgrade/reset/delete a document) for whatever
  `ulbId` the caller passed in, before there's necessarily any real document to authorize against. A
  form's `findByUlbAndYear`/`getForm` must call its `validateViewAccess`-equivalent check against a
  synthetic `{ ulb: new Types.ObjectId(ulbId) }` (every such check only ever reads `.ulb`) as the
  *first* thing it does — not after the initial doc fetch, and not only in the "doc still missing"
  fallback branch. `SlbService.getForm` is the reference for getting this right; DUR's and Annual
  Accounts' `findByUlbAndYear` originally authorized only after already writing, letting an
  out-of-scope caller trigger materialize/revalidate for an arbitrary ULB — fixed once found in
  review, but worth checking again for the next form wired into this mechanism.
- **Golden rule**: if a real form document already exists for `(ulb, year, form)`, none of this
  automatic mechanism ever touches it — no automatic re-creation, no re-classification. An
  already-started ULB a state wants excused instead goes through the separate discretionary
  STATE→MoHUA Request Exemption flow (`module/xvi-fc/state/request-exemption` +
  `module/xvi-fc/mohua/request-exemption`) — built for Audited/Provisional AFS (formIds 30/31);
  MoHUA's approve there *does* block on (not silently override) an already-started target section,
  via the same "real progress" check, rather than the automatic path's blanket hands-off rule.
  "Real" excludes an untouched `NOT_STARTED` document with no actual submission on it — Annual
  Accounts' `materializeExemptionStubIfNeeded` does reach into and upgrade such a document in place
  (see "Undoing an exemption" below for why), which looks like it's touching an existing document
  until you know `NOT_STARTED` itself was never real progress to begin with.
- Once an entry is materialized, `yearEnabled`/`disabledFormIds` are read directly. No code path
  falls back to `dateOfConstitution` or any other condition once `yearAccess[label]` exists — except
  that changing `startYear` or the seed's `disabledFormIds` both wipe the whole map first (see
  "Invalidation..." above), since every entry's correctness depends on both.
- `submissionScope: 'ONCE_EVER'` forms (e.g. Bank Account/PFMS) never appear in `disabledFormIds` —
  they aren't "exempted," they're "already satisfied elsewhere." They're looked up by `{ulb}` alone
  on GET, returning the same record regardless of which year is requested. The write path guards
  against the underlying `{ulb, designYear}` unique index otherwise letting a second submission in
  a different year create an ambiguous duplicate — see `BankAccountService.assertNoCrossYearBankAccountRecord`.
- `FORM_STATUS.EXEMPTED_ACKNOWLEDGED` (`src/common/constants/form-status.constants.ts`) is terminal
  from the discretionary flow's point of view, but not immutable from this mechanism's own — see
  "Undoing an exemption" below. Written only by this mechanism's own automatic materialization (e.g.
  `SlbService.materializeExemptionStubIfNeeded`) and, in reverse, its own
  `revalidateExemptionStubIfNeeded`. `RequestExemptionMohuaService.approve` (the
  discretionary STATE→MoHUA flow) deliberately does **not** write this status, or anything else,
  into a target form's own collection — an earlier version did, and it repeatedly conflicted with
  that collection's own invariants (e.g. Annual Accounts' `sectionType: 'audited'` universal anchor);
  see `RequestExemptionMohuaService`'s own class-level doc-comment. A MoHUA-approved discretionary
  exemption is a pure display-only overlay instead — `resolveDiscretionary`'s lookup is the only
  source of truth for it, read directly by `listUlbSubmissions` and the ULB-facing exemption banner,
  never by checking this status.

## Undoing an exemption (self-correcting stubs)

`disabledFormIds` can be edited any time (see "edit-anytime" at the top) — including removing a
formId that was previously exempted. Since the materialized stub document is a separate write from
`yearAccess` itself, undoing the exemption there doesn't retroactively touch any stub already
materialized in SLB/DUR/Annual Accounts' own collections. Every read path that could otherwise keep
trusting a now-stale stub forever is made self-correcting instead, by checking a doc's
`isExemptionStub` flag before trusting its stored status:

- **Single-record GET flow** (`SlbService.getForm`, `DurService.findByUlbAndYear`,
  `AnnualAccountsService.findByUlbAndYear`): each service's `revalidateExemptionStubIfNeeded` re-runs
  the same live exemption check the materializer used, and deletes a stub outright once it's no longer
  exempt (never reset to `NOT_STARTED` in place) — this part is uniform across all three. When it
  actually *runs* differs: SLB/DUR only call it when the existing doc's own `isExemptionStub` is
  true (a flat one-document-per-`{ulb, year}` shape, so the doc itself is unambiguously the thing to
  check). Annual Accounts calls it whenever the audited anchor exists at all, stub or not — the
  *unaudited* sibling can independently be the stale stub even when the anchor itself is a genuine,
  untouched `NOT_STARTED` placeholder or a real submission, so gating on the anchor's own flag would
  miss it; `revalidateExemptionStubIfNeeded` checks both documents' flags itself and no-ops if
  neither is a stub. Annual Accounts' own audited anchor is the one document in this mechanism that
  *can* end up reset to a persisted `NOT_STARTED` rather than deleted — see the anchor/sibling
  paragraph below. Once nothing is left to revalidate, the caller falls through to the exact same
  code path a never-visited ULB already gets.

  `NOT_STARTED` is not exclusively an "absence of a document" state, contrary to an earlier version
  of this note — `DurService.findOrInitialize` and Annual Accounts' own `findOrInitialize` both
  persist it as part of ordinary upload initialization (before the real content lands), same as the
  anchor-placeholder case below. What *is* still true, and load-bearing for
  `UlbService.assertNoRealSubmissionsForExemptedForms`: an exemption stub itself is never left at
  `NOT_STARTED` — it's either `EXEMPTED_ACKNOWLEDGED` (materialized/still valid) or deleted (undone),
  and a plain `NOT_STARTED` document with `isExemptionStub` not `true` is never itself the product of
  this mechanism, exemption-wise indistinguishable from "no real submission yet" regardless of which
  code path actually created it.
- **Bulk STATE list overlays** (`listUlbSlbForms`/`listUlbSubmissions` in all three services): these
  resolve `formStatus` live for every candidate ULB regardless of whether a doc has been visited yet,
  so they're widened to distrust a *stub's* stored status the same way they already treat a missing
  doc — falling through to the live check instead of trusting `isExemptionStub: true` data. Purely
  read-time, no write, so a list is correct even for a ULB whose stub was undone but who never
  revisited the form page.
- **`XviFcService.resolveSlbStatus`** (the "Conditions Progress" dashboard's SLB status) has the same
  golden-rule shape and the same widening. Its DUR/Annual-Accounts siblings in the same method have no
  live exemption check at all (a separate, already-known gap, unrelated to undo) — not touched here.

Annual Accounts' anchor/sibling split (see `annual-account.schema.ts`'s own doc-comment) makes the
`audited` anchor's revalidation asymmetric with the `unaudited` sibling's: the sibling is always safe
to delete outright (nothing else resolves against its `_id`), but the anchor can only be deleted once
its sibling document is confirmed gone too — otherwise it's reset in place (cleared stub flags, status
back to `NOT_STARTED`) rather than deleted, preserving the same "anchor exists once either section is
touched" invariant `findOrInitialize` relies on for real uploads.

Undo is deliberately silent — no audit-log entry, mirroring materialization itself (also unlogged).
The admin's actual `disabledFormIds` edit, in `UlbService.updateYearAccess`, is unlogged too; if that
ever needs an audit trail, the write belongs there, not scattered across each form's stub
materialize/revalidate methods, since a bulk-list revalidation is read-only and would never see it.

## Before changing this, read the ADR

`docs/adr/0001-dynamic-year-access-design.md` in this folder — the alternatives that were considered
and rejected (inferring newness from `dateOfConstitution`, a separate `noPriorDataFormIds` field, a
`Map`-typed sub-schema, hand-maintained per-year entries) and what's deliberately deferred.
