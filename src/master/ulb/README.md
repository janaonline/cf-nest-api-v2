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

| Method   | Route                          | Roles             | Notes                                                                                                     |
| -------- | ------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `POST`   | `master/ulb`                   | ADMIN, STATE      | ADMIN submissions auto-approve; STATE submissions are scoped to the requester's state and start `PENDING` |
| `GET`    | `master/ulb`                   | any authenticated | STATE users are always scoped to their own state                                                          |
| `GET`    | `master/ulb/types`             | any authenticated | ULB types for a select                                                                                    |
| `GET`    | `master/ulb/register-sections` | any authenticated | Resolved section/field config for the Register ULB page                                                   |
| `GET`    | `master/ulb/edit-sections`     | ADMIN             | Resolved section/field config for the Edit ULB dialog                                                     |
| `GET`    | `master/ulb/:id`               | any authenticated |                                                                                                           |
| `PATCH`  | `master/ulb/:id`               | ADMIN, STATE      | STATE may only edit their own state's `REJECTED` ULB, which resets it to `PENDING`                        |
| `PATCH`  | `master/ulb/:id/approve`       | ADMIN             | See [Approval and onboarding](#registration--onboarding--approval-flow) below                             |
| `PATCH`  | `master/ulb/:id/reject`        | ADMIN             |                                                                                                           |
| `DELETE` | `master/ulb/:id`               | ADMIN             | Soft-delete via `isActive: false`                                                                         |

## Primary Contact fields

The Register ULB page collects four fields describing the person who becomes the ULB's first
login — `primaryContactName` / `primaryContactDesignation` / `primaryContactEmail` /
`primaryContactMobile` (keys: `ULB_PRIMARY_CONTACT_FIELD_KEYS`). `UlbService.create()` strips
these out of the `Ulb` patch (`extractPrimaryContact()`) — they are never persisted onto the `Ulb`
document itself.

## Registration → onboarding → approval flow

Accounts provisioned by this module are **never emailed a password, temporary or otherwise**. The
account is created with a random, unguessable password hash that nobody is ever shown; the only
way to actually unlock the login is the app-wide Forgot Password OTP flow.

### 1. ULB creation (`UlbService.create()`)

- Validates the primary contact's email isn't already registered to another account
  (`ensureContactNotRegistered`) and that its domain actually accepts mail
  (`ensureEmailDomainIsReachable`, via `EmailDomainValidationService`).
- Persists the `Ulb` document. If created by a STATE user it starts `approval.status: 'PENDING'`,
  `isActive: false`; if created by ADMIN it's auto-approved.
- Provisions the login itself, via `createPrimaryContactUser()`:
  - Generates a random password via `generatePlaceholderPassword()` and bcrypt-hashes it — this
    value is never sent anywhere, it exists purely to satisfy the schema's required `password`
    field.
  - Creates a `Role.ULB` `User` document with:
    - `name` / `email` / `mobile` / `designation` — the login identity, copied from the primary
      contact fields (`email`/`mobile` also drive the duplicate-account and MX checks above, and
      are what the Forgot Password flow resolves the account by).
    - `accountantName` / `accountantEmail` / `accountantConatactNumber` — the same contact
      mirrored onto these embedded fields so this ULB's contact card shows up the same way
      legacy ULB documents do wherever XVI-FC's contact-extraction logic reads them (see
      `src/module/xvi-fc/xvifc-multi-role-design.md`, §7 Contact Extraction Rules).
    - `censusCode` / `sbCode` — copied from the `Ulb` patch, because ULB logins authenticate by
      census/SB code, not email (`UsersRepository.resolveByIdentifier()` looks these up on
      `User`, not on `Ulb`) — this is also the identifier the contact uses on the Forgot Password
      page to request an OTP.
    - `isNewUser: true` — cleared once the contact successfully resets their password (see
      step 3), or once profile verification completes.
    - `isActive`: mirrors the owning `Ulb`'s approval state — `true` for an auto-approved
      (ADMIN) submission, `false` for a `PENDING` (STATE) one.
  - If the login is active (ADMIN path), queues the invite email immediately
    (`ulb-member-invite` template), telling the contact to set their password. If it's inactive
    (STATE path), **no email is sent yet** — telling someone to set a password for a login that
    can't authenticate yet would be confusing.

### 2. Approval (`UlbService.approve()`)

- Flips `Ulb.approval.status` to `APPROVED` and `Ulb.isActive: true`.
- Finds every `User` tied to this ULB that is still `isActive: false`.
- For each: if it's a first-time login (`isNewUser && email`), calls
  `activateAndInviteContact()`; otherwise just flips `isActive: true` (covers re-approving an
  already-active ULB, e.g. a stray double-click, without re-sending invites).
- `activateAndInviteContact()` just flips `isActive: true` and queues the invite email — there's
  no password to regenerate, since nothing was ever emailed at creation time either.

### 3. Setting a password — the Forgot Password OTP flow

There's no temp password and no expiry to worry about. The invite/approval email's "Set Your
Password" button sends the contact to the app's existing Forgot Password page
(`/auth/forgot-password`), which:

1. `POST /auth/sendOtp` with `{ identifier: censusCode, purpose: 'forgot-password' }` — sends an
   OTP to the account's contact mobile/email (`OtpService.sendOtp()`).
2. `POST /auth/forgot-password/reset` with the OTP and a new password
   (`OtpService.forgotPasswordReset()`) — verifies the OTP, sets the password, and clears
   `isNewUser` if this was the account's first-ever password.

This is the same flow used app-wide (STATE/MoHUA member invites work identically — see
`UsersService`), and it isn't specific to XVI-FC or to first-time accounts: existing users use the
exact same endpoints to recover a forgotten password.

## Testing

```bash
npx jest src/master/ulb/ulb.service.spec.ts
npx jest src/master/ulb/ulb.controller.spec.ts
```
