# FC Unspent Declaration

State-facing feature: a per (state, year) form where a State declares, per ULB, whether it has an
unspent FC grant balance and (if so) the amount — gated on and (for Devolution-linked design years) cross-checked against Devolution
Formula's allocation data. See "Per-design-year policy" below. No ADR of its own — see "Dependencies" below for why.

## Layout

- `services/main/fc-unspent-declaration.service.ts` — form-level orchestration: get form, save
  draft, final submit. Owns the two real transactions in this module (`saveDraft`/`finalSubmit`,
  each atomically writing parent + rows) — both self-contained to this file, no ADR needed for them
  (single call site each, nothing external depends on the transaction mechanics). History is written
  differently per method: `finalSubmit` writes its own full-snapshot entry inside its transaction
  (a failure there aborts the submit); `saveDraft` writes a lightweight, best-effort entry
  (`recordDraftHistory`) after its transaction commits, mirroring
  `elected-urban-local-bodies.service.ts`'s own `recordFormHistory` discipline — a failure there
  never fails the draft save.
- `services/rows/fc-unspent-declaration-row.service.ts` — per-ULB row resolution/validation,
  including the `eligibility` computation (see "Dependencies"). The threshold percent it compares
  against is not a constant baked into this file — it's resolved per design year by
  `services/form-json/fc-unspent-declaration-form-json.service.ts`'s `loadFormConfig()`, whose
  returned `thresholdPercent` reads `formJson.meta.eligibilityThresholdPercent` (via the private
  `resolveThresholdPercent()`) and falls back to `FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT`
  (constants/) only when a design year's form-json document has no override. Main service calls
  `loadFormConfig()` once per request and passes the result into both the GET response's
  `threshold` field and `resolveAndValidateRows`'s `opts.thresholdPercent`.
- `services/ulb-options/fc-unspent-ulb-options.service.ts` — ULB picker data.
- `services/document/fc-unspent-declaration-document.service.ts` (+ `-docx.service.ts`) — assembles
  and renders the FC Unspent Declaration letter (Word doc, via the `docx` npm package) served by
  `GET :stateId/:yearId/fc-unspent-declaration-document`. Mirrors elected-urban-local-bodies'
  document-service / renderer-service split. See "FC Unspent Declaration document" below.
- `services/form-json/`, `helpers/`, `dto/`, `types/`, `constants/` — supporting.

## FC Unspent Declaration document and its two file fields

Two distinct file fields on `XviFcUnspentStateForm`, each owned by exactly one branch — never
conflate them:

- `fcDeclaration` — the No-branch's signed nil-balance declaration. `visibleWhen isFcUnspent === 'no'`.
- `fcUnspentDeclaration` — the Yes-branch's signed declaration (carries the ULB-wise unspent-balance
  table). `visibleWhen isFcUnspent === 'yes' AND savedUnspentUlbData isNotEmpty` — the second
  condition only shows the field once at least one ULB-wise row has actually been *saved* (not
  merely typed into the browser FormArray). `savedUnspentUlbData` is a synthetic key, not one of
  this form's own `FieldConfig` fields — `FcUnspentDeclarationService` (`services/main/`) injects
  it into the generic validator's `FormData` at both `saveDraft` and `finalSubmit`, sourced straight
  from the submitted `unspentUlbData` array (safe to use as-is: `resolveAndValidateRows` always
  throws on unresolvable/duplicate rows rather than silently dropping them, so for any request that
  succeeds this count matches what actually persists). `getForm` mirrors the same "isFcUnspent must
  be true" gate on its own row fetch. The frontend mirrors the same key as a synthetic
  (non-`FieldConfig`) `FormControl`, added in `fc-unspent-declaration.component.ts`'s
  `bindPickedUlbsControl()` and kept in step with the ULBs currently picked in the table, so the field
  (and its download action) appears as soon as a ULB is picked rather than only after a first save. This
  is safe because the download action itself saves the draft first when the screen holds unsaved
  branch/ULB changes ("Save & download": `requestDeclarationDownload()`), and the backend's draft/final
  validators already derive the same key from the rows in the request. (It used to mirror only
  already-saved rows, with a separate `fc-unspent-declaration-save-prompt` alert filling the gap while the
  field was hidden; that alert is gone — a persistent save-status strip in the sticky action bar replaces
  it.)

Deliberately two fields rather than one dual-purpose field: every other branch-conditional file
field in this form's formjson (and elsewhere in xvi-fc) uses strict single-branch `visibleWhen` +
`clearValueWhenDisabled: true`, so switching branches auto-clears the now-irrelevant upload. A
shared field would never toggle to hidden across a Yes<->No switch and so would never clear a stale
prior upload — `saveDraft`/`finalSubmit` additionally force the *other* branch's field to `null`
server-side on every branch switch as a second line of defense, mirroring `fcDeclaration`'s own
established forcing behavior.

