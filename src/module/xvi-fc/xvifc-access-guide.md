# XVI-FC User Access Management — Plain English Guide

> This document explains the entire user access system for the XVI Finance Commission module
> in simple language. It is meant to be read by anyone — developers, product managers, testers,
> or stakeholders — without needing to understand code. Every scenario, every rule, and every
> flow is described here in plain terms.

---

## Table of Contents

1. [The Big Picture — What Problem Are We Solving?](#1-the-big-picture--what-problem-are-we-solving)
2. [Two Kinds of Users — ULB and STATE](#2-two-kinds-of-users--ulb-and-state)
3. [The Three Roles — Submitter, Editor, Viewer](#3-the-three-roles--submitter-editor-viewer)
4. [What Each Role Can and Cannot Do](#4-what-each-role-can-and-cannot-do)
5. [First Time on XVI-FC — The Verification Gate](#5-first-time-on-xvi-fc--the-verification-gate)
6. [The Profile Verification Page — Step by Step](#6-the-profile-verification-page--step-by-step)
7. [How the Contacts List Is Built](#7-how-the-contacts-list-is-built)
8. [After Verification — The Team Overview Page](#8-after-verification--the-team-overview-page)
9. [The Suggested Members List](#9-the-suggested-members-list)
10. [Inviting a Team Member](#10-inviting-a-team-member)
11. [Changing a Member's Role](#11-changing-a-members-role)
12. [Handing Over as Submitter — Transfer Ownership](#12-handing-over-as-submitter--transfer-ownership)
13. [What Happens When Someone Does Not Complete the OTP](#13-what-happens-when-someone-does-not-complete-the-otp)
14. [Session and Security Rules](#14-session-and-security-rules)
15. [The Old Portal — What Does Not Change](#15-the-old-portal--what-does-not-change)
16. [Quick Reference — All Rules at a Glance](#16-quick-reference--all-rules-at-a-glance)

---

## 1. The Big Picture — What Problem Are We Solving?

### The Old System (15th Finance Commission)

Before XVI-FC, every ULB and State government office had a single shared account on the
CityFinance platform. One account for the entire office. Everyone used it together.

- A municipal corporation (ULB) had one login: a census code and a shared password.
- A state government office had one or a few personal accounts, each with their own email and password.

This was simple but had a big problem: there was no team structure. Everyone had the same
access. Nobody could tell who did what. There was no way to give one person permission to
only view reports while another person could submit documents.

### What XVI-FC Needs

The XVI Finance Commission module is built for collaboration. Multiple people from the same
office will work on it together — but they need different levels of access based on their role.

- One person (the Submitter) is responsible for final submissions and managing the team.
- Some people (Editors) can work on documents but cannot make final submissions.
- Some people (Viewers) can only look at information but cannot change anything.

### The Challenge

We cannot just delete the old accounts and start fresh. Those accounts are still being used
for the 15th Finance Commission work on the old portal. We need XVI-FC to work alongside
the old portal without disturbing it.

This is the core challenge: **add a new role system to XVI-FC without breaking anything in
the existing system.**

---

## 2. Two Kinds of Users — ULB and STATE

Understanding the difference between ULB and STATE users is essential because they behave
very differently in the system.

---

### ULB User — The Institutional Account

A ULB (Urban Local Body) is a municipal corporation, council, or panchayat. Examples:
Rajnandgaon Municipal Corporation, Bhopal Municipal Corporation, etc.

In the old system, each ULB had exactly **one account**. That account belonged to the
organisation, not to any specific person. Think of it like a company email address that
everyone in the office uses.

**Key facts about the ULB account:**
- Login is done using a census code (like 801991) and a shared password.
- The account name is the organisation name, like "Rajnandgaon Municipal Corporation" — not a
  person's name.
- The email on the account is a shared institutional inbox.
- There is no personal mobile number on the account.
- Inside the account record, there are contact details for real people:
  the Accountant, the Commissioner, and sometimes the Department contact.

**Example ULB account (simplified):**
```
Organisation:  Rajnandgaon Municipal Corporation
Login:         censusCode: 801991 + password
Email:         nigamrajnandgaon@gmail.com  (shared inbox)
Mobile:        (none)

Contacts stored inside this account:
  Accountant:   U K Ramteke          mobile: 9827118810
  Commissioner: Abhishek Kumar Gupta mobile: 9407720005
```

---

### STATE User — The Personal Account

A STATE account belongs to a real individual working in the state government's urban
development office. Unlike ULB accounts, STATE accounts are personal — each person has
their own email and password.

**Key facts about the STATE account:**
- Login is done using a personal email address and personal password.
- The email is that person's own email — it is their login credential.
- There can be many STATE accounts for the same state. Odisha might have 4 or 5 people
  each with their own STATE account.
- All of them could log in and use the old portal independently.

**Example STATE accounts for Mizoram (simplified):**
```
Person 1:  email: ritalpachuau@gmail.com  mobile: 9436141270  designation: Joint Director
Person 2:  email: lalnunpuia@mizoram.gov  mobile: 9876543210  designation: Director
Person 3:  email: kzauva@mizoram.gov      mobile: 9765432109  designation: Deputy Director
```

All three are different people, all have their own login, and all work for the same state.

---

### Why This Matters for XVI-FC

| | ULB | STATE |
|---|---|---|
| How many accounts per entity? | One (institutional) | Multiple (personal) |
| Who logs in? | Whoever has the census code + password | Each person with their own email |
| Is the email a login credential? | No — it is a shared contact email | Yes — it is the login |
| Can we change the email? | Yes — safe | Never — breaks login |
| Where are the real people? | Stored as embedded contacts inside the account | They ARE the accounts |

---

## 3. The Three Roles — Submitter, Editor, Viewer

XVI-FC introduces three roles. Every person using XVI-FC has exactly one of these roles.

### Submitter
- There is exactly **one Submitter per ULB** and exactly **one Submitter per State**.
- The Submitter is the primary responsible person for XVI-FC work.
- They can do everything: submit forms, manage the team, approve documents.
- They are the account owner for XVI-FC purposes.

### Editor
- There can be multiple Editors per ULB or State.
- Editors can do most of the work — uploading documents, filling forms, reviewing submissions.
- Editors cannot make final submissions to MoHUA or to the State DMA.
- Editors cannot manage the team (cannot invite, change roles, or remove members).

### Viewer
- There can be multiple Viewers per ULB or State.
- Viewers can only see information. They cannot change anything.
- Useful for supervisors, auditors, or officials who need oversight without editing access.

---

## 4. What Each Role Can and Cannot Do

### For ULB

| Action | Submitter | Editor | Viewer |
|---|---|---|---|
| View status reports and dashboards | Yes | Yes | Yes |
| Upload financial documents | Yes | Yes | No |
| Message other users | Yes | Yes | No |
| Do final submission to State DMA | Yes | No | No |
| Invite team members | Yes | No | No |
| Change team member roles | Yes | No | No |
| Transfer submitter role to someone else | Yes | No | No |
| Remove team members | Yes | No | No |

### For STATE

| Action | Submitter | Editor | Viewer |
|---|---|---|---|
| View status reports and dashboards | Yes | Yes | Yes |
| Upload state-level documents | Yes | Yes | No |
| Review ULB submissions | Yes | Yes | No |
| Edit state forms | Yes | Yes | No |
| Message users | Yes | Yes | No |
| Approve ULB submissions | Yes | No | No |
| Prepare grant letters | Yes | No | No |
| Do final submission to MoHUA | Yes | No | No |
| Invite team members | Yes | No | No |
| Change team member roles | Yes | No | No |
| Transfer submitter role to someone else | Yes | No | No |
| Remove team members | Yes | No | No |

---

## 5. First Time on XVI-FC — The Verification Gate

When a ULB or STATE user logs into XVI-FC for the very first time using their old credentials,
they are not automatically let into the portal. They must pass through a one-time verification
step first.

This gate exists because XVI-FC needs to know WHO the real person is behind the account.
The old accounts were created for the institution, not for a specific individual. XVI-FC
needs a verified real person with a confirmed mobile number.

```
User logs in with old credentials
         │
         ▼
System checks: Has this person completed XVI-FC verification?
         │
         ├── YES → Enter XVI-FC portal directly
         │
         └── NO  → Go to Profile Verification Page
                   (must complete this before entering XVI-FC)
```

**This verification happens exactly once.** After completing it, the person goes directly
to the XVI-FC overview page on every future login. They never see the verification page again.

---

## 6. The Profile Verification Page — Step by Step

The profile verification page asks one simple question: **"Who are you?"**

It shows a list of people already known to be connected to this ULB or State (from old
contact records). The logged-in person finds themselves in that list, verifies their mobile
number with an OTP, and is confirmed as the XVI-FC contact.

### Path A — "I see myself in the list"

```
Person logs in → goes to verification page
         │
         ▼
Page shows a list of known contacts:
  ○  U K Ramteke         Accountant    +91 98271 XXXXX    [This is me]
  ○  Abhishek Kumar Gupta Commissioner +91 94077 XXXXX    [This is me]
         │
         ▼
Person clicks [This is me] next to their name
         │
         ▼
System shows: "We will send a 6-digit OTP to +91 94077 XXXXX"
  [Send OTP]
         │
         ▼
Person receives OTP on their phone, enters it
         │
         ▼
OTP verified successfully
         │
         ▼
For ULB:   This person is always the Submitter
           (only one ULB account exists, so they are by definition the Submitter)

For STATE: Is anyone else from this state already verified as Submitter?
           NO  → This person becomes the Submitter
           YES → This person becomes an Editor
         │
         ▼
Verification complete → Enter XVI-FC Overview Page
```

### Path B — "My name is not in the list"

```
Person looks at the contacts list and their name is not there
         │
         ▼
They click [My name is not here — Add myself]
         │
         ▼
A form appears:
  Name:        [Enter your full name          ]
  Mobile:      [Enter your mobile number      ]
  Email:       [Enter your email address      ]
  Designation: [Enter your job title          ]
         │
         ▼
Person fills in their own details and clicks [Send OTP]
         │
         ▼
OTP sent to the mobile they entered
         │
         ▼
Person enters OTP → verified
         │
         ▼
Since this is a brand new account:
  Set your password:
  [Enter password  ]
  [Confirm password]
  [Activate Account]
         │
         ▼
Same logic as Path A for determining Submitter vs Editor
         │
         ▼
Verification complete → Enter XVI-FC Overview Page
```

**Important rules on the verification page:**
- The verification page is always for the person who is currently logged in. It is
  self-verification only. You cannot use this page to set up someone else's account.
- For STATE users: the email field is never shown or editable. The email is the login
  credential and must never be changed.
- For ULB users: the email can be updated because the ULB login uses a census code,
  not the email address.

---

## 7. How the Contacts List Is Built

The contacts list on the verification page is not random. It is extracted from old records
already stored in the system. Here is how it works for each type.

### For ULB — From One Account Record

The system looks at the single ULB account record and extracts up to three contacts:

```
From the Rajnandgaon Municipal Corporation account:

Included in list:
  ✓  U K Ramteke · Accountant · 9827118810      (from accountantName field)
  ✓  Abhishek Kumar Gupta · Commissioner · 9407720005  (from commissionerName field)

Not included:
  ✗  "Rajnandgaon Municipal Corporation" — this is the org name, not a person
  ✗  Department contact — empty fields, nothing to show
```

**Rules for what gets included:**
- The contact must have a name AND a mobile number. No mobile = cannot verify via OTP.
- The main account name is skipped if it looks like an organisation name.
- If two contacts share the same mobile number, only one entry is shown.
- Contacts with corrupted emails (old system issue) are hidden.

### For STATE — From Multiple Account Records

The system looks at ALL STATE account records for that state and combines their contacts:

```
For Mizoram — pulls from every STATE account under Mizoram's state ID:

From Person 1's account (ritalpachuau@gmail.com):
  ✓  ritalpachuau@gmail.com · Joint Director · 9436141270
     (name field was corrupted — email stored as name, shown as-is)

From Person 2's account (lalnunpuia@mizoram.gov):
  ✓  Lalnunpuia · Director · 9876543210

From Person 3's account:
  ✓  K Zauva · Deputy Director · 9765432109

Combined deduplicated list shown to the logged-in person.
```

---

## 8. After Verification — The Team Overview Page

Once verified, the person lands on the Roles and Teams Overview page. This is their home
page in XVI-FC. It shows everyone in their team and their current status.

The page is divided into three sections:

```
ACTIVE TEAM MEMBERS
These people are verified, have set up their accounts, and can log into XVI-FC.

  Abhishek Kumar Gupta    Commissioner    ● Submitter    Last login: today
  Anjali Singh            DMA Officer     ● Editor       Last login: 2 days ago
  Ravi Teja               Accounts        ● Viewer       Last login: 5 days ago


PENDING  (invited but not yet activated)
These people were invited. An OTP was sent to their mobile.
They have not yet entered the OTP or set their password.

  U K Ramteke             Accountant      ◑ Pending (Editor)    Invited: 2 hours ago
  [Resend Invite]  [Remove]


SUGGESTED MEMBERS  (known contacts not yet invited)
These people are in the old system's contact records. They have not been
invited to XVI-FC yet. The Submitter can invite them with one click.

  Kavita Nair             Finance Dept    ○ Not invited
  [Invite as Editor ▾]
```

---

## 9. The Suggested Members List

The Suggested Members section shows people who are known to the system but have not yet
joined XVI-FC. The Submitter can invite any of them into the team.

### For ULB — Where Suggestions Come From

Suggestions come from the embedded contacts in the ULB account record (the Accountant,
Commissioner, and Department contacts) that have not yet been invited.

### For STATE — Where Suggestions Come From

Suggestions come from two places:
1. Other STATE account holders for the same state who have not yet verified themselves on XVI-FC.
2. Embedded contacts (Accountant, Commissioner etc.) from any STATE account record,
   if they have a name and mobile number and are not already a real user.

### What Happens When a Suggested Person Is Already Verified

If someone in the Suggested list already completed verification on their own (they logged
in separately and went through the verification page), they move from Suggested to Active.
Their row in the list updates automatically.

---

## 10. Inviting a Team Member

The Submitter can invite anyone from the Suggested list — or add a brand new person not
in any list — by clicking Invite.

### Inviting Someone from the Suggested List

```
Submitter clicks [Invite as Editor ▾] on Kavita Nair's row
         │
         ▼
Dropdown appears:
  ● Editor
  ○ Viewer
         │
         ▼
Submitter selects Editor and confirms
         │
         ▼
For ULB embedded contact (no existing account):
  A new account is created for Kavita
  Role set to Editor
  An SMS is sent to her mobile:
    "You have been added to XVI-FC for Rajnandgaon Municipal Corporation.
     Your OTP to activate your account: 847291"
         │
         ▼
For STATE unverified user (existing account):
  No new account created
  Their role in XVI-FC is set to Editor
  An SMS is sent:
    "You have been added to the XVI-FC team for Odisha.
     Log in at [url] to complete your setup."

         ▼
Kavita now appears under PENDING on the overview page
         ▼
Kavita enters OTP → sets password → logs into XVI-FC
         ▼
Kavita moves to ACTIVE on the overview page
```

### Inviting a Brand New Person (Not in Any List)

```
Submitter clicks [+ Add new member] at the bottom of the page
         │
         ▼
A form appears:
  Name:        [Full name of the new person  ]
  Mobile:      [Their mobile number          ]
  Email:       [Their email address          ]
  Designation: [Their job title              ]
  Role:        ● Editor  ○ Viewer
         │
         ▼
Submitter clicks [Send Invite]
         │
         ▼
System checks: Is this mobile number already registered?
  YES → "This mobile number is already linked to an existing account.
          Ask that person to log in and join the team directly."
  NO  → New account created, OTP sent to their mobile
         │
         ▼
Same flow as above — they enter OTP, set password, join as Editor or Viewer
```

---

## 11. Changing a Member's Role

The Submitter can change an Editor to a Viewer or a Viewer to an Editor at any time.

### Who Can Change Roles
- Only the Submitter can change roles.
- Editors and Viewers cannot change anyone's role, including their own.

### What Is Allowed

```
Editor  →  Viewer    Allowed
Viewer  →  Editor    Allowed

Editor  →  Submitter    NOT allowed via this action (use Transfer Ownership instead)
Submitter → Editor      NOT allowed via this action (use Transfer Ownership instead)
Submitter changes their own role    NOT allowed
```

### Special Cases

- **Changing a pending member's role:** You can change a pending member's role before they
  activate their account. When they complete activation, they join at the new role.
- **Changing the last editor to viewer:** Allowed. The Submitter can always perform editor-level
  work themselves.
- **Target is already that role:** The system accepts the request silently and does nothing.
  No error is shown.

### What Actually Changes in the System

For new managed users (people added through the invite system):
- Both their internal role AND their XVI-FC label change. Their actual permissions change.

For legacy STATE users (old accounts with STATE-level access):
- Only their XVI-FC label changes. Their actual API permissions stay at STATE level
  during the migration period. This is expected and acceptable.

---

## 12. Handing Over as Submitter — Transfer Ownership

The current Submitter can hand over their Submitter role to any active, verified Editor or
Viewer on the team. This is called Transfer Ownership.

### When Would You Do This?

- The current submitter is leaving the organisation.
- A different person should be the primary contact for XVI-FC going forward.
- The current person wants to step down to Editor level.

### Rules for Transfer Ownership

- Only the current Submitter can initiate a transfer.
- The person receiving the Submitter role must already be an active, verified team member.
  You cannot transfer to a Pending (not yet activated) member.
- You cannot transfer to yourself.
- After the transfer: the old Submitter becomes an Editor (not a Viewer — they retain
  meaningful access).

### The Full Flow

```
Submitter clicks [Make Submitter] on Anjali Singh's row
         │
         ▼
Confirmation screen:
  "Are you sure you want to transfer ownership to Anjali Singh?
   You will become an Editor after this action."
  [Cancel]    [Yes, Transfer]
         │
         ▼
[Yes, Transfer] clicked
         │
         ▼
System makes two changes at exactly the same time (atomically):
  Anjali Singh:  becomes Submitter
  You (old Submitter): become Editor
         │
         ▼
A message appears on your screen for 2 seconds:

  ┌────────────────────────────────────────────────────────┐
  │                                                        │
  │  ✅ Ownership transferred successfully                │
  │                                                        │
  │  Anjali Singh is now the Submitter.                   │
  │  Your role has changed to Editor.                     │
  │                                                        │
  │  Logging you out in 2 seconds...                      │
  │                                                        │
  └────────────────────────────────────────────────────────┘
         │
         ▼  (after 2 seconds)
You are automatically logged out
         │
         ▼
You log back in with your same credentials
         │
         ▼
You go to the XVI-FC overview page — now as an Editor

Anjali Singh (if she is currently logged in on another device):
  She receives a notification: "You are now the Submitter. Refresh the page to see
  your updated access."
  She is NOT forcefully logged out — she just needs to refresh.
```

### There Is Always Exactly One Submitter

The system ensures there is never a moment with zero Submitters. The transfer is done
atomically — Anjali becomes Submitter at the exact same instant you become Editor. There
is no gap.

Additionally, you cannot delete or remove the only Submitter. If you try to remove yourself
(the only Submitter), the system blocks it with: "Cannot remove the only Submitter. Transfer
ownership first."

---

## 13. What Happens When Someone Does Not Complete the OTP

There are two situations where an OTP goes unanswered.

---

### Situation A — On the Profile Verification Page (Self-Setup Abandoned)

The logged-in person started Path B (entered their own details, an OTP was sent), but they
closed the browser, walked away, or let the OTP expire.

**The OTP itself expires after 10 minutes.** But the account created for them stays in a
Pending state until they come back.

**What happens on their next login:**

```
They log in again with their old credentials
         │
         ▼
System checks: isXVIFCProfileVerified? → NO → profile verification page
         │
         ▼
System also checks: did this person start a setup that was abandoned?
         │
         ▼
YES → Page shows:

  ┌──────────────────────────────────────────────────────────┐
  │  ⚠ You have a pending verification                      │
  │  An OTP was previously sent to +91 94077 XXXXX          │
  │                                                          │
  │  [Enter OTP]     [Resend OTP]     [Start over]          │
  └──────────────────────────────────────────────────────────┘

  [Enter OTP]   — if the original OTP is still valid (within 10 minutes of generation)
  [Resend OTP]  — generates a fresh OTP and sends a new SMS
  [Start over]  — cancels the pending account and lets them begin fresh
                  (useful if they entered the wrong mobile number)
```

**If they do nothing for 48 hours:**
The pending account is marked as expired. On their next visit to the verification page,
they are told: "Your previous attempt expired. Please start again."

---

### Situation B — Invited Team Member Does Not Activate (Overview Page Invite)

The Submitter invited U K Ramteke. An SMS was sent to Ramteke's mobile. Ramteke never
entered the OTP or set up his account.

**What the Submitter sees on the Overview page:**

```
PENDING
  U K Ramteke · Editor · ◑ Pending · Invited: 2 hours ago
  [Change Role ▾]   [Resend Invite]   [Remove]
```

**After 48 hours without activation:**

```
  U K Ramteke · Editor · ⚠ Invite Expired
  [Reinvite]   [Remove]
```

**Actions available:**
- **[Resend Invite]**: Sends a fresh OTP to Ramteke's mobile. The 48-hour clock resets.
- **[Reinvite]**: Same as Resend Invite but shown after expiry. Reactivates the pending state.
- **[Remove]**: Deletes the pending account entirely. The mobile number is freed up and can
  be used again for a fresh invite.

**What Ramteke sees if he tries to enter the OTP after it expired:**
"This OTP has expired. Please ask your organisation's Submitter to resend the invite."

---

### The Life Cycle of a Pending Account

```
Invite sent → PENDING → Person activates → ACTIVE
                    ↓
              48 hours pass
              without action
                    ↓
                 EXPIRED → Submitter can [Reinvite] or [Remove]
                                │               │
                             PENDING          DELETED
                           (fresh invite)
```

---

### OTP Rules Summary

| Situation | OTP is valid for | What happens after OTP expires |
|---|---|---|
| Profile verification (self-setup) | 10 minutes | Account stays Pending. Resend on next visit. |
| Team invite | 10 minutes | Account stays Pending. Submitter can Resend. |
| 3 wrong OTP attempts | — | Mobile locked for 10 minutes |
| No activation at all | 48 hours | Account moves to Expired state |

---

## 14. Session and Security Rules

### The Two Locks on Every XVI-FC Page

Every page inside XVI-FC has two independent locks. Both must be open for a person to
access any page.

```
Lock 1 — Login check:
  Are you logged in with a valid, unexpired JWT token?
  NO  → You are taken to the Login page

Lock 2 — Verification check:
  Have you completed XVI-FC profile verification?
  NO  → You are taken to the Profile Verification page
  (Even if you are logged in, you cannot enter XVI-FC without completing verification)
```

These two locks are independent. Having a valid login does not bypass the verification
check. Both must pass.

### Navigation Blocked Until Verification Is Complete

While a user has a valid login but has NOT completed verification:

| What they try to do | What happens |
|---|---|
| Go to /xvi-fc/overview | Blocked → taken to verification page |
| Go to any other XVI-FC page | Blocked → taken to verification page |
| Press browser back/forward | Intercepted → taken to verification page |
| Refresh the page | Lands back on verification page |
| Directly type a XVI-FC URL | Blocked → taken to verification page |
| Do nothing for more than 15 minutes | Login expires → taken to Login page |

### What Happens If They Are Mid-OTP and Navigate Away

If a person is on the OTP entry screen (they clicked "Send OTP" and are about to enter
the code) and they navigate away, refresh, or the browser closes:

- Their pending account is NOT deleted.
- The OTP expires after 10 minutes.
- When they return, the verification page shows the resume option (Resend OTP or Start over).
- They do not lose their progress on the contact selection they made.

### Inactivity Timeline

```
Time since OTP was sent:        What the user sees when they return:
─────────────────────────────────────────────────────────────────────
0 to 10 minutes                 OTP entry screen (can still submit the OTP)
10 to 15 minutes                Verification page + "Resend OTP" (OTP expired)
More than 15 minutes            Login page (their session has fully expired)
```

After logging in again (if session expired), they are taken back to the verification page
and the resume option is shown if a pending account exists.

### Forced Logout After Transfer Ownership

When the Submitter transfers their role to someone else, they are automatically logged out
after 2 seconds. This happens because:

1. Their role has changed — they are now an Editor, not a Submitter.
2. Staying logged in would show them outdated information (the Submitter dashboard).
3. Forcing a logout ensures they see the correct Editor view on their next login.
4. Their login session on the backend is also ended (their refresh token is cleared),
   so they cannot silently extend the old session.

The new Submitter (the person who received the role) is NOT forcefully logged out. They
see a notification on their screen and their access updates on their next page refresh.

---

## 15. The Old Portal — What Does Not Change

This is a critical point: **the old CityFinance portal for the 15th Finance Commission
continues to work exactly as before.** Nothing about the XVI-FC changes affects it.

### For ULB Users

| Field | Can XVI-FC change it? | Reason |
|---|---|---|
| Census code | Never | It is the login credential |
| Password | Never | Obvious |
| Organisation role (ULB) | Never | Old portal checks this for access |
| Email | Yes (safe) | Not used for ULB login |
| Name, mobile, designation | Yes | Not login credentials |

### For STATE Users

| Field | Can XVI-FC change it? | Reason |
|---|---|---|
| Email address | Never | It is the login credential |
| Password | Never | Obvious |
| STATE role | Never | Old portal checks this for access |
| Mobile | Yes (safe) | Not used for STATE login |
| Name, designation | Yes | Not login credentials |

### The Technical Solution — Two Role Fields

To give XVI-FC its own role system without touching the old system's role field, a new
separate field called `xviFcRole` was added to each user account.

```
Field: role        — the old system's role. Unchanged. Old portal reads this.
Field: xviFcRole   — the new XVI-FC role. Only XVI-FC reads this.
```

The old portal is completely blind to `xviFcRole`. It never reads it. This means:
- A STATE user with `xviFcRole: editor` still has full STATE access in the old portal.
- A ULB user with `xviFcRole: submitter` still logs into the old portal as a ULB account.
- Nothing breaks.

### Legacy STATE Users During Migration

During the migration period, old STATE account holders who become Editors in XVI-FC still
technically have the same level of API access as the Submitter. This is because their
old `role: STATE` field (which gives full access) has not been changed.

This is **intentional and acceptable** because:
- These are all authorised state government officials.
- They already had this level of access before XVI-FC existed.
- XVI-FC is not giving them new power — it is just labelling them correctly.
- As new Editors and Viewers are added through the invite system, those new people (with
  `role: STATE-EDITOR` or `STATE-VIEWER`) correctly have restricted access.

---

## 16. Quick Reference — All Rules at a Glance

### Role Assignment Rules

| Situation | Role assigned |
|---|---|
| ULB user completes verification | Always Submitter (one ULB = one account) |
| STATE user verifies, no submitter exists for state | Submitter |
| STATE user verifies, submitter already exists | Editor |
| New person invited by Submitter | Editor or Viewer (Submitter chooses) |
| Two STATE users verify at the exact same time | Only one gets Submitter (atomic lock) |

### What the Submitter Can Do

| Action | Allowed? |
|---|---|
| Invite a new Editor or Viewer | Yes |
| Change an Editor to a Viewer | Yes |
| Change a Viewer to an Editor | Yes |
| Promote an Editor/Viewer to Submitter | Yes — via Transfer Ownership only |
| Demote themselves to Editor | Yes — via Transfer Ownership only |
| Remove a team member | Yes — but cannot remove themselves if they are the only Submitter |
| Resend an invite to a Pending member | Yes |
| Change their own role without transferring | No |

### What Editors and Viewers Cannot Do

| Action | Allowed for Editor? | Allowed for Viewer? |
|---|---|---|
| Upload documents / edit forms | Yes | No |
| View reports and dashboards | Yes | Yes |
| Invite team members | No | No |
| Change anyone's role | No | No |
| Transfer ownership | No | No |
| Remove team members | No | No |
| Final submission to MoHUA / State | No | No |

### OTP and Account Rules

| Situation | What happens |
|---|---|
| OTP not entered within 10 minutes | OTP expires. Account stays Pending. |
| Pending account not activated for 48 hours | Account marked Expired. |
| Submitter resends invite | Fresh OTP sent. 48-hour clock resets. |
| Wrong OTP entered 3 times | Mobile locked for 10 minutes. |
| Person navigates away mid-OTP | Pending account preserved. Resume shown on return. |
| Submitter removes a Pending account | Account deleted. Mobile freed. |

### Session Rules

| Situation | What happens |
|---|---|
| Valid login but verification not complete | Stuck at verification page. All other XVI-FC routes blocked. |
| Login expires (15 minutes of inactivity) | Redirected to Login page. |
| Verification complete | Routing guard allows entry. Never shown verification page again. |
| Transfer Ownership completed | Old Submitter force-logged out after 2-second message. |
| New Submitter during Transfer Ownership | Notified on screen. Not forced out. |

### The Contacts List Rules

| Contact type | Shown on verification page? | Condition |
|---|---|---|
| Accountant (from embedded fields) | Yes | Must have a name AND mobile number |
| Commissioner (from embedded fields) | Yes | Must have a name AND mobile number |
| Department contact | Yes | Only if it looks like a person name (not an org name) |
| ULB organisation name itself | No | It is an org name, not a person |
| STATE account holder | Yes | Mobile must be present |
| Corrupted account (email has ".deleted.") | No | Always excluded |
| Contact with no mobile | No | Cannot send OTP |

---

*This document should be updated whenever the access management design changes.
For the technical implementation details, refer to `xvifc-multi-role-design.md`.*
