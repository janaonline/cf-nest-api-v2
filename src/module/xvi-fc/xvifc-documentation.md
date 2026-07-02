# XVI-FC Documentation

## Purpose

- Quick source of truth for the `src/module/xvi-fc` NestJS backend module.
- Used by LLMs/devs to understand current implementation without scanning the full project.
- Must be updated before every code push when XVI-FC backend changes are made.
- Keep updates short, technical, and bullet-based.

---

## Current Module Scope

- Main folder: `src/module/xvi-fc`
- Domain: XVI Finance Commission backend APIs.
- Current implementation includes:
  - State-level read APIs.
  - Sidebar/menu APIs.
  - Year/support-info APIs.
  - ULB annual account upload/read APIs.
  - ULB XVI-FC bank account form APIs.
  - State SFC Status form APIs (save draft, get, final submit, questions).
- Upcoming/backend pending area:
  - Remaining state-level forms (Requirements, Elected Body Status, Devolution Formula).
  - Annual account status workflow (review/approve/reject).
  - Stronger scope enforcement on annual account APIs.

---

## Module Structure

- Root module:
  - `xvi-fc.module.ts`
- Root controller/service:
  - Handles state-level/read APIs.
- Nested sub-modules:
  - `ulb/annual_accounts` — ULB annual account upload/read.
  - `ulb/bank-account` — ULB XVI-FC PFMS bank account read/submit + proof signed-url wrapper.
  - `state/sfc-status` — State SFC Status form CRUD + final submit.
  - `side-menu/` — Admin CRUD for side menu items (DB-driven).
- Cache layer:
  - `cache/xvi-fc-cache.service.ts` — Redis get/set/delete/deleteByPattern wrapper.
  - `cache/xvi-fc-cache.interceptor.ts` — HTTP response cache interceptor; TTL set via `@XviFcCacheTTL()` decorator.
- Shared schemas:
  - Located outside module under `src/schemas/xvi-fc/`.
  - State form schemas under `src/schemas/xvi-fc/state/`.
  - ULB form schemas under `src/schemas/xvi-fc/ulb/`.
  - `src/schemas/xvi-fc/xvi-fc-side-menu.schema.ts` — side menu items schema.
- Auth/RBAC:
  - No local guards/decorators inside `xvi-fc`.
  - Auth primitives imported from `src/module/auth`.

---

## Auth / RBAC Baseline

- `JwtAuthGuard` is global through `APP_GUARD`.
- Routes are authenticated by default unless marked `@Public()`.
- `PermissionGuard` is applied at controller level.
- `@RequirePermissions()` is applied at method level.
- `@CurrentUser()` extracts authenticated user.
- Access is permission-driven, not direct role-decorator driven.
- Effective permissions are built from:
  - Base role permissions.
  - User-level `permissionOverrides.allow`.
  - User-level `permissionOverrides.deny`.

---

## Current Permission Model

- Main permissions currently relevant:
  - `VIEW_STATUS_REPORTS`
  - `UPLOAD_DOCUMENTS`
  - `REVIEW_ULB_SUBMISSIONS`
  - `APPROVE_ULB_SUBMISSIONS`
  - `MANAGE_USERS`
  - `FINAL_SUBMIT_TO_STATE_DMA`
  - `FINAL_SUBMIT_TO_MOHUA`
  - `VIEW_STATE_FORMS` ← new
  - `EDIT_STATE_FORMS` ← new
  - `FINAL_SUBMIT_STATE_FORMS` ← new

- Current active route usage:
  - Read/status/sidebar APIs use `VIEW_STATUS_REPORTS`.
  - Annual account POST/GET currently use `UPLOAD_DOCUMENTS`.
  - Bank account GET uses `VIEW_STATUS_REPORTS`.
  - Bank account submit and proof signed-url use `UPLOAD_DOCUMENTS`.
  - SFC Status GET and questions use `VIEW_STATE_FORMS`.
  - SFC Status save draft uses `EDIT_STATE_FORMS`.
  - SFC Status final submit uses `FINAL_SUBMIT_STATE_FORMS`.

---

## Current Roles

- `ULB`
- `ULB_EDITOR`
- `ULB_VIEWER`
- `STATE`
- `STATE_EDITOR`
- `STATE_VIEWER`
- `ADMIN`

Role → State Form permissions:

| Role         | VIEW_STATE_FORMS | EDIT_STATE_FORMS | FINAL_SUBMIT_STATE_FORMS |
| ------------ | ---------------- | ---------------- | ------------------------ |
| STATE        | ✅               | ✅               | ✅                       |
| STATE_EDITOR | ✅               | ✅               | ❌                       |
| STATE_VIEWER | ✅               | ❌               | ❌                       |
| ADMIN        | ✅               | ✅               | ✅                       |

Known note:

- `MOHUA` and `DOE` appear in sidebar/menu context but are not currently part of the active JWT `UserRole` enum.

---

## Current Route Summary

### XVI-FC Root APIs

- `GET /xvi-fc/state/:stateId`
  - Permission: `VIEW_STATUS_REPORTS`
  - Returns state-wise data.
  - Has state-scope restriction in service.

- `GET /xvi-fc/sidebar/:role?yearId=<id>`
  - Permission: `VIEW_STATUS_REPORTS`
  - Query param `yearId` (required) — ObjectId of the year.
  - Returns role-specific sidebar menu fetched from MongoDB (`xvifc_side_menus` collection, `isActive: true`).
  - Response cached in Redis for 600 s (key: `xvifc:cache:/xvi-fc/sidebar/<role>?yearId=<id>`).
  - Cache is invalidated automatically on any write to the side-menu collection for that role+year.
  - Uses `MenuRole` type (`ULB | STATE | MOHUA | DOE | ADMIN`) defined in the schema.

- `GET /xvi-fc/years`
  - Permission: `VIEW_STATUS_REPORTS`
  - Returns hardcoded year range currently around 2026–2031.

- `GET /xvi-fc/ulb/:ulbId`
  - Permission: `VIEW_STATUS_REPORTS`
  - Returns ULB name and state name.

- `GET /xvi-fc/state-info/:stateId`
  - Permission: `VIEW_STATUS_REPORTS`
  - Returns state name.

- `GET /xvi-fc/support-hours`
  - Permission: `VIEW_STATUS_REPORTS`
  - Returns next support-hour slots.

### Side Menu Admin APIs (`/xvi-fc/side-menu`)

All require `MANAGE_USERS` permission. Swagger tag: `XVI-FC Side Menu (Admin)`.

- `GET /xvi-fc/side-menu` — list all items; optional query `role`, `yearId`, `includeInactive`.
- `GET /xvi-fc/side-menu/:id` — get one item by MongoDB `_id`.
- `POST /xvi-fc/side-menu` — create a single item.
- `POST /xvi-fc/side-menu/bulk` — create one or many items in one call; body is a raw JSON array.
- `PATCH /xvi-fc/side-menu/:id` — update any field (partial `UpdateSideMenuDto`).
- `PATCH /xvi-fc/side-menu/:id/toggle` — flip `isActive` true↔false.
- `DELETE /xvi-fc/side-menu/:id` — delete one item.

All write operations (create/bulk-create/update/toggle/delete) invalidate the Redis cache for the affected `role+year` pair.

- `DELETE /xvi-fc/admin/cache?pattern=<url-pattern>`
  - Permission: `MANAGE_USERS`, ADMIN scope only.
  - Clears Redis cache matching the URL pattern (SCAN-based, non-blocking).
  - Omit `pattern` to clear all `xvifc:cache:*` keys.

### Annual Account APIs

- `GET /xvi-fc/annual-account/upload-config/:type?yearId=<designYearId>`
  - Permission: `UPLOAD_DOCUMENTS`
  - `type`: `audited` (formId 30) or `provisional` (formId 31).
  - `yearId`: ObjectId of the XVI-FC design year (e.g. 2026-27).
  - Returns `{ meta, data[] }` from the active `formjsons` document for that year and formId.
  - `meta` contains: `uploadType`, `description`, `confirmLabel`, `documentYearId`, `documentYear`.
  - `data[]` is an array of `FieldConfig` file fields (one per upload document).
  - **Must be declared before `GET /:id`** in the controller to avoid NestJS matching "audited"/"provisional" as ObjectIds.

- `POST /xvi-fc/annual-account/upload`
  - Permission: `UPLOAD_DOCUMENTS`
  - Uploads a single PDF document (multipart); upserts the document slot in the annual account.

- `GET /xvi-fc/annual-account/by-ulb/:ulbId/:designYearId`
  - Permission: `UPLOAD_DOCUMENTS`
  - Returns current annual account status for a ULB + design year.

- `POST /xvi-fc/annual-account/:id/submit`
  - Permission: `UPLOAD_DOCUMENTS`
  - Body: `{ section: 'auditedData' | 'unauditedData' }`.
  - Validates that all docIds in the **active formjson config** for this section have `processingStatus === 'PASSED'`.
  - DocIds present in the annual account but absent from the current formjson config are ignored (handles temporarily hidden documents).
  - Sets `form_status → UNDER_REVIEW_BY_STATE`.

- `GET /xvi-fc/annual-account/:id/status`
  - Permission: `UPLOAD_DOCUMENTS`
  - Polling endpoint for OCR processing status.

- `POST /xvi-fc/annual-account/:id/documents/:uploadId/retry`
  - Permission: `UPLOAD_DOCUMENTS`
  - Retries OCR for a FAILED upload.

- `GET /xvi-fc/annual-account/:id/documents/:uploadId/signed-url`
  - Permission: `UPLOAD_DOCUMENTS`
  - Returns a pre-signed S3 URL for file preview.

### XVI-FC Bank Account APIs

Module path:

- `src/module/xvi-fc/ulb/bank-account/`

Schema:

- Path: `src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema.ts`
- Collection: `xvi_fc_bank_accounts`
- Unique index: `{ ulb: 1, designYear: 1 }`

Routes:

- `GET /xvi-fc/bank-account?yearId={designYearId}&ulbId={ulbId}`
  - Permission: `Permission.VIEW_STATUS_REPORTS`
  - Returns the safe bank-account response or `null`.
  - `ulbId` may be omitted by ULB-scope users; service resolves it from the authenticated user.

