# XVI-FC State Dashboard — Phase 1 Existing-Code and Data-Source Audit

## 1. Phase status

Completed phases: None

Remaining phases: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, Phase 9, Phase 10

This document is discovery only. No dashboard route, controller, service, DTO, schema, aggregation, CTA, frontend change, index, or business-rule classifier is implemented in Phase 1.

## 2. Audit summary

- The future route can follow the existing `api/v2` global prefix and XVI-FC State route conventions: `GET /api/v2/xvi-fc/state/:stateId/:yearId/dashboard`.
- State, Year, ULB, grant-allocation, SFC, elected-ULB, devolution-formula, annual/provisional-account, PFMS bank-account, and ULB unspent-balance sources exist.
- `GrantAllocation.basic + GrantAllocation.performance` is the only authoritative State/year allocation total found. Both values are stored as numbers in the existing workflow and displayed as crores. The future API must return their numeric sum unchanged, with no division or multiplication by `10,000,000`.
- No executable claim-letter model, claim amount, claim status, or claim aggregation exists. Required fallback: **SOURCE NOT AVAILABLE — RETURN 0 UNTIL CLAIM-LETTER MODEL IS IMPLEMENTED**.
- No executable Service Level Benchmark or exemption-request source exists.
- Annual and provisional accounts are independent sections (`auditedData` and `unauditedData`) in one ULB/year document, not separate collections.
- Existing source statuses describe workflow state, but there is no dashboard compliance classifier or exemption bucket mapper.
- ULB-level records generally do not store State directly, except PFMS bank accounts. State scoping must therefore start with applicable ULB IDs and avoid one query per ULB.

### Required conclusions

1. State context comes from `State._id` and `State.name`; the schema has no dashboard-specific projection.
2. Financial-year context comes from `Year._id` and `Year.year`.
3. User role and scope come from the authenticated `AuthUser`, not a dashboard collection.
4. No grant-type field or relation exists in the audited XVI-FC models.
5. The executable active-ULB filter used by State forms is `{ state: ObjectId(stateId), isActive: true }`.
6. ULB has no soft-delete field; `isPublish`, `approval.status`, and `ulbType` are not used by the existing XVI-FC active-ULB count.
7. Allocation is one `GrantAllocation` document per State/year, enforced by a unique index.
8. Allocation total is `basic + performance`; no `$sum` across records is required for a State/year dashboard.
9. Devolution row amounts are per ULB, but they are allocations under a formula and are not claim amounts.
10. Claim-letter data is not implemented and must return `0` until a source exists.
11. SFC, elected-ULB, and devolution forms are State/year-scoped; ULB registration is State-scoped only.
12. State FC unspent balance does not exist as a State-level source; the present disclosure source is ULB/year-scoped.
13. Annual and provisional completion must use section workflow status, not document existence or upload status alone.
14. PFMS submission sets status `3` (`UNDER_REVIEW_BY_STATE`); IFSC server verification is currently a stub.
15. ULB unspent-balance submission is confirmed by string status `SUBMITTED`.
16. SLB and exemption-request buckets cannot be populated from an executable source.
17. Shared status `7` is the only globally defined terminal status, while current State final-submit services transition to status `5`.
18. A cross-form compliance rule cannot be confirmed without product decisions about required forms, terminal/submitted statuses, exemptions, and the applicable ULB denominator.

## 3. Repository architecture and conventions

### Route and module conventions

- `src/main.ts` sets the global prefix to `api/v2`.
- Existing route roots include `xvi-fc`, `xvi-fc/state/sfc-status`, `xvi-fc/state/elected-urban-local-bodies`, `xvi-fc/state/devolution-formula`, `xvi-fc/annual-account`, `xvi-fc/bank-account`, and `xvi-fc/unspent-balance-disclosure`.
- `src/module/xvi-fc/xvi-fc.module.ts` is the existing composition root for XVI-FC models and feature modules.
- Controllers use Swagger decorators, bearer authentication, the global JWT guard, permission metadata/guards where configured, and service-level scope checks.
- XVI-FC success responses use `xviFcSuccess`, which returns `success`, `message`, `data`, optional `meta`, and `timestamp`.
- Global response/error handling is provided by `ResponseTransformInterceptor` and `HttpExceptionFilter`; duplicate-key errors are mapped to HTTP 409.

