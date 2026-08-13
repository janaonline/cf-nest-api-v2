# XVI-FC State Dashboard API

## Purpose

This module supplies one aggregated, read-only State Dashboard response for XVI-FC State users. It combines State context, grant metrics, State tasks, ULB submission progress, form completion, compliance, and claim-letter display metadata without calling internal HTTP endpoints.

## Endpoint

```http
GET /api/v2/xvi-fc/state/:stateId/:yearId/dashboard
```

## Authentication and authorization

- JWT authentication is applied by the global authentication guard.
- The route requires `VIEW_STATUS_REPORTS`.
- State-scoped users may access only their assigned State.
- ADMIN may request an explicit active State.
- ULB, MoHUA, missing, and currently unsupported scopes are rejected.

## Route parameters

- `stateId` — MongoDB ObjectId of the State.
- `yearId` — MongoDB ObjectId of the XVI-FC design year.

Both parameters are validated by `GetStateDashboardParamsDto` through the global validation pipeline.

## Response structure

The response always includes context, metrics, three State data tasks, five ULB submission buckets, five form-completion rows, and two claim-letter display rows. Array ordering and counts are fixed by dashboard constants.

```json
{
  "success": true,
  "message": "State dashboard fetched successfully",
  "data": {
    "context": {
      "stateId": "000000000000000000000001",
      "stateName": "Example State",
      "yearId": "000000000000000000000002",
      "financialYear": "2026-27",
      "userRole": "STATE",
      "grantType": null
    },
    "metrics": {
      "totalUlbs": 0,
      "allocatedAmount": 15620000000,
      "claimedAmount": 0,
      "amountUnit": "CRORE",
      "currency": "INR",
      "compliance": {
        "rate": 0,
        "compliantUlbs": 0,
        "totalUlbs": 0
      }
    },
    "stateDataTasks": [
      {
        "key": "ulb-registration",
        "title": "Register new ULBs",
        "subtitle": "Keep the state master list of 0 ULBs up to date",
        "status": "PENDING",
        "actionLabel": null,
        "route": null
      },
      {
        "key": "devolution-formula",
        "title": "Fill in the devolution formula",
        "subtitle": "Allocation and instalment split for each ULB",
        "status": "PENDING",
        "actionLabel": "Continue",
        "route": null
      },
      {
        "key": "state-conditions",
        "title": "Submit other state conditions",
        "subtitle": "SFC status and elected body confirmation",
        "status": "PENDING",
        "actionLabel": "Continue",
        "route": null
      }
    ],
    "ulbSubmissionSummary": [
      { "key": "NOT_STARTED", "label": "Not Started", "count": 0, "description": "No forms submitted yet" },
      {
        "key": "IN_PROGRESS",
        "label": "In Progress",
        "count": 0,
        "description": "Some forms are still being completed"
      },
      { "key": "UNDER_REVIEW", "label": "Under Review", "count": 0, "description": "Awaiting State or MoHUA review" },
      { "key": "ELIGIBLE", "label": "Eligible", "count": 0, "description": "All required forms are cleared" },
      {
        "key": "EXEMPTION_REQUESTED",
        "label": "Exemption Requested",
        "count": 0,
        "description": "Pending exemption review"
      }
    ],
    "formCompletion": [
      { "key": "annual-accounts", "label": "Annual Accounts", "completed": 0, "total": 0 },
      { "key": "provisional-accounts", "label": "Provisional Accounts", "completed": 0, "total": 0 },
      { "key": "pfms-bank-account", "label": "PFMS Bank Account", "completed": 0, "total": 0 },
      { "key": "fc-unspent-balance", "label": "FC Unspent Balance", "completed": 0, "total": 0 },
      { "key": "service-level-benchmarks", "label": "Service Level Benchmarks", "completed": 0, "total": 0 }
    ],
    "claimLetters": [
      {
        "key": "installment-1-batch-1",
        "title": "Generate the first Claim Letter",
        "subtitle": "Instalment 1 · Batch 1 — 0 approved ULBs ready to include",
        "installment": 1,
        "status": "LOCKED",
        "actionLabel": null,
        "lockReason": "No eligible ULBs are available for the first claim letter.",
        "route": null
      },
      {
        "key": "installment-2",
        "title": "Instalment 2 Claim Letter",
        "subtitle": "Opens after the first Instalment 1 Claim Letter is generated",
        "installment": 2,
        "status": "LOCKED",
        "actionLabel": null,
        "lockReason": "The first Instalment 1 Claim Letter has not been generated.",
        "route": null
      }
    ]
  },
  "timestamp": "2026-07-13T10:00:00.000Z",
  "requestId": "req-00000000-0000-4000-8000-000000000000"
}
```

Runtime item counts are:

- `stateDataTasks`: 3
- `ulbSubmissionSummary`: 5
- `formCompletion`: 5
- `claimLetters`: 2

## Amount handling

- Amounts are returned as raw stored numeric values.
- `amountUnit` is `CRORE` and `currency` is `INR`.
- The backend performs no crore/rupee conversion and no display formatting.
- The frontend is responsible for symbols, separators, and display labels.
- `claimedAmount` remains numeric `0` until a persisted claim source exists.

## Data-source matrix