- `POST /xvi-fc/bank-account`
  - Permission: `Permission.UPLOAD_DOCUMENTS`
  - Upserts by `{ ulb, designYear }`.
  - Final ULB submit transition: `FORM_STATUS.UNDER_REVIEW_BY_STATE`.
  - Stores `submittedBy` and `submittedAt`.

- `POST /xvi-fc/bank-account/proof/signed-url`
  - Permission: `Permission.UPLOAD_DOCUMENTS`
  - Generates a bank-account-proof S3 PUT signed URL using the server-side XVI-FC folder resolver.

Scope rules:

- `ULB` / `ULB_EDITOR`
  - Can read and submit only own ULB.
  - Can generate proof signed URL only for own ULB.
- `ULB_VIEWER`
  - Can read own ULB when effective permissions allow.
  - Cannot submit.
  - Cannot generate proof signed URL.
- `STATE` / `STATE_EDITOR` / `STATE_VIEWER`
  - Can read only ULBs belonging to own state when read is enabled.
  - Cannot submit bank-account form.
  - Cannot generate proof signed URL.
- `ADMIN`
  - Can read, submit, and generate proof signed URL for an explicit requested ULB.
- Unsupported scope
  - Rejected.

POST request payload:

```ts
{
  ulbId: string;
  designYearId: string;
  ifscCode: string;
  accountNumber: string;
  confirmAccountNumber: string;
  bankDetails: {
    name: string;
    branch: string;
    address: string;
    city: string;
    state?: string;
    micr: string | null;
  };
  proof: {
    fileName: string;
    fileUrl: string;
    fileSize: number | null;
    mimeType: string;
  };
}
```

Proof object rule:

- Use only SFC-style file objects:

```ts
{
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string;
}
```

- Do not use `filepath`, `originalName`, or `sizeKb`.
- `fileUrl` is the uploaded S3 URL.

Proof signed-url flow:

- Endpoint: `POST /xvi-fc/bank-account/proof/signed-url`
- Folder key: `XVI_FC_BANK_ACCOUNT_PROOF`
- Final folder pattern: `xvi-fc/ulb/{ulbId}/{designYearId}/bank-account/proof`
- Allowed MIME types:
  - `application/pdf`
  - `image/jpeg`
  - `image/png`
- Max file size: `5 * 1024 * 1024` bytes.

Status handling:

- Do not use or document `formStatus: 'SUBMITTED'` for this form.
- Use `currentFormStatus: FormStatusType`.
- No bank-account record in GET/form-status: `FORM_STATUS.NOT_STARTED`.
- POST submit transition: `FORM_STATUS.UNDER_REVIEW_BY_STATE`.

Sensitive account-number handling:

- Stored fields:
  - `accountNumberEncrypted`
  - `accountNumberHash`
  - `accountNumberMasked`
  - `accountNumberLast4`
- Returned fields:
  - `accountNumberMasked`
  - `accountNumberLast4`
- Never returned:
  - `accountNumber`
  - `confirmAccountNumber`
  - `accountNumberEncrypted`
  - `accountNumberHash`
- Never store the raw account number directly.

Security helper file:

- `src/module/xvi-fc/ulb/bank-account/utils/bank-account-security.util.ts`
- Helpers:
  - `encryptAccountNumber`
  - `decryptAccountNumber`
  - `hashAccountNumber`
  - `maskAccountNumber`
  - `getAccountNumberLast4`
  - `buildSafeBankAccountResponse`
- Required env vars:
  - `BANK_ACCOUNT_ENCRYPTION_KEY`
  - `BANK_ACCOUNT_HASH_SECRET`

Form-status integration:

- Existing route: `GET /xvi-fc/form-status/:ulbId/:designYearId`
- Added block:

```ts
xviFcBankAccount: {
  currentFormStatus: FormStatusType;
  currentFormStatusLabel: string;
  form_status_id: null;
}
```

- No bank-account record: `FORM_STATUS.NOT_STARTED`.
- Existing bank-account record: `record.currentFormStatus`.
- `currentFormStatusLabel` comes from the shared form-status label helper.
- No string-only `SUBMITTED` status is returned for bank account.

IFSC verification status:

- Angular performs IFSC lookup through the backend proxy route `GET /xvi-fc/bank-account/ifsc/:ifscCode`.
- The backend proxy calls Razorpay server-side to avoid browser CORS/preflight failures.
- Bank-account submit still includes an explicit `verifyIfscCode()` placeholder.
- TODO: wire backend verification to the approved internal IFSC master or Razorpay backend verification source.
- Do not treat full submit-time backend IFSC verification as complete yet.

Tests added/updated:

- Backend:
  - `src/module/xvi-fc/ulb/bank-account/bank-account.service.spec.ts`
  - `src/module/xvi-fc/ulb/bank-account/utils/bank-account-security.util.spec.ts`
  - `src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver.spec.ts`
  - `src/module/xvi-fc/xvi-fc.service.spec.ts`
  - `src/module/xvi-fc/ulb/bank-account/dto/submit-xvi-fc-bank-account.dto.spec.ts`
- Frontend:
  - `xvi-fc-bank-account.service.spec.ts`
  - `xvi-fc-bank-account.component.spec.ts`

Known test limitations:

- Backend full `npm run test` is blocked by unrelated existing failing suites:
  - `users.service.spec.ts`
  - `otp.service.spec.ts`
  - `auth.controller.spec.ts`
  - annual-account specs
- Frontend `npm run test` is blocked by unrelated existing auth specs:
  - `forgot-password.component.spec.ts`
  - `login.component.spec.ts`
- Targeted bank-account/backend-related tests passed during Phase 10.

### SFC Status APIs

- `GET /xvi-fc/state/sfc-status/dump`
  - Permission: `VIEW_STATUS_REPORTS`
  - Query params (all optional): `stateId`, `yearId`, `status`
  - Returns `.xlsx` download of all SFC Status records.
  - ADMIN: exports all records; STATE scope: restricted to own state.
  - Columns: metadata (state, year, status, submitted/created/updated by+at) + all 15 form fields. File fields split into `_fileName`, `_fileUrl`, `_fileSize`, `_mimeType` sub-columns. `awardPeriodDuration` computed from `awardPeriod` at export time.

- `GET /xvi-fc/state/sfc-status/questions`
  - Permission: `VIEW_STATE_FORMS`
  - Returns `SFC_STATUS_QUESTIONS` config array for frontend form rendering.

- `GET /xvi-fc/state/sfc-status/:stateId/:yearId`
  - Permission: `VIEW_STATE_FORMS`
  - Returns a fully hydrated form response (see **SFC Status GET Hydration** section below).
  - State scope enforced: STATE/STATE_EDITOR/STATE_VIEWER can only access own state.
  - ADMIN bypasses scope.

- `POST /xvi-fc/state/sfc-status/save-draft`
  - Permission: `EDIT_STATE_FORMS`
  - Body: `{ stateId, yearId, data: Record<string, unknown> }`.
  - Save draft only — never performs a final submit.
  - Runs partial (draft) validation: absent normal `required` fields are allowed;
    `requiredTrue` and all format validators on provided values are enforced.
  - Persists only the sanitized visible-field payload. Hidden and `includeInPayload: false` fields are excluded.
  - Upserts by `state + year + formType`. Status → `IN_PROGRESS`.
  - Status gate: `assertCanStateEditForm` — blocked unless `NOT_STARTED`, `IN_PROGRESS`, or `RETURNED_BY_MOHUA`.
  - History action: `CREATE_DRAFT` (new record) / `UPDATE_DRAFT` (existing record).

- `POST /xvi-fc/state/sfc-status/final-submit`
  - Permission: `FINAL_SUBMIT_STATE_FORMS`
  - Body: `{ stateId, yearId, data: Record<string, unknown> }`.
  - Final submit only — never behaves like draft save.
  - Supports **one-shot submit**: a draft does not need to exist; the record is created if absent.
  - Runs full validation: all visible required fields must be present; `requiredTrue` must be satisfied.
  - Persists sanitized visible-field payload and transitions status to `UNDER_REVIEW_BY_MOHUA`.
  - Records `submittedBy` and `submittedAt`.
  - Status gate: `assertCanStateFinalSubmitForm` — blocked unless `NOT_STARTED`, `IN_PROGRESS`, or `RETURNED_BY_MOHUA`.
  - History action: `FINAL_SUBMIT`.
  - STATE users can submit only their own state. ADMIN can submit any state.
  - **Workflow rule (applies to all state forms):** STATE final-submit always transitions to `UNDER_REVIEW_BY_MOHUA` (5). `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (7) is reserved exclusively for a future MoHUA acknowledge/approval action and is never set by a state user.

---

## SFC Status GET Hydration

**Contract:** `GET /xvi-fc/state/sfc-status/:stateId/:yearId`

### Hydration rule

- **No record / Not Started:** Return `SFC_STATUS_QUESTIONS` as-is. Each question's `value` is the template default defined in the questions config.
- **Record exists:** Shallow-copy each question; replace `value` only when `record.data` has that key (checked via `Object.prototype.hasOwnProperty.call`). Missing keys keep their template default.
- O(n) — one pass over questions, no extra DB calls.

### Response shape

```ts
{
  success: true,
  message: 'SFC Status form fetched.',
  timestamp: string,          // ISO 8601
  data: {
    _id: string | null,        // null when no record exists
    formKey: 'sfc-status',
    formName: 'SFC Status',
    formType: 'STATE_FORM',
    stateId: string,
    yearId: string,
    currentFormStatus: number, // 1 = Not Started, 2 = In Progress, 5 = Under Review by MoHUA
    currentFormStatusLabel: string,
    questions: HydratedFieldConfig[],  // FormFieldConfig with guaranteed `value`
    permissions: {
      canView: boolean,
      canEdit: boolean,
      canFinalSubmit: boolean,
    },
    instructions: [],
    meta: { version: 1 },
  }
}
```

### Permissions logic

`permissions` is status-aware. All three flags are computed from three independent gates — all must pass:

1. **Role/permission** — effective permissions (base role + per-user overrides).
2. **State scope** — ADMIN bypasses; STATE users must own the requested `stateId`.
3. **Form status** — `canEdit` and `canFinalSubmit` are `false` when the current status is not in the editable set (`NOT_STARTED`, `IN_PROGRESS`, `RETURNED_BY_MOHUA`).

**When status is editable (NOT_STARTED / IN_PROGRESS / RETURNED_BY_MOHUA):**

| Role         | canView | canEdit | canFinalSubmit |
| ------------ | ------- | ------- | -------------- |
| STATE        | true    | true    | true           |
| STATE_EDITOR | true    | true    | false          |
| STATE_VIEWER | true    | false   | false          |
| ADMIN        | true    | true    | true           |

**When status is NOT editable (e.g. UNDER_REVIEW_BY_MOHUA, SUBMISSION_ACKNOWLEDGED_BY_MOHUA):**

| Role         | canView | canEdit | canFinalSubmit |
| ------------ | ------- | ------- | -------------- |
| STATE        | true    | false   | false          |
| STATE_EDITOR | true    | false   | false          |
| STATE_VIEWER | true    | false   | false          |
| ADMIN        | true    | false   | false          |

Source: `buildFormPermissions` in `sfc-status.service.ts`, using `canStateEditForm` / `canStateFinalSubmitForm` from `xvi-fc-form-status-access.util.ts`.

### Question template defaults

- `radio`, `text`, `textarea`, `date`, `select` → `''`
- `checkbox` → `false`
- `file` → `{ fileName: '', fileUrl: '', fileSize: null, mimeType: '' }`

### Types

- `HydratedFieldConfig` — `src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types.ts`
- `SfcFormPermissions`, `SfcFormGetResponseData` — `src/module/xvi-fc/state/sfc-status/sfc-status.types.ts`

---

## SFC Status Schema

### Main form collection — `xvi_fc_sfc_status_forms`

- Schema file: `src/schemas/xvi-fc/state/sfc-status.schema.ts`
- Unique index: `{ state: 1, year: 1, formType: 1 }`
- Stores only the **current/latest** form state — no embedded history.
- Status values use shared `FORM_STATUS` from `src/common/constants/form-status.constants.ts`:
  - `1 = NOT_STARTED`, `2 = IN_PROGRESS`, `5 = UNDER_REVIEW_BY_MOHUA` (state final submit), `7 = SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (MoHUA acknowledge — not yet implemented)