### Identifier and access conventions

- `ParseObjectIdPipe`, `toObjectId`, and `toObjectIdString` are the existing ObjectId validation/normalization utilities.
- The JWT strategy reloads the active user and provides `role`, `scope`, `accessLevel`, `xviFcSubrole`, `ulb`, and `state` on `request.user`.
- Existing State-form services use an explicit State access assertion: ADMIN can access any State; STATE scope must match `user.state`; other scopes are rejected by those helpers.
- `Permission.VIEW_STATUS_REPORTS` and `Permission.VIEW_DASHBOARDS` are granted to State and MoHUA subroles and to ADMIN. ULB permissions are currently empty.
- Permission availability and State-scope authorization are separate checks. MoHUA has dashboard permissions but the current State-form scope helper rejects MoHUA, so dashboard access policy must be decided before implementation.

### Collection-name convention

`State`, `Year`, and `Ulb` do not set an explicit `collection` option, so their registered Mongoose model names use the default pluralized collections (`states`, `years`, and `ulbs`). XVI-FC feature schemas listed below declare explicit collection names.

## 4. Data-source matrix

| Dashboard item | Model / collection | Exact fields and relations | Required filter | Existing reusable path | Audit conclusion |
|---|---|---|---|---|---|
| State ID | `State` / default `states` | `_id` | `_id = stateId`; decide whether `isActive`/`accessToXVFC` is mandatory | `XviFcService.getStateById` | Confirmed source |
| State name | `State` / default `states` | `name` | Same State lookup | `XviFcService.getStateById` | Confirmed source |
| Financial year | `Year` / default `years` | `year` | `_id = yearId`; decide whether `isActive: true` is mandatory | `XviFcService.getYears` is list-only and hardcodes permitted labels | Confirmed source; direct lookup needed later |
| XVI-FC year ID | `Year` / default `years` | `_id` | `_id = yearId` | ObjectId utilities | Confirmed source |
| User role | Authenticated `AuthUser`; persisted User model / default `users` | `role`, `scope`, `xviFcSubrole`, `state`, `ulb`, overrides | Active JWT-authenticated user | JWT strategy and `CurrentUser` | Confirmed source |
| Grant type | None | No `grantType` field/relation found | Not applicable | None | Source gap; do not invent a value |
| Total active ULBs | `Ulb` / default `ulbs` | `state -> State`, `isActive`, `ulbType`, `isPublish`, `approval.status` | `{ state: ObjectId(stateId), isActive: true }` | Same filter is used in elected-ULB/devolution services | Confirmed query; publish/approval/type additions need a decision |
| Allocated amount | `GrantAllocation` / `grantAllocation` | `stateId -> State`, `yearId -> Year`, `basic`, `performance` | `{ stateId, yearId }` | `DevolutionFormulaService.resolveGrantAllocation` and summary helper | Return `basic + performance` unchanged; no cross-record `$sum` |
| Claimed amount | None | No claim numeric/status/State/year fields | Not applicable | Claim lock is a no-op stub | **SOURCE NOT AVAILABLE — RETURN 0 UNTIL CLAIM-LETTER MODEL IS IMPLEMENTED** |
| ULB registration task | `Ulb` / default `ulbs` | `state`, `isActive`, `approval.status`; no year/status form | State-only | ULB master service approval workflow | Source exists, but State/year DONE rule does not |
| Devolution task | `DevolutionFormulaForm` / `xvi_fc_devolution_formula_forms` | `state`, `year`, `installment`, `currentFormStatus`, `validationStatus`, `isActive`, `isDraft` | State/year/installment; normally `isActive: true` | `DevolutionFormulaService.getForm` | Status `5` after validated final submit; dashboard DONE definition needs confirmation |
| SFC condition | `XviFcSfcStatus` / `xvifc_sfc_forms` | `state`, `year`, `formType`, `currentFormStatus`, `isActive`, `isDeleted` | `{ state, year, formType, isDeleted: false }`; service currently omits `isActive` | `SfcStatusService.getForm` | State/year source confirmed; DONE status needs confirmation |
| Elected-ULB condition | `ElectedUrbanLocalBodiesForm` / `xvi_fc_elected_urban_local_bodies_forms` | `state`, `year`, `formType`, `currentFormStatus`, `validationStatus`, `isActive`, `isDeleted` | State/year/formType; active/nondeleted policy should be explicit | `ElectedUrbanLocalBodiesService.getForm` | Final submit requires valid complete dataset and sets status `5` |
| State FC unspent condition | None at State level | Existing disclosure has `ulb` and `designYear`, not `state` | Not applicable | None | Not a State-level source |
| Annual accounts | `XviFcAnnualAccount` / `xvifc_annualaccount_datas` | `ulb -> Ulb`, `design_year -> Year`, `auditedData.form_status`, `auditedData.form_status_id` | Applicable ULB IDs + `design_year` | `AnnualAccountsService.findByUlbAndYear`; `XviFcService.getFormStatus` | Shared ULB/year document; section status determines progress |
| Provisional accounts | Same as annual | `unauditedData.form_status`, `unauditedData.form_status_id` | Applicable ULB IDs + `design_year` | Same services | Separate section in same document |
| PFMS bank account | `XviFcBankAccount` / `xvi_fc_bank_accounts` | `ulb -> Ulb`, `designYear -> Year`, `state -> State`, `currentFormStatus`, `proofFile`, `submittedBy`, `submittedAt` | State/year and applicable ULB IDs | `BankAccountService.getBankAccount` | One ULB/year record; submitted workflow status is `3` |
| FC unspent balance | `XviFcUnspentBalanceDisclosure` / `xvi_fc_unspent_balance_disclosures` | `ulb -> Ulb`, `designYear -> Year`, `formStatus`, `submittedBy`, `submittedAt` | Applicable ULB IDs + `designYear` | `UnspentBalanceDisclosureService.getByUlbAndYear`; `XviFcService.getFormStatus` | `SUBMITTED` is confirmed submission state |
| Service Level Benchmarks | None | No schema/model/status found | Not applicable | None | Source gap |
| Exemption requested | None | No executable exemption schema/model/status found | Not applicable | None | Source gap |
| Compliance rate/count | None | No persisted compliance flag or classifier found | Must derive only after rules are approved | None | Business-rule gap |
| Claim instalment display | Devolution forms/rows only; no claim source | `installment`, allocation row amounts; no claim status/letter | Not applicable for claims | Installment 2 lock helper currently always returns locked | Cannot represent a claim letter |

