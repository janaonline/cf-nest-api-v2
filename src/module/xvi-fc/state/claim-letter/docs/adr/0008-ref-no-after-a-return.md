# 0008 - The Ref No of a letter built after a return

## Status

Accepted (2026-11-16).

## Context

A letter's names come from its slot: Ref No `CL/TR/2026-27/1-2`, file base name `CF_TR_2026-27_1-2`, downloads
`CF_Tripura_Claim-letter-1-2_2026-27`. A return frees the slot (ADR 0007), and the next letter takes the lowest free
one (ADR 0002), so the replacement usually lands in the same slot and got exactly the same names as the letter MoHUA
returned. MoHUA still lists returned letters, so two different letters showed under one Ref No, and the signed
paper letter, remarks and emails could not say which one they meant.

## Decision

**A letter built in a slot a returned letter held adds `-R<n>` to every name:** `CL/TR/2026-27/1-2-R1`,
`CF_TR_2026-27_1-2-R1`, `CF_Tripura_Claim-letter-1-2-R1_2026-27`. A second return in the slot gives `-R2`.

- `resubmissionNumber` on the batch is set once, at create, inside the slot-allocation transaction: the count of
  returned letters (`RETURNED_CLAIM_LETTER_STATUSES`, also `isAbandoned`) in the same State, year, installment and
  slot. It never changes; a new version (`createNewVersion`) copies it, since it is the same letter.
- A discarded draft does not count: it never reached MoHUA, so its number was never sent anywhere.
- `buildClaimLetterBatchLabel` (`helpers/claim-letter-financial.helpers.ts`) builds the shared `1-2-R1` part; the Ref
  No, the stored `fileBaseName` and both download names use it. Letters created before the field read it as 0, so
  their names do not change.
- A unique index on `{ state, year, installment, batchNumber, resubmissionNumber, version }`, limited to submitted
  letters, makes a counting mistake fail loudly instead of issuing a duplicate Ref No.

## Consequences

- Shipped before any State filled a claim letter, so every letter carries `resubmissionNumber` and no backfill
  exists. A letter without the field (e.g. data copied from an older environment) must be numbered by hand before
  it is submitted, or its submit hits the index.
- Mongoose builds the index at startup but swallows a failure (`model.init().catch(...)`, nothing logged). After a
  deploy onto existing data, confirm it with `db.xvifc_claim_letter_batches.getIndexes()`.
- The suffix counts returns in the slot; it does not link a replacement to the letter it replaces.
- MoHUA's screens show `fileBaseName`, so they show the suffix with no change of their own. The State's screens show
  the batch as "2-R1".