- `data` field: `Mixed` (flexible form data object)
- `formType` is immutable; always `'SFC_STATUS'`
- Local `SfcFormStatus` enum and `SFC_STATUS_LABELS` have been removed; use `FORM_STATUS` and `getFormStatusLabel()` throughout

### History collection — `xvi_fc_sfc_status_histories`

- Schema file: `src/schemas/xvi-fc/state/sfc-status-history.schema.ts`
- One document per status transition event.
- Fields: `sfcStatusForm` (ref), `state`, `year`, `action`, `fromStatus`, `toStatus`, `changedBy`, `changedAt`, `ip`, `userAgent`, `remarks`, `metadata`, `isActive`, `isDeleted`
- Actions: `CREATE_DRAFT`, `UPDATE_DRAFT`, `FINAL_SUBMIT`
- Indexes: `{ sfcStatusForm: 1, changedAt: -1 }`, `{ state: 1, year: 1, changedAt: -1 }`
- History insert happens after the main document update; not wrapped in a transaction — a failed history insert does not roll back the status change.

---

## SFC Status Submit Validation

Validation is driven by `SFC_STATUS_QUESTIONS` (field config array) via `DynamicFormValidationService`.
Both save-draft and final-submit evaluate **visible fields only** — hidden fields never block validation or reach the DB.

### Visibility evaluation

- Fields without `visibleWhen` are always visible.
- `visibleWhen.mode = 'all'` → every condition must hold.
- `visibleWhen.mode = 'any'` → at least one condition must hold.
- Operators: `equals`, `notEquals`, `in`, `notIn`.
- Computed server-side field `awardPeriodDuration` is injected before visibility evaluation so conditions on it resolve correctly; it is never stored (field has `includeInPayload: false`).

### Save as Draft (`POST /save-draft`)

- **Absent fields with only `required` validator** → skipped (allowed to be empty in draft).
- **Absent fields with `requiredTrue` validator** → **blocked** — a false/missing checkbox is never ignored in draft.
- **Present values** → all validators run (pattern, yearRange, minlength, maxlength, min, max, minDate, maxDate, file type/size, etc.).
- Rejects with `400 Validation failed` if any error is found.
- Persists only the sanitized visible payload (see **Payload filtering** below).

### Final Submit (`POST /final-submit`)

- All visible, payload-included fields are validated.
- Missing `required` fields produce errors.
- Missing or non-true `requiredTrue` fields produce errors.
- All format validators run as usual.
- Rejects with `400 Validation failed` if any error is found.
- Persists sanitized visible payload and transitions status to `UNDER_REVIEW_BY_MOHUA`.
- Supports one-shot submit: creates the form record if none exists (no prior draft required).

### Required fields (final submit)

Always required:

- `isActiveSfc`
- `isNewSfcConstituted`
- `checkboxConfirmation === true`

If `isActiveSfc === 'yes'`:

- `awardPeriod` (format `YYYY-YYYY`, start 2020–2026, end 2025–2032, duration 1/5/6, must include 2026)
- `whichAwardPeriod`
- `sfcReportStatus`

If duration = 1: require `sfcConstitutedForInterim`
If duration = 6: require `sfcAwardPeriodExtended`
If `sfcAwardPeriodExtended === 'yes'`: require `extensionOrder`

If `sfcReportStatus === 'toBeSubmitted'`: require `reportSubmissionDate`
If `sfcReportStatus === 'reportSubmittedAtrNotYetTabled'`: require `sfcReport`
If `sfcReportStatus === 'reportSubmittedAtrTabled'`: require `sfcReport` + `atrReport`

If `isNewSfcConstituted === 'yes'`: require `gazetteNotification`

### Payload filtering

Before every DB write (both draft and final submit):

- `buildSanitizedPayload` (on `DynamicFormValidationService`) builds the stored object.
- Excludes fields where `render === false`.
- Excludes fields where `includeInPayload === false`.
- Excludes fields hidden by `visibleWhen` conditions.
- Only includes keys that were actually present in the incoming request data.
- Result: the DB `data` field contains only visible, payload-eligible, user-provided answers.

### Validation error response shape

Errors are returned as an object keyed by field key. One field may have multiple errors (array). Frontend accesses errors in O(1): `errors['awardPeriod']`, `errors['checkboxConfirmation']`. Non-field errors use the `_form` key.

```ts
{
  statusCode: 400,
  message: 'Validation failed.',
  errors: {
    awardPeriod: [
      { field: 'awardPeriod', message: 'Enter a valid period in YYYY-YYYY format.', code: 'yearRangeFormat' }
    ],
    checkboxConfirmation: [
      { field: 'checkboxConfirmation', message: 'Please confirm before submitting.', code: 'requiredTrue' }
    ]
  },
  timestamp: string,
  path: string,
}
```

Types:

```ts
interface XviFcValidationError {
  field?: string;
  message: string;
  code?: string;
}
type XviFcValidationErrorMap = Record<string, XviFcValidationError[]>;
```

Defined in `src/module/xvi-fc/common/response/xvi-fc-api-response.ts`.

---

## Form Status Access Helpers

Status-based write gates are centralised in:

```
src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util.ts
```

Never add inline status checks inside services — call these helpers instead.

### Allowed statuses

| Actor | Operation                  | Allowed statuses                                                       |
| ----- | -------------------------- | ---------------------------------------------------------------------- |
| ULB   | Edit / save / submit       | `NOT_STARTED`, `IN_PROGRESS`, `RETURNED_BY_STATE`, `RETURNED_BY_MOHUA` |
| STATE | Edit / save / final-submit | `NOT_STARTED`, `IN_PROGRESS`, `RETURNED_BY_MOHUA`                      |

Lookups use `Set.has(status)` — O(1).

### Helper API

| Function                                | Throws               | Use when                                    |
| --------------------------------------- | -------------------- | ------------------------------------------- |
| `canUlbEditForm(status)`                | —                    | Need a boolean check for ULB edit           |
| `canUlbSubmitForm(status)`              | —                    | Need a boolean check for ULB submit         |
| `canStateEditForm(status)`              | —                    | Need a boolean check for STATE edit         |
| `canStateFinalSubmitForm(status)`       | —                    | Need a boolean check for STATE final submit |
| `assertCanStateEditForm(status)`        | `ForbiddenException` | Guard in STATE save-draft handler           |
| `assertCanStateFinalSubmitForm(status)` | `ForbiddenException` | Guard in STATE final-submit handler         |

Error messages produced by the assert helpers:

```
Form cannot be edited when status is <label>.
Form cannot be final submitted when status is <label>.
```

### Note on role vs status

`canEdit` and `canFinalSubmit` in the GET response are now the intersection of both concerns — role/permission AND form status. Both must allow the action for the flag to be `true`.

On save/final-submit routes, status is re-checked server-side (`assertCanStateEditForm` / `assertCanStateFinalSubmitForm`) regardless of what the GET response returned, so the permission flags in the GET response are informational/UI-gating only and cannot be bypassed by submitting directly.

---

## Important Access Rules

- Permission check alone is not enough.
- XVI-FC APIs must enforce permission + scope ownership.
- ULB-scoped users should access only their own ULB data.
- STATE-scoped users should access only ULBs belonging to their own state.
- ADMIN can access all relevant XVI-FC data.
- Read permissions and write permissions should be separated clearly.
- Workflow actions must validate current status before changing status.

---

## Known Gaps

- Annual account APIs need stronger ULB/state scope enforcement.
- ULB user may currently pass another `ulbId` if not checked in service.
- STATE user may access another state's ULB if not checked in service.
- `GET /annual-account/:ulbId/:yearId` currently uses `UPLOAD_DOCUMENTS`; may need read permission instead.
- `STATE` role lacks `UPLOAD_DOCUMENTS`, while `STATE_EDITOR` has it.
- Review/approve/final-submit permissions on annual accounts are defined but not yet used.
- Annual account status enum exists but transition APIs are missing.
- Year API is hardcoded and depends on DB year format.
- Sidebar route accepts role param instead of deriving from authenticated user/scope.
- Remaining state forms (Requirements, Elected Body Status, Devolution Formula) are visible in frontend/sidebar but backend APIs are pending.

