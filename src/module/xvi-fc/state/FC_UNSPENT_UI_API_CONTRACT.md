# FC Unspent Declaration — UI-to-API Contract

Status: **UI-side contract only, mock-backed.** No FC Unspent backend endpoint exists yet.
`FcUnspentDeclarationService` (`fc-unspent-declaration.service.ts`) implements every method against
local mock fixtures wrapped in `of(...).pipe(delay(300))`, each with a `TODO(backend)` comment naming
the expected real route. Nothing described below as a "response"/"payload" has been confirmed against
a real backend — it is what the UI currently sends/expects, for backend review.

All types referenced here live in `fc-unspent-declaration.models.ts`.

## 1. GET preview response — `FcUnspentDeclarationData`

`FcUnspentDeclarationService.getPreview(stateId, yearId)` — TODO route:
`GET xvi-fc/state/fc-unspent-declaration/${stateId}/${yearId}`.

Deliberately **excludes `ulbOptions`** — see §3.

```jsonc
{
  "stateName": "Sample State",
  "applicableFc": "14TH_FC",
  "threshold": 10,
  "currentFormStatus": 2, // FORM_STATUS.IN_PROGRESS — always the numeric FORM_STATUS value, never a raw label string
  "permissions": {
    "canView": true,
    "canEdit": true,
    "canSaveDraft": true,
    "canFinalSubmit": true,
  },
  "dependency": {
    "devolutionStatus": 5, // FORM_STATUS.UNDER_REVIEW_BY_MOHUA, or null if no Devolution submission exists yet
    "devolutionDatasetExists": true,
    "editableDueToDevolutionReturn": false,
    "blockingMessage": null,
  },
  "actors": [
    {
      "action": "Created by",
      "designation": "State DMA Officer",
      "by": "user@example.com",
      "date": "2026-07-13T13:06:49.890Z",
    },
  ],
  "questions": [
    /* ConditionalFieldConfig[] — unchanged, existing dynamic-form shape */
  ],
  "unspentUlbData": [
    {
      "slNo": 1,
      "ulbId": "66a000000000000000000001",
      "censusCode": "800123",
      "sbCode": null,
      "ulbName": "Sample Municipal Corporation",
      "allocationAmount": 20,
      "unspentAmount": 1.5,
      "allocationPerc": 7.5,
      "eligibility": true,
    },
  ],
}
```