## 5. Status inventory

### Shared numeric workflow

| Value | Constant | Existing meaning | Proposed dashboard bucket | Confidence / issue |
|---:|---|---|---|---|
| 0 | `NO_STATUS` | No workflow status | `NOT_STARTED` | Proposed; decide whether it should instead be excluded |
| 1 | `NOT_STARTED` | Not started | `NOT_STARTED` | Confirmed |
| 2 | `IN_PROGRESS` | Editable/in progress | `IN_PROGRESS` | Confirmed |
| 3 | `UNDER_REVIEW_BY_STATE` | Submitted by ULB and owned by State | `UNDER_REVIEW` | Confirmed |
| 4 | `RETURNED_BY_STATE` | Returned to ULB for changes | `IN_PROGRESS` | Proposed from editable ownership |
| 5 | `UNDER_REVIEW_BY_MOHUA` | Submitted by State and owned by MoHUA | `UNDER_REVIEW` or `ELIGIBLE` | Product decision; current State forms stop here |
| 6 | `RETURNED_BY_MOHUA` | Returned for changes | `IN_PROGRESS` | Proposed from editable ownership |
| 7 | `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` | Terminal acknowledgement | `ELIGIBLE` | Strong candidate; eligibility itself is not defined in code |

`isTerminalStatus` recognizes only status `7`. Shared transitions allow `5 -> 6 or 7`. State SFC, elected-ULB, and devolution final-submit code currently writes status `5`, despite some controller descriptions referring to acknowledgement.