---

## Cross-Branch Merge Notes

### Merge: `feat/xvi-fc-communication-center` (merged 2026-06-15)

Three new top-level modules were merged in:

- `FormsModule` (`src/forms/`) — generic ULB→State→MoHUA form workflow engine
- `CommunicationModule` (`src/communication/`) — message threads between org tiers
- `NotificationsModule` (`src/notifications/`) — in-app notification delivery

**None of these touch `src/module/xvi-fc`.** They are currently independent.

#### Status value alignment — resolved

The XVI-FC SFC form now uses the shared `FORM_STATUS` constants from `src/common/constants/form-status.constants.ts`. Final submit sets status to `FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA = 7`. The previously used value `6` (which maps to `RETURNED_BY_MOHUA` in the shared enum) is no longer used by SFC Status. The local `SfcFormStatus` enum and `SFC_STATUS_LABELS` have been removed from the schema file.

#### Two AuthUser interfaces — do not unify without preserving XVI-FC fields

| Interface   | File                                           | Used by                                               |
| ----------- | ---------------------------------------------- | ----------------------------------------------------- |
| `AuthUser`  | `src/module/auth/auth-user.interface.ts`       | XVI-FC module, PermissionGuard, SfcStatusService      |
| `IAuthUser` | `src/common/interfaces/auth-user.interface.ts` | FormsModule, CommunicationModule, NotificationsModule |

`AuthUser` carries `scope`, `accessLevel`, and `permissionOverrides` — all required by XVI-FC RBAC guards. `IAuthUser` does not include these. Do not merge or replace `AuthUser` with `IAuthUser` without first moving those fields across.

#### JWT refresh secret bug — fixed

The merged `JwtRefreshStrategy` used `JWT_SECRET` as `secretOrKey` instead of `JWT_REFRESH_SECRET`. This was fixed in `src/module/auth/strategies/jwt-refresh.strategy.ts` — the strategy now reads `JWT_REFRESH_SECRET` and fails fast at startup if it is not configured.

---

## Upcoming State Forms

Frontend/sidebar already references:

- Requirements — not a form; visual/overview. No backend API needed yet.
- SFC Status — ✅ implemented.
- Elected Body Status — backend pending.
- Devolution Formula — backend pending.

---

## Dynamic Form Validator (XVI-FC Common)

Location: `src/module/xvi-fc/common/dynamic-form-validation/`

- `dynamic-form-validation.types.ts` — all shared types: `FormFieldConfig`, `VisibleWhen`, `ValidationResult`, `XviFcValidationErrorMap`, `YearRangeValidatorConfig`, etc.
- `dynamic-form-validation.service.ts` — `DynamicFormValidationService`
- Provided and exported by `XviFcCommonModule`.
- Future state form modules import `XviFcCommonModule` to reuse.

### Validation modes

- `validateDraft(questions, data)` — validates only **present** fields; absent fields skipped.
- `validateFull(questions, data)` — validates all **visible** + required fields.

### Supported validators

`required`, `requiredTrue`, `nullValidator`, `pattern`, `min`, `max`, `minDate`, `maxDate`, `minlength`, `maxlength`, `email`, `yearRange`

### Visibility engine

- `visibleWhen.mode: 'all'` — all conditions must match.
- `visibleWhen.mode: 'any'` — at least one condition must match.
- Operators: `equals`, `notEquals`, `in`, `notIn`.

### Computed fields (backend-injected)

- `awardPeriodDuration` — derived from `awardPeriod` string (e.g., `2021-2026` → `5`).
- Never trusted from frontend. Injected before validation via `injectComputedFields()`.

### yearRange validator config

```ts
{
  (startYearMin,
    startYearMax,
    endYearMin,
    endYearMax,
    requireEndGreaterThanStart,
    allowedDurations,
    requiredIncludedYear);
}
```

### File validation

- Checks `fileName` and `fileUrl` on full submit.
- `allowedFileTypes: ['pdf']` — validates by extension or MIME type.
- `maxFileSize` (MB) — validated only if `fileSize` is provided.

### Date validators

- Fixed: `'YYYY-MM-DD'`
- Relative: `'TODAY+0D'`, `'TODAY+30D'`, `'TODAY-7D'`

### Error shape

```ts
{
  field: string;
  message: string;
  code: string;
}
```

---

## XVI-FC API Response

Location: `src/module/xvi-fc/common/response/`

- `xvi-fc-api-response.ts` — types `XviFcApiResponse<T>`, `XviFcValidationError`.
- `xvi-fc-response.util.ts` — `xviFcSuccess()`, `throwXviFcValidationError()`.

### Success shape

```ts
{ success: true, message: string, data: T, meta?: Record<string, unknown> }
```

The global `ResponseTransformInterceptor` passes this through unchanged because `success` is already present.

### Validation error

Thrown as `BadRequestException({ message: 'Validation failed.', errors: { fieldKey: [...] } })`.
The global `HttpExceptionFilter` forwards `message` and `errors` into the 400 response body.
`errors` is a `Record<string, XviFcValidationError[]>` keyed by field key; non-field errors use `_form`.

### Applied to

All new SFC Status APIs (questions, get form, save draft, final submit).

---

## Documentation Update Rule

Before every code push involving XVI-FC backend changes:

- Append a short entry under `Change Log`.
- Mention only important implementation details.
- Include changed files/modules.
- Include new/changed routes.
- Include permission/RBAC changes.
- Include schema/DTO changes.
- Include workflow/status changes.
- Include known gaps or follow-ups.
- Do not write long paragraphs.
- Do not duplicate existing content.

---

## Change Log

### Initial Baseline

- Added initial summary for current `src/module/xvi-fc` implementation.
- Captured current module structure, routes, RBAC flow, permissions, roles, and known gaps.

---

### SFC Status Backend (State Form v1)

**New permissions added** (`src/module/auth/enum/roles-xvi-fc.enum.ts`):

- `VIEW_STATE_FORMS`, `EDIT_STATE_FORMS`, `FINAL_SUBMIT_STATE_FORMS`

**Permission map updated** (`src/module/auth/permissions.map.ts`):

- `STATE`: view + edit + final submit
- `STATE_EDITOR`: view + edit
- `STATE_VIEWER`: view only
- `ADMIN`: all (via `Object.values(Permission)`)

**New schema** (`src/schemas/xvi-fc/state/sfc-status.schema.ts`):

- Collection: `xvi_fc_sfc_status_forms`
- Unique index: `{ state, year, formType }`
- Status: 1 (Not Started), 2 (In Progress), 6 (Final Submitted)
- Embedded `statusHistory` array

**New module** (`src/module/xvi-fc/state/sfc-status/`):

- `sfc-status.module.ts` — registers schema, controller, service
- `sfc-status.controller.ts` — 4 routes
- `sfc-status.service.ts` — scope checks, draft upsert, final submit + conditional validation
- `dto/save-sfc-status.dto.ts` — `SaveSfcStatusDto` with nested `SfcStatusDataDto`
- `constants/sfc-status.constants.ts` — award period validation ranges
- `constants/sfc-status.questions.ts` — `SFC_STATUS_QUESTIONS` config for frontend

**XviFcModule updated** (`src/module/xvi-fc/xvi-fc.module.ts`):

- Imports `SfcStatusModule`

**Routes added**:

- `GET /xvi-fc/state/sfc-status/questions`
- `GET /xvi-fc/state/sfc-status/:stateId/:yearId`
- `POST /xvi-fc/state/sfc-status`
- `PATCH /xvi-fc/state/sfc-status/:id/final-submit`

**Follow-ups**:

- Award period validation in `sfcReport` DTO duplicate question keys for multi-condition dependsOn need frontend alignment.
- Remaining state forms (Elected Body Status, Devolution Formula) still pending.

---

### SFC Status — Centralized Validator + Uniform Response (State Form v2)

**New files**:

- `src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types.ts` — all shared form config/validation types
- `src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service.ts` — `DynamicFormValidationService`
- `src/module/xvi-fc/common/xvi-fc-common.module.ts` — exports `DynamicFormValidationService`
- `src/module/xvi-fc/common/response/xvi-fc-api-response.ts` — `XviFcApiResponse<T>`, `XviFcValidationError`
- `src/module/xvi-fc/common/response/xvi-fc-response.util.ts` — `xviFcSuccess()`, `throwXviFcValidationError()`

**Modified files**:

- `src/module/xvi-fc/state/sfc-status/constants/sfc-status.questions.ts` — migrated to `FormFieldConfig[]`; `visibleWhen` + typed `validators`; `awardPeriodDuration` computed conditions for sfcConstitutedForInterim and sfcAwardPeriodExtended
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts` — removed hand-rolled validation; uses `DynamicFormValidationService`; all methods return `XviFcApiResponse<T>`; JSDoc on all public methods; ip/userAgent stored in statusHistory
- `src/module/xvi-fc/state/sfc-status/sfc-status.controller.ts` — added `@ApiTags`, `@ApiOperation`; captures `@Ip()` and `@Headers('user-agent')` on saveDraft/finalSubmit
- `src/module/xvi-fc/state/sfc-status/sfc-status.module.ts` — imports `XviFcCommonModule`
- `src/schemas/xvi-fc/state/sfc-status.schema.ts` — added optional `ip` and `userAgent` fields to `StatusHistoryEntry`

**Key behaviours**:

- Draft validation: only validates present fields; absent fields skipped.
- Full submit validation: validates all visible required fields driven by question config.
- `awardPeriodDuration` computed server-side; frontend-supplied value is ignored.
- `sfcReport` now correctly visible for both ATR conditions using `in` operator.
- All SFC API success responses: `{ success, message, data }`.
- Validation errors: `BadRequestException` → `{ statusCode, message, errors[], timestamp, path }`.

**Follow-ups**:

- `sfc-status.constants.ts` (award period hardcoded ranges) is now superseded by the `yearRange` config in questions. Can be removed in a cleanup pass.
- Other state forms (Elected Body Status, Devolution Formula) will reuse `XviFcCommonModule` and the same `FormFieldConfig` pattern.

---

### SFC Status — Hydrated GET Response (State Form v3)

**New file**:

- `src/module/xvi-fc/state/sfc-status/sfc-status.types.ts` — `SfcFormPermissions`, `SfcFormGetResponseData`

**Modified files**:

- `src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types.ts` — added `value?: unknown` to `FormFieldConfig`; added `HydratedFieldConfig` type
- `src/module/xvi-fc/common/response/xvi-fc-api-response.ts` — added `timestamp?: string` to `XviFcApiResponse`
- `src/module/xvi-fc/common/response/xvi-fc-response.util.ts` — `xviFcSuccess()` now includes `timestamp: new Date().toISOString()`
- `src/module/xvi-fc/state/sfc-status/constants/sfc-status.questions.ts` — added default `value` to all 14 questions
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts` — rewrote `getForm()` to return full hydrated shape; added `hydrateQuestions()` and `buildFormPermissions()` private helpers; imported `Permission`, `getEffectivePermissions`
- `src/module/xvi-fc/state/sfc-status/sfc-status.controller.ts` — updated `@ApiOperation` description for `getForm`

