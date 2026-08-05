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
- `services/form-json/`, `helpers/`, `dto/`, `types/`, `constants/` — supporting.

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