`FcUnspentDeclarationDocumentService.getDocumentData()` gates the same way `getForm`/`saveDraft`/
`finalSubmit` do — the shared `assertStateAccess` util (imported independently, same as every other
xvi-fc module), plus `FcUnspentDeclarationService`'s own `resolveDevolutionDependency`/
`buildFormPermissions` reused as-is (those two are intentionally not `private` for this reason) —
and additionally refuses to build the Yes-branch document (400, `fcUnspentDeclaration`
field, code `noRows`) unless the active row set has at least one row, and refuses either branch
(400, `_form`, code `branchNotChosen`) until `isFcUnspent` has been answered. The Yes-branch table
renders `unspentAmount` and `previousFcUnspentBalance` (both converted to Lakhs for display) —
values come straight off already-validated row data (both are resolved/validated once at
row-save time by `FcUnspentDeclarationRowService`, nothing is re-derived for the document). The
row's own `allocationAmount`/`allocationPerc`/`eligibility` fields still exist and are still read
elsewhere (see "Dependencies" below) but are no longer surfaced in this particular letter, per the
current MoHUA specimen's table columns. The design-year label is resolved via the existing `YearIdToLabel`
static map (`src/core/constants/years.ts`), the same mechanism already used throughout this
module's main service — deliberately *not* elected-urban-local-bodies' `Year`-model DB lookup
pattern, to stay consistent with this module's own established convention and avoid registering a
new model in `fc-unspent-declaration.module.ts` purely for this. The "14th"/"15th" FC ordinal is
`resolvePriorFcCycleLabel`/`resolvePriorFcCycleFullLabel` (`helpers/fc-unspent-declaration-cycle.helpers.ts`)
— the same shared, single-source-of-truth helper claim-letter's Annexure 1 also reads from; the
`*FullLabel` variant is a thin prose wrapper composed over the original, not a second year->FC
mapping.

### The docx letter mirrors the MoHUA specimen's branch structure

`FcUnspentDeclarationDocxService` renders as `.docx`, not PDF — the state must be able to type over
the closing signature block in Word before printing and signing. It mirrors the MoHUA specimen
letter verbatim, including its title heading; the specimen shows the No and Yes options side by
side (separated by "OR") purely as a reference format, but this renders only whichever one actually
applies to `data.isFcUnspent`. The title, subject line, and closing paragraph are the same wording
regardless of branch — only the certifying paragraph (and, on the Yes branch, the table plus its
trailing sentence) differ. The closing signature block (`[Name]`, `[Designation]`, etc.) is literal,
non-interpolated text — including its own `[State Name]` — identical to elected-urban-local-bodies'
signature block; only the certifying paragraph's state name (and, on the Yes branch, the table) are
filled with real data.

## Every branch outcome deactivates rows except an actual "Yes"

`saveDraft` resolves `isFcUnspent` to one of three branches: `'yes'`, `'no'`, or `'undecided'`
(sent as `null`/omitted — e.g. a draft saved before the radio has been answered, or after it's been
cleared). Only `'yes'` calls `rowService.applyRows(...)`; both `'no'` *and* `'undecided'`
deactivate the active row set (`rowService.deactivateAllRows(...)`) — previously only `'no'` did,
leaving `'undecided'` a no-op that could strand a prior Yes-branch's rows active (and their
`eligibility`/`allocationAmount` stale) after the state cleared the radio without re-answering. Keep
this `else` branch covering both cases if this dispatch is ever refactored — don't reintroduce a
third no-op branch.

## Invariants worth knowing before you change adjacent code

- `unspentAmount` and `allocationAmount` are whole Rupees only — no decimals. Enforced by `@IsInt()`
  on `FcUnspentUlbRowInputDto` (`unspentAmount`); `allocationAmount` is inherited unconverted from
  Devolution Formula's `totalGrantAllocation`, itself `@IsInt()`-enforced there. This was previously
  the one state-form amount left decimal-tolerant (`@IsNumber({ maxDecimalPlaces: 2 })`, since it's a
  real bank-balance figure a State user types in rather than a computed proportional split) — brought
  in line with every other state-form amount for full consistency. `allocationPerc` is a ratio
  (`unspentAmount / allocationAmount * 100`) and is unaffected by the unit — computed unrounded, see
  `FcUnspentDeclarationRowService`.
- A ULB row's two amounts (`unspentAmount`, `previousFcUnspentBalance`) are **nullable in a draft and
  required on final submit**. `FcUnspentUlbRowInputDto` accepts `null`/omitted (a provided value must
  still be a whole number >= 1), so `saveDraft` keeps a selected ULB before its figures are entered —
  previously the whole row was dropped client-side and the API required both, so the selection was lost on
  save. `FcUnspentDeclarationRowService.resolveAndValidateRows` enforces completeness only when called
  with `requireCompleteRows: true` (`finalSubmit`), returning a `required` error on the missing field of
  that row. An incomplete draft row is stored with `null` amounts, `allocationPerc` null (unless an unspent
  amount and a Devolution allocation both exist) and `eligibility: false` (`evaluateRowEligibility` never
  returns true for a row with a `null` figure); final submit recomputes it. Because of that, a `null`
  amount can only exist on a form that was never finally submitted — PMU/MoHUA review, the claim letter and
  the snapshot history only ever see complete rows. The declaration document refuses to generate while
  any active row is incomplete (400, `fcUnspentDeclaration`, code `incompleteRows`).
