# 0005 - Exemptions under MoHUA review count for the claim

## Status

Accepted (2026-10-29).

## Context

A State files a discretionary exemption request (Request Exemption, formId 34,
`xvifc_eligibility_exemptions`) for a ULB (Elected Body 23, Audited Accounts 30, Provisional
Accounts 31) or for the Entire State (SFC 22). Each entry starts at `UNDER_REVIEW_BY_MOHUA` (5);
MoHUA approves it (`SUBMISSION_ACKNOWLEDGED_BY_MOHUA`, 7) or rejects it (`RETURNED_BY_MOHUA`, 6). A
rejected entry can be filed again, back to 5. There is no revoke. While an entry is under review or
approved, its target form is blocked, so the ULB cannot meet the condition with real data either.

The claim counted only approved entries, so a ULB waiting on MoHUA could be neither uploaded nor
claimed. The program team wants the State to claim while MoHUA reviews, and MoHUA to decide the
exemption later, possibly while reviewing the claim batch itself.

## Decision

**Under review or approved counts; rejected does not.** `ClaimEligibilityEvaluatorService` treats an
entry at 5 or 7 (`DISCRETIONARY_COUNTED_STATUSES`) as EXEMPTED, for the State gate (Entire State)
and for every ULB-bulk criterion. The evaluator is used only by the claim letter, so no other screen
changes. It also returns each ULB's request status (5, 6 or 7) per criterion
(`discretionaryExemptionStatusByUlbId`) and tallies `exemptedUnderReview`, so callers can tell the
two apart and say why a ULB fails.

**Every step re-reads the live status.** Draft create and edit, a new version, the .docx and Submit
evaluate fresh; the detail page re-checks each saved row on load (30-second display cache); the
preview may lag a decision by up to 5 minutes (its as-on time is printed). Nothing is pushed into a
claim when MoHUA decides: a rejection before Submit turns the ULB ineligible on the next read, its
row says "Exemption rejected by MoHUA", Save stays disabled until the State removes it, and Submit
refuses naming it.

**The letter says which.** Annexure cells print "Exemption requested" (under review) or "Exempted"
(approved); rows C-I count both as met. While the Entire State SFC exemption counts, Row B prints
"State has requested exemption from this condition; the request is under MoHUA review." or "State
has been exempted from this condition by MoHUA." instead of the SFC details, and the ATR date leaves
the letter details (not shown, not required for Download or Submit). A rejection brings both back.

**The snapshot records what was relied on.** Each child's `eligibilitySources` holds one entry per
ULB condition: the State forms judged per ULB (Elected Body, 14th FC) and every ULB-owned form
(Audited, Provisional, SLB, PFMS, DUR), each with its document and status, `exemptionKind`
(`DISCRETIONARY_ULB`, `DISCRETIONARY_STATE`, `AUTO_NEW_ULB_NO_DOCUMENT`, `AUTO_NEW_ULB_STUB`),
`exemptionId` (the ULB's own request) and `exemptionStatusAtEvaluation`. `appliedExemptionIds` lists
the ULB's requests once each. An EXEMPTED entry may have no source document (an Entire State
exemption for a form never started, or an automatic one), which used to stop the draft build. These
are the colleague plan's Phase 2 items 2-5.

## Consequences

- A submitted batch can rely on an exemption MoHUA has not decided. What happens to the batch when
  MoHUA rejects it, or whether approval waits for the decision, belongs to the MoHUA claim review. It
  can read the snapshot above and the live statuses; this module does nothing on a decision.
- The Submit confirm names both the State's own exemption requests still under review and how many
  ULBs rely on one.
- `createNewVersion` re-checks every copied ULB, so one whose exemption was rejected fails the whole
  new version until the State can drop it there.
- An already signed letter keeps "Exemption requested" after an approval (true when signed); the
  next generated letter says "Exempted".
