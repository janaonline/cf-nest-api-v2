# 0001 - Approve/reject as a display-only overlay, never a write to the target form

## Status

Accepted

## Context

A decided discretionary exemption entry (formId 30/31 Annual Accounts, formId 22 SFC Status, formId 23
Elected Body) logically concerns a real target form — an approved SFC exemption "means" the state no
longer has to submit SFC Status. An earlier version of this service acted on that meaning literally: on
`approve`, it materialized or revised a real document in the target form's own collection (e.g.
`xvifc_annualaccounts`). This repeatedly conflicted with invariants that collection's own owning service
(`AnnualAccountsService`) enforces elsewhere — e.g. the `sectionType: 'audited'` universal per-`{ulb,year}`
anchor its `findOrInitialize` guarantees. Two services writing to the same collection under different
assumptions produced real bugs.

## Decision

**`approve`/`reject` never write to a target form's own collection.** Both write only to this module's own
collections — `xvifc_eligibility_exemptions` (the entry's `currentFormStatus`/`decidedBy`/`decidedAt`/
`mohuaRemarks`) and `xvifc_eligibility_exemption_form_logs` (the audit trail). An "Approved" outcome is a
pure display-only overlay, exactly like "Pending" and "Rejected" already are — not a real status write into
a collection this module doesn't own.

Every target form's own service is responsible for reading and reflecting that overlay itself, live, at its
own request time:

- `AnnualAccountsService` (formId 30/31) — `listUlbSubmissions`'s exemption overlay and
  `assertNotBlockedByPendingExemption`.
- `SfcStatusService` (formId 22) — its own `resolveExemptionStatusForResponse`/
  `assertNotBlockedByExemption` copies of the same pattern; see `state/sfc-status/CLAUDE.md`'s
  "Discretionary whole-state exemption awareness".
- Elected Body (formId 23) has no per-ULB status document to overlay onto in the first place — a Constituted/
  6th-Schedule row is already its own live signal, which is exactly why `assertSectionStillEligible` checks
  row eligibility for this formId instead of a document status (see that method's own doc-comment).

All three read via `ExemptionResolverService.resolveDiscretionary` (or, for Elected Body, a direct row read)
rather than a field this module wrote onto their own documents.

## Consumers

- **Inside this module**: `RequestExemptionMohuaService.approve`/`reject` — the only writers.
- **Outside this module**: every target-form service listed above depends on this remaining true — each
  reads this module's collections live rather than expecting a copy of the decision on its own documents.

## Consequences

- A future feature that wants "approving an exemption should also flip the target form to Exempted" needs a
  live read at the target form's own request time (the same pattern the three consumers above already use),
  not a write added back here.
- Reintroducing a write to a target form's collection on approve/reject would resurrect the same
  cross-service invariant conflicts this ADR moved away from — check the target form's own service (e.g.
  `AnnualAccountsService.findOrInitialize`'s per-`{ulb,year}` anchor guarantee) for compatibility first.
