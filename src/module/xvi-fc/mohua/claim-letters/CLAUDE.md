# MoHUA Claim Letters

MoHUA's Claims & Submissions screens and the SO's approve and return. The endpoints and the SO flow are described in
the root `CLAUDE.md` (the `claim-letters` entry); this file covers only what isn't obvious from there.

## ULB Eligibility page

`GET ulb-eligibility/:stateId/:yearId/:installment` (`mohua-ulb-eligibility.service.ts`) lists every ULB of a State,
live: the claim letter's annexure columns, Eligible / Ineligible, and the letter holding it. MoHUA, DoE, PMU and Admin
can read it (`assertViewScope`), the same as the other claim letter reads.

- **Eligible** means every ULB-level criterion passes and the ULB has a devolution allocation (`NO_ALLOCATION`
  otherwise). A failed State condition is returned as `stateGate`, a banner, not as every ULB being ineligible. Being
  in a letter is the `batch` cell, not ineligibility. This differs from the State's ULB picker on purpose.
- **Cells** come from `buildAnnexureCell` (the letter's text), except that a failed ULB-owned form shows its own status
  ("Not Started", "In Progress", "Returned"...) instead of "No" (`buildLiveConditionCell`). The 14th FC unspent column
  comes back as Rupees in `amounts` (its cell holds only the exemption note) so the page shows it in its own units,
  and headers drop the "(₹ lakh)" the letter prints. The letter itself is unchanged.
- **Cache:** the condition check runs over the whole State (filters, counts and totals need every row) with the fresh
  `resolveUlbLevelEligibility`, because cell text needs `perCriterion`. It is cached 15 minutes in Redis
  (`mohuaUlbEligibility:<env>:<state>:<year>:<inst>`); `refresh=true` rebuilds it, but only once the cached copy is
  over a minute old (`MOHUA_ULB_ELIGIBILITY_REFRESH_FLOOR_SECONDS`), so repeated clicks don't re-run the State. Builds
  made together in one process share one run. Redis is only a cache: a failed read or write is logged and the page is
  built without it.
- **Live part:** the ULB locks and their letters are read on every request (two queries), so a new draft, submit or
  return shows at once. Returned letters hold no locks, so their ULBs show as in no letter. The letter query keeps
  only letters still holding ULBs (`MOHUA_ULB_ELIGIBILITY_LETTER_STATUSES`, not abandoned), since a return can commit
  between the two reads. A draft (2) is not
  `linkable`: MoHUA's letter pages list only `MOHUA_CLAIM_LETTERS_LISTED_STATUSES`.
- **Entry points (UI):** the State page's Claim Letters panel, the State's claim letters header, and the claim letter
  header (filtered to its `batchNumber` via `?batch=N`; a returned letter opens the whole State).
- Rows are sorted eligible first, then ineligible, each A to Z, once per build.
- Search (`escapeRegex`) matches the name and the code the page shows: the census code, or the SB code when there is
  none. Search, filters and paging run in memory over the cached rows; counts are State-wide, before filters.

## Known gaps

- A ULB held by a letter but no longer in the expected set (e.g. deactivated) is not listed.
- Installment 1 only, like the rest of the claim letter flow.

No ADRs exist for this module; the cache trade-off above is recorded here.