**Key behaviours**:

- Not Started (no DB record): questions returned with template default values.
- Existing record: questions hydrated from `record.data` — present keys overwrite template defaults, absent keys keep defaults.
- Hydration is O(n); uses `Object.prototype.hasOwnProperty.call` for safe key presence check.
- `permissions` block derived from caller's effective permissions (respects per-user overrides).
- All SFC API success responses now include `timestamp` at top level.

---

### Post-merge Auth Fix

**Fixed file**:

- `src/module/auth/strategies/jwt-refresh.strategy.ts` — `secretOrKey` corrected from `JWT_SECRET` to `JWT_REFRESH_SECRET`; startup null-check updated to match.

**Unaffected**:

- `src/module/auth/strategies/jwt.strategy.ts` — no changes; XVI-FC fields (`scope`, `accessLevel`, `permissionOverrides`, `state`, `ulb`, `sessionId`) are all still returned from `validate()`.

**Context**: The `feat/xvi-fc-communication-center` merge accidentally replaced `JWT_REFRESH_SECRET` with `JWT_SECRET` in `JwtRefreshStrategy`. Environments where both secrets share the same value would not notice; environments with distinct secrets would have refresh token validation silently fail.

---

### SFC Status — Shared Form Status Constants (State Form v4)

**Modified files**:

- `src/schemas/xvi-fc/state/sfc-status.schema.ts` — removed local `SfcFormStatus` enum and `SFC_STATUS_LABELS`; imported `FORM_STATUS` from shared constants; `currentFormStatus` default now uses `FORM_STATUS.NOT_STARTED`
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts` — replaced all `SfcFormStatus.*` references with `FORM_STATUS.*`; replaced all `SFC_STATUS_LABELS[...]` lookups with `getFormStatusLabel(...)`

**Status mapping change**:

- `NOT_STARTED`: `1` → no change
- `IN_PROGRESS`: `2` → no change
- Final submit: was `SfcFormStatus.FINAL_SUBMITTED = 6`, then `FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA = 7` (v4), now corrected to `FORM_STATUS.UNDER_REVIEW_BY_MOHUA = 5` (v9)

**Note**: Existing documents in `xvi_fc_sfc_status_forms` with `currentFormStatus = 6` will display as `'Returned by MoHUA'` (the shared label for 6) rather than `'Acknowledged by MoHUA'`. A one-time migration updating those documents from 6 → 7 is required before deploying to any environment with existing submissions.

---

### SFC Status — Separate History Collection (State Form v5)

**New file**:

- `src/schemas/xvi-fc/state/sfc-status-history.schema.ts` — `XviFcSfcStatusHistory` schema, collection `xvi_fc_sfc_status_histories`

**Modified files**:

- `src/schemas/xvi-fc/state/sfc-status.schema.ts` — removed `StatusHistoryEntry` class and `statusHistory` array prop; main collection now stores only current form state
- `src/module/xvi-fc/state/sfc-status/sfc-status.types.ts` — added `SfcHistoryEntryInput` interface
- `src/module/xvi-fc/state/sfc-status/sfc-status.module.ts` — added `XviFcSfcStatusHistory` to `MongooseModule.forFeature`
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts` — injected `historyModel`; replaced `$push: { statusHistory }` in `saveDraft`/`finalSubmit` with `await createHistoryEntry(...)`; added `createHistoryEntry()` private helper

**Key behaviours**:

- `saveDraft` (new record): creates form doc → inserts `CREATE_DRAFT` history entry.
- `saveDraft` (existing record): updates form doc → inserts `UPDATE_DRAFT` history entry with `fromStatus = existing.currentFormStatus`.
- `finalSubmit`: updates form doc to `UNDER_REVIEW_BY_MOHUA` → inserts `FINAL_SUBMIT` history entry.
- API response shapes are unchanged — history is internal only.
- History insert is not wrapped in a transaction; a failed insert does not roll back the main status update.

---

### SFC Status — Status-Aware Permissions + Unified Validation Error Map (State Form v6)

**Modified files**:

- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts`
  - `buildFormPermissions(user, stateId, status)` — now accepts `stateId` and `status`; all three flags gated by role, state scope, and form status.
  - Added `hasStateAccess(user, stateId): boolean` — pure boolean scope check extracted from `assertStateAccess`; used by both the assert helper and permission building.
  - `assertStateAccess` refactored to call `hasStateAccess`; error message is now scope-specific.
  - `getForm` passes `stateId` and `currentFormStatus` to `buildFormPermissions`.
  - Imported `canStateEditForm` and `canStateFinalSubmitForm` from the status util.
- `src/module/xvi-fc/common/response/xvi-fc-api-response.ts` — added `XviFcValidationErrorMap = Record<string, XviFcValidationError[]>`; `errors` field on `XviFcApiResponse` changed from `XviFcValidationError[]` to `XviFcValidationErrorMap`.
- `src/module/xvi-fc/common/response/xvi-fc-response.util.ts` — `throwXviFcValidationError` parameter type updated to `XviFcValidationErrorMap`.
- `src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types.ts` — removed `ValidationError` interface; added `XviFcValidationErrorMap` re-export; added `ValidationResult = { isValid: boolean; errors: XviFcValidationErrorMap }`.
- `src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service.ts` — `validateDraft`/`validateFull` return `ValidationResult` (not an array); added `accumulateErrors` private helper (O(1) map accumulation); `validateField` still returns `XviFcValidationError[]` internally.

**Key behaviours**:

- `canEdit` and `canFinalSubmit` in GET response are `false` when status is not in the editable set, regardless of role.
- Validation errors from save-draft/final-submit are now a `Record<string, XviFcValidationError[]>` keyed by field key; frontend accesses errors in O(1): `errors['fieldKey']`. Non-field errors use the `_form` key.
- Save/final-submit routes re-enforce status server-side independently — the GET permissions flags are UI-gating only and cannot be bypassed.

**Documentation moved**:

- `xvifc-documentation.md` relocated from project root to `src/module/xvi-fc/xvifc-documentation.md`.

---

### SFC Status — Excel Dump/Export API (State Form v7)

**New files**:

- `src/module/xvi-fc/state/sfc-status/dto/dump-sfc-status-query.dto.ts` — optional query params DTO (`stateId`, `yearId`, `status`)
- `src/module/xvi-fc/state/sfc-status/types/sfc-status-dump.types.ts` — `SfcStatusDumpFilters`, `SfcStatusDumpRecord`, `SfcStatusDumpRow`, populated state/year interfaces

**Modified files**:

- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts`
  - `ExcelService` injected via constructor; `Buffer` imported from `exceljs`; `FilterQuery` from mongoose.
  - `SFC_DUMP_HEADERS` module-level constant — 39 column definitions.
  - `dumpToExcel(filters, user)` — scope-resolves filters, queries with `.lean().populate()` for state name + year name, maps docs to rows, calls `ExcelService.generateExcel`.
  - `resolveDumpFilters` — enforces ADMIN/STATE scope; STATE users cannot export another state's data.
  - `buildDumpRow` — O(n) flat row builder; no nested loops.
  - `extractFileColumns` — splits file object into 4 sub-fields.
  - `strVal` / `deriveAwardPeriodDuration` — scalar coercion helpers.
- `src/module/xvi-fc/state/sfc-status/sfc-status.controller.ts`
  - `GET dump` route added before `:stateId/:yearId` to avoid param conflict.
  - Returns `StreamableFile` with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
  - Filename: `sfc-status-dump_YYYY-MM-DD.xlsx`.
- `src/module/xvi-fc/state/sfc-status/sfc-status.module.ts` — `ExcelService` added to providers.

**Key behaviours**:

- Uses `VIEW_STATUS_REPORTS` permission (report-level, broader than `VIEW_STATE_FORMS`).
- State/Year names populated via `.populate('state', 'name').populate('year', 'year')` — models registered in parent `XviFcModule`.
- `awardPeriodDuration` is not stored in DB; derived at export time from `awardPeriod`.
- File fields (`extensionOrder`, `sfcReport`, `atrReport`, `gazetteNotification`) split into 4 columns each.
- All values coerced to strings for Excel; `Date` fields serialised as ISO 8601.

**Example curl**:

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/xvi-fc/state/sfc-status/dump?status=7" \
  -o sfc-status-dump.xlsx
