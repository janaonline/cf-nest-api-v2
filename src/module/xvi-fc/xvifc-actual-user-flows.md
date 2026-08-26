# XVI-FC User Flows — As Actually Implemented

> **Purpose**: This documents login, forgot-password, profile verification, and the Roles & Teams Overview pages **as they exist in the codebase today** — verified by reading the real controllers/services/schemas/components, not by reading `xvifc-multi-role-design.md`. That design doc is explicitly marked "Design complete. Implementation pending." and describes a `xviFcRole` field and a set of `/users/verify-profile/*` endpoints that **do not exist in the codebase**. Where this doc and that one disagree, this doc reflects reality; the design doc should be reconciled or retired once someone confirms whether it's still the intended future direction.
>
> **Repos covered**: `cf-nest-api-v2` (NestJS backend, global prefix `/api/v2`) and `cityfinance-ng-ui-v2` (Angular frontend).
>
> **Last written**: 2026-07-09, by reading source directly (see file map at the bottom).

---

## 1. Login

One shared login form/page serves **ULB, STATE, MoHUA, DOE, and PARTNER** — there is no separate login component per role.

- Frontend: `src/app/auth/login/login.component.ts` (+`.html`), `src/app/auth/login/login.service.ts`
- Backend: `src/module/auth/auth.controller.ts`, `login.service.ts`, `auth.service.ts`

### 1.1 Form

Single reactive form: `role`, `identifier`, `password`.

- `role` is only required/shown as a picker step for login types `'16thFC'` / `'15thFC'` (`isMultiStep`). For other entry points (`XVIFC`, `ranking`, `state-dashboard`) the role step is skipped entirely.
- `identifier` is a **chameleon field** — its validators, label, placeholder, and keyboard type switch based on the selected role:
  - **ULB** → "Census Code": `required, minLength(6), maxLength(254)`, must be all-digits (`noEmailFormat` rejects anything containing `@`).
  - **STATE / MoHUA / DOE / PARTNER** → "Email": `required, maxLength(254), Validators.email`.
  - Before a role is picked, a looser combined validator (`emailOrCensusCode`) accepts either shape.
  - All variants additionally run `IDENTIFIER_SECURITY_VALIDATORS` = `noHtmlOrScript, noMongoOperators, noSqlInjection, noNullBytes`.
- `password`: `required, minLength(6), maxLength(128)`, plus `noNullBytes`.

### 1.2 Submit

```
loginForm.getRawValue() → { identifier, password }
  → LoginService.signInWithPassword(identifier, password, typeKey)
    → RecaptchaService.execute('login')
    → AuthService.login({ identifier, password, type, recaptchaToken })
      → POST /api/v2/auth/login   (Public, no auth required)
```

**Note**: the `role` picked in step 1 is *not sent* in the login request — only `identifier`, `password`, `type` (the login-flow key, e.g. `'16thFC'`), `recaptchaToken`.

### 1.3 Backend validation order (`LoginService.login()`)

