# FC Unspent Declaration

State-facing feature: a per (state, year) form where a State declares, per ULB, whether it has an
unspent FC grant balance and (if so) the amount — gated on and cross-checked against Devolution
Formula's allocation data. No ADR of its own — see "Dependencies" below for why.

## Layout

- `services/main/fc-unspent-declaration.service.ts` — form-level orchestration: get form, save
  draft, final submit. Owns the two real transactions in this module (`saveDraft`/`finalSubmit`,
  each atomically writing parent + rows + history) — both self-contained to this file, no ADR
  needed for them (single call site each, nothing external depends on the transaction mechanics).
- `services/rows/fc-unspent-declaration-row.service.ts` — per-ULB row resolution/validation,
  including the `eligibility` computation (see "Dependencies"). The threshold percent it compares
  against is not a constant baked into this file — it's resolved per design year by
  `services/form-json/fc-unspent-declaration-form-json.service.ts`'s
  `getEligibilityThresholdPercent()`, which reads `formJson.meta.eligibilityThresholdPercent` and
  falls back to `FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT` (constants/) only when a design year's
  form-json document has no override. Main service fetches it once per request and passes it into
  both the GET response's `threshold` field and `resolveAndValidateRows`'s `opts.thresholdPercent`.
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
  table). `visibleWhen isFcUnspent === 'yes'`.

Deliberately two fields rather than one dual-purpose field: every other branch-conditional file
field in this form's formjson (and elsewhere in xvi-fc) uses strict single-branch `visibleWhen` +
`clearValueWhenDisabled: true`, so switching branches auto-clears the now-irrelevant upload. A
shared field would never toggle to hidden across a Yes<->No switch and so would never clear a stale
prior upload — `saveDraft`/`finalSubmit` additionally force the *other* branch's field to `null`
server-side on every branch switch as a second line of defense, mirroring `fcDeclaration`'s own
established forcing behavior.

`FcUnspentDeclarationDocumentService.getDocumentData()` gates the same way `getForm`/`saveDraft`/
`finalSubmit` do (`FcUnspentDeclarationService.assertStateAccess`/`resolveDevolutionDependency`/
`buildFormPermissions`, reused as-is — those methods are intentionally not `private` for this
reason) and additionally refuses to build the Yes-branch document (400, `fcUnspentDeclaration`
field, code `noRows`) unless the active row set has at least one row, and refuses either branch
(400, `_form`, code `branchNotChosen`) until `isFcUnspent` has been answered. Column values come
straight off already-computed row data (`allocationAmount`/`unspentAmount`/`allocationPerc`/
`eligibility` are all resolved once at row-save time by `FcUnspentDeclarationRowService` — nothing
is re-derived for the document). The design-year label is resolved via the existing `YearIdToLabel`
static map (`src/core/constants/years.ts`), the same mechanism already used throughout this
module's main service — deliberately *not* elected-urban-local-bodies' `Year`-model DB lookup
pattern, to stay consistent with this module's own established convention and avoid registering a
new model in `fc-unspent-declaration.module.ts` purely for this. The "14th"/"15th" FC ordinal is
`resolvePriorFcCycleLabel`/`resolvePriorFcCycleFullLabel` (`helpers/fc-unspent-declaration-cycle.helpers.ts`)
— the same shared, single-source-of-truth helper claim-letter's Annexure 1 also reads from; the
`*FullLabel` variant is a thin prose wrapper composed over the original, not a second year->FC
mapping.

## Invariants worth knowing before you change adjacent code

- `unspentAmount` and `allocationAmount` are whole Rupees only — no decimals. Enforced by `@IsInt()`
  on `FcUnspentUlbRowInputDto` (`unspentAmount`); `allocationAmount` is inherited unconverted from
  Devolution Formula's `totalGrantAllocation`, itself `@IsInt()`-enforced there. This was previously
  the one state-form amount left decimal-tolerant (`@IsNumber({ maxDecimalPlaces: 2 })`, since it's a
  real bank-balance figure a State user types in rather than a computed proportional split) — brought
  in line with every other state-form amount for full consistency. `allocationPerc` is a ratio
  (`unspentAmount / allocationAmount * 100`) and is unaffected by the unit — computed unrounded, see
  `FcUnspentDeclarationRowService`.

## Dependencies

**Inbound — reads devolution-formula's dataset-versioning invariant (read-only, no writes):**
this module reads `activeDatasetVersion` at 3 call sites (main service's
`resolveDevolutionDependency`, ulb-options service, row service's `resolveAllocationsForUlbIds`) to
gate editability and resolve per-ULB allocation amounts. See
`devolution-formula/docs/adr/0001-dataset-versioning.md` (this module is listed there as a
consumer) before changing anything on either side of these reads.

**Outbound — this module's `eligibility` field is read externally, generically:** claim-letter's
ULB-bulk eligibility evaluation reads the per-row `eligibility` boolean computed by
`FcUnspentDeclarationRowService.resolveAndValidateRows` — but not via a direct import. It's mediated
entirely by a DB-stored `formJsons.claimEligibility` config (collection/field names as strings) and
a shared, generic dispatcher — the same mechanism Elected Body, SLB, and Annual Accounts also plug
into. See `common/services/claim-eligibility-evaluator.service.ts`'s own docblock for how that
generic contract works; this module doesn't special-case it.