### Source-specific statuses

| Workflow | Stored field/statuses | Existing completion behavior | Dashboard implication |
|---|---|---|---|
| ULB registration | `approval.status`: `PENDING`, `APPROVED`, `REJECTED`; `isActive` boolean | State-created ULBs can be pending; ADMIN-created ULBs default approved | No year-scoped task completion rule exists |
| Annual audited section | `auditedData.form_status`: `NOT_STARTED`, `IN_PROGRESS`, `UNDER_REVIEW_BY_STATE`; parallel IDs `1`, `2`, `3` | `submitSection` sets status/ID to under-review only after selected uploaded documents pass OCR processing | Treat status `3`, not mere uploads, as submitted; “compliant” still unresolved |
| Provisional/unaudited section | Same at `unauditedData.*` | Same workflow | Independent from audited section |
| Annual document upload | `uploadStatus`: `NOT_UPLOADED`/`UPLOADED`; `processingStatus`: `NOT_STARTED`/`PROCESSING`/`PASSED`/`FAILED` | Submission requires the chosen documents to be uploaded and processing-passed | Upload/processing status alone is not form completion |
| PFMS bank account | Numeric `1`, `2`, `3`, `4`, `6` | Submit writes `3` and timestamps/user | Count `3` as submitted/under review; no terminal/eligible PFMS status is supported by this schema |
| FC unspent balance | String `DRAFT`, `SUBMITTED` | Submit writes `SUBMITTED`; submitted records are immutable | `SUBMITTED` is the confirmed submitted state |
| SFC | Numeric shared status; executable writes `2` for draft and `5` for final submit | Data is a dynamic mixed payload driven by FormJson | Whether `5` or only `7` is DONE must be decided |
| Elected ULB | Numeric shared status plus `NOT_VALIDATED`, `VALID`, `INVALID` | Final submit requires valid row coverage and writes `5` | Candidate DONE is status `5` plus `VALID`; product confirmation required |
| Devolution formula | Numeric shared status plus validation state | Final submit requires `VALID`, writes `5`; installment 2 remains locked pending claims | Candidate DONE is status `5` plus `VALID`, per required installment |

### Proposed bucket mapping, not implementation

- `NOT_STARTED`: missing form record, shared `0`/`1`, annual section `NOT_STARTED`, unspent missing record.
- `IN_PROGRESS`: shared `2`/`4`/`6`, annual section `IN_PROGRESS`, unspent `DRAFT`.
- `UNDER_REVIEW`: shared `3`; possibly shared `5` depending on whether this bucket means review at either authority.
- `ELIGIBLE`: candidate shared `7`; potentially source-specific submitted statuses only after eligibility/compliance rules are approved.
- `EXEMPTION_REQUESTED`: cannot be mapped because no executable exemption source/status exists.

## 6. Access-control findings

- The future read route should rely on the global JWT guard and should require an existing dashboard/status-report permission via `PermissionGuard`.
- A matching-State assertion is still required in the service. Permission checks alone do not prevent one State user from requesting another State ID.
- Existing State services allow ADMIN globally and a STATE user only when `user.state` matches the route State ID; ULB and other scopes are denied.
- MoHUA users have `VIEW_DASHBOARDS` and `VIEW_STATUS_REPORTS`, but existing State-scope helpers deny MoHUA. Product must decide whether MoHUA may inspect any State dashboard.
- State and year route values must be validated as ObjectIds. State and Year existence should be checked independently and produce 404 when absent.
- No State/year compatibility table exists. Compatibility can only be inferred from feature records unless a new policy is defined later.
- `State.isActive`, `State.isPublish`, `State.accessToXVFC`, and `Year.isActive` exist, but current helper methods do not consistently enforce them. Required filters need an explicit contract decision.

## 7. Amount-unit findings