```

---

### FormJson Redis Caching + SFC Template via FormJsonService (State Form v8)

**Modified files**:

- `src/form-json/form-json.service.ts`
  - `RedisService` injected via constructor (globally available, no module import needed).
  - `getFormJsonCacheKey(designYearId, formId): string` — private helper; returns `formJson:<designYearId>:<formId>`.
  - `findActiveByDesignYearAndFormId(designYearId, formId): Promise<IFormJson>` — new public method; checks Redis first (TTL 1 h), queries `{ design_year, formId, isActive: true }` on miss, writes result to Redis, returns `IFormJson`.
  - `create()` — sets fresh cache entry after insert when `formId` is present and `isActive: true`.
  - `update()` — fetches existing via `findById` before update; deletes old cache key; deletes new cache key if it differs (design_year or formId may have changed).
  - `remove()` — uses `findByIdAndUpdate` (no `{ new: true }`) to obtain pre-update values in a single query; deletes cache key for that document's `design_year + formId`.
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts`
  - Removed `@InjectModel(FormJsonSchema.name)` constructor injection and direct `formJsonModel.findOne()` calls.
  - `FormJsonService` injected in place of the model.
  - `loadFormQuestions(yearId?: string)` updated: when `yearId` is provided calls `formJsonService.findActiveByDesignYearAndFormId(yearId, SFC_FORM_ID)` (cached); otherwise falls back to `formJsonService.findByType('SFC')`.
  - `getForm` and `saveDraft`/`finalSubmit` pass `yearId` to `loadFormQuestions`; `getQuestions` and `dumpToExcel` call it without a yearId.
  - `SFC_FORM_ID = 22` defined as a file-level constant (replaces magic number).

**Cache key format**: `formJson:<designYearId>:<formId>`

- `designYearId` — string representation of the `design_year` ObjectId.
- `formId` — numeric form identifier (SFC Status: `22`).
- Do **not** use `formJson:<formId>` alone — `formId` is only unique per `design_year`.

**Cache TTL**: 3600 seconds (1 hour).

**Cache invalidation**:

- `create` — sets cache immediately for the new document.
- `update` — deletes old key (pre-update `design_year + formId`) and new key (post-update values, in case either field changed).
- `remove` (soft-delete) — deletes cache key for the document being deactivated.

**No module-level change needed**: `RedisModule` is `@Global()` so `RedisService` is injectable everywhere without importing `RedisModule` per-module. `FormJsonModule` already exports `FormJsonService`; `SfcStatusModule` already imports `FormJsonModule`.

**SFC formId**: `22` (`SFC_FORM_ID` constant in `sfc-status.service.ts`).

**Key behaviours**:

- SFC form questions are no longer fetched by direct `formJsonModel` query from `SfcStatusService`.
- All `getForm`, `saveDraft`, and `finalSubmit` calls benefit from the 1-hour Redis cache.
- `getQuestions` and `dumpToExcel` (no yearId context) use `findByType('SFC')` — direct DB query, not cached.
- Cache miss path: `{ design_year: ObjectId, formId: 22, isActive: true }` — hits the compound `{design_year, formId}` unique index.

---

### Side Menu — DB-driven with Redis Cache + Admin CRUD

**Context**: Sidebar menu was previously hardcoded in `src/module/xvi-fc/config/side-menu.config.ts`. Migrated to MongoDB so product team can manage items per year and role without code deploys.

**New schema** (`src/schemas/xvi-fc/xvi-fc-side-menu.schema.ts`):

- Collection: `xvifc_side_menus`
- Fields: `module`, `role`, `year` (ObjectId ref → Year), `isActive`, `section` (`top|bottom`), `sequence`, `type` (`header|separator|item|group`), `label`, `icon`, `featureKey`, `routerLink`, `parentId` (ObjectId ref → self, null for top-level)
- Indexes: `{ module, role, year, isActive }`, `{ parentId }`
- Exports `MenuRole` type (`ULB | STATE | MOHUA | DOE | ADMIN`)

**New cache layer** (`src/module/xvi-fc/cache/`):

- `xvi-fc-cache.service.ts` — Redis wrapper: `get`, `set`, `delete`, `deleteByPattern` (SCAN-based, non-blocking). Key prefix: `xvifc:cache`.
- `xvi-fc-cache.interceptor.ts` — `NestInterceptor` that caches full HTTP response in Redis. Per-route TTL via `@XviFcCacheTTL(seconds)` decorator (default 600 s). Cache key = `xvifc:cache:<request.url>`.
- `XVIFC_CACHE_KEY_PREFIX` defined in `xvi-fc-cache.service.ts` and re-exported from the interceptor.

**New sub-module** (`src/module/xvi-fc/side-menu/`):

- `side-menu.module.ts`, `side-menu.controller.ts`, `side-menu.service.ts`
- DTOs: `CreateSideMenuDto`, `UpdateSideMenuDto` (PartialType), `QuerySideMenuDto`
- All routes require `MANAGE_USERS` permission
- Routes: GET `/`, GET `/:id`, POST `/`, POST `/bulk`, PATCH `/:id`, PATCH `/:id/toggle`, DELETE `/:id`
- `bulkCreate` uses `insertMany` and invalidates cache once per unique `role+year` pair in the batch

**Modified files**:

- `src/module/xvi-fc/xvi-fc.service.ts` — `getSideMenu()` now queries DB instead of returning hardcoded config; `clearCache()` added; `XviFcCacheService` injected
- `src/module/xvi-fc/xvi-fc.controller.ts` — `GET /sidebar/:role` now uses `@UseInterceptors(XviFcCacheInterceptor)` + `@XviFcCacheTTL(600)`; `DELETE /admin/cache` added (ADMIN scope, MANAGE_USERS permission)
- `src/module/xvi-fc/xvi-fc.module.ts` — imports `SideMenuModule`; registers `XviFcSideMenu` schema; provides `XviFcCacheService`, `XviFcCacheInterceptor`

**Removed**:

- `src/module/xvi-fc/config/side-menu.config.ts` — dead `SIDE_MENU_CONFIG` hardcoded object removed; `MenuRole` type moved to schema file
- `scripts/seed-xvi-fc-side-menu.ts` — one-time seed script (already executed for 2026-27); removed post-run
- `package.json` `seed:xvi-fc-side-menu` script removed

**Tree building** (`buildMenuTree` / `buildSection` in `xvi-fc.service.ts`):

- Flat DB docs → `{ topModel, bottomModel }` nested structure
- Top-level items: `parentId === null`; children matched by `c.parentId.toString() === doc._id.toString()`
- `separator` type → `{ label: '_', separator: true }` (no other fields)
- `group` type → item with `items[]` populated from children sorted by `sequence`

**Cache invalidation**:

- On any write (create/bulk/update/toggle/delete): `cache.delete('xvifc:cache:/xvi-fc/sidebar/<role>?yearId=<yearId>')`
- Admin manual clear: `DELETE /xvi-fc/admin/cache?pattern=<url-pattern>` (uses `deleteByPattern` SCAN loop)

**Data seeded**: 35 documents inserted for year 2026-27 (`yearId: 67d7d136d3d038946a5239e9`) covering roles ULB, STATE, MOHUA, DOE, ADMIN.

### Annual Account — Dynamic Upload Config + Submit Fix

**Context**: Upload document configs (which documents to upload per section, with validation rules) were previously hardcoded in the Angular frontend. Migrated to MongoDB via the existing `form_json` collection so configs can be managed per design year without code deploys.

**New data in `formjsons` collection**:

- `formId: 30` (`UPLOAD_CONFIG_AUDITED`) — 6 file fields for audited section (design_year 2026-27, `documentYear: 2023-24`).
- `formId: 31` (`UPLOAD_CONFIG_PROVISIONAL`) — 5 file fields for provisional section (design_year 2026-27, `documentYear: 2024-25`).
- Each field is a `FieldConfig` with `formFieldType: 'file'`, `allowedFileTypes`, `maxFileSize`, and `validations[]`.
- `auditors-report` field carries an extra validator: `{ name: 'minPages', validator: 2, message: '...' }`.
- `receipts-payments` was seeded initially but subsequently removed from both configs via `$pull` (temporarily hidden on frontend; excluded from submit validation).
- **Redis cache keys** `formJson:<designYearId>:30` and `formJson:<designYearId>:31` must be manually flushed after any direct MongoDB update that bypasses the service layer (service layer handles cache invalidation automatically on `create`/`update`/`remove`).

**Modified files**:

- `src/module/xvi-fc/ulb/annual_accounts/annual_accounts.module.ts`
  - `FormJsonModule` added to `imports`.
- `src/module/xvi-fc/ulb/annual_accounts/annual_accounts.service.ts`
  - `FormJsonService` injected via constructor.
  - `getUploadConfig(type, yearId)` — resolves `formId` from `type` (`audited → 30`, `provisional → 31`); calls `formJsonService.findActiveByDesignYearAndFormId`; returns `{ meta, data }`.
  - `submitSection()` — now fetches the active formjson config before validating; only checks `processingStatus === 'PASSED'` for `docId`s present in `formJson.data[].key`. Documents in the annual account that are absent from the current config (e.g. previously uploaded then hidden fields) are silently skipped. Falls back to checking all uploaded docs if formjson lookup fails.
- `src/module/xvi-fc/ulb/annual_accounts/annual_accounts.controller.ts`
  - `GET upload-config/:type` added **before** `GET :id` to prevent NestJS matching `"audited"` / `"provisional"` as MongoDB ObjectIds.
  - `@Query('yearId')` extracts the design year.

**New route**:

- `GET /xvi-fc/annual-account/upload-config/:type?yearId=<designYearId>` — see Route Summary above.

**Submit validation change** (key behaviour):

- Before: `sectionData.documents.every(d => d.processingStatus === 'PASSED')` — checked every document ever uploaded into the section, including ones removed from the active config.
- After: filters `sectionData.documents` to only those whose `docId` is in the current `formjson.data[].key` list, then runs `every(d => d.processingStatus === 'PASSED')` on the filtered set.

**Frontend changes** (Angular — `cityfinance-ng-ui-v2`):

- `upload-documents.service.ts` (new) — fetches `GET upload-config/:type` and maps `FieldConfig[]` to `UploadDocumentDef[]`; extracts `minPages` from `validations[]`.
- `upload-documents.component.ts` — all config now loaded from API via signals; `config`, `documents`, `totalCount`, `allPassed`, `progressPct` are signals/computed; `loadConfig()` → `loadExistingData()` chain; route data key changed from `{ config: UPLOAD_CONFIGS.audited }` to `{ uploadType: 'audited' }`.
- `receipts-payments` filtered out in `mapToConfig()` in the service (frontend-only; DB retains the field but it is also removed from `data[]` in both formjsons).
- `PageErrorStateComponent` (new, `shared/page-error-state/`) — reusable full-screen error state with `title`, `message`, `retryLabel` inputs and `(retry)` output. Wired into `upload-documents`, `overview`, `support-hours`, and `roles-teams-overview` components replacing inline alert banners.

