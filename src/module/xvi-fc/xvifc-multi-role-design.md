# XVI-FC Multi-Role Migration — Design Document

> **Purpose**: Source of truth for the multi-role (submitter / editor / viewer) migration design for the XVI Finance Commission module. All implementation decisions, workflows, edge cases, and API contracts are defined here. Read this before making any changes to profile verification, user management, or role logic in the XVI-FC module.
>
> **Last updated**: 2026-06-18 (rev 2 — added overview page team management, role change rules, transfer ownership rules)
>
> **Status**: Design complete. Implementation pending.

---

## Table of Contents

1. [Background and Problem Statement](#1-background-and-problem-statement)
2. [The Two User Types — ULB vs STATE](#2-the-two-user-types--ulb-vs-state)
3. [Real User Object Analysis](#3-real-user-object-analysis)
4. [The `xviFcRole` Field — Core Design Decision](#4-the-xvifcrole-field--core-design-decision)
5. [Complete Workflow — Login to Overview](#5-complete-workflow--login-to-overview)
6. [Profile Verification Page — Detailed Flow](#6-profile-verification-page--detailed-flow)
7. [Contact Extraction Rules](#7-contact-extraction-rules)
8. [All Edge Cases](#8-all-edge-cases)
9. [Permission Matrix Analysis](#9-permission-matrix-analysis)
10. [Transfer Ownership Implications](#10-transfer-ownership-implications)
11. [Old Portal Compatibility Constraints](#11-old-portal-compatibility-constraints)
12. [APIs to Build](#12-apis-to-build)
13. [File-by-File Changes Required](#13-file-by-file-changes-required)
14. [Data Quality Issues in Legacy Data](#14-data-quality-issues-in-legacy-data)
15. [Overview Page — Suggested Members Pattern](#15-overview-page--suggested-members-pattern)
16. [Role Change Rules — Editor ↔ Viewer](#16-role-change-rules--editor--viewer)
17. [Transfer Ownership Rules](#17-transfer-ownership-rules)
18. [Session Management — JWT and Account Transitions](#18-session-management--jwt-and-account-transitions)
19. [Routing Guard Rules](#19-routing-guard-rules)
20. [OTP Abandon, Resume and Pending State Machine](#20-otp-abandon-resume-and-pending-state-machine)
21. [Transfer Ownership — Force Logout Behaviour](#21-transfer-ownership--force-logout-behaviour)

---

## 1. Background and Problem Statement

### What existed (15th FC / old system)

The old CityFinance portal has one user account per entity:

```
ULB   → role: ULB   → one institutional account per ULB
                       login: censusCode + password
                       name: org name (e.g. "Rajnandgaon Municipal Corporation")
                       multiple embedded contacts stored ON the user document

STATE → role: STATE → one OR MORE personal accounts per state
                       login: email + password
                       each account is a real person
                       each account also has embedded contacts
```

These accounts continue to work for the old portal. They cannot be broken.

### What is being built (XVI-FC)

The XVI Finance Commission module adds a multi-role team structure on top of the existing user accounts:

```
ULB scope:
  Submitter  (1 per ULB)   — can upload, final submit, manage team
  Editor     (0..N per ULB) — can upload, review. Cannot final submit or manage team.
  Viewer     (0..N per ULB) — read-only access

STATE scope:
  Submitter  (1 per state)   — can approve, final submit to MoHUA, manage team
  Editor     (0..N per state) — can upload, review ULB submissions, edit state forms
  Viewer     (0..N per state) — read-only access
```

### The migration challenge

The old `role` field on the User document drives both:
- Old portal access (must not change)
- XVI-FC permissions (needs to evolve)

These two concerns must be decoupled. The solution is a new field `xviFcRole` on the User schema that drives XVI-FC display and submitter designation, while the original `role` field remains untouched for old portal compatibility.

---

## 2. The Two User Types — ULB vs STATE

Understanding this distinction is critical. Every design decision flows from it.

### ULB Account — Institutional

```
role:    ULB
login:   censusCode + password  (censusCode is the login credential)
email:   shared institutional email (e.g. nigamrajnandgaon@gmail.com)
         NOT used for login. Safe to update.
name:    organisation name (e.g. "Rajnandgaon Municipal Corporation")
         NOT a person's name.
mobile:  often null (no personal mobile on institutional account)
count:   exactly ONE per ULB
```

Key point: The `email` field on a ULB account is a shared institutional email. Multiple contacts in the same ULB document share the same email. It is NOT a login credential. It is safe to update during XVI-FC profile verification.

### STATE Account — Personal

```
role:    STATE
login:   email + password  (email IS the login credential)
email:   personal email of the individual (e.g. ritalpachuau@gmail.com)
         CRITICAL: do not change. If changed, user cannot log in.
name:    person's name (but may be corrupted — see legacy data issues)
mobile:  person's personal mobile
count:   ONE or MORE per state (multiple state officials have separate accounts)
```

Key point: The `email` field on a STATE account is the login credential. Changing it will permanently lock the user out. It must NEVER be updated during XVI-FC profile verification.

---

## 3. Real User Object Analysis

### ULB Example — Rajnandgaon Municipal Corporation

```json
{
  "_id": "5fcb9f1d6e7a0139dc6b61b1",
  "role": "ULB",
  "name": "Rajnandgaon Municipal Corporation",
  "email": "nigamrajnandgaon@gmail.com",
  "mobile": null,
  "censusCode": "801991",
  "designation": "",
  "accountantName": "U K Ramteke",
  "accountantEmail": "nigamrajnandgaon@gmail.com",
  "accountantConatactNumber": "9827118810",
  "commissionerName": "Abhishek Kumar Gupta",
  "commissionerEmail": "nigamrajnandgaon@gmail.com",
  "commissionerConatactNumber": "9407720005",
  "departmentName": "",
  "departmentEmail": "",
  "departmentContactNumber": ""
}
```

**What can be extracted:**

| # | Person | Mobile | Source | Show? |
|---|---|---|---|---|
| 1 | U K Ramteke | 9827118810 | accountant | YES |
| 2 | Abhishek Kumar Gupta | 9407720005 | commissioner | YES |
| 3 | Rajnandgaon Municipal Corporation | null | main | NO — org name, no mobile |
| 4 | Department | — | department | NO — empty fields |

**Observations:**
- All three contacts share the same institutional email. Do NOT deduplicate by email.
- Only deduplicate by mobile number.
- The ULB's own `name` is an org name — skip it from the contacts list.
- The ULB's `mobile` is null — skip main account from the list.

---

### STATE Example — Mizoram (ritalpachuau@gmail.com)

```json
{
  "_id": "5ef9e1fb1f67e03c215cb8ff",
  "role": "STATE",
  "name": "ritalpachuau@gmail.com",
  "email": "ritalpachuau@gmail.com",
  "mobile": "9436141270",
  "designation": "Joint Director",
  "state": "5dcf9d7416a06aed41c748f3",
  "departmentName": "Urban Development and Poverty Alleviation",
  "departmentContactNumber": "9436141270",
  "departmentEmail": "dirudpa.mz@gmail.com",
  "commissionerName": "",
  "commissionerEmail": "",
  "commissionerConatactNumber": "",
  "accountantName": "",
  "accountantEmail": "",
  "accountantConatactNumber": ""
}
```

**What can be extracted:**

| # | Person | Mobile | Source | Show? |
|---|---|---|---|---|
| 1 | ritalpachuau@gmail.com | 9436141270 | main | YES — but name is corrupted (email in name field). Display email as name. |
| 2 | Urban Development and Poverty Alleviation | 9436141270 | department | NO — same mobile as main, deduplicate. Also org name not person. |
| 3 | Commissioner | — | commissioner | NO — empty |
| 4 | Accountant | — | accountant | NO — empty |

**Final list from this document: 1 person** (the logged-in user themselves, with corrected name display)

**For STATE**: Query ALL `role: STATE` + `role: STATE-EDITOR` + `role: STATE-VIEWER` users for the same `stateId` and extract contacts from each. Combine and deduplicate by mobile across all documents.

---

## 4. The `xviFcRole` Field — Core Design Decision

### The Problem

The `role` field currently drives both old portal access AND XVI-FC permissions. We cannot safely change `role: STATE` to `role: STATE-EDITOR` for legacy users — they would lose old portal access. We need a parallel field.

### The Solution

Add `xviFcRole` to the User schema as a completely separate field:

```typescript
// In user.schema.ts
@Prop({
  type: String,
  enum: ['submitter', 'editor', 'viewer', null],
  default: null,
})
xviFcRole: 'submitter' | 'editor' | 'viewer' | null;
```

### How the two fields coexist

```
Old portal reads:   role  (STATE, ULB, MOHUA, etc.)  ← never touched
XVI-FC reads:       xviFcRole (submitter, editor, viewer, null)  ← new
```

### State of each user type

| User type | `role` | `xviFcRole` initial | `xviFcRole` after verification | Old portal | XVI-FC display |
|---|---|---|---|---|---|
| Legacy ULB account | ULB | null | submitter | Works | Submitter |
| Legacy STATE account (first to verify) | STATE | null | submitter | Works | Submitter |
| Legacy STATE account (verified after submitter exists) | STATE | null | editor | Works | Editor |
| New editor via team management | ULB-EDITOR or STATE-EDITOR | editor | editor | No access (correct) | Editor |
| New viewer via team management | ULB-VIEWER or STATE-VIEWER | viewer | viewer | No access (correct) | Viewer |
| Legacy STATE account (not yet verified) | STATE | null | null | Works | Shown as unverified |

### Why not change the `role` field?

If we change `role: STATE → STATE-EDITOR` for a legacy user, that user would:
1. Lose old portal access (old portal gates on `role: STATE`)
2. Lose MANAGE_USERS and FINAL_SUBMIT_TO_MOHUA permissions (STATE-EDITOR does not have these)
3. Break their ability to log in if their password was shared

This is an unacceptable production risk. `xviFcRole` is the safe decoupling mechanism.

### `xviFcRole` is NOT in the JWT

The JWT continues to carry `role` only. The `PermissionGuard` reads `role` from the JWT. `xviFcRole` is a schema-level field used for:
- Display/labeling in the UI (Submitter / Editor / Viewer badge)
- Determining who is the designated XVI-FC submitter for a state/ULB
- Sorting in the team members list (submitter first)
- The `mapRole()` function in `users.service.ts`

### The migration-period permission gap (by design, acceptable)

During the migration period, legacy STATE users who are designated as `xviFcRole: editor` will still have `role: STATE` → `ROLE_PERMISSIONS[STATE]` includes `MANAGE_USERS`. This means they technically can call team management APIs.

This is **intentional and acceptable** because:
- All legacy STATE users are authorized state government officials
- They had full access before migration — this is not a new escalation
- The gap closes naturally as migration completes (only one submitter per state remains active)
- After full migration, only the designated submitter has `xviFcRole: submitter` and is used as the primary contact

---

## 5. Complete Workflow — Login to Overview

```
USER LOGS IN (identical to today — 15th FC credentials unchanged)
│
│   ULB user:   censusCode + password
│   STATE user: email + password
│   New editor: email + password
│
▼
JWT issued
  { _id, role, scope, ulb/state, permissionOverrides }
│
▼
XVI-FC FRONTEND ROUTING GUARD
│
├─ isXVIFCProfileVerified === true  ────────────────────► XVI-FC OVERVIEW PAGE
│
└─ isXVIFCProfileVerified === false ────────────────────► PROFILE VERIFICATION PAGE
                                                           (one-time, never shown again)
```

Once `isXVIFCProfileVerified: true` is set on the user document, that user goes directly to the overview page on every subsequent login. The verification page is a one-time onboarding gate.

---

## 6. Profile Verification Page — Detailed Flow

### Purpose

This page exists to answer one question: **"Who is the real person behind this account?"**

The old ULB/STATE accounts were created with org-level or shared credentials. The XVI-FC module needs a real verified person (with a confirmed mobile number) as the submitter. This page bridges that gap.

### What the page does NOT do

- It does NOT let the admin designate someone else as submitter from a remote location.
- It does NOT send activation links or emails.
- It IS synchronous — the verified person must be physically present to enter the OTP.
- After verification, the person is immediately active as submitter.

### Full flow diagram

```
PROFILE VERIFICATION PAGE
│
│  Backend: GET /users/verification-contacts
│  → Returns extracted contact list (see Section 7)
│
▼
┌─────────────────────────────────────────────────────────────────────┐
│  "Who are you? We found these contacts for your ULB/State."        │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  👤 U K Ramteke                                             │   │
│  │     Accountant  ·  +91 98271 XXXXX                         │   │
│  │                                      [ This is me → ]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  👤 Abhishek Kumar Gupta                                    │   │
│  │     Commissioner  ·  +91 94077 XXXXX                       │   │
│  │                                      [ This is me → ]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ─────────────────────────────────────────────────────────────     │
│                                                                     │
│  My name is not in this list          [ Add myself → ]             │
└─────────────────────────────────────────────────────────────────────┘
          │                                        │
          │ PATH A                                 │ PATH B
          │ "This is me" selected                  │ "Add myself" clicked
          ▼                                        ▼
┌────────────────────────────┐     ┌──────────────────────────────────┐
│  CONFIRM DETAILS           │     │  ENTER YOUR DETAILS              │
│                            │     │                                  │
│  Name:        [pre-filled] │     │  Name:        [_______________]  │
│  Designation: [pre-filled] │     │  Designation: [_______________]  │
│  Mobile:      [pre-filled] │     │  Mobile:      [+91 __________]   │
│  Email:       [pre-filled] │     │  Email:       [_______________]  │
│               (STATE: locked│     │                                  │
│               ULB: editable)│     │  [Send OTP to this mobile]       │
│                            │     └──────────────────────────────────┘
│  [Send OTP to this mobile] │                     │
└────────────────────────────┘                     │
          │                                        │
          └──────────────┬─────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────┐
            │  MOBILE OTP VERIFICATION   │
            │                            │
            │  "We sent a 6-digit code   │
            │  to +91 XXXXXX XXXX"       │
            │                            │
            │  [ _ ][ _ ][ _ ][ _ ][ _ ][ _ ]  │
            │                            │
            │  [Verify OTP]              │
            │  Resend in 30s             │
            │  Max 3 attempts            │
            └──────────┬─────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
           │ PATH A                │ PATH B
           │ (existing contact)    │ (new person)
           ▼                       ▼
  OTP verified.           OTP verified.
  No password setup       ┌─────────────────────────────┐
  needed — they already   │  SET YOUR PASSWORD           │
  have a password         │                             │
  (or it's the same ULB/  │  Password:    [___________] │
  STATE account they       │  Confirm:     [___________] │
  logged in with).         │  [Activate Account]         │
                          └──────────────────────────────┘
           │                       │
           └──────────┬────────────┘
                      │
                      ▼
         BACKEND: POST /users/verify-profile/confirm
         ┌──────────────────────────────────────────────────────┐
         │                                                      │
         │  1. Confirm OTP is valid                             │
         │                                                      │
         │  2. Find or create user document:                    │
         │     PATH A — existing contact with real account:     │
         │       → update their OWN document in place           │
         │     PATH A — contact only in embedded fields:        │
         │       → create new user document                     │
         │     PATH B — always create new user document         │
         │                                                      │
         │  3. Determine xviFcRole:                             │
         │     Query: any user in this ulb/state with           │
         │     xviFcRole: 'submitter' already?                  │
         │       NO  → set xviFcRole: 'submitter'               │
         │       YES → set xviFcRole: 'editor'                  │
         │     (use atomic findOneAndUpdate to prevent race)    │
         │                                                      │
         │  4. Set fields:                                      │
         │     isXVIFCProfileVerified: true                     │
         │     isActive: true                                   │
         │     Update: name, mobile, designation                │
         │     STATE users: NEVER update email                  │
         │     ULB users: email can be updated                  │
         │                                                      │
         │  5. PATH B new submitter only:                       │
         │     If xviFcRole set to 'submitter' AND              │
         │     role is ULB-EDITOR / STATE-EDITOR:               │
         │     → add to permissionOverrides.allow:              │
         │       [MANAGE_USERS, CREATE_MANAGED_USER,            │
         │        UPDATE_MANAGED_USER, DELETE_MANAGED_USER,     │
         │        FINAL_SUBMIT_TO_STATE_DMA / FINAL_SUBMIT_TO_MOHUA] │
         │                                                      │
         └──────────────────────────────────────────────────────┘
                      │
                      ▼
            XVI-FC OVERVIEW PAGE
```

### PATH A — Selecting an existing contact

When user clicks "This is me" on a contact card:

**Case A1 — The contact IS the logged-in user's own account:**
- Mobile in contact card matches `mobile` on the logged-in user's document
- Action: update the logged-in user's own document
- No new account created
- No password setup needed (they already have a password — they just logged in)

**Case A2 — The contact is an embedded field (accountantName etc.) on the ULB/STATE document:**
- Mobile in contact card is in `accountantConatactNumber`, `commissionerConatactNumber`, etc.
- Check: does any user document exist with this mobile?
  - YES → that person already has an account → update it
  - NO  → create a new user document for them. Role: `ULB-EDITOR` or `STATE-EDITOR`. Set `isActive: false` initially, then activate after OTP.

**Case A3 — The contact is from ANOTHER STATE user's document (STATE scope only):**
- Mobile belongs to a different `role: STATE` person for the same state
- That person already has their own account
- Action: They must log in with THEIR OWN credentials and verify themselves
- Response to current user: "This person already has an account. Ask them to log in and complete their profile."

### PATH B — Adding a new person

- User fills: name, mobile, email, designation
- System checks: is this mobile already registered?
  - YES → "This mobile is already registered. If this is you, please log in with your credentials."
  - NO  → create new user document, send OTP
- After OTP verified → set password screen → account active
- xviFcRole determined by first-verifier-wins check

---

## 7. Contact Extraction Rules

### For ULB (single document)

```
Input:  one ULB user document
Output: list of real person contacts

Rules:
1. Skip main account (name is org name, mobile is null)
   → Detection: role === 'ULB' AND (mobile === null OR name has no spaces
     after trim OR name matches ULB name from ulb collection)

2. Include accountant if accountantName is non-empty AND
   accountantConatactNumber is non-empty
   → { name: accountantName, mobile: accountantConatactNumber,
       email: accountantEmail, designation: 'Accountant',
       source: 'accountant' }

3. Include commissioner if commissionerName is non-empty AND
   commissionerConatactNumber is non-empty
   → { name: commissionerName, mobile: commissionerConatactNumber,
       email: commissionerEmail, designation: 'Commissioner',
       source: 'commissioner' }

4. Include department if departmentName is non-empty AND
   departmentContactNumber is non-empty AND
   departmentName does NOT look like an org name
   → { name: departmentName, mobile: departmentContactNumber,
       email: departmentEmail, designation: 'Department',
       source: 'department' }

5. Deduplicate by mobile (normalized, strip country code):
   → Keep the first occurrence. If same mobile appears in
     accountant AND commissioner, show only once (prefer
     the one with more data filled in).

6. Skip corrupted accounts:
   → email.includes('.deleted.') → skip entirely
   → isDeleted: true → skip
```

### For STATE (multiple documents)

```
Input:  ALL user documents for stateId with role IN
        [STATE, STATE-EDITOR, STATE-VIEWER]
Output: combined deduplicated list of real persons

Rules:
1. For each state user document, extract contacts:

   a. Main account person:
      → Include if mobile is non-empty
      → name may be corrupted (email in name field — detect with email regex)
        If name looks like an email → use email as display name
      → { name: cleanedName, mobile, email, designation, source: 'main',
          userId: user._id }

   b. Extract embedded contacts (same rules as ULB above)
      BUT: embedded contacts on STATE documents are rarer.
      departmentName on STATE docs is often a department/org name not a person —
      skip if it looks like an org name.

2. After extracting from ALL documents, deduplicate by mobile across
   the full combined list.
   → If same mobile appears in two different STATE user documents,
     prefer the one where source === 'main' (real account wins over
     embedded contact).

3. Skip corrupted accounts:
   → email.includes('.deleted.') → skip
   → isDeleted: true → skip
   → isActive: false AND isXVIFCProfileVerified: true → show as
     "Already verified" badge, not selectable

4. Show already-verified users with a badge:
   → isXVIFCProfileVerified: true → show "Verified ✓" badge
   → These are non-selectable. The logged-in user cannot re-claim
     a mobile already verified by someone else.
```

### Helper: isOrgName detection

```typescript
function isOrgName(name: string): boolean {
  if (!name) return true;
  const orgKeywords = [
    'municipal', 'corporation', 'council', 'nagar', 'palika',
    'panchayat', 'department', 'authority', 'board', 'directorate',
    'urban development', 'pradesh', 'foundation', 'society',
  ];
  const lower = name.toLowerCase();
  return orgKeywords.some((kw) => lower.includes(kw));
}

function isEmailString(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
```

---

## 8. All Edge Cases

### During Profile Verification

| # | Scenario | Expected Behavior |
|---|---|---|
| EC-01 | STATE user verifies, no submitter exists for this state | `xviFcRole: submitter`, `isXVIFCProfileVerified: true` |
| EC-02 | STATE user verifies, submitter already exists | `xviFcRole: editor`, `isXVIFCProfileVerified: true` |
| EC-03 | Two STATE users verify simultaneously (race condition) | Use atomic `findOneAndUpdate` with `$setOnInsert` — only one gets submitter |
| EC-04 | ULB user verifies | Always `xviFcRole: submitter` (one ULB account per ULB) |
| EC-05 | User already verified, logs in again | `isXVIFCProfileVerified: true` → skip verification page entirely |
| EC-06 | STATE user tries to update their email during verification | Backend strips email from update payload for STATE users. Email field is locked. |
| EC-07 | ULB user updates email during verification | Allowed. ULB login is via censusCode, not email. |
| EC-08 | Selected contact mobile is already registered to another account | Show: "This mobile is registered to another user. They must log in and verify themselves." |
| EC-09 | Contact from another STATE user's document is selected | Show: "This person already has an account. Ask them to log in." |
| EC-10 | Corrupted email (`.deleted.xxx` suffix) | Exclude from contacts list entirely. Do not show. |
| EC-11 | Contact has no mobile number | Cannot be selected for verification. OTP requires a mobile. Show as non-selectable with tooltip "No mobile number on file". |
| EC-12 | OTP expires before user enters it | Show "OTP expired. Resend." button. Generate new OTP on resend. |
| EC-13 | OTP entered 3 times incorrectly | Lock for 10 minutes. Show: "Too many attempts. Try again in 10 minutes." |
| EC-14 | New user PATH B — mobile already registered | Show: "This mobile is already linked to an account. Log in with it instead." |
| EC-15 | New user PATH B — email already registered | Email uniqueness check. Show: "This email is already registered." |
| EC-16 | Contact list is empty (all contacts are org names / no mobiles) | Show only PATH B option. "No individual contacts found on file. Please add your details." |
| EC-17 | State has no STATE users at all | Edge case — show empty list with PATH B only |
| EC-18 | ULB user verifies with a contact that has a different email | For PATH A contact selection (embedded contact, not main account), let them set their own email at account creation time |

### During Team Management

| # | Scenario | Expected Behavior |
|---|---|---|
| EC-19 | Legacy STATE user with `xviFcRole: editor` calls MANAGE_USERS API | Succeeds (role: STATE → has permission). Migration-period gap. Acceptable. |
| EC-20 | Submitter soft-deletes themselves | Block. Cannot delete yourself. |
| EC-21 | Soft-delete of the only submitter | Block. State/ULB must have at least one active submitter. |
| EC-22 | Submitter tries to create another submitter via team management | Block. `createManagedUser` only allows EDITOR and VIEWER roles. |
| EC-23 | Editor tries to add a team member | Block. `CREATE_MANAGED_USER` permission required. Editors do not have it. |
| EC-24 | Admin queries team for a state and gets 130+ users | State query MUST include `role: { $in: [STATE, STATE-EDITOR, STATE-VIEWER] }`. ULB users also store stateId. Without this filter, all ULBs in the state appear. |
| EC-25 | Pending activation account (PATH B, OTP sent but password not set) | Show in team list with `status: PENDING`, `isActive: false`. Submitter can resend OTP from team page. |
| EC-26 | OTP for pending account expires (72 hours) | Account remains in PENDING state. Submitter must trigger OTP resend. |

---

## 9. Permission Matrix Analysis

### How permissions work (existing system)

```
User logs in → JWT has { role: 'STATE' }
                           │
                           ▼
PermissionGuard.canActivate()
  reads: user.role from JWT request
  calls: getEffectivePermissions({ role, permissionOverrides })
  looks up: ROLE_PERMISSIONS[role] → base permission array
  applies: permissionOverrides.allow (union)
  applies: permissionOverrides.deny  (subtract)
                           │
                           ▼
                      GRANT / DENY
```

### What `xviFcRole` does NOT change

`xviFcRole` is a schema field only. It is not in the JWT. The PermissionGuard never reads it.

| File | Impact of adding `xviFcRole` |
|---|---|
| `src/module/auth/permissions.map.ts` | **No changes needed.** `ROLE_PERMISSIONS` is keyed on `role` enum, not `xviFcRole`. |
| `src/module/auth/permission.guard.ts` | **No changes needed.** Reads `user.role` from JWT. |
| `src/module/auth/enum/roles-xvi-fc.enum.ts` | **No changes needed.** `Permission` enum unchanged. |
| JWT strategy / auth strategy | **No changes needed.** JWT carries `role` only. |

### The `mapRole()` function — what changes

Currently in `users.service.ts`:

```typescript
// CURRENT (wrong for multiple STATE users)
private mapRole(role: string): string {
  const r = (role ?? '').toUpperCase();
  if (r.includes('EDITOR')) return 'editor';
  if (r.includes('VIEWER')) return 'viewer';
  if (r === 'ULB' || r === 'STATE') return 'submitter'; // ALL legacy users = submitter (WRONG)
  return role;
}
```

After adding `xviFcRole`:

```typescript
// NEW (correct)
private mapRole(user: { role: string; xviFcRole?: string | null }): string {
  if (user.xviFcRole) return user.xviFcRole; // Trust xviFcRole if set
  // Fallback for users not yet through verification
  const r = (user.role ?? '').toUpperCase();
  if (r.includes('EDITOR')) return 'editor';
  if (r.includes('VIEWER')) return 'viewer';
  if (r === 'ULB' || r === 'STATE') return 'unverified'; // Not yet designated
  return user.role;
}
```

### Permission matrix display (ULB)

From `ULB_MATRIX` in `users.service.ts` — no changes needed to the matrix definition itself:

| Action | Submitter | Editor | Viewer |
|---|---|---|---|
| View status and reports | ✅ | ✅ | ✅ |
| Upload documents | ✅ | ✅ | ❌ |
| Message users | ✅ | ✅ | ❌ |
| Final submit to State DMA | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |

### Permission matrix display (STATE)

From `STATE_MATRIX` in `users.service.ts` — no changes needed:

| Action | Submitter | Editor | Viewer |
|---|---|---|---|
| View status and reports | ✅ | ✅ | ✅ |
| View dashboards | ✅ | ✅ | ✅ |
| Upload state-level documents | ✅ | ✅ | ❌ |
| Review ULB submissions | ✅ | ✅ | ❌ |
| Message users | ✅ | ✅ | ❌ |
| Approve ULB submissions | ✅ | ❌ | ❌ |
| Prepare grant letters | ✅ | ❌ | ❌ |
| Recommend exemptions | ✅ | ❌ | ❌ |
| Final submit to MoHUA | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |

### PATH B new submitter — the permission gap

A newly invited person (PATH B) gets `role: ULB-EDITOR` or `role: STATE-EDITOR`. But the permission matrix says submitters need `MANAGE_USERS`, `FINAL_SUBMIT_TO_MOHUA`, etc. — which `STATE-EDITOR` does not have.

**Fix**: When a PATH B user is designated as submitter (`xviFcRole: submitter`), automatically populate their `permissionOverrides.allow` with the missing permissions:

```typescript
// When PATH B new user → xviFcRole: submitter
const submitterOnlyPermissions = {
  ULB: [
    Permission.FINAL_SUBMIT_TO_STATE_DMA,
    Permission.MANAGE_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],
  STATE: [
    Permission.APPROVE_ULB_SUBMISSIONS,
    Permission.PREPARE_GRANT_LETTERS,
    Permission.RECOMMEND_EXEMPTIONS,
    Permission.FINAL_SUBMIT_TO_MOHUA,
    Permission.FINAL_SUBMIT_STATE_FORMS,
    Permission.MANAGE_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],
};
// Set permissionOverrides.allow = submitterOnlyPermissions[scope]
```

This works without any changes to `PermissionGuard` or `ROLE_PERMISSIONS` — the existing `getEffectivePermissions` function already handles `allow` overrides.

---

## 10. Transfer Ownership Implications

### Current `transferOwnership` logic

```typescript
// users.service.ts — current implementation
// Atomically swaps the role field between two users
await this.userModel.findByIdAndUpdate(dto.newOwnerId, { $set: { role: requester.role } });
await this.userModel.findByIdAndUpdate(requester._id,  { $set: { role: dto.demoteTo } });
```

### For ULB — swapping role is safe

ULB users log in via `censusCode + password`. Changing `role: ULB → ULB-EDITOR` on the old submitter does not break their login. They can still authenticate. Role swap is fine.

**Updated behavior for ULB transfer:**
- Swap `role` (existing behavior, fine)
- Also swap `xviFcRole` on both users

### For STATE — swapping role is dangerous

STATE users log in via `email + password`. If we change `role: STATE → STATE-EDITOR` on the old submitter, that user:
1. Keeps the ability to log in (email+password unchanged)
2. Loses old portal access (old portal gates on `role: STATE`)

This is a production-breaking change for that user in the old portal.

**Updated behavior for STATE transfer:**
- Do NOT swap `role` field
- Only swap `xviFcRole` between the two users
- Both users retain their original `role` values
- Old portal access is unaffected for both

**Limitation**: STATE-to-STATE transfer (both legacy `role: STATE` accounts) is clean. But STATE submitter to a new managed user (`role: STATE-EDITOR`) as the new submitter creates a permissions problem — the new STATE-EDITOR does not have submitter-level permissions.

**Rule**: For STATE, only allow ownership transfer between users who both have `role: STATE`. If the new owner has `role: STATE-EDITOR`, reject with: "Cannot transfer ownership to a managed user in STATE scope. The new owner must be a state-level account."

As an alternative when the submitter wants a STATE-EDITOR to become submitter: use `permissionOverrides.allow` to elevate the STATE-EDITOR, and swap `xviFcRole`. Document this as a known limitation to be revisited when `xviFcRole` is added to the JWT.

---

## 11. Old Portal Compatibility Constraints

These are absolute rules. Violating any of them causes production incidents.

### NEVER change for STATE users

| Field | Reason |
|---|---|
| `email` | Login credential. Change = locked out. |
| `password` | Obvious. |
| `role` (for legacy STATE accounts) | Old portal gates on `role: STATE`. |

### NEVER change for ULB users

| Field | Reason |
|---|---|
| `censusCode` | Login credential. |
| `sbCode` | Also used as login in some flows. |
| `password` | Obvious. |
| `role` (for legacy ULB accounts) | Old portal gates on `role: ULB`. |

### Safe to change for ULB users during XVI-FC verification

| Field | Why safe |
|---|---|
| `email` | Not the login credential for ULB. |
| `name` | Display field only. |
| `mobile` | Not used for login. |
| `designation` | Display field only. |
| `isXVIFCProfileVerified` | New XVI-FC field. |
| `xviFcRole` | New XVI-FC field. |

### Safe to change for STATE users during XVI-FC verification

| Field | Why safe |
|---|---|
| `name` | Display field. Not login credential. |
| `mobile` | Not login credential (STATE login is email+password). |
| `designation` | Display field. |
| `isXVIFCProfileVerified` | New XVI-FC field. |
| `xviFcRole` | New XVI-FC field. |

---

## 12. APIs to Build

### 1. GET /users/verification-contacts

```
Purpose:    Returns the list of contacts to show on the profile verification page.
Auth:       JWT required (logged-in ULB or STATE user)
Guards:     JwtAuthGuard
Query:      none (derives scope from JWT)

Logic:
  - ULB user  → extract contacts from the logged-in user's own ULB document
  - STATE user → query ALL STATE/STATE-EDITOR/STATE-VIEWER users for requester.stateId,
                 extract contacts from each, deduplicate

Response:
  {
    contacts: [
      {
        contactId: string | null,   // user._id if real account, null if embedded contact
        name: string,
        designation: string,
        mobile: string,             // masked: +91 XXXXXX1234 for display
        mobileRaw: string,          // full mobile sent to OTP (backend only, not returned)
        email: string,              // masked for display
        source: 'main' | 'accountant' | 'commissioner' | 'department',
        isVerified: boolean,        // isXVIFCProfileVerified
        isSelectable: boolean,      // false if already verified by someone else
      }
    ]
  }
```

### 2. POST /users/verify-profile/send-otp

```
Purpose:    Sends OTP to the mobile of the selected contact.
Auth:       JWT required
Body:
  {
    contactIndex: number,           // index in the contacts list returned above
    mobile: string,                 // full mobile number (user confirms)
  }

Logic:
  - Verify mobile matches contact in the list
  - Generate 6-digit OTP, store in Redis with 10-min TTL keyed by userId
  - Send SMS to mobile

Response:
  { message: 'OTP sent', maskedMobile: '+91 XXXXXX1234' }
```

### 3. POST /users/verify-profile/confirm (PATH A)

```
Purpose:    Verifies OTP and completes profile verification for an existing contact.
Auth:       JWT required
Body:
  {
    otp: string,                    // 6-digit code
    name: string,                   // confirmed/updated name
    designation: string,            // confirmed/updated designation
    email?: string,                 // ULB only — optional email update
    mobile: string,                 // the mobile OTP was sent to
  }

Logic:
  1. Verify OTP from Redis
  2. Check if contact is the logged-in user's own document or an embedded contact
  3. Find or create user document (see PATH A cases in Section 6)
  4. Atomic check: any user with xviFcRole: 'submitter' for this ulb/state?
     NO  → set xviFcRole: 'submitter'
     YES → set xviFcRole: 'editor'
  5. Update fields (never email for STATE)
  6. Set isXVIFCProfileVerified: true
  7. If new submitter AND role is EDITOR → add permissionOverrides.allow

Response:
  {
    message: 'Profile verified',
    xviFcRole: 'submitter' | 'editor',
    redirectTo: '/xvi-fc/overview'
  }
```

### 4. POST /users/verify-profile/create-new (PATH B)

```
Purpose:    Creates a new user and sends OTP to their mobile.
Auth:       JWT required
Body:
  {
    name: string,
    mobile: string,
    email: string,
    designation: string,
  }

Logic:
  1. Check mobile uniqueness
  2. Check email uniqueness
  3. Create user document:
     role: ULB-EDITOR or STATE-EDITOR (from requester scope)
     isActive: false, password: 'UNSET', status: 'PENDING'
  4. Send OTP to mobile
  5. Store pending userId in Redis with OTP, 10-min TTL

Response:
  { message: 'OTP sent', pendingUserId: string, maskedMobile: string }
```

### 5. POST /auth/set-password (PATH B only)

```
Purpose:    Activates a pending account after OTP verification (PATH B).
Auth:       Public endpoint — secured by OTP token
Body:
  {
    pendingUserId: string,
    otp: string,
    password: string,
    confirmPassword: string,
  }

Logic:
  1. Verify OTP from Redis for pendingUserId
  2. Validate password strength
  3. Hash password
  4. Atomic check: submitter slot taken?
     NO  → set xviFcRole: 'submitter', add permissionOverrides.allow
     YES → set xviFcRole: 'editor'
  5. Set: isActive: true, isXVIFCProfileVerified: true, password: hashedPwd
  6. Clear OTP from Redis

Response:
  { message: 'Account activated', xviFcRole: 'submitter' | 'editor' }
```

### 6. POST /users/verify-profile/resend-otp

```
Purpose:    Resends OTP for a pending account (called from team management page).
Auth:       JWT required + MANAGE_USERS permission
Body:       { pendingUserId: string }
Logic:      Generate new OTP, send SMS, update Redis TTL
Response:   { message: 'OTP resent', maskedMobile: string }
```

---

## 13. File-by-File Changes Required

| File | Change | Priority |
|---|---|---|
| `src/schemas/user/user.schema.ts` | Add `xviFcRole: string \| null` field with enum `['submitter', 'editor', 'viewer', null]` | P0 — everything else depends on this |
| `src/users/users.service.ts` | Update `mapRole()` to read `xviFcRole` first | P0 |
| `src/users/users.service.ts` | Update `listTeamMembers()` to select `xviFcRole` in query | P0 |
| `src/users/users.service.ts` | Update `transferOwnership()` — ULB: swap role + xviFcRole; STATE: swap xviFcRole only | P1 |
| `src/users/users.service.ts` | Add `listVerificationContacts()` method | P0 |
| `src/users/users.controller.ts` | Add `GET /users/verification-contacts` route | P0 |
| `src/users/users.service.ts` | Add `sendVerificationOtp()` method | P0 |
| `src/users/users.controller.ts` | Add `POST /users/verify-profile/send-otp` route | P0 |
| `src/users/users.service.ts` | Add `confirmVerification()` method (PATH A) | P0 |
| `src/users/users.controller.ts` | Add `POST /users/verify-profile/confirm` route | P0 |
| `src/users/users.service.ts` | Add `createNewAndSendOtp()` method (PATH B) | P0 |
| `src/users/users.controller.ts` | Add `POST /users/verify-profile/create-new` route | P0 |
| `src/module/auth/login.service.ts` or similar | Add `POST /auth/set-password` for PATH B activation | P0 |
| `src/users/users.service.ts` | Filter `.deleted.` accounts in `listTeamMembers` | P1 |
| `src/users/users.service.ts` | Filter `.deleted.` accounts in `listUsers` | P1 |
| `src/module/auth/enum/role.enum.ts` | No changes needed | — |
| `src/module/auth/permissions.map.ts` | No changes needed | — |
| `src/module/auth/permission.guard.ts` | No changes needed | — |

---

## 14. Data Quality Issues in Legacy Data

These are real problems found in the actual user documents. Handle them gracefully.

| Issue | Example | How to handle |
|---|---|---|
| Name field contains email address | `name: "ritalpachuau@gmail.com"` | Detect with email regex. Display the email value as-is — it's still identifiable. |
| Name field contains org name instead of person | `name: "Rajnandgaon Municipal Corporation"` | Detect with `isOrgName()`. Skip from contacts list. |
| Multiple contacts sharing the same email | All three contacts use `nigamrajnandgaon@gmail.com` | Do NOT deduplicate by email. Deduplicate by mobile only. |
| Department name is an org/department name not a person | `departmentName: "Urban Development and Poverty Alleviation"` | Run through `isOrgName()`. Skip if true. |
| Mobile is null on main ULB account | `mobile: null` | Skip. Cannot send OTP without mobile. |
| Corrupted email from soft-delete | `email: "ritalpachuau@gmail.com.deleted.1592293354"` | Filter: `email: { $not: /\.deleted\./ }`. Exclude from all lists. |
| `isDeleted: false` but email is corrupted | Legacy cleanup miss | Apply the `.deleted.` email filter regardless of `isDeleted` flag |
| Empty embedded contact fields | `accountantName: ""` | Check both name AND mobile non-empty before including in contacts list |
| `mobile` stored as `"0"` or `"N/A"` | Various legacy inputs | Normalize: strip non-digits. If result is less than 10 digits, treat as empty. |
| Department mobile same as main account mobile | `departmentContactNumber: "9436141270"` same as `mobile: "9436141270"` | Deduplicate by normalized mobile. Keep main account entry, drop department. |

---

---

## 15. Overview Page — Suggested Members Pattern

### The Pattern

After the submitter completes profile verification, the Roles & Teams Overview page shows three tiers of members:

```
ACTIVE TEAM MEMBERS        — verified, isActive: true, isXVIFCProfileVerified: true
PENDING                    — invited, OTP sent, setup not yet complete
SUGGESTED MEMBERS          — known from embedded contacts or unverified legacy STATE users,
                             not yet invited into XVI-FC
```

This is the "Suggested Members" pattern used by Google Workspace Admin, GSTN Portal, and Slack. Pre-populate the team with known contacts and let the submitter activate them one by one.

### What Goes Into Each Tier

**ACTIVE TEAM MEMBERS**
- Any user in this ULB/state with `isXVIFCProfileVerified: true` and `isActive: true`
- Includes the submitter themselves, plus any previously activated editors/viewers

**PENDING**
- Users with `isActive: false` and `status: PENDING` in this ULB/state
- These were invited (account created, OTP sent) but have not completed setup
- Action available: `[Resend Invite]`

**SUGGESTED MEMBERS**

For ULB:
- Embedded contacts from the ULB document (accountantName, commissionerName, departmentName)
  that are non-empty and have a mobile number
- Exclude any whose mobile already exists on an active user document (they are already in
  the Active or Pending tier)
- Exclude corrupted entries (empty name, no mobile, `.deleted.` email)

For STATE:
- Other `role: STATE` user documents for the same stateId where `isXVIFCProfileVerified: false`
  and `xviFcRole` is null (not yet invited)
- Embedded contacts from any STATE user document that have a real person name and mobile
- Deduplicated by mobile across all documents

### Overview Page — Row Layout Per Tier

```
─── ACTIVE TEAM ────────────────────────────────────────────────────────────────

  Abhishek Kumar Gupta     Commissioner     ● Submitter     Last login: today
  (no actions on the submitter's own row)

  Anjali Singh             DMA Officer      ● Editor        Last login: 2d ago
  [Change to Viewer]  [Make Submitter]  [Remove]

  Ravi Teja                Accounts         ● Viewer        Last login: 5d ago
  [Change to Editor]  [Make Submitter]  [Remove]

─── PENDING ────────────────────────────────────────────────────────────────────

  U K Ramteke              Accountant       ◑ Pending (Editor)    Invited: 2d ago
  [Change to Viewer]  [Resend Invite]  [Remove]

─── SUGGESTED ──────────────────────────────────────────────────────────────────

  Kavita Nair              Finance Dept     ○ Not invited
  [Invite as Editor ▾]

```

### Invite Action Flow

When submitter clicks `[Invite as Editor ▾]` on a suggested member:

```
Step 1:  Submitter selects role — Editor or Viewer
Step 2:  Backend checks:
           - Does a user account already exist with this mobile?
               YES → update that account: set xviFcRole, send notification SMS
               NO  → create new user document (role: ULB-EDITOR or STATE-EDITOR),
                     set xviFcRole, isActive: false, status: PENDING
Step 3:  OTP SMS sent to the contact's mobile:
           "You have been added to XVI-FC for [ULB/State name].
            Your OTP: XXXXXX. Valid for 10 minutes."
Step 4:  Contact enters OTP → sets password (if new account) → isActive: true
Step 5:  Contact's row moves from PENDING → ACTIVE on next overview load
```

**ULB embedded contact (no existing account):**
- New user document created
- `role: ULB-EDITOR` or `ULB-VIEWER`
- `xviFcRole: 'editor'` or `'viewer'`
- `isActive: false`, `status: PENDING`
- OTP sent, they set password on first login

**STATE unverified legacy user (has existing account, role: STATE):**
- No new document created
- `xviFcRole` set on their existing document
- Notification SMS sent
- They log in with their existing credentials → hit verification page → verify their own mobile → `isXVIFCProfileVerified: true`

**STATE embedded contact (no existing account):**
- Same as ULB embedded contact above but `role: STATE-EDITOR` or `STATE-VIEWER`

### Terminology

| Term | Meaning |
|---|---|
| Invite | Bring a suggested contact into XVI-FC (sends OTP) |
| Resend Invite | Send OTP again to a PENDING member |
| Activate | Internal term only. Never shown in UI. |
| Remove | Soft-delete the user from the XVI-FC team |

---

## 16. Role Change Rules — Editor ↔ Viewer

### Who Can Do It

Only the submitter. Editors and viewers cannot change anyone's role.

### What Is Allowed

```
Editor  →  Viewer     ✅  allowed
Viewer  →  Editor     ✅  allowed
Any     →  Submitter  ❌  use Transfer Ownership instead
Submitter → anything  ❌  use Transfer Ownership instead
Submitter changes own role  ❌  blocked
```

### All Edge Cases

| # | Scenario | Rule |
|---|---|---|
| RC-01 | Change editor → viewer | Allowed |
| RC-02 | Change viewer → editor | Allowed |
| RC-03 | Change pending user's role before they activate | Allowed. They join at the new role. |
| RC-04 | Submitter tries to change their own role | Blocked. Use Transfer Ownership. |
| RC-05 | Target is already that role | Return success silently. No error. No DB write. |
| RC-06 | Target user is from a different ULB/state | Blocked by scope enforcement. |
| RC-07 | Target user does not exist or is deleted | 404 Not Found. |
| RC-08 | Change the last active editor to viewer | Allowed. Submitter can always perform editor actions. |

### What Changes in the Database

**For new managed users** (`role: ULB-EDITOR`, `ULB-VIEWER`, `STATE-EDITOR`, `STATE-VIEWER`):

Change BOTH fields so permissions and display stay in sync:

```
Editor → Viewer:
  role:      ULB-EDITOR  →  ULB-VIEWER   (API permissions change)
  xviFcRole: editor       →  viewer       (display label changes)

Viewer → Editor:
  role:      ULB-VIEWER  →  ULB-EDITOR
  xviFcRole: viewer       →  editor
```

**For legacy STATE users** (`role: STATE` — cannot change):

Change `xviFcRole` only. API permissions remain STATE-level (migration gap — acceptable):

```
Editor → Viewer:
  role:      STATE   →  STATE    (untouched — old portal)
  xviFcRole: editor  →  viewer   (display label only)

Viewer → Editor:
  role:      STATE   →  STATE
  xviFcRole: viewer  →  editor
```

### API

```
PATCH /users/:id/role
Body: { role: 'ULB-EDITOR' | 'ULB-VIEWER' | 'STATE-EDITOR' | 'STATE-VIEWER' }
Guard: MANAGE_USERS permission
```

The existing `updateUserRole` endpoint in `users.controller.ts` covers this.
It must be updated to also set `xviFcRole` in the same write operation.

---

## 17. Transfer Ownership Rules

### What Transfer Ownership Does

The current submitter hands off the submitter role to another active team member.
After transfer:
- The new person is the submitter
- The old submitter becomes an editor (never a viewer — they were admin-level)
- This is atomic — both changes happen in a single MongoDB transaction or neither does

### Who Can Do It

Only the current submitter.

### Target Restrictions

```
Target must be:
  ✅  Active (isActive: true)
  ✅  Verified (isXVIFCProfileVerified: true)
  ✅  In the same ULB/state as the requester
  ✅  Currently an editor OR viewer (not already a submitter)

Target must NOT be:
  ❌  Pending (not yet activated)
  ❌  Deleted
  ❌  The submitter themselves
  ❌  From a different ULB/state
```

### What Changes in the Database — All Cases

**CASE 1: Legacy ULB submitter → managed ULB-EDITOR becomes submitter**

```
Old submitter (role: ULB):
  role:      ULB        →  ULB           (keep — old portal)
  xviFcRole: submitter  →  editor

New submitter (role: ULB-EDITOR):
  role:      ULB-EDITOR →  ULB-EDITOR    (keep — permissions gap handled via overrides)
  xviFcRole: editor     →  submitter
  permissionOverrides.allow → add:
    [FINAL_SUBMIT_TO_STATE_DMA, MANAGE_USERS, CREATE_MANAGED_USER,
     UPDATE_MANAGED_USER, DELETE_MANAGED_USER]
```

**CASE 2: Legacy ULB submitter → managed ULB-VIEWER becomes submitter**

```
Old submitter (role: ULB):
  role:      ULB        →  ULB
  xviFcRole: submitter  →  editor

New submitter (role: ULB-VIEWER):
  role:      ULB-VIEWER →  ULB-EDITOR    (promote role to editor level first)
  xviFcRole: viewer     →  submitter
  permissionOverrides.allow → same as CASE 1
```

**CASE 3: Legacy STATE submitter → another legacy STATE user becomes submitter**

```
Old submitter (role: STATE):
  role:      STATE      →  STATE         (keep — old portal)
  xviFcRole: submitter  →  editor

New submitter (role: STATE):
  role:      STATE      →  STATE         (keep — already has STATE-level permissions)
  xviFcRole: editor/viewer → submitter
  permissionOverrides → no change needed (STATE already has all permissions)
```

**CASE 4: Legacy STATE submitter → managed STATE-EDITOR becomes submitter**

```
Old submitter (role: STATE):
  role:      STATE      →  STATE
  xviFcRole: submitter  →  editor

New submitter (role: STATE-EDITOR):
  role:      STATE-EDITOR → STATE-EDITOR
  xviFcRole: editor       → submitter
  permissionOverrides.allow → add:
    [APPROVE_ULB_SUBMISSIONS, PREPARE_GRANT_LETTERS, RECOMMEND_EXEMPTIONS,
     FINAL_SUBMIT_TO_MOHUA, FINAL_SUBMIT_STATE_FORMS, MANAGE_USERS,
     CREATE_MANAGED_USER, UPDATE_MANAGED_USER, DELETE_MANAGED_USER]
```

**CASE 5: Legacy STATE submitter → managed STATE-VIEWER becomes submitter**

```
Old submitter (role: STATE):
  role:      STATE      →  STATE
  xviFcRole: submitter  →  editor

New submitter (role: STATE-VIEWER):
  role:      STATE-VIEWER → STATE-EDITOR  (promote to editor level first)
  xviFcRole: viewer       → submitter
  permissionOverrides.allow → same as CASE 4
```

### Atomic Execution

Both writes must succeed or neither must. Use a MongoDB session with `withTransaction`:

```typescript
const session = await this.userModel.db.startSession();
await session.withTransaction(async () => {
  // 1. Demote old submitter
  await this.userModel.findByIdAndUpdate(
    requester._id,
    { $set: { xviFcRole: 'editor' } },
    { session }
  );
  // 2. Promote new owner
  await this.userModel.findByIdAndUpdate(
    dto.newOwnerId,
    { $set: { role: resolvedRole, xviFcRole: 'submitter',
              'permissionOverrides.allow': resolvedAllowOverrides } },
    { session }
  );
});
await session.endSession();
```

### The "Zero Submitters" Rule

At no point should a ULB or state have zero active submitters.

Transfer Ownership guarantees this because it is an atomic swap — old submitter becomes editor at the exact same moment the new submitter is promoted. There is never a window with zero submitters.

Additional guard:
- `softDeleteUser` must check: is the target the only active submitter for this ULB/state?
  - YES → block with 400: "Cannot remove the only submitter. Transfer ownership first."
  - NO  → proceed

### Full Action Table — What the Submitter Can Do

| Action | Endpoint | Target restriction |
|---|---|---|
| Invite member | `POST /users/verify-profile/create-new` | New person or embedded contact |
| Change Editor → Viewer | `PATCH /users/:id/role` | Active or pending editor |
| Change Viewer → Editor | `PATCH /users/:id/role` | Active or pending viewer |
| Transfer Ownership | `POST /users/transfer-ownership` | Active + verified editor or viewer |
| Remove member | `DELETE /users/:id` | Any non-submitter in same scope |
| Resend Invite | `POST /users/verify-profile/resend-otp` | Pending members only |

### Full Action Table — What the Overview Page Shows Per Row

```
Submitter (yourself):
  No action buttons. You manage others, not yourself.

Active Editor:
  [Change to Viewer]  [Make Submitter]  [Remove]

Active Viewer:
  [Change to Editor]  [Make Submitter]  [Remove]

Pending (invited, not yet activated):
  [Change to Editor / Change to Viewer ▾]  [Resend Invite]  [Remove]

Suggested (not yet invited):
  [Invite as Editor / Viewer ▾]
```

---

---

## 18. Session Management — JWT and Account Transitions

### The Two Independent Session Checks

Every XVI-FC route requires BOTH checks to pass:

```
Check 1: Is the JWT valid and not expired?
  NO  → redirect to /login

Check 2: isXVIFCProfileVerified on the user document?
  NO  → redirect to /xvi-fc/verify
  YES → allow access
```

A valid JWT does NOT grant XVI-FC access on its own. Both gates must pass independently.

### PATH A — Selecting an Existing Contact (Self)

The logged-in person selects themselves from the contacts list and verifies their mobile.
The verification updates the SAME user document they are already logged in as.

```
Session before:  JWT-A { userId: ULB-account-id, role: ULB }
Action:          OTP verified, name/mobile/designation updated on existing document
Backend:         Re-issues refreshed JWT for the SAME userId
Session after:   JWT-A-refreshed { userId: same ULB-account-id, role: ULB }
Redirect:        /xvi-fc/overview (isXVIFCProfileVerified: true now)
```

No session switch. Same user, same JWT subject, just updated fields.

### PATH B — Creating a New Account for Yourself

The logged-in person's details are not in the contacts list. They fill in their own details,
a new user document is created for them, they verify mobile and set password.

```
Session before:  JWT-A { userId: old-ULB-account-id, role: ULB }
Action:          New user document created, OTP verified, password set
Backend:         Issues BRAND NEW JWT for the new user document
Session after:   JWT-B { userId: new-account-id, role: ULB-EDITOR }
Frontend:        Replaces JWT-A with JWT-B in storage
Redirect:        /xvi-fc/overview with JWT-B
Old JWT-A:       Abandoned. Old ULB account's refreshTokenHash set to null.
```

This is a full session switch. The person is now logged in as their new personal account.

### Inviting Someone Else (from Overview Page)

The submitter creates an account for a different person. No session concern.

```
Session:         Submitter's JWT unchanged throughout
Action:          New pending account created, OTP SMS sent to the new person's mobile
Backend:         Returns success response to submitter
Submitter:       Stays on overview page. Their session is unaffected.
New person:      Logs in SEPARATELY on their own device with their own credentials.
                 Gets their own fresh JWT. Goes to XVI-FC overview.
```

There is no session handoff between the submitter and the new person. They are independent sessions.

### Summary Table

| Scenario | Session change | Who holds new JWT |
|---|---|---|
| PATH A — select existing contact (self) | No — refreshed JWT same userId | Same person |
| PATH B — create new account (self) | YES — full session switch | New personal account |
| Overview page — invite someone else | No change for submitter | New person on their own device |
| Transfer ownership | YES — force logout for old submitter | Old submitter re-logs in as editor |

---

## 19. Routing Guard Rules

### Guard Logic (Frontend)

```typescript
// Applied on every route change and on app load
function xviFcRouteGuard(user, route) {
  if (!jwt || isJwtExpired(jwt)) {
    redirect('/login');
    return;
  }

  if (!user.isXVIFCProfileVerified) {
    redirect('/xvi-fc/verify');
    return;
  }

  allow(route);
}
```

### Behavior Table — All Navigation Scenarios While Unverified

| Action attempted | JWT status | Outcome |
|---|---|---|
| Navigate to /xvi-fc/overview | Valid | Blocked → /xvi-fc/verify |
| Navigate to /xvi-fc/team | Valid | Blocked → /xvi-fc/verify |
| Directly type any XVI-FC URL | Valid | Blocked → /xvi-fc/verify |
| Refresh the page | Valid | Back to /xvi-fc/verify |
| Browser back/forward button | Valid | Guard intercepts → /xvi-fc/verify |
| JWT expires (inactive >15 min) | Expired | Blocked → /login |
| Any navigation after JWT expired | Expired | Blocked → /login |

### What Happens on the Verification Page After OTP Was Sent but Not Entered

```
User navigates away or refreshes while OTP entry screen is showing
         ↓
Guard: isXVIFCProfileVerified: false → /xvi-fc/verify
         ↓
Verification page loads — shows contact list view (not OTP entry)
Backend detects: pending account exists for this ulb/state
         ↓
Page shows resume banner:

  ┌────────────────────────────────────────────────────────────┐
  │  ⚠ You have a pending verification                        │
  │  An OTP was sent to +91 94077 XXXXX                       │
  │  [Enter OTP]     [Resend OTP]     [Start over]            │
  └────────────────────────────────────────────────────────────┘
```

### Inactivity Behaviour

| Time since OTP was sent | JWT status | OTP status | What user sees on return |
|---|---|---|---|
| < 10 minutes | Valid | Valid | OTP entry screen (resume option) |
| 10–15 minutes | Valid | Expired | Verification page + "Resend OTP" |
| > 15 minutes | Expired | Expired | Login page (JWT gate fails first) |

After re-login with expired JWT: `isXVIFCProfileVerified: false` → verification page → pending account detected → "Resend OTP" shown.

---

## 20. OTP Abandon, Resume and Pending State Machine

### The Pending Account State Machine

```
                     [Invite sent / PATH B account created]
                                      │
                                      ▼
                                  PENDING
                              (isActive: false,
                               status: PENDING)
                              /                \
               OTP verified                  48 hours pass
               + password set                without any action
               (within 10 min OTP window)          │
                      │                            ▼
                   ACTIVE                       EXPIRED
               (isActive: true,             (status: EXPIRED)
                isXVIFCProfileVerified:      shown in team list
                true)                        as ⚠ Invite Expired
                                            /              \
                                     [Reinvite]          [Remove]
                                          │                  │
                                       PENDING           SOFT DELETED
                                    (clock reset)      (isDeleted: true)
```

### Case A — Profile Verification Page PATH B (Self-Creation Abandoned)

```
State when abandoned:
  Pending account:    exists (isActive: false, status: PENDING)
  OTP in Redis:       expires after 10 minutes from generation
  Old JWT:            still valid until its 15-minute window
  isXVIFCProfileVerified on old account: false

On next login or return to verification page:
  Backend detects pending account for this ulb/state
  Verification page shows resume banner (see Section 19)

Options shown:
  [Enter OTP]    — if OTP still valid (<10 min)
  [Resend OTP]   — if OTP expired (generates fresh OTP, sends SMS again)
  [Start over]   — soft-deletes pending account, returns to contact list
                   allows entering different mobile number
```

### Case B — Overview Page Invite Abandoned (Team Member Not Activating)

```
State:
  Pending account in team list with status: PENDING
  OTP expires after 10 minutes
  Submitter sees on overview:

  U K Ramteke · Editor · ◑ Pending · Invited: 2 hours ago
  [Change Role ▾]  [Resend Invite]  [Remove]

After 48 hours with no action:
  status: PENDING → status: EXPIRED
  Overview shows:
  U K Ramteke · Editor · ⚠ Invite Expired
  [Reinvite]  [Remove]

[Resend Invite] / [Reinvite]:
  Generates new 6-digit OTP
  Sends fresh SMS to mobile
  Resets 48-hour expiry clock
  status back to PENDING

[Remove]:
  Soft-deletes the pending account
  Mobile number is freed (can be used for a fresh invite)
```

### OTP Rules Summary

| OTP event | TTL | Result |
|---|---|---|
| Generated on invite / PATH B | 10 minutes | After 10 min → expired, must resend |
| Resend triggered | 10 minutes (fresh) | Old OTP invalidated, new OTP active |
| 3 wrong attempts | — | Account locked for 10 minutes |
| Pending account not activated | 48 hours | status → EXPIRED, shown in team list |
| Pending account expired | Until removed | Submitter must [Reinvite] or [Remove] |

---

## 21. Transfer Ownership — Force Logout Behaviour

### Why Force Logout

After ownership transfer:
- Old submitter's `xviFcRole` changes: `submitter` → `editor`
- Their JWT still carries `role: ULB` or `role: STATE` (role field unchanged)
- Without force logout, they would still see the submitter UI until the JWT expires
- Force logout provides a clear signal and ensures a clean state on next login
- Backend invalidates their refresh token so they cannot silently extend the session

### The Full Sequence

```
Old submitter clicks [Transfer Ownership to Anjali]
         ↓
Confirmation modal shown:
  "Are you sure? You will be demoted to Editor.
   Anjali Singh will become the new Submitter."
  [Cancel]  [Yes, Transfer]
         ↓
[Yes, Transfer] clicked
         ↓
Backend (atomic MongoDB transaction):
  1. Old submitter: xviFcRole: submitter → editor
  2. New submitter: xviFcRole: editor/viewer → submitter
                    + permissionOverrides.allow updated (if new submitter is managed user)
  3. Old submitter: refreshTokenHash → null  (refresh token invalidated)
         ↓
Backend response: { success: true }
         ↓
Frontend shows full-screen overlay for 2 seconds:

  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  ✅  Ownership transferred successfully                 │
  │                                                          │
  │  Anjali Singh is now the Submitter.                     │
  │  Your role has changed to Editor.                       │
  │                                                          │
  │  Logging you out in 2 seconds...                        │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

         ↓  (after 2 seconds)
Frontend:
  1. Clear JWT from localStorage / sessionStorage
  2. Clear refresh token cookie
  3. Redirect to /login
         ↓
Old submitter logs in again with their credentials
→ Fresh JWT issued
→ isXVIFCProfileVerified: true → goes to overview
→ Sees themselves as Editor (not Submitter)
```

### What Happens to the New Submitter (Anjali)

Do NOT force logout the new submitter. It would be jarring — her screen would unexpectedly redirect to login with no explanation.

Instead:
- If Anjali is currently logged in on another device: her existing JWT remains valid
- On her next API call or page refresh: her updated profile is returned (xviFcRole: submitter)
- She sees a notification: "You have been made the Submitter for [entity]. Refresh to see your updated permissions."
- On her next login: her JWT reflects the new xviFcRole

### Zero Submitter Protection

Transfer ownership is an atomic swap — there is never a moment with zero submitters.

Additional guard in `softDeleteUser`:
- Check: is this the only active submitter for the ULB/state?
  - YES → block with 400: "Cannot remove the only Submitter. Transfer ownership first."
  - NO  → proceed with soft delete

---

*End of document. Update this file whenever design decisions change. Do not implement anything that contradicts this document without updating it first.*
