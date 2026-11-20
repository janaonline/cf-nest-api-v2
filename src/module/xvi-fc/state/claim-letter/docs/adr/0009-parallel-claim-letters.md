# 0009 - Parallel claim letters

## Status

Accepted (2026-11-18). Supersedes ADR 0004.

## Context

ADR 0004 let a State keep one claim letter open per State/year/installment: a draft, or a letter with the MoHUA
Section Officer (SO). The next letter could not start until the SO approved it. The program team decided that States
submit letters in parallel: the next letter is prepared and submitted while earlier ones are still under SO review.

Letters are independent except for one thing: every letter of a State relies on the same State forms (SFC, GTC,
Elected Body, FC Unspent, Devolution), and its letter prints their content. A ULB is only ever in one letter (its
lock, ADR 0002), so ULB-level events stay with that letter.

## Decision

**Several letters at once, up to a cap.** Drafts and letters under review exist side by side, up to formjson 26
`meta.maxClaimLetters` (a whole number 1-10; missing or invalid means 3; read by `ClaimLetterFormJsonService`). A letter
holds a place while it is a draft, under review (15, 5) or approved (7); a discarded or returned letter frees it
(`allocateBatchNumber` counts letters that are not `isAbandoned`). Lowering the cap never touches existing letters; it
only stops new ones until a place is free. `batchNumber` is 1 to `CLAIM_LETTER_MAX_LETTERS_LIMIT` (10) in the schemas.

**The SO's approve affects no other letter.** The first approval moves SFC and GTC to 5. From then on they are
settled: the return refuses them ("SFC Status was accepted with Claim Letter 1 and can no longer be returned"), and
the dialog shows them disabled with the reason (accepted, exempted or not in this review). The refusal is a 409, so a
page that still offered the form reloads. The accepting letter is the `SO_APPROVE` row in the form's own history
(`ClaimLetterFormStatusService.describeReturnableStateForms`). Row forms keep reopening from 15, 5 or 7 (ADR 0007);
an approved letter's rows stay frozen.

**A return that reopens a State form reaches the State's other letters, in the same transaction**
(`MohuaClaimLettersService.returnWithStateForms`). It applies when the return moved SFC or GTC, or a ULB's row in
Elected Body, FC Unspent or Devolution (a row return reopens the whole form):

- every other letter under SO review (15) is returned too: 16 plus `isAbandoned` (slot and ULB locks freed),
  `returnedWith` naming the letter and the forms, the SO's remark, and a `DEPENDENCY_INVALIDATION` history row;
- the dialog lists those letters (`otherLettersUnderReview` on the detail) and the request sends their ids as
  `affectedLetterIds` only when it warned about them (else an empty list); a different set inside the transaction is
  refused (409), so nothing is returned unseen;
- every draft gets `stateFormReturnNotice`; a draft with a signed letter loses it and its merged final PDF, since
  what it signed may change. The notice is cleared by the next signed upload, and a notice that says the signed letter
  was removed is kept by later returns until then. The upload is also pinned on the notice it read, so it never clears
  a newer notice;
- one email to the State names the letters also returned.
  Letters at 5 or 7 are never touched.

**Every other return touches no other letter.** Returning only the claim letter, a ULB's own form or a ULB's
exemption leaves the other letters as they are. A letter's "List of Ineligible ULBs" and row J are a snapshot: the
note under the table says when they were generated and that eligibility may have changed. Later letters, and every
OM (built at Generate), list a returned ULB while it is not eligible.

**Nothing is signed while a State form is being corrected.** A draft's .docx download and signed upload are refused
while the fresh State gate fails (`ClaimLetterEligibilityService.assertStateConditionsMet`). The upload then writes in
a transaction after the per-State guard (`touchClaimUndoGuard`) and re-checks the State forms there
(`assertStateFormsStillReady`), as submit does, so an SO return that commits after the gate check is a 409. The notice
pin alone is not enough: a second return keeps a "signed letter removed" notice as it was, so the pin still matches. The detail hides the
letter sections with that reason (`blockedReason`) and shows one banner (`stateFormNotice`): the notice, followed by
the block reason when another State form fails too, or the block reason alone when there is no notice.

**No ULB is stranded (the last-draft rule).** Once open letters fill every place under the cap, a ULB in no letter
can only go into a draft. So the last draft (every place taken, no other draft open) is not submitted while some
expected ULB is in no letter (`ClaimLetterSubmitService.assertNoUlbLeftOut`; the detail's `isLastPlace`, read with
`remainingUlbCount` so the page never pairs a fresh flag with an old count). Other drafts
submit freely: the last one can still take the ULBs. A ULB a draft holds counts as in a letter; if that draft later
drops it, its own submit is refused. When another draft let a submit pass, the check runs again inside the
transaction after the per-State guard, so two drafts submitted one after the other cannot each count the other.
This replaces the slot-3-only check, which missed a letter that took a lower slot freed by a return, and a first
version that refused every draft once all places were taken (all-draft States could submit nothing).
Known gap: if the cap is lowered below the open letters and the State then discards the last draft, the ULBs left out
have no place until a letter is returned.

**One State's submits and SO decisions run one at a time.** Submit, approve and return write the per-State guard
(`touchClaimUndoGuard`) first in their transactions, so two of them on the same State conflict instead of both
committing. Submit also re-reads its State forms' statuses inside the transaction
(`assertStateFormsStillReady`), since its gate check runs before it. A lost transaction is a 409 "Please try again"
(`toClaimLetterBusyConflict`), never a 500.

**Devolution's dataset is not replaced under a claim.** Re-upload, revalidate and delete are refused while any ULB of
the installment holds a claim lock, drafts included (`assertNoClaimLockedUlbs`): a draft keeps the row and amount it
was saved with, and saving it again with the same ULBs does not refresh them. A returned row is fixed with a
single-row edit.

**A draft's money tiles are live:** the detail computes the other letters' totals now, not from the snapshot stored
when the draft was last saved.

## Consequences

- `ClaimLetterActiveBatchService` and the `blockedByBatchNumber` / `activeBatchNumber` fields are gone; `blockedReason`
  now means "a State-level condition fails".
- Two State users saving drafts at the same moment: one gets "This state is being updated by another action. Please
  try again." (the same guard).
- A draft's saved per-ULB data (the exemption each ULB relies on, the evidence) is still not refreshed while its ULBs
  stay the same; unchanged by this ADR.
- MoHUA's own return (6), when built, must close the letter like 16 and follow the same rules.