- `GrantAllocation.basic` and `GrantAllocation.performance` are `Number` fields with minimum `0`.
- The unique State/year allocation record is the authoritative source. Dashboard allocated amount should be `basic + performance`.
- The devolution workflow names this sum `totalMoHUAAllocation`, and Excel/UI labels display `Cr.`. Therefore the stored operational unit is crores.
- The future API must return the existing numeric values unchanged. It must not divide or multiply by `10,000,000`.
- No `$sum` across `GrantAllocation` documents is needed because `{ stateId, yearId }` is unique.
- Devolution rows store per-ULB `totalGrantAllocation`, `installment1Amount`, and `installment2Amount`; these validate distribution against the State allocation but are not the dashboard’s authoritative State allocation or claimed amount.
- Existing `XviFcService.getStateWiseData` groups allocation by State without a year and therefore must not be reused unchanged for this State/year endpoint.
- Claimed amount has no source and must be `0` under the explicit temporary rule.

## 8. Existing indexes and performance implications

| Source | Existing relevant indexes | Implication |
|---|---|---|
| State | `{ name, code, slug, isActive, isPublish }` | `_id` lookup remains the dashboard context path |
| Year | unique/indexed `year`; indexed `isActive` | `_id` lookup is supported by MongoDB’s default index |
| ULB | `{ state: 1, isActive: 1 }`; `{ state: 1, approval.status: 1 }` | Exact active-State count is indexed |
| Grant allocation | unique `{ stateId: 1, yearId: 1 }`; individual indexed refs | Efficient single-record State/year lookup |
| SFC | unique `{ state: 1, year: 1, formType: 1 }` | Efficient exact form lookup; `isDeleted` is not part of the index |
| Elected-ULB form | unique `{ state, year, formType }`; `{ state, year, isActive }` | Efficient State/year form lookup |
| Elected-ULB rows | form/version/validation indexes; `{ state, year, ulbId }`; partial unique row indexes | Supports aggregate validation without per-ULB reads |
| Devolution form | unique `{ state, year, installment }`; `{ state, year, isActive }` | Efficient per-installment lookup |
| Devolution rows | form/version/validation and State/year/installment/ULB/version indexes | Supports grouped allocation checks |
| Annual/provisional | unique `{ ulb: 1, design_year: 1 }` | One shared document per ULB/year; State query needs applicable ULB IDs |
| PFMS bank | unique `{ ulb: 1, designYear: 1 }` | One record per ULB/year; direct `state` exists but no State/year/status compound index |
| ULB unspent | unique `{ ulb: 1, designYear: 1 }` | One record per ULB/year; State query needs applicable ULB IDs |

Recommended Phase 2/implementation query shape, without adding it now:

1. Validate authorization, State, and Year.
2. Fetch applicable active ULB IDs once.
3. Fetch State/year grant and State-level form records in parallel.
4. Query each ULB-level collection once using `ulb: { $in: applicableUlbIds }` and the year field.
5. Read annual and provisional statuses from the same annual-account result set.
6. Group/distinct by ULB defensively and never issue one query per ULB.
7. Do not synthesize unavailable source data except the explicitly required claimed-amount fallback of `0`.

Index changes should be considered only after the final Phase 2 contract/query predicates are fixed. No index was changed in Phase 1.

## 9. Source-gap register