**Follow-ups**:

- Annual account scope enforcement (ULB/STATE) still pending (see Known Gaps).
- `receipts-payments` removal from frontend is temporary; re-enable by removing the `.filter()` in `mapToConfig()` and re-adding the field to `formjsons.data[]`.

---

### SFC Status — Correct Final-Submit Transition Status (State Form v9)

**Modified files**:

- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts`
  - `finalSubmit()` — `toStatus` changed from `FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (7) to `FORM_STATUS.UNDER_REVIEW_BY_MOHUA` (5).

**Workflow rule**:

- STATE final-submit → `UNDER_REVIEW_BY_MOHUA` (5). Form is now with MoHUA for review.
- `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (7) is reserved for a future MoHUA acknowledge/approval action; it is never set by a state user.

**No changes needed to**:

- Status-gate helpers (`canStateFinalSubmitForm`, `assertCanStateFinalSubmitForm`) — `UNDER_REVIEW_BY_MOHUA` is already outside `STATE_EDITABLE_STATUSES`, so a submitted form is correctly blocked from re-editing by the STATE.
- `isTerminalStatus()` — remains tied to `SUBMISSION_ACKNOWLEDGED_BY_MOHUA`; `UNDER_REVIEW_BY_MOHUA` is not terminal (MoHUA can return it).
- Permission logic in `buildFormPermissions` — `canEdit`/`canFinalSubmit` are `false` for `UNDER_REVIEW_BY_MOHUA` because it is not in `STATE_EDITABLE_STATUSES`.

---

### Elected Urban Local Bodies — Correct Final-Submit Transition Status

**Modified file**:

- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.service.ts`
  - `finalSubmit()` — `toStatus` corrected from `FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (7) to `FORM_STATUS.UNDER_REVIEW_BY_MOHUA` (5).
  - JSDoc updated to reflect correct target status.

**Workflow rule (all state forms)**:

- STATE final-submit → `UNDER_REVIEW_BY_MOHUA` (5). Form moves to MoHUA for review.
- `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` (7) is reserved for a future MoHUA acknowledge/approval action; it is never set by a state user.

**No changes needed to**:

- Status-gate helpers — `UNDER_REVIEW_BY_MOHUA` is already outside `STATE_EDITABLE_STATUSES`.
- `isTerminalStatus()` — unchanged; `UNDER_REVIEW_BY_MOHUA` is not terminal.
- `buildFormPermissions` — `canEdit`/`canFinalSubmit` are already `false` for `UNDER_REVIEW_BY_MOHUA`.

---

### Elected Urban Local Bodies — Row Data Lifecycle (Hard Delete)

**Modified files**:

- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies-excel.service.ts`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies-row.service.ts`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.controller.ts`

**Row data lifecycle**:

- EULB row data is hard-deleted on file removal — no soft-delete, no archive, no history collection.
- The row collection (`xvi_fc_elected_urban_local_bodies_rows`) holds only the current working dataset at any given time.
- Rows are scoped by `(form, datasetVersion)`. The form's `activeDatasetVersion` determines which rows are live.

**New Excel upload (safe replace)**:

Safe replace order enforced in `validateExcel` (`POST validate-excel`):

1. Parse and validate rows.
2. Insert new rows with `datasetVersion = activeDatasetVersion + 1` (new rows exist before form points to them).
3. Update form document: set all summary fields and `activeDatasetVersion = newVersion`.
4. Delete old rows (`datasetVersion = currentVersion`) only after steps 2 and 3 succeed.

- If row insert or form update fails, the old active dataset remains untouched.
- If old-row deletion fails, it is logged and silently skipped — old rows are invisible because the rows API queries by `activeDatasetVersion`.
- Validation with row errors is still a successful replace: invalid rows are stored alongside their `errors[]`.

**Delete uploaded Excel (`DELETE /:stateId/:yearId/uploaded-excel`)**:

- Permission: `EDIT_STATE_FORMS`.
- Status gate: `assertCanStateEditForm` — blocked when form is under review/submitted.
- Hard-deletes rows for `(formId, activeDatasetVersion)`.
- Clears `electedBodyExcelFile` from the form document (`$unset`).
- Resets `excelRowCount`, `matchedDbUlbCount`, `missingDbUlbCount`, `extraExcelRowCount`, `errorRowCount` to `0`.
- Resets `validationStatus` to `NOT_VALIDATED`.
- Does not clear `ulbCount`, `dbUlbCount`, `maxAllowedExcelRows`, or `activeDatasetVersion`.
- Does not delete the uploaded file from S3 (only the DB reference is cleared).
- Returns `{ validationSummary: { ... } }` with zeroed counts.

**Side effects after delete**:

- GET form: `electedBodyExcelFile` is cleared → `view-uploaded-data` and `download-error-sheet` actions hidden, no badges.
- Rows API: returns empty list (no rows for `activeDatasetVersion` after delete).
- Error-sheet API: returns controlled 400 (`No uploaded Elected Bodies data found`).
- GET form supporting actions rebuild from live DB state on every GET.

---

### Elected Urban Local Bodies — Row Edit Fields and Validation Summary Sync

**Modified files**:

- `src/module/xvi-fc/common/types/field-config.type.ts`
- `src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants.ts`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.types.ts`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.service.ts`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies-row.service.ts`

**GET form now returns `rowEditFields`**:

- `GET /:stateId/:yearId` includes `rowEditFields: FieldConfig[]` in `data` alongside `questions`.
- Contains static field configs for the 4 editable row fields: `electedBodyStatus`, `dateOfConstitution`, `dateOfExpiry`, `remarks`.
- Frontend uses these configs to render and validate the row-edit dialog without a separate API call.
- Defined as `EULB_ROW_EDIT_FIELDS` constant in the constants file — static, no DB dependency.

**PATCH row now returns updated row and recalculated summary**:

- `PATCH /:stateId/:yearId/rows/:rowId` response shape changed from `data: EulbRow` to `data: { row: EulbRow, validationSummary: EulbValidationSummary }`.
- After row revalidation, `recalculateFormSummary()` now returns the full `EulbValidationSummary` instead of `void`.
- Summary is recalculated from DB counts — not incremented/decremented client-side.
- Frontend must use the returned summary to update the parent error-count pill without refetching GET form.

**Supporting content remains backend-driven**:

- After row edits, the next GET form call returns refreshed badges and action visibility.
- Parent UI should reload form after modal close to pick up the latest `supportingContent` from the backend.

---

### XVI-FC Common — Shared Form Actors Service

**New files**:

- `src/module/xvi-fc/common/types/xvifc-form-actors.type.ts` — `XvifcActorSourceDocument`, `XvifcFormActor`, `XvifcFormActorsResult`
- `src/module/xvi-fc/common/services/xvifc-form-actors.service.ts` — `XvifcFormActorsService.buildActorsAndStateName(doc)`

**Modified files**:

- `src/module/xvi-fc/common/xvi-fc-common.module.ts` — registers and exports `XvifcFormActorsService`
- `src/module/xvi-fc/state/sfc-status/sfc-status.types.ts` — `SfcFormActor` is now a type alias for `XvifcFormActor` (re-export); removed the local interface definition
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts` — injects `XvifcFormActorsService`; `getForm()` calls `buildActorsAndStateName(doc)`; removed private `getActors()` method and module-level `getPopulatedName`/`toIsoStringOrNull` helpers
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.types.ts` — `EulbFormActor` is now a type alias for `XvifcFormActor`; gains `designation: string` field
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.service.ts` — injects `XvifcFormActorsService`; `getForm()` calls `buildActorsAndStateName(doc)`; removed private `getActors()` method and module-level helpers

**Key behaviours**:

- Both SFC and EULB actors now include `designation: 'State DMA Officer'` on every entry.
- No module wiring changes required — both `SfcStatusModule` and `ElectedUrbanLocalBodiesModule` already import `XviFcCommonModule`.

---

### Elected Urban Local Bodies — Revalidate Uploaded Excel API

**New files**:

- `src/module/xvi-fc/state/elected-urban-local-bodies/dto/revalidate-eulb-excel.dto.ts` — `RevalidateEulbExcelDto` with `ulbCount: number`

**Modified files**:

