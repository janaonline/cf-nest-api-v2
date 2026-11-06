# 0006 - The claim amount is the allocation, behind a switch

## Status

Accepted (2026-11-05).

## Context

A State used to enter a claim amount per ULB, which the server accepted within ±10% of the ULB's
Devolution Formula allocation (`meta.varianceLowerPercent` / `varianceUpperPercent`, else 90 / 110).
Each child stored `claimedAmount`, `differenceAmount` and `differencePercentageBasisPoints`.

The program team dropped the claim amount and the band: the allocation is the final amount. The
feature may come back, so it must return without a code change.

## Decision

**One switch, off by default.** formjson 26 `meta.claimAmountEditable`; only the boolean `true` turns
it on. `ClaimLetterFormJsonService.loadClaimAmountConfig` returns it with the band, and
`resolveClaimedAmount` (`helpers/claim-letter-financial.helpers.ts`) is the only place the rule lives:

- **Off:** the request may omit `claimedAmount`. The server stores the allocation it reads at save
  time, so both difference fields are 0. A request that sends a different amount (e.g. from Postman)
  is rejected with 400, naming the ULB.
- **On:** exactly the earlier behaviour: an amount is required and must be within the band.

**Nothing is removed.** The schema fields, the band, every reader of `claimedAmount` (letter total,
claimed totals per status, financial summary, content hash, recovery, the ULB rows response) and the
UI's claim column all stay. Claim-context, the detail summary and the eligibility summary carry
`claimAmountEditable`, and the UI shows the claim and difference columns and the ±10% text only when
it is on. A saved selection without an amount stands for the row's allocation, so the same ULBs
without amounts is a no-op save. A new version (`createNewVersion`) carries amounts forward only when
the switch is on; otherwise it takes the current allocation.

## Consequences

- **To bring the claim amount back:** PATCH formjson 26 through the form-json API with
  `meta.claimAmountEditable: true` (and the band keys if they change). Do not write the document
  directly in the DB: the formjson read is cached in Redis with no TTL and only an API write clears it.
- Batches built while the switch was off keep claim = allocation; turning it on later does not touch
  them.
- Drafts built before this change may store a claim that differs from the allocation. The claim
  letter was not in prod, so dev/staging drafts are abandoned and recreated; no migration exists.
- MoHUA review: show the claim and the difference only for batches built while the switch was on;
  otherwise they repeat the allocation and 0.
