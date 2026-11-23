# 0007 - The Section Officer's review stage

## Status

Accepted (2026-11-12).

## Context

A submitted claim letter is first reviewed by the MoHUA Section Officer (SO), before MoHUA's own final step.
The SO either approves the whole letter or returns parts of it for correction. A letter is built from evidence
frozen at submit (State forms, each ULB's rows and forms, discretionary exemptions), but that evidence can change
while the letter waits: MoHUA can reject an exemption, a ULB can become inactive, the State can re-upload a row
form, or a form can be undone. A review of the first build (2026-11-11) found that approve trusted the frozen
evidence, decided exemptions outside the letter's transaction, let rows of submitted letters be replaced, and left
no trace in the forms' own history.

## Decision

**Statuses.** Submit moves the letter to `UNDER_REVIEW_BY_SO` (15). The SO's approve moves it to
`UNDER_REVIEW_BY_MOHUA` (5); the SO's return moves it to `RETURNED_BY_SO` (16, shown as "Returned for Correction").
A returned letter is also flagged `isAbandoned`, so its batch slot and ULB locks are free and the State builds a
new letter; `isReturnedClaimLetter` (`helpers/claim-letter-returned.helpers.ts`) is the one place that tells a
returned letter from a discarded draft. A returned letter's amount and ULBs are never counted as claimed.

**Approve re-checks the letter, fresh.** Before anything is written, approve re-runs the letter's conditions
exactly as submit does (`ClaimLetterEligibilityService.recheckClaimLetter`): the State-level gate, then every ULB
against the expected-ULB set and the fresh per-ULB criteria. A ULB whose exemption was rejected, whose relied-on
row was deleted, or that is no longer active refuses the approval (409, naming up to ten ULBs); the SO returns the
letter instead. A pending exemption (5) still counts. Inside the transaction, the form-status guard also counts a
deleted form or row as changed.

**Exemptions are decided inside the letter's transaction.** Approve approves every pending exemption the letter
relied on; return rejects the ones the SO picked. Both run on the letter's session
(`RequestExemptionMohuaService.approve` / `reject` take an optional session), so a failure anywhere leaves every
exemption as it was, and a retried return rejects each one once.

**Only what the SO marked is returned.** The SO marks ULBs first (`soDecision` on the claim ULB row); the return
reopens each marked ULB's picked forms and rows, plus the State-wide items picked in the request. Everything else
keeps its status. SFC and GTC are returnable only while at 15; a return that reopens a State form also returns the
State's other letters under SO review and clears its drafts' signed letters (ADR 0009).

**Rows of a submitted letter are frozen.** While a ULB is in a letter at 15, 5 or 7, or its row is at 5 or 7:
- Elected Body's post-submission update refuses that ULB, by name;
- Elected Body and Devolution Excel re-upload / revalidate (and Devolution's delete) are refused while any active
  row is at 5 or 7, and Devolution's per-row edit lock also honours `ACKNOWLEDGED` locks;
- FC Unspent never deactivates a row under review or approved (13, 15, 5, 7), on resubmit or when the answer
  switches to "No".

**Forms keep their own history.** Every form or row the SO's decision moves gets a row in that form's history
collection, in the same transaction, for exactly the documents the conditional write moved: `SO_APPROVE` /
`SO_RETURN` on the State forms and the Elected Body / FC Unspent rows, a MOHUA-stage `APPROVED` / `RETURNED` on the
ULB forms. SLB is deemed approved and keeps no history; Devolution rows have no history collection.

**Emails on return only.** After the return commits, every verified State user gets one email listing what was
returned, and each ULB whose own forms were reopened gets one (Nodal Officer, else the accountant contact)
through `FormReturnedNotificationService.notifyClaimLetterReturned`. A failed email never undoes the return.

## Consequences

- Status 5 means "approved by the SO"; MoHUA's own final step (5 -> 7) and its return (6) are not built yet. When
  they are, 6 needs the same handling as 16 (`RETURNED_CLAIM_LETTER_STATUSES` already lists it; see ADR 0009).
- Approve costs one fresh eligibility run per letter, the same as submit.
- The freeze is per path. A new write path that can replace or deactivate a State form's rows must apply the same
  rule, or it can change the evidence of a letter MoHUA is reviewing.
- Approve sends no email; only returns do.
