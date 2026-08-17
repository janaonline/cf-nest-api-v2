# Master ULB (`src/master/ulb`)

## Purpose

CRUD and lifecycle management for the `Ulb` master-data collection — the reference list of Urban
Local Bodies shared across grant cycles (XVI-FC, 15th FC, etc). Distinct from `src/module/xvi-fc`,
which builds grant-cycle-specific forms on top of this master data.

Two related but separate things live here:
1. **ULB CRUD** — create/list/update/approve/reject/remove `Ulb` documents, with an
   admin-configurable dynamic field/section layout (`FormJsonService`, `ULB_MASTER` /
   `ULB_REGISTER_SECTIONS` / `ULB_EDIT_SECTIONS` types, falling back to `DEFAULT_ULB_*` in
   [`constants/ulb-form.constants.ts`](constants/ulb-form.constants.ts)).
2. **Primary-contact onboarding** — when a ULB is created, its "Primary Contact" fields (from the
   Register ULB page) provision that person's first login. This document covers that flow in
   detail, since it spans creation, approval, and login.

## Endpoints

| Method | Route | Roles | Notes |
|---|---|---|---|
| `POST` | `master/ulb` | ADMIN, STATE | ADMIN submissions auto-approve; STATE submissions are scoped to the requester's state and start `PENDING` |
| `GET` | `master/ulb` | any authenticated | STATE users are always scoped to their own state |
| `GET` | `master/ulb/types` | any authenticated | ULB types for a select |
| `GET` | `master/ulb/register-sections` | any authenticated | Resolved section/field config for the Register ULB page |
| `GET` | `master/ulb/edit-sections` | ADMIN | Resolved section/field config for the Edit ULB dialog |
| `GET` | `master/ulb/:id` | any authenticated | |
| `PATCH` | `master/ulb/:id` | ADMIN, STATE | STATE may only edit their own state's `REJECTED` ULB, which resets it to `PENDING` |
| `PATCH` | `master/ulb/:id/approve` | ADMIN | See [Approval and onboarding](#approval-and-onboarding) below |
| `PATCH` | `master/ulb/:id/reject` | ADMIN | |
| `DELETE` | `master/ulb/:id` | ADMIN | Soft-delete via `isActive: false` |

## Primary Contact fields

The Register ULB page collects four fields describing the person who becomes the ULB's first
login — `primaryContactName` / `primaryContactDesignation` / `primaryContactEmail` /
`primaryContactMobile` (keys: `ULB_PRIMARY_CONTACT_FIELD_KEYS`). `UlbService.create()` strips
these out of the `Ulb` patch (`extractPrimaryContact()`) — they are never persisted onto the `Ulb`
document itself.

## Registration → onboarding → approval flow

### 1. ULB creation (`UlbService.create()`)

- Validates the primary contact's email isn't already registered to another account
  (`ensureContactNotRegistered`) and that its domain actually accepts mail
  (`ensureEmailDomainIsReachable`, via `EmailDomainValidationService`).
- Persists the `Ulb` document. If created by a STATE user it starts `approval.status: 'PENDING'`,
  `isActive: false`; if created by ADMIN it's auto-approved.
- Provisions the login itself, via `createPrimaryContactUser()`:
  - Generates a random temp password, bcrypt-hashes it.
  - Creates a `Role.ULB` `User` document with:
    - `name` / `email` / `mobile` / `designation` — the login identity, copied from the primary
      contact fields (`email`/`mobile` also drive the duplicate-account and MX checks above).
    - `accountantName` / `accountantEmail` / `accountantConatactNumber` — the same contact
      mirrored onto these embedded fields so this ULB's contact card shows up the same way
      legacy ULB documents do wherever XVI-FC's contact-extraction logic reads them (see
      `src/module/xvi-fc/xvifc-multi-role-design.md`, §7 Contact Extraction Rules).
    - `censusCode` / `sbCode` — copied from the `Ulb` patch, because ULB logins authenticate by
      census/SB code, not email (`UsersRepository.resolveByIdentifier()` looks these up on
      `User`, not on `Ulb`).
    - `isNewUser: true`, `tempPasswordExpiresAt: now + 72h` (`TEMP_PASSWORD_TTL_MS`).
    - `isActive`: mirrors the owning `Ulb`'s approval state — `true` for an auto-approved
      (ADMIN) submission, `false` for a `PENDING` (STATE) one.
  - If the login is active (ADMIN path), queues the invite email immediately
    (`ulb-member-invite` template) with the login code and temp password. If it's inactive
    (STATE path), **no email is sent yet** — sending credentials for a login that can't
    authenticate would be confusing, and the temp password could well be past its TTL by the
    time an ADMIN gets around to approving it.

### 2. Approval (`UlbService.approve()`)

- Flips `Ulb.approval.status` to `APPROVED` and `Ulb.isActive: true`.
- Finds every `User` tied to this ULB that is still `isActive: false`.
- For each: if it's a first-time login (`isNewUser && email`), calls
  `activateAndInviteContact()`; otherwise just flips `isActive: true` (covers re-approving an
  already-active ULB, e.g. a stray double-click, without re-sending invites).
- `activateAndInviteContact()` **regenerates** the temp password rather than reusing the one
  hashed at creation time (that one was never emailed and may already be near/past its TTL by
  approval time), resets `tempPasswordExpiresAt` to `now + 72h`, sets `isActive: true`, saves,
  and queues the invite email.

### 3. Temp-password expiry — checked at login, not on a timer

There's no background job expiring temp passwords. `LoginService.login()`
([`src/module/auth/login.service.ts`](../../module/auth/login.service.ts)) checks the stored
timestamp live, after credentials are validated:

```ts
if (user.isNewUser && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
  throw new ForbiddenException('Your temporary password has expired...');
}
```

If a user doesn't log in within 72 hours of (re-)provisioning, their next login attempt is
rejected with this message. There's no self-service resend — the message tells them to contact
an administrator, who would need to re-trigger provisioning/invite for that account.

### 4. Clearing the temp-password state

Once the user logs in on the temp password, the frontend forces a password-setup step
(`isNewUser: true` in the login response), which calls `PATCH /auth/set-new-password`. This is
handled by `AuthService.setNewPassword()`
([`src/module/auth/auth.service.ts`](../../module/auth/auth.service.ts)), which sets
`isNewUser: false` and `tempPasswordExpiresAt: null` — after this, the login.service.ts expiry
check above no longer applies to that account.

## Testing

```bash
npx jest src/master/ulb/ulb.service.spec.ts
npx jest src/master/ulb/ulb.controller.spec.ts
```