Envelope: `{ success: boolean, message: string, data: <above> }` — matches
`SfcStatusApiResponse`/`XviFcApiResponse<T>`'s pattern of `{success, data}`; `message` is kept since
`SfcStatusApiResponse` includes it (`XviFcApiResponse<T>` in devolution-formula does not — see
§7 CONTRACT DECISION REQUIRED #6 for the `timestamp` field, which is also absent).

## 2. Permission meanings (`FcUnspentPermissions`) — authoritative, never re-derived by the UI

| Field            | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `canView`        | State may view this page at all.                                                                          |
| `canEdit`        | Form fields and the ULB table are interactive.                                                            |
| `canSaveDraft`   | The "Save" button is enabled. **New gate** — sfc-status/devolution-formula have no equivalent; see §7 #1. |
| `canFinalSubmit` | The "Final Submit" button renders and is enabled.                                                         |

The component (`fc-unspent-declaration.component.ts`) reads these four booleans directly for every
gating decision (`[disabled]` bindings, whether the Final Submit button renders at all). It never
inspects `currentFormStatus` or `dependency` to compute a gate — those are backend-owned and must
already be folded into `permissions` by the time the response reaches the UI.

## 3. Lazy ULB-options — `FcUnspentUlbOption[]`

`FcUnspentDeclarationService.getUlbOptions(stateId, yearId)` — TODO route:
`GET xvi-fc/state/fc-unspent-declaration/${stateId}/${yearId}/ulb-options`.

**Called at most once per page session, only on real edit intent** (a ULB `<select>` gains focus, or
"Add ULB" is clicked) — never on page load, never for a No-branch session, never for a read-only view.
An already-saved row renders its `ulbName`/`censusCode`/`sbCode`/`allocationAmount` from its own
snapshot in `unspentUlbData` (§1), not from this list — so viewing a submitted Yes-branch declaration
never triggers this call either. This matters for states with hundreds of ULBs (e.g. UP).

Query contract (`FcUnspentUlbOptionsQuery`, defined but **not yet threaded through** the service
method — no pagination/search UI exists yet in this phase):

```ts
{ stateId: string; yearId: string; search?: string; page?: number; limit?: number }
```

Response — array of:

```jsonc
{
  "ulbId": "66a000000000000000000001",
  "censusCode": "800123",
  "sbCode": null,
  "ulbName": "Sample Municipal Corporation",
  "allocationAmount": 20,
}
```

Constraints the backend must enforce:

- Options are **State-scoped** (the requesting state's ULBs only).
- Only **active registry ULBs** are returned.
- `allocationAmount` comes from the state's **current active Installment 1 Devolution dataset**.
- A ULB with a missing or non-positive allocation must **not** be returned as a selectable option —
  the UI has no client-side fallback for this and treats every returned option as selectable.
- The backend remains authoritative for `allocationAmount`; the UI's `allocationPerc`/eligibility
  preview (`unspent-ulb-table.component.ts`) is feedback only.

## 4. Save-draft / final-submit payload — `FcUnspentSavePayload`

Envelope matches `SfcStatusDraftPayload`/`SfcStatusFinalSubmitPayload`
(`{ stateId, yearId, data }`, identical shape for both draft and final submit — the endpoint called
decides which action it is):

```ts
interface FcUnspentSavePayload {
  stateId: string;
  yearId: string;
  data: FcUnspentSaveData;
}
```

### No branch

```jsonc
{
  "stateId": "state-1",
  "yearId": "year-1",
  "data": {
    "isFcUnspent": "no",
    "fcDeclaration": {
      /* UploadedFileMetadata — owned by the shared dynamic-form file control */
    },
  },
}
```

### Yes branch

```jsonc
{
  "stateId": "state-1",
  "yearId": "year-1",
  "data": {
    "isFcUnspent": "yes",
    "unspentUlbData": [
      { "ulbId": "66a000000000000000000001", "unspentAmount": 1.5 },
      { "ulbId": "66a000000000000000000002", "unspentAmount": 1.2 },
    ],
    "checkboxConfirmation": true,
  },
}
```

Row rules (`buildPayload()` in `fc-unspent-declaration.component.ts`):

- Every row is whitelisted to exactly `{ ulbId, unspentAmount }` — never `getRawValue()`'s full shape.
- Rows with a null `ulbId` or null `unspentAmount` (an incomplete, not-yet-filled-in row) are dropped
  before sending, even for `saveAsDraft`.

**`isFcUnspent` is sent as the radio field's own live value, `'yes' | 'no'`** — the dynamic-form radio
control never holds a boolean. See §7 CONTRACT DECISION REQUIRED #2.

## 5. Backend-owned fields — never trusted from client state

The UI never reads these from its own form state when building a payload; they are documented here so
backend review can confirm nothing is missing:

- `applicableFc`, `threshold`
- The entire `dependency` object (`devolutionStatus`, `devolutionDatasetExists`,
  `editableDueToDevolutionReturn`, `blockingMessage`)
- Per-row: `ulbName`, `censusCode`, `sbCode`, `allocationAmount`, `allocationPerc`, `eligibility`
- Any future MoHUA row-review fields (§7 #3–#5) — not yet modeled, but flagged now as backend-owned
  by construction once they exist

## 6. Devolution dependency scenarios

`dependency` (§1) is for **display only** — a status label plus `blockingMessage`. The UI never
recomputes `permissions` from it. Six mock scenarios exist in
`fc-unspent-declaration.mock-scenarios.ts` for testing:

| Scenario                                         | `devolutionStatus`            | `devolutionDatasetExists` | `canEdit` | `canSaveDraft` | `canFinalSubmit` | `blockingMessage` |
| ------------------------------------------------ | ----------------------------- | ------------------------- | --------- | -------------- | ---------------- | ----------------- |
| `FC_UNSPENT_SCENARIO_DEVOLUTION_UNDER_REVIEW`    | `UNDER_REVIEW_BY_MOHUA`       | true                      | true      | true           | true             | null              |
| `FC_UNSPENT_SCENARIO_DEVOLUTION_RETURNED`        | `RETURNED_BY_MOHUA`           | true                      | true      | true           | **false**        | set               |
| `FC_UNSPENT_SCENARIO_MISSING_DEVOLUTION_DATASET` | null                          | **false**                 | **false** | **false**      | **false**        | set               |
| `FC_UNSPENT_SCENARIO_READONLY_SUBMITTED`         | `UNDER_REVIEW_BY_MOHUA`       | true                      | **false** | **false**      | **false**        | null              |
| `FC_UNSPENT_SCENARIO_YES_BRANCH_WITH_ROWS`       | (alias of `..._UNDER_REVIEW`) |                           |           |                |                  |                   |
| `FC_UNSPENT_SCENARIO_NO_BRANCH_SAVED`            | `UNDER_REVIEW_BY_MOHUA`       | true                      | true      | true           | true             | null              |

When `dependency.blockingMessage` is non-null, the component renders it verbatim in a Bootstrap
`alert alert-warning` banner (`data-cy="fc-unspent-declaration-dependency-alert"`), mirroring the
existing pattern in `devolution-formula.component.html`'s installment-lock banner. The banner never
computes its own message from raw status.

Existing saved rows (`unspentUlbData`) remain visible and rendered regardless of whether final submit
is currently blocked — blocking `canFinalSubmit` never clears or hides them.

## 7. CONTRACT DECISION REQUIRED

Items below are genuinely undecided — nothing in this repository establishes a naming precedent for
them, confirmed by full-repo search. They are **not implemented** as model fields; implementing them
now would mean guessing names, which was explicitly out of scope for this phase.

1. **`canSaveDraft` is a new permission with no sibling-form precedent.** `sfc-status`/
   `devolution-formula` only expose `canView`/`canEdit`/`canFinalSubmit` (confirmed — zero repo-wide
   matches for `canSaveDraft` before this change). Confirm the backend will genuinely distinguish
   "may keep editing / save a draft" from "may edit" as two independent gates, since every other form
   in this codebase treats them as one (`canEdit`).
2. **`isFcUnspent` value type.** This contract sends the radio control's live string value
   (`'yes' | 'no'`), matching the field's own option ids. Confirm the backend accepts the string form
   rather than expecting a boolean.
3. **Row-level MoHUA review state** (e.g. pending/approved/rejected per row) — no enum with this
   purpose exists anywhere in the repo. The closest analogs (`EulbRowValidationStatus`,
   `EulbPostUpdateValidationState`) are client-side data-validity/staleness concepts, not an
   approval workflow, and are not reusable as-is.
4. **Rejection remarks field name.** No `rejectionRemarks` exists anywhere. The one legacy precedent,
   `rejectMessage` (`admin/xvi-fc-review/approve-reject-form.service.ts`), belongs to a different,
   older admin review flow and is not clearly intended for reuse here.
5. **Per-row editability, "allocation changed after Devolution resubmission", and "requires
   re-review" flags** — none exist anywhere in the repo, at the row level or otherwise. The only
   structurally similar precedent is `EulbPostUpdateValidationState`'s `STALE` value (a client-only
   "needs re-check" signal), which is a reusable _pattern_ (an extra enum state) but not a reusable
   _name_ for this domain.
6. **`FcUnspentDeclarationPreviewResponse` omits `timestamp`**, unlike `SfcStatusApiResponse`
   (`{success, message, data, timestamp}`) and `XviFcApiResponse<T>` (`{success, data, timestamp}`).
   Confirm whether the real response should include one.
7. **Missing-Devolution-dataset scope.** This phase locks the _entire_ form
   (`canEdit`/`canSaveDraft`/`canFinalSubmit` all `false`) rather than only disabling ULB row actions,
   on the reasoning that unspent-amount entry is meaningless without an allocation to validate
   against. If the backend intends a narrower lock (e.g. still allow the No-branch declaration to be
   saved without a Devolution dataset), a separate flag distinct from `canEdit` would be needed —
   currently there isn't one.

## 8. Declaration-template download (No branch only)

`GET xvi-fc/state/fc-unspent-declaration/${stateId}/${yearId}/declaration-template`

Returns a private, signed, single-use-window download URL for the design-year-specific FC Unspent
declaration DOCX template. This is what the No-branch `fcDeclaration` file field's
`download-template` supporting action calls — the action's `visible` flag is server-hydrated
(`permissions.canEdit && templateConfiguredForDesignYear`) on every GET response, so the UI never
needs to compute this itself.

```jsonc
{
  "success": true,
  "data": {
    "fileName": "FC-Unspent-Declaration-2026-27.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "url": "https://.../file/download?signature=...",
  },
}
```

Rules:

- Requires `EDIT_STATE_FORMS`; State (own state only) or Admin access — same `assertStateAccess` as
  every other route in this module.
- Available only while the form is effectively editable: the same `permissions.canEdit` computed for
  State GET (role/scope + access + `NOT_STARTED`/`IN_PROGRESS`/`RETURNED_BY_MOHUA` form status + the
  Devolution dependency gate). Blocked once `UNDER_REVIEW_BY_MOHUA` or
  `SUBMISSION_ACKNOWLEDGED_BY_MOHUA`. A missing parent form behaves like `NOT_STARTED`.
- The URL is a private, signed `/file/download?signature=...` link (existing `FileTokenService`) —
  the response never includes the raw S3 key, bucket name, or storage base URL.
- One DOCX template per design year, explicitly configured server-side — there is **no fallback**
  from one year to another. An unconfigured design year returns a `fcDeclaration` field error
  ("The declaration template is not configured for the selected design year."), not another year's
  file.
- `fileName`/`mimeType` are backend-owned; never accepted from the client.

## 9. Not built in this phase

- Real HTTP endpoints (`FcUnspentDeclarationService` remains fully mock-backed).
- Pagination/search UI for ULB options (`FcUnspentUlbOptionsQuery` is defined but unused).
- Per-ULB MoHUA review UI (blocked on §7 #3–#5).
- Devolution resubmission reconciliation (recalculating `allocationPerc`/`eligibility` when
  Devolution allocations change after a Devolution resubmission).
- Backend field-level validation-error mapping (`sfc-status.component.ts`'s `applyApiErrors` is the
  existing pattern to follow once a real backend returns structured errors).