- `src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants.ts` — added `EULB_ACTION_REVALIDATE_EXCEL = 'revalidate-excel'`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.types.ts` — added `EulbRevalidateExcelResponseData`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies-excel.service.ts` — added `revalidateExcel()` method; no new dependencies
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.service.ts` — `buildElectedBodyFileSupportingContent` now accepts `canEdit: boolean`; `hydrateQuestions` now accepts `canEdit: boolean` as 4th param; `getForm` computes `permissions` before calling `hydrateQuestions`
- `src/module/xvi-fc/state/elected-urban-local-bodies/elected-urban-local-bodies.controller.ts` — added `POST :stateId/:yearId/revalidate-excel` route

**New route**:

- `POST /xvi-fc/state/elected-urban-local-bodies/:stateId/:yearId/revalidate-excel`
  - Permission: `EDIT_STATE_FORMS`
  - Body: `{ ulbCount: number }`
  - Status gate: `assertCanStateEditForm` — blocked when form is under review/submitted

**Revalidation behaviour**:

- Loads all rows for the current `activeDatasetVersion` — no file re-read from S3.
- Validates `ulbCount` against current row count; returns field-level 400 under `ulbCount` key if mismatched.
- Re-runs the same row validation rules as the original `validate-excel` (DB ULB matching, field validators).
- Updates rows in-place via `bulkWrite` — no rows deleted or duplicated.
- Recalculates and persists: `dbUlbCount`, `maxAllowedExcelRows`, `excelRowCount`, `matchedDbUlbCount`, `missingDbUlbCount`, `extraExcelRowCount`, `errorRowCount`, `validationStatus`.
- Returns `{ validationSummary, errors: EulbRowValidationError[] }`.
- Returns success even when row errors remain — errors are the result, not the failure signal.

**Revalidate action in GET form**:

- `buildElectedBodyFileSupportingContent` now receives `EulbFormPermissions` from the caller.
- `revalidate-excel` action is included in `electedBodyExcelFile.supportingContent.actions`.
- Visible when: `canEdit && hasUploadedExcel && validationStatus !== 'VALID'` (`canEdit` already encodes the editable-status gate).
- `hasUploadedExcel` is true when `electedBodyExcelFile.fileName` or `fileUrl` is non-empty, regardless of row dataset existence.

**Final submit unchanged** — still requires `validationStatus === 'VALID'`.

---

### Elected Urban Local Bodies — View-Only Access Enforcement

- View-only users (those with `VIEW_STATE_FORMS` but not `EDIT_STATE_FORMS`) can read the form and rows but cannot mutate anything.
- `GET :stateId/:yearId/template` now requires `EDIT_STATE_FORMS` (changed from `VIEW_STATE_FORMS`). Direct API calls by view-only users return 403.
- `buildElectedBodyFileSupportingContent` now accepts `EulbFormPermissions` (`canView` + `canEdit`).
- `download-template` action: visible only when `canEdit` is true (view-only users never see it).
- `view-uploaded-data` action: visible when `canView && hasActiveDataset` (view-only users can open the data dialog if rows exist).
- `download-error-sheet` action: visible when `canView && errorRowCount > 0`.
- `revalidate-excel` action: visible when `canEdit && hasUploadedExcel && validationStatus !== 'VALID'` (view-only users never see it).
- `supportingContent` description string removed entirely (was the long template instruction text).
- `updateRow` (PATCH rows/:rowId) now calls `assertCanStateEditForm(formDoc.currentFormStatus)` before processing. Returns 403 when form status does not allow editing; controller-level `EDIT_STATE_FORMS` guard blocks view-only users.
- All other mutating endpoints (`save-draft`, `validate-excel`, `revalidate-excel`, `delete-uploaded-excel`) already required `EDIT_STATE_FORMS` at controller level and `assertCanStateEditForm` in service — unchanged.
- Read endpoints (`GET form`, `GET rows`, `GET error-sheet`) continue to require `VIEW_STATE_FORMS` — accessible to view-only users.

---

### Centralized XVI-FC Folder Path Resolver

**Problem**: `folderPath` was stored as a static string in MongoDB `formjsons` (e.g. `xvi-fc/state/2026-27/sfc-status/sfc-report`). It did not include `stateId`, so all states uploaded to the same S3 prefix. Year label was hardcoded instead of derived at runtime.

**Solution**: A centralized resolver in `src/module/xvi-fc/common/folder-paths/` resolves `folderPath` at the backend GET response boundary using runtime context (`role` + `_id` + `designYear`). The frontend continues to consume `folderPath` unchanged.

**New files** (`src/module/xvi-fc/common/folder-paths/`):

- `xvi-fc-folder-path.constants.ts` — `XVI_FC_FOLDER_PATH_KEYS` const object, `XviFcFolderPathKey` union type, `XVI_FC_FOLDER_PATH_MAP` (key → relative subpath)
- `xvi-fc-folder-path.resolver.ts` — two pure functions:
  - `buildXviFcFolderPath(key, context)` — builds `xvi-fc/{role}/{_id}/{designYear}/{subpath}`; appends `/{batchId}/document` for `EULB_POST_SUBMISSION_PROOF` when `batchId` is present; throws on empty `_id`/`designYear` or unknown key
  - `resolveXviFcFolderPathsInFormJson<T extends FieldConfig>(fields, context)` — maps over a field array; for each `formFieldType === 'file'` field: resolves `folderPath` from `folderPathKey` if present, otherwise preserves existing static `folderPath`; returns a new array without mutating the input
- `xvi-fc-folder-path.resolver.spec.ts` — 17 unit tests covering all keys, dynamic role/id paths, batchId variant, empty context guards, unknown key throw, mutation safety, backward-compat (static path preserved)

**Key → subpath mapping**:

| Key                          | Subpath                               |
| ---------------------------- | ------------------------------------- |
| `SFC_EXTENSION_ORDER`        | `sfc-status/extension-order`          |
| `SFC_REPORT`                 | `sfc-status/sfc-report`               |
| `SFC_ATR_REPORT`             | `sfc-status/atr-report`               |
| `SFC_GAZETTE_NOTIFICATION`   | `sfc-status/gazette-notification`     |
| `EULB_EXCEL`                 | `elected-body/elected-bodies-list`    |
| `EULB_POST_SUBMISSION_PROOF` | `elected-body/post-submission-update` |
| `XVI_FC_BANK_ACCOUNT_PROOF`  | `bank-account/proof`                  |

**Modified files**:

- `src/module/xvi-fc/common/types/field-config.type.ts` — added `folderPathKey?: string` to `FieldConfig`
- `src/module/xvi-fc/state/sfc-status/sfc-status.service.ts` — `getForm()` derives `designYear` via `YearIdToLabel[yearId]`; throws `NotFoundException` for unknown yearId; `hydrateQuestions()` gains optional `folderPathContext`; resolves `folderPath` inside the existing `formFieldType === 'file'` branch (no second loop)
- `src/module/xvi-fc/state/elected-urban-local-bodies/services/main/elected-urban-local-bodies.service.ts` — same pattern: `getForm()` derives `designYear`, `hydrateQuestions()` gains optional `folderPathContext`
- `src/module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service.ts` — `getMetadata()` derives `designYear` and calls `resolveXviFcFolderPathsInFormJson` on `EULB_POST_SUBMIT_UPDATE_FIELDS` questions before returning
- `src/s3-upload/s3-upload.service.ts` — added `assertSafeFolderPath()` private function; blocks path traversal (`..`), leading `/`, double `//`, and empty segments; called before constructing S3 key; does not enforce xvi-fc prefix (shared endpoint — audit other module usages first)
- `src/module/xvi-fc/xvifc-payload.json` — all 6 file fields migrated from static `folderPath` to `folderPathKey`

**DB payload convention going forward**:

```json
{ "formFieldType": "file", "key": "sfcReport", "folderPathKey": "SFC_REPORT" }
```

Backend injects resolved `folderPath` at GET time. Old records with only a static `folderPath` continue to work (backward compatible — resolver preserves them).

**Year label derivation**: `YearIdToLabel[yearId]` from `src/core/constants/years.ts`. Throws `NotFoundException` for unrecognised yearIds — all test specs updated to use `new Types.ObjectId('67d7d136d3d038946a5239e9')` (2026-27).

**Runtime path format**: `xvi-fc/{role}/{_id}/{designYear}/{subpath}`

Example: `xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/sfc-report`

**Resolution is single-pass**: folded into the existing `hydrateQuestions` file-field branch — no extra loop over the field array.

**S3 upload security note**: Full xvi-fc prefix whitelisting (`xvi-fc/{role}/` only) is deferred — `POST /s3/signed-url` is shared across modules. Current validation covers path traversal only. Prefix enforcement can be added once all module upload paths are audited.

---

### XVI-FC Bank Account API

**New module**:

- `src/module/xvi-fc/ulb/bank-account/`
- Registers controller, service, DTOs, types, proof signed-url wrapper, and security helpers.

**New schema**:

- `src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema.ts`
- Collection: `xvi_fc_bank_accounts`
- Unique index: `{ ulb: 1, designYear: 1 }`

**New routes**:

- `GET /xvi-fc/bank-account?yearId={designYearId}&ulbId={ulbId}` — `Permission.VIEW_STATUS_REPORTS`
- `POST /xvi-fc/bank-account` — `Permission.UPLOAD_DOCUMENTS`
- `POST /xvi-fc/bank-account/proof/signed-url` — `Permission.UPLOAD_DOCUMENTS`

**Signed-url wrapper**:

- Uses folder key `XVI_FC_BANK_ACCOUNT_PROOF`.
- Final folder: `xvi-fc/ulb/{ulbId}/{designYearId}/bank-account/proof`.
- Allows PDF, JPEG, PNG up to 5 MB.

**Proof object convention**:

- Uses SFC-style proof object only: `{ fileName, fileUrl, fileSize, mimeType }`.
- Does not use `filepath`, `originalName`, or `sizeKb`.

**Status and form-status integration**:

- POST submit transitions to `FORM_STATUS.UNDER_REVIEW_BY_STATE`.
- GET/form-status no-record default is `FORM_STATUS.NOT_STARTED`.
- `GET /xvi-fc/form-status/:ulbId/:designYearId` now includes `xviFcBankAccount`.
- No `formStatus: 'SUBMITTED'` is used for bank account.

**Security helpers**:

- `src/module/xvi-fc/ulb/bank-account/utils/bank-account-security.util.ts`
- Encrypts, hashes, masks, extracts last 4 digits, and builds safe responses.
- Requires `BANK_ACCOUNT_ENCRYPTION_KEY` and `BANK_ACCOUNT_HASH_SECRET`.
- Safe responses exclude raw account number, confirmation number, encrypted value, and hash.

**Frontend integration**:

- Angular standalone form at `src/app/features/xvi-fc-module/ulb-module/ulb-forms/xvi-fc-bank-account/`.
- Loads existing record, displays masked account number only, uploads proof via signed URL, submits metadata only, and gates editing by `currentFormStatus`.

**Tests added/updated**:

- Backend: `bank-account.service.spec.ts`, `bank-account-security.util.spec.ts`, `xvi-fc-folder-path.resolver.spec.ts`, `xvi-fc.service.spec.ts`, `submit-xvi-fc-bank-account.dto.spec.ts`.
- Frontend: `xvi-fc-bank-account.service.spec.ts`, `xvi-fc-bank-account.component.spec.ts`.

**Known TODO / blockers**:

- Backend IFSC verification is still a placeholder; wire to internal IFSC master or Razorpay backend verification when approved.
- Backend full `npm run test` is blocked by unrelated existing failures in `users.service.spec.ts`, `otp.service.spec.ts`, `auth.controller.spec.ts`, and annual-account specs.
- Frontend `npm run test` is blocked by unrelated existing auth spec failures in `forgot-password.component.spec.ts` and `login.component.spec.ts`.