| Gap | Evidence | Safe Phase 2 handling / decision needed |
|---|---|---|
| Claim letters and claimed amount | Full-code search found only a devolution row lock comment and a no-op stub pending a claim model | Return numeric `0` until the claim-letter model is implemented, exactly as required |
| Claim statuses and qualifying instalments | No model, collection, amount, generated/approved status, or State/year claim fields | Do not infer claims from devolution allocation rows |
| Service Level Benchmarks | No executable schema/model/service/form source found | Exclude or represent as unavailable in the contract; do not count as incomplete without a product rule |
| Exemption requests | Permission/menu text exists, but no executable request model/status | `EXEMPTION_REQUESTED` cannot be populated; contract must define temporary behavior |
| Grant type | No audited allocation/form field or relation | Do not hardcode a grant type; make it nullable/omit it until a source is selected |
| Compliance classifier | No persisted compliance flag or shared cross-form classifier | Define required forms and source-specific qualifying statuses before coding |
| Applicable ULB population | Existing XVI-FC services use `state + isActive`; ULB also has publish, approval, type, and UT-related data | Confirm denominator filters before Phase 2 |
| ULB registration DONE | ULB master has approval/active status but no State/year task form | Define whether all active ULBs must be approved and how year applies |
| Annual/provisional completeness | Submission uses FormJson-required IDs but does not enforce a fixed audited/provisional document count in the schema | Define whether section status `3` alone is sufficient for dashboard compliance |
| PFMS verification | `verifyIfscCode` is a TODO/stub returning no verified details | Define whether status `3` is sufficient or future verification is required |
| SFC DONE | Final submit writes `5`; common terminal helper recognizes only `7` | Select the qualifying dashboard status |
| Elected-ULB DONE | Final submit writes `5` after validation | Confirm whether `5 + VALID` is DONE or acknowledgement `7` is required |
| Devolution DONE | Two installment records are modeled, but installment 2 is deliberately locked pending claims | Define whether installment 1 alone can complete the task and how installment 2 affects it |
| State FC unspent condition | Current unspent source is ULB/year only | Confirm that this is not a separate State condition |
| Released/unclaimed/available amounts | No corresponding amount source or formula is implemented | Do not derive these values without an approved definition |
| State/year activation filters | Fields exist but are inconsistently enforced | Decide required `isActive`, `isPublish`, and `accessToXVFC` predicates |
| MoHUA cross-State access | Permission map grants dashboard view; State-service access helpers reject MoHUA | Approve one access policy before route implementation |

## 10. Decisions required before Phase 2

1. Confirm whether dashboard readers are ADMIN plus matching STATE only, or whether MoHUA may read every State.
2. Confirm whether the route requires `VIEW_DASHBOARDS`, `VIEW_STATUS_REPORTS`, or both.
3. Confirm State/Year activation rules: `State.isActive`, `State.isPublish`, `State.accessToXVFC`, and `Year.isActive`.
4. Confirm the applicable ULB denominator: current `{ state, isActive: true }` only, or also publish, approval, type, UT, or other filters.
5. Define a year-aware ULB-registration DONE rule.
6. Confirm that allocated amount is `basic + performance` and that the response exposes the stored crore value unchanged.
7. Confirm temporary claimed amount `0` and how the contract indicates that its source is unavailable.
8. Select DONE statuses for SFC, elected-ULB, and each required devolution installment.
9. Confirm whether devolution installment 2 participates before claim functionality exists.
10. Define ULB compliance: required form set, qualifying status per source, handling of missing SLB, and exemption behavior.
11. Decide whether annual/provisional status `UNDER_REVIEW_BY_STATE` is sufficient or whether later review/acknowledgement states must be added first.
12. Decide whether PFMS status `3` is sufficient while IFSC verification is not implemented.
13. Decide whether unspent `SUBMITTED` is eligible/compliant or merely under review.
14. Define dashboard bucket treatment for shared statuses `0`, `4`, `5`, `6`, and `7`.
15. Select the source/default behavior for grant type.

## 11. Files created or modified

- Created `src/module/xvi-fc/state/dashboard/state-dashboard-phase-1-audit.md`.
- No application source, schema, controller, service, DTO, module, test, frontend, or index file was modified.

## 12. Validation performed

- Inspected the requested XVI-FC, State, ULB, schema, auth, shared-status, FormJson, and master areas.
- Searched the full `src` tree for claim letters, claimed amounts, grant type, Service Level Benchmarks, exemptions, instalments, compliance, and form-status usage.
- Cross-checked schema fields, explicit collections, model registrations, unique/compound indexes, service queries, workflow transitions, and authorization helpers.
- Confirmed the backend worktree was clean before creating this document.
- Documentation-only phase: no build/test execution is required to validate runtime behavior because no executable code changed.

## 13. Phase status

Completed phases: Phase 1

Remaining phases: Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, Phase 9, Phase 10
