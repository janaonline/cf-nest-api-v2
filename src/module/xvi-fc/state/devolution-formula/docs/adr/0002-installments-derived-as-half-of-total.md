# 0002 - Instalments are derived as Total / 2 (may end in .50)

## Status

Accepted (2026-11-25)

## Context

Each row used to carry three typed amounts (Total, Instalment 1, Instalment 2), all whole Rupees,
and the only rule was `inst1 + inst2 === total`. The operational guidelines say each instalment is
half of the ULB's Total, so the typed split was redundant and let uneven splits through (184 saved
rows had an even Total that was not split in half).

Requiring even Totals, so that halves stay whole Rupees, was rejected: Totals come from a formula
applied across all ULBs, and 45 of one state's 76 ULBs had odd Totals.

## Decision

- The Total stays whole Rupees (unchanged checks). Both instalments are always `Total / 2`, derived
  only by `splitTotalIntoInstallments` (`helpers/devolution-formula-installments.helpers.ts`) on
  every write path: Excel upload (`parseDataRow`), revalidate Case A, and portal row edit
  (`updateRow`). Uploaded instalment cells are ignored and the columns are optional (old templates
  still work). Number-like text in the Total cell ("1000" from a text-formatted cell) splits like a
  number, matching how the validator reads it; a TRUE / FALSE cell is a row error.
- **Rows a claim letter holds keep their stored split.** A ULB with an open or acknowledged
  `ClaimLetterUlbLock`, or a row frozen at 5 / 7, is never re-derived or flagged: the State can't edit
  it, and changing it would split it from the `allocatedAmount` that letter claimed (the SO's approval
  rechecks eligibility, not amounts). `DevolutionFormulaService.findClaimHeldUlbIds` is the one lock
  lookup; revalidate Case A uses it to keep held rows' amounts.
- Two backend guards, so an API caller can't get a different split in:
  - `updateRow` refuses a sent `installment1Amount` / `installment2Amount` that isn't `Total / 2`
    (400, `installmentNotHalf`), instead of silently replacing it.
  - `finalSubmit` refuses while any active row the State can fix (not held or frozen, above) is off
    `Total / 2` (`installmentSplitOutdated`, naming up to 5 ULBs). This catches rows saved before the
    rule. The message says "Revalidate, or edit and save these rows", or only "edit and save" while
    frozen rows exist, since Revalidate is refused then.
  - The same lookup (`findOutdatedSplit`) runs in `getForm` for the State's editable view only: while
    such rows exist it shows a warning badge and hides "All valid", and it offers the Revalidate
    action only when Revalidate can run (the badge says "need editing" otherwise).
- An odd Total gives x.50 instalments. That is safe where typed decimals were not: halves of whole
  Rupees are only ever .00 or .50, which floating point represents and adds exactly, so sums can't
  drift the way arbitrary typed decimals did.
- The template shows the instalments as `IF(<Total>="","",<Total>/2)` formula columns marked
  `readOnly` in `DF_TEMPLATE_HEADERS`, with a header comment (`DF_INSTALLMENT_NOTE`). For a
  `readOnly` column `ExcelService` greys the header and data rows (down to the last ULB only) and adds
  a data validation that shows the comment text on selection and refuses any typed entry. The sheet is
  not protected: Excel's normal paste copies the source's Locked flag, so on a protected sheet pasted
  Total / Formula cells locked themselves. A paste or Delete can still change the instalment cells in
  the file; that is guidance only, since the server derives the values regardless. The error sheets
  (`DF_ERROR_EXCEL_HEADERS`) hold fixed instalment values, so they drop `readOnly` and the comment.
- `UpdateRowDevolutionFormulaDto` keeps the two instalment fields so a sent value gets the
  `installmentNotHalf` error above rather than the global `forbidNonWhitelisted` one.

## Consumers

- `claim-letter`: `allocatedAmount` is the row's instalment for that installment, so a claim, a batch
  total and the letter's amount in words can carry 50 paise (`amountToIndianWords` in
  `common/utils/xvi-fc-amount-format.util.ts`). The lakh figures in the letter, annexure and OM round
  to 2 decimals, so 50 paise does not show there.
- MoHUA claim-letters and the OM: the installment allocation is `Math.round(allocation / 2)`. When the
  state's allocation is even (all 140 were on 2026-11-25), a fully claimed state reaches exactly that
  figure. An odd allocation would leave ₹0.50 showing as unclaimed; the fix then is to drop that
  rounding (`mohua-claim-letters.service.ts`, `om.service.ts`).
- UI: `AmountDisplayModeService` shows `.50` in Rupee (`inr`) mode.

## Consequences

- Deploying changes no saved row: there is no migration, and submitted forms (13 / 15 / 5 / 7) can't
  be written by any of the three write paths. Rows saved before this rule keep their old split until
  the State revalidates, edits or re-uploads; a returned form can't be resubmitted until then (the
  final-submit guard). A submitted form that is never returned keeps its old split, and claim letters
  built from it use those stored amounts. A ULB a claim letter holds keeps its old split even on a
  reopened form, and final submit doesn't count it.
- The claim request accepts a .50 amount, and with the switch off it must equal the allocation. If
  `claimAmountEditable` is ever turned on, its whole-Rupee rule (`resolveClaimedAmount`) and the UI's
  decimal check must accept .50 too, or a State could not claim exactly its allocation.