- Only valid ULBs are saved: a row's ULB must exist in the state's active, XVI-FC-eligible registry
  (`ulbNotFound`) **and** have a census code or an SB code on record (`ulbCodeMissing`, see
  `helpers/fc-unspent-ulb-code.helpers.ts`). A bad row fails the whole request with a row-level error
  (nothing is silently dropped). The ULB picker applies the same code condition, so it never offers a ULB
  the save would reject.
- `finalSubmit` requires the active branch's declaration file reference (`fcDeclaration` for No,
  `fcUnspentDeclaration` for Yes) explicitly in every submission payload — omitted/null is rejected
  rather than silently falling back to the previously stored file. This keeps an explicit null
  meaningful (never a silent no-op) and gives `FileInfoNormalizerService` the raw payload value it
  needs to tell a genuine re-upload from the unchanged-file case.

## Per-design-year policy (Devolution link and eligibility rule)

Whether this form depends on Devolution Formula, and how a ULB row's `eligibility` is decided, is one
small object resolved per design year — `FcUnspentPolicy` (`helpers/fc-unspent-policy.helpers.ts`):

- `devolutionLinked` — `true`: edit/save/submit/document are gated on Devolution Installment 1
  (`resolveDevolutionDependency`), the ULB picker is sourced from its dataset, and each row snapshots
  `allocationAmount`/`allocationPerc`/`allocationSource`. `false`: fully independent — every gate is open,
  Devolution is not queried, the picker lists the state's active XVI-FC-eligible ULBs from the registry, and
  the three allocation fields are `null`.
- `eligibilityRule` — `NO_UNSPENT_ALLOWED` (eligible only when BOTH the applicable-FC unspent and the
  previous unspent balance are zero; for now every other combination is ineligible, per the product truth
  table) or `MAX_PERCENT_OF_ALLOCATION` (the original `unspent / allocation * 100 <= thresholdPercent`).

Defaults are keyed by the FC cycle, not the year (`FC_UNSPENT_POLICY_DEFAULTS_BY_FC`; the year -> cycle map
is still `FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL`): 14th FC (2026-27, 2027-28) = independent +
`NO_UNSPENT_ALLOWED`; 15th FC (2028-29 onward) = today's linked percent rule, deliberately unchanged until the
business confirms the Years 3-5 rules. A design year can override either part through
`formJson.meta.unspentPolicy` (`{ devolutionLinked, eligibilityRule }`); the legacy
`meta.eligibilityThresholdPercent` still feeds the percent rule. `loadFormConfig()` returns the resolved
`policy`, callers load it BEFORE resolving gates, and GET exposes it to the UI as `policy`. Claim Letter is
unchanged: it still reads the row's boolean `eligibility` through its `formjsons.claimEligibility` config.

Row validation note: `unspentAmount` and `previousFcUnspentBalance` are still both required and `>= 1` on a
saved row, so under `NO_UNSPENT_ALLOWED` every saved row is ineligible. A row where one balance is zero
cannot be saved today; relaxing that is a separate product decision.

## Dependencies

**Inbound — reads devolution-formula's dataset-versioning invariant (read-only, no writes):**
this module reads `activeDatasetVersion` at 3 call sites (main service's
`resolveDevolutionDependency`, ulb-options service, row service's `resolveAllocationsForUlbIds`) to
gate editability and resolve per-ULB allocation amounts. See
`devolution-formula/docs/adr/0001-dataset-versioning.md` (this module is listed there as a
consumer) before changing anything on either side of these reads.

`resolveDevolutionDependency`'s own "is Devolution ready" check treats devolution-formula's status,
not just its dataset: `UNDER_REVIEW_BY_PMU` counts the same as `UNDER_REVIEW_BY_MOHUA` (both
"ready" — Devolution Formula got its own PMU pre-screen stage, see
`pmu/devolution-formula/CLAUDE.md`), and `RETURNED_BY_PMU` counts the same as `RETURNED_BY_MOHUA`
(both "editable due to return"). Neither pairing is a regression from the other. This module's own
PMU review stage (`UNDER_REVIEW_BY_PMU`/`RETURNED_BY_PMU` on *this* module's forms, gating
`finalSubmit`'s own target status) is a separate, unrelated concept — see
`pmu/fc-unspent-declaration/CLAUDE.md`.

**Outbound — this module's `eligibility` field is read externally, generically:** claim-letter's
ULB-bulk eligibility evaluation reads the per-row `eligibility` boolean computed by
`FcUnspentDeclarationRowService.resolveAndValidateRows` — but not via a direct import. It's mediated
entirely by a DB-stored `formJsons.claimEligibility` config (collection/field names as strings) and
a shared, generic dispatcher — the same mechanism Elected Body, SLB, and Annual Accounts also plug
into. See `common/services/claim-eligibility-evaluator.service.ts`'s own docblock for how that
generic contract works; this module doesn't special-case it.