| Dashboard field      | Source                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| State                | `State` model                                                                                                      |
| Financial year       | `Year` model                                                                                                       |
| Total ULBs           | Active `Ulb` master records for the State                                                                          |
| Allocated amount     | `GrantAllocation` / `grantAllocation` (`basic + performance`)                                                      |
| Claimed amount       | Controlled fallback `0`                                                                                            |
| Devolution task      | `DevolutionFormulaForm` / `xvifc_devolution_forms`                                                        |
| State conditions     | `XviFcSfcStatus` / `xvifc_sfc` and `ElectedUrbanLocalBodiesForm` / `xvifc_elected_ulb_forms` |
| Annual Accounts      | `XviFcAnnualAccount` / `xvifc_annualaccount_datas.auditedData.form_status_id`                                      |
| Provisional Accounts | `XviFcAnnualAccount` / `xvifc_annualaccount_datas.unauditedData.form_status_id`                                    |
| PFMS                 | `XviFcBankAccount` / `xvi_fc_bank_accounts.currentFormStatus`                                                      |
| FC Unspent Balance   | `XviFcUnspentBalanceDisclosure` / `xvi_fc_unspent_balance_disclosures.formStatus`                                  |
| SLB                  | No executable source                                                                                               |
| Exemption            | No executable source                                                                                               |
| Claim persistence    | No executable source                                                                                               |

## Status rules

- State-task completion accepts `UNDER_REVIEW_BY_MOHUA` and `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` for confirmed State forms.
- Form-completion rows accept `UNDER_REVIEW_BY_STATE`, `UNDER_REVIEW_BY_MOHUA`, and `SUBMISSION_ACKNOWLEDGED_BY_MOHUA`.
- Final ULB eligibility requires all five required forms to be `SUBMISSION_ACKNOWLEDGED_BY_MOHUA`.
- ULB classification priority is `EXEMPTION_REQUESTED`, `ELIGIBLE`, `UNDER_REVIEW`, `IN_PROGRESS`, then `NOT_STARTED`.
- `UNDER_REVIEW` requires all three required ULB submissions—audited accounts, unaudited accounts, and PFMS—to have status `UNDER_REVIEW_BY_STATE` (`3`). A partially submitted ULB remains `IN_PROGRESS`.
- FC Unspent Balance maps `DRAFT` to in-progress and `SUBMITTED` to the submitted/under-State-review category.
- Missing records and missing statuses are incomplete; returned statuses are in progress, not complete.

## Compliance

```text
compliantUlbs = eligible ULB count
rate = round(compliantUlbs / total active ULBs × 100)
```

When there are no active ULBs, the rate and compliant count are both `0`.

## Claim-letter display

- Instalment 1, Batch 1 is `AVAILABLE` only when at least one ULB is eligible; otherwise it is `LOCKED`.
- Instalment 2 remains `LOCKED` because no persisted claim-letter workflow can prove that Instalment 1 was generated.
- This module includes no claim creation, generation, approval, submission, or write API.

## Query strategy

- The frontend makes one aggregated dashboard request.
- The non-empty path is bounded at 10 MongoDB queries; the zero-active-ULB path uses 7.
- Active ULB IDs are loaded once.
- ULB form sources use one `$in` query each and never query per ULB.
- Independent State-level and ULB-form queries run in parallel only after their dependencies are available.
- Grant Allocation is loaded once and reused.
- There are no SLB, exemption, or claim-letter queries.
- The service makes no internal HTTP calls and uses no dashboard cache.

## Response envelopes

Successful dashboard data is wrapped by `xviFcSuccess()`. The shared response interceptor preserves that envelope, preserves its timestamp, and adds one request ID. A safe incoming `x-request-id` is reused; otherwise `req-{UUID}` is generated.

Errors flow through the shared exception filter and include `success: false`, HTTP status, a safe message, timestamp, request ID, and path. Structured dashboard errors use `STATE_ACCESS_DENIED`, `STATE_NOT_FOUND`, and `YEAR_NOT_FOUND`. Invalid ObjectIds are rejected by DTO validation. Unexpected database errors return a generic server error without exposing raw details.

## Known limitations

- No executable Service Level Benchmark source exists, so SLB completion is always zero and final eligibility cannot be reached from current persisted sources.
- No exemption source exists, so the exemption bucket remains zero.
- No claim-letter persistence exists, so claimed amount remains zero and Instalment 2 remains locked.
- `grantType` remains `null` because no authoritative source exists.
- No CTA/write APIs are included.
- No dashboard caching is included.

## Testing

Targeted validation commands:

```bash
npm run test -- state-dashboard.service.spec.ts
npm run test -- state-dashboard.controller.spec.ts
npm run test -- get-state-dashboard-params.dto.spec.ts
npm run test -- request-id.util.spec.ts
npm run test -- response-transform.interceptor.spec.ts
npm run test -- http-exception.filter.spec.ts
npm run build
```

Prettier and ESLint are run against all modified dashboard and shared response files. Final command results are recorded in the Phase 10 completion report.

Final targeted validation: 241 tests passed across the six dashboard, DTO, request-ID, interceptor, and exception-filter suites.

Repository-wide validation: 51 of 62 suites passed and 1,030 of 1,104 tests passed. The 11 failing suites are outside this dashboard scope and reflect existing stale expectations, missing test providers or modules, and unrelated authentication, user, annual-account, AFS-dump, master-ULB, and root XVI-FC test setup drift. The targeted dashboard and shared-response suites remain fully green.