1. Resolve user by identifier (email / mobile / census-or-SB code for ULB).
2. Mobile-number identifier only accepted when `type === '16thFC'`.
3. `status === 'PENDING'` → 403. `status === 'REJECTED'` → 403 with reason.
4. `type === '16thFC' && user.isXviFcdeleted` → 403 (an XVI-FC-removed user can't log back into the 16th FC portal).
5. `!isEmailVerified` → 403 with a reactivation link.
6. `role === ULB` && identifier looks like an email → 403 (ULB must use census code).
7. State's `accessToXVFC === false` → 403.
8. Type-based role gating (e.g. only `STATE`/`STATE_DASHBOARD` may use `state-dashboard`; only `XVIFC_STATE`/`XVIFC`/`ULB` may use `XVIFC`; `PMU`/`AAINA` blocked from `15thFC`).
9. ULB role: an active `Ulb` document must exist.
10. Account lock check (`isLocked` + `lockUntil`) → 403, locked for 1 hour after repeated failures.
11. `bcrypt.compare(password, user.password)` — **with a master-password bypass**: if env `USER_IDENTITY` is set and equals the submitted password, auth succeeds regardless of the real password (dev/support backdoor — flag this for a security review). Wrong password increments `loginAttempts`.
12. Success → issues tokens, creates a `LoginHistory` row, updates `lastLoginAt`, sets refresh cookie, returns a hydrated `user` object plus `allYears`.

**Note**: newly-provisioned accounts (ULB primary contact, STATE/MoHUA invites) are created with a
random, never-revealed password — there is no temp password or expiry anymore. The invite/approval
email instead points the recipient at the Forgot Password OTP flow (`POST /auth/sendOtp` with
`purpose: 'forgot-password'`, then `POST /auth/forgot-password/reset`) to set their password before
their first login. `isNewUser` stays true until that reset succeeds (or until the profile-verification
save flow completes it), independent of *how* the password was set.

### 1.4 Tokens

- Access token: `{ _id, lh_id, sessionId, purpose }`, signed `JWT_SECRET`, expiry env `JWT_EXPIRES_IN` (fallback **15m**).
- Refresh token: `{ sub: userId }`, signed `JWT_REFRESH_SECRET`, expiry env `JWT_REFRESH_EXPIRES_IN` (fallback **7d**); bcrypt-hashed and stored on the user doc; also set as an **httpOnly, `sameSite: 'strict'` cookie** (`refresh_token` by default, name from `REFRESH_COOKIE_NAME`).
- Access token extraction: `Authorization: Bearer` header **or** `x-access-token` header, plus a Redis session-blacklist check (`bl:<sessionId>`, populated on logout).
- Refresh token extraction: **cookie only**, never header/body.
- Every request re-derives `scope`/`accessLevel`/`permissionOverrides` fresh from the DB (`parseUserRole(role, xviFcSubrole)`) — the JWT payload itself is never trusted for authorization.

### 1.5 Post-login redirect

```ts
navigateAfterLogin(user, type):
  if (type === '16thFC') {
    clear sessionStorage postLoginNavigation(V2)
    → '/xvifc/year'   // unconditional — no role branching, no deep-link restore
    return
  }
  if (saved deep-link exists in sessionStorage) → navigate there
  else → look up ROUTE_PAGES by (type, role) → navigate or window.location.href
```

For the 16th FC module specifically: **every role lands on `/xvifc/year` after login**, full stop. Any saved "come back here after login" deep link is discarded for this flow. Role-specific behavior only starts once inside `/xvifc/...`.

`xvifcAuthGuard` (`core/guards/auth.guard.ts`) only checks "is this a valid authenticated session" — it does **not** check role. Role-specific access is enforced deeper in the route tree / components, not at this guard.

### 1.6 `check-user` and OTP login

- `POST /auth/check-user` (Public) — given an identifier, returns `{ status, isXVIFCProfileVerified, maskedContact, loginFlow: 'PASSWORD' | 'OTP', role }`. Used to decide whether to show a password field or an OTP field before the user commits (not confirmed wired into `login.component.ts` in the agent's read — worth a follow-up check if the UI is expected to branch here).
- `POST /auth/sendOtp` `{ identifier, purpose: 'login' }` → generates + Redis-stores a hashed OTP.
- `POST /auth/verifyOtp` `{ identifier, otp }` → on success: sets `isXVIFCProfileVerified: true, status: 'APPROVED', isActive: true`, issues tokens exactly like password login.

---

## 2. Forgot Password

- Frontend: `src/app/auth/forgot-password/forgot-password.component.ts` (+`.html`) — calls `OtpAuthService` (`src/app/core/auth/auth.service.ts`); there is no separate `forgot-password.service.ts`.
- Backend: `otp.service.ts` (`sendOtp`, `forgotPasswordReset`), routes on `auth.controller.ts`.

Role picker: `ULB | STATE | MoHUA` (same three as login, no DOE/PARTNER here).

### 2.1 Step 1 — identify

- ULB → `code` field: required, 6–20 chars, digits only.
- STATE/MoHUA → `email` field: required, valid email.
- Submit → `POST /auth/sendOtp` `{ identifier, purpose: 'forgot-password' }`.
- **Anti-enumeration by design**: the backend always returns success even if no user matches. If the backend returns no `maskedMobile`/`maskedEmail`, the frontend computes its own mask from the entered identifier so a nonexistent account looks identical to a real one.
- 60s resend cooldown starts on success.

### 2.2 Step 2 — reset

- `otp`: required, 4–6 digits.
- `newPassword`: required, 6–128 chars, must satisfy `PASSWORD_SECURITY_VALIDATORS`.
- `confirmPassword`: required, group-level match validator.
- Submit → `POST /auth/forgot-password/reset` `{ identifier, otp, newPassword, confirmPassword }`.
- On success: **does not log the user in** (no token returned) — shows a success screen, 5s countdown, then redirects to `/auth/login` (with the original `type` query param if present).
- On error: `429` → "Too many attempts"; everything else (wrong/expired OTP, or account doesn't exist) → the *same* generic "Invalid or expired OTP" message, intentionally indistinguishable.

There is **no token-link-based** reset flow (no "click the email link" pattern) — it's entirely OTP-in-the-same-session.

---

## 3. Profile Verification (`/xvifc/profile-verify`)

- Frontend: `src/app/features/xvi-fc-module/shared/profile-verification/` (`.component.ts/.html/.models.ts/.service.ts`)
- One shared component for all three roles, branching internally on `role: 'ulb' | 'state' | 'mohua'`.

### 3.1 When a user lands here

Triggered from `years-selection.component.ts`'s `continue()`:

```ts
if (isNewUser || !isXVIFCProfileVerified) {
  navigate('/xvifc/profile-verify', { queryParams: { year } });  // applies to ALL roles, including MoHUA
  return;
}
if (routeRole === 'MOHUA') navigate('/xvifc/{yearId}');   // already-verified MoHUA skips straight in, no entity scope
```

So **MoHUA users do go through this page** the first time (contrary to what you might assume from MoHUA having "no entity"). Only already-verified, non-new users of any role skip it.

The component itself double-checks: if `!isNewUser && isAlreadyVerified`, it immediately redirects away instead of rendering.

### 3.2 ULB flow — simplest, no OTP, no password step

- `GET /users/{userId}/profile-contacts` — loads existing Commissioner + "ULB Nodal Officer" (accountant) contact fields.
- Two small forms (`commissionerForm` optional, `accountantForm` required): name/email/mobile fields with `noHtmlOrScript`, `noMongoOperators`, name-pattern, and 10-digit-starting-6-9 mobile pattern.
- Submit → `PATCH /users/{userId}/profile-contacts` with the edited fields + `isXVIFCProfileVerified: true`.
- No OTP. No password. One PATCH and done.

### 3.3 STATE / MoHUA flow — email OTP + first-login password

- `stateForm`: `firstName`, `lastName` (required), `email` (**disabled/display-only — never editable here**), `mobile` (optional, pattern-checked), `designation` (optional).
- Step A — `POST /email/sendProfileOtp { email }`.
- Step B — `POST /email/verifyProfileOtp { email, otp }`.
- Step C — `POST /users/{userId}/issue-profile-save-token {}` → a short-lived (120s) single-use save token.
- Step D — `PATCH /users/{userId}/profile-contacts { name, mobile, designation, saveToken, isXVIFCProfileVerified: true, ...extra }`. MoHUA additionally sends `{ isXviFcdeleted: false }` in `extra`.
- **If `isNewUser`** (first login on a temp password): an additional password-setup form appears (`newPassword`/`confirmPassword`, 8+ chars, upper+lower+digit+special) → `PATCH /auth/set-new-password { newPassword, saveToken, ...profileFieldsForState }`. For MoHUA this call carries no profile fields (profile was already saved in step D); for STATE it's used as the single combined save call.

None of these paths call anything named `/users/verify-profile/*` or `/users/verification-contacts` — those are design-doc names only.

### 3.4 On success (all roles)

- `localStorage.isXVIFCProfileVerified = 'true'`, `userData` patched (`isXVIFCProfileVerified: true, isNewUser: false`, refreshed name/mobile/designation for STATE/MoHUA).
- Redirect: MoHUA → `/xvifc/{yearId}`; ULB/STATE → the role's `overview` route.

### 3.5 What's real vs. what's aspirational, per the design doc

| Design doc claim | Reality |
|---|---|
| Contact-selection screen ("This is me" / "Add myself") | **Does not exist.** OTP always goes to the single email/mobile already on the account record. |
| `xviFcRole: submitter/editor/viewer`, first-verifier-wins | **Does not exist.** The real analogue is `xviFcSubrole: admin/reviewer/viewer` on the User schema, auto-assigned server-side (`assignXviFcSubrolesByState`) based on `isNodalOfficer`, not a "first person to verify wins" race. |
| `/users/verify-profile/send-otp`, `/confirm`, `/create-new` | **Do not exist.** Real endpoints: `/email/sendProfileOtp`, `/email/verifyProfileOtp`, `/users/{id}/issue-profile-save-token`, `/users/{id}/profile-contacts`, `/auth/set-new-password`. |
| ULB has an OTP step | **No.** ULB has no OTP at all — direct PATCH. |

---

## 4. Roles & Teams Overview

Same route/folder name (`roles-teams-overview`) is used across all three modules, but **ULB is functionally a different page** from STATE/MoHUA.

### 4.1 ULB — `ulb-module/roles-teams-overview/`

This is **not a team-member list**. It's a two-contact profile editor: Commissioner + ULB Nodal Officer, same data as the profile-verification ULB form, editable inline (pencil → edit → Save/Cancel).

- `GET /users/{userId}/profile-contacts`
- `PATCH /users/{userId}/profile-contacts`

No invite, no member list, no roles, no remove, no transfer. There is exactly one account per ULB by design, so there's no team to manage.

### 4.2 STATE — `state-module/roles-teams-overview/`

A real, fully wired team-management page.

| Endpoint | Used for |
|---|---|
| `GET /users/permission-matrix` | Static display-only matrix, "UI display only, not a security boundary" per backend code comment |
| `GET /users/state-members` | Team list for the current state |
| `POST /users/invite-state-member` | Invite (or restore a previously-removed) reviewer/viewer |
| `PATCH /users/{memberId}/sub-role` | Change Editor ↔ Viewer |
| `DELETE /users/{memberId}` | Soft-remove a member |
| `POST /users/transfer-submitter` | Hand off the Submitter/Admin role — **backend + frontend TS logic exist and are wired, but the entire Transfer Ownership UI block is commented out in the HTML** (`TODO: re-enable after fixing isNodalOfficer sync on transfer + restore`). Not reachable through the UI today. |

Roles shown: `SUBMITTER / EDITOR / VIEWER` (maps to backend `xviFcSubrole: admin/reviewer/viewer`). Status badge: `ACTIVE` vs `PENDING` driven by `isXVIFCProfileVerified`.

### 4.3 MoHUA — `mohua-module/roles-teams-overview/`

Near-identical architecture and behavior to STATE, parallel endpoint set:

`GET /users/mohua-permission-matrix`, `GET /users/mohua-members`, `POST /users/invite-mohua-member`, `PATCH /users/mohua-members/{id}/sub-role`, `DELETE /users/mohua-members/{id}`, `POST /users/mohua-members/transfer-submitter`.

Same Transfer Ownership UI-block-commented-out situation, same reasoning/TODO. Minor differences: role-edit pencil is hidden on the current user's own row (STATE doesn't hide it), slightly different banner copy/colors, an admin-only `POST /users/patch-mohua-core-subroles` exists for fixing two hardcoded MoHUA accounts.

### 4.4 Summary table

| | ULB | STATE | MoHUA |
|---|---|---|---|
| Page is | Contact editor (2 fixed contacts) | Team member manager | Team member manager |
| Invite | ❌ | ✅ | ✅ |
| Change role | ❌ | ✅ | ✅ |
| Remove member | ❌ | ✅ | ✅ |
| Transfer ownership | ❌ | Built, **UI hidden** | Built, **UI hidden** |
| Backing model | `ProfileContactsApiResponse` | `StateMember` | `MohuaMember` (identical shape to `StateMember`) |

---

## 5. Role / permission model reference

- Real sub-role field: **`xviFcSubrole: 'admin' | 'reviewer' | 'viewer' | null`** on the `User` schema — this is the real thing the design doc's `xviFcRole` proposal was describing; it already exists and is in active use. Frontend display labels: `admin→SUBMITTER, reviewer→EDITOR, viewer→VIEWER`.
- Primary `role` enum values in use: `ADMIN, MoHUA, PARTNER, STATE, ULB, USER, XVIFC_STATE, STATE_DASHBOARD, AFS_ADMIN, XVIFC, PMU, AAINA, ULB-EDITOR, ULB-VIEWER, STATE-EDITOR, STATE-VIEWER`.
- **`MoHUA` is the real role string** (mixed case) — not `MOHUA`. All-caps `MOHUA` only exists as a derived `Scope` enum value used internally for permission-matrix selection, never as the persisted `role`.
- `isXviFcdeleted` (XVI-FC-scoped soft delete) is distinct from the legacy global `isDeleted`.
- ⚠️ **Almost every `@RequirePermissions(...)` decorator on `users.controller.ts` routes is commented out.** `PermissionGuard` treats an empty required-permission list as "allow", so these routes are currently protected only by "must be authenticated" (global `JwtAuthGuard`) plus manual in-service role checks (e.g. `transferSubmitter` checks `requester.role === STATE && requester.xviFcSubrole === 'admin'` itself). This is a real gap worth flagging to whoever owns backend security review, not just a documentation nuance.
- `POST /users` (`create`) takes an **empty `CreateUserDto`** — no field validation currently happens on that route.
- `PATCH /users/:id/role` (`updateUserRole`) is fully commented out — dead code, not a live route.

---

## 6. File map (for whoever picks this up next)

**Frontend (`cityfinance-ng-ui-v2`)**
- `src/app/auth/login/login.component.ts` / `.html`, `login.service.ts`
- `src/app/auth/forgot-password/forgot-password.component.ts` / `.html`
- `src/app/core/auth/auth.service.ts` (`OtpAuthService`), `src/app/core/auth/otp.models.ts`
- `src/app/core/services/auth.service.ts` (legacy `AuthService` — actual login POST + token storage)
- `src/app/core/guards/auth.guard.ts` (`authGuard`, `xvifcAuthGuard`)
- `src/app/core/constants/login-menu.constant.ts` (`ROUTE_PAGES`)
- `src/app/features/xvi-fc-module/shared/profile-verification/*`
- `src/app/features/xvi-fc-module/shared/years-selection/years-selection.component.ts`
- `src/app/features/xvi-fc-module/ulb-module/roles-teams-overview/*`
- `src/app/features/xvi-fc-module/state-module/roles-teams-overview/*`
- `src/app/features/xvi-fc-module/mohua-module/roles-teams-overview/*`

**Backend (`cf-nest-api-v2`)**
- `src/module/auth/auth.controller.ts`, `login.service.ts`, `auth.service.ts`, `otp.service.ts`, `otp/otp.config.ts`
- `src/module/auth/strategies/jwt.strategy.ts`, `jwt-refresh.strategy.ts`
- `src/module/auth/permission.guard.ts`
- `src/module/auth/enum/role.enum.ts`, `roles-xvi-fc.enum.ts`
- `src/module/users/users.controller.ts`, `users.service.ts`
- `src/schemas/user/user.schema.ts`
- `src/main.ts` (global prefix `api/v2`)

---

*This doc describes current behavior only. If you implement changes described in `xvifc-multi-role-design.md`, update this file to match, or delete the parts of that design doc that no longer apply so the two don't keep drifting apart.*
