# Form JSON Config

Stable, per-`formId`-only behavior config, backing [Dynamic Year Access](../../module/xvi-fc/common/services/CLAUDE.md).
**If you're adding a new form to Dynamic Year Access, or trying to find out how a form's exemption
behaves, start here and at `module/xvi-fc/common/services/CLAUDE.md` — not inside any individual
form's own folder.** The mechanism is generic; no per-form documentation exists or is needed for it.

## Layout

- `src/schemas/form-json-config.schema.ts` — the `FormJsonConfig` schema (collection `formjsonconfigs`).
- `form-json-config.service.ts` — `findByFormId` (cached), `findAllExemptable`, `findAll`,
  `create`/`update`/`remove`.
- `form-json-config.controller.ts`, `dto/`, `interfaces/` — ordinary ADMIN CRUD.
- `form-json-config.module.ts` — plain module, no bootstrap side effects.
- `constants/form-labels.constants.ts` — `FORM_LABELS`/`getFormLabel`, a formId -> short display
  label map. Computed and spread onto each row `findAllExemptable()` returns (`label`, not
  persisted) so a UI consumer (e.g. the ULB review dialog's exemption checklist) reads the label
  straight off the API response instead of keeping its own formId -> label map in sync by hand.

## Bootstrap

`findByFormId`/`findAllExemptable` return nothing for a formId with no row - the mechanism they
back is silently inert until a row exists. There is no auto-seed on boot (removed — it was writing
rows as a side effect of every app startup); a fresh environment needs each row created once via
`POST form-json-config` (ADMIN only). Dynamic Year Access currently depends on exactly two rows: 32
(SLB - `isApplicableForExemption: true`) and 33 (Bank Account - `submissionScope: 'ONCE_EVER'`). See
`POST form-json-config` request bodies below. Every other formId in the registry below is a
reference entry only - it has no `formJsonConfig` row, and doesn't need one unless it's later wired
into exemption or `ONCE_EVER` (see "How to add a new form" below).

```jsonc
// POST form-json-config  (ADMIN only) — SLB
{ "formId": 32, "isApplicableForExemption": true, "exemptionGraceYears": 1, "submissionScope": "PER_YEAR" }

// POST form-json-config  (ADMIN only) — Bank Account / PFMS
{ "formId": 33, "isApplicableForExemption": false, "exemptionGraceYears": 1, "submissionScope": "ONCE_EVER" }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `formId` | `number`, unique | The formJson document's `formId` this config describes. |
| `isApplicableForExemption` | `boolean`, default `false` | Whether a genuinely new ULB can be exempted from this form via `yearAccess.disabledFormIds`. |
| `exemptionGraceYears` | `number`, default `1`, min `1` | How many of the ULB's own initial participating years (counting the seed/`startYear` year as year 1) this form stays exempted for. |
| `submissionScope` | `'PER_YEAR' \| 'ONCE_EVER'`, default `'PER_YEAR'` | `PER_YEAR` — normal, submit every design year. `ONCE_EVER` — submit once, the same record is reused across every year (e.g. PFMS/Bank Account). |
| `isActive` | `boolean`, default `true` | Soft delete — `remove()` sets this false rather than deleting the row. |

Kept as a **separate collection from `formJsons`** deliberately: a form's data requirements
(exemptable? one-time?) don't change per design year the way its questionnaire does. Embedding this
in `formJsons` would mean re-entering the same value on every new year's document; this way it's set
once per formId and never touched again unless the form's own behavior actually changes.

## Caching

Redis-backed via `NamespacedCacheService`, namespace `formJsonConfig`, no TTL — `findByFormId` is
read-through (checks cache, falls back to Mongo, populates cache); every write (`create` when
`isActive`, `update`, `remove`) deletes that formId's cache key. Same no-TTL/explicit-invalidation
pattern as `UlbEligibilityService`'s reference-data cache (see root `CLAUDE.md`).

## FormId registry

Every formId currently in use across xvi-fc, and where it lives. This table resolves what used to be
a dangling reference in `bank-account-form.constants.ts` ("see CLAUDE.md's formId registry") — this
is that registry.

| formId | Form | Module |
|---|---|---|
| 22 | SFC Status | `module/xvi-fc/state/sfc-status` |
| 23 | Elected Urban Local Bodies | `module/xvi-fc/state/elected-urban-local-bodies` |
| 24 | Devolution Formula | `module/xvi-fc/state/devolution-formula` |
| 25 | FC Unspent Declaration | `module/xvi-fc/state/fc-unspent-declaration` |
| 26 | Claim Letter | `module/xvi-fc/state/claim-letter` |
| 30 | Annual Account — Audited | `module/xvi-fc/ulb/annual_accounts` (`sectionType: 'audited'`) |
| 31 | Annual Account — Provisional/Unaudited | `module/xvi-fc/ulb/annual_accounts` (`sectionType: 'unaudited'`) |
| 32 | SLB | `module/xvi-fc/ulb/slb` |
| 33 | Bank Account / PFMS | `module/xvi-fc/ulb/bank-account` |

## How to add a new form to Dynamic Year Access

1. Add or update this form's `formJsonConfig` row: `isApplicableForExemption: true`,
   `exemptionGraceYears: N` (or `submissionScope: 'ONCE_EVER'` for a once-only form instead). Also
   add its formId to `FORM_LABELS` in `constants/form-labels.constants.ts` — otherwise it shows up
   in the exemption checklist as the generic `Form #<id>` fallback instead of a real name.
2. In that form's own GET flow, at the point where "no record exists yet for this `(ulb, year)`" is
   already detected, call `YearAccessService.isFormExempt(ulb, year, formId)`. If `true`, upsert a
   stub record with a terminal, ownerless "exempted" status and return it instead of a blank
   questionnaire.
   - If the form already uses the shared numeric `FORM_STATUS` enum, use
     `FORM_STATUS.EXEMPTED_ACKNOWLEDGED` directly — copy `slb.service.ts`'s
     `materializeExemptionStubIfNeeded` as the working reference implementation.
   - If the form has its own bespoke status enum (e.g. Annual Accounts' `AnnualAccountFormStatus`/
     `FORM_STATUS_ID`), add an equivalent terminal, ownerless status to that enum first, then follow
     the same pattern.
3. `YearAccessService`, the year selector, and `ClaimEligibilityEvaluatorService`'s `EXEMPTED`
   bucket all key off `formId` generically already - nothing to change there.
4. Add a branch to `UlbService.assertNoRealSubmissionsForExemptedForms`
   (`src/master/ulb/ulb.service.ts`) for the new formId - it blocks the admin from marking a form
   exempt when a real (non-stub) submission already exists for the seed year, so the checkbox can't
   silently become a no-op. There's no generic formId→Model registry in this codebase (every form
   consumer hardcodes its own model injection), so this is a small formId-keyed check, not something
   that resolves itself automatically like step 3.

See `module/xvi-fc/common/services/CLAUDE.md` for how the read/write mechanics work, and its
`docs/adr/0001-dynamic-year-access-design.md` for the full design rationale and what's deliberately
deferred.
