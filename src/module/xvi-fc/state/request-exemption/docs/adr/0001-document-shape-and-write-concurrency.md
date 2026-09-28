# 0001 - Document shape and write concurrency

## Status

Accepted

## Context

`xvifc_eligibility_exemptions` needs to serve two request shapes — per-ULB (a state asking on behalf of
one ULB) and whole-state (a state asking on behalf of every ULB it has) — that otherwise share an
identical lifecycle: same status enum, same permission model, same per-`formId` entry array, same MoHUA
approve/reject flow. Two independent writers touch the same collection and must keep the same document
shape and status-transition rules in sync: this module's `RequestExemptionService.finalSubmit` (filing)
and `RequestExemptionMohuaService`'s decide flow (`mohua/request-exemption/`, approve/reject). Concurrent
filings for the same `{ulb, year}` or `{state, year}` must not corrupt each other or silently double-write.

## Decision

**Two shapes, one collection.** `ulb: Types.ObjectId | null` distinguishes them: a real ObjectId is a
per-ULB request (one document per `{ulb, year}`); `null` (always explicit, never absent) is a whole-state
request (one document per `{state, year}`). Reusing one collection rather than splitting into two means a
future "does ULB X inherit its state's whole-state exemption" query is a single
`{$or: [{ulb: X}, {state: S, ulb: null}]}` instead of a two-collection union. Two partial unique indexes
enforce "at most one document" per shape without conflicting with each other:

```js
{ ulb: 1, year: 1 }   // unique, partialFilterExpression: { ulb: { $type: 'objectId' } }, name: 'uniq_ulb_year_exemption'
{ state: 1, year: 1 } // unique, partialFilterExpression: { ulb: { $type: 'null' } },     name: 'uniq_state_year_exemption_no_ulb'
```

**Wholesale-replace, not edit, per `formId`.** Each document's `data[]` holds at most one entry per
requested `formId` (enforced in the service, not the schema). `finalSubmit` never patches an existing
entry: a brand-new `formId` is pushed; an existing one (whatever its status) is wholesale-replaced —
fresh `supportingDetails`/`supportingFile`/`submittedBy`/`submittedAt`, `decidedBy`/`decidedAt`/
`mohuaRemarks` reset to `null`. There is no "edit" operation and no archive-to-history on the document
itself (history lives only in the form-log collection, see below) — this reuses the same in-place-revision
convention every other state form in this codebase already uses for a returned document, deliberately not
a remove-and-archive pattern.

**Optimistic concurrency on update.** The update path is
`findOneAndUpdate({_id, updatedAt: existingDoc.updatedAt}, {$set: {data: mergedData, ...}})` — if another
writer (a second filing, or MoHUA deciding) changed the document between read and write, the match fails,
`findOneAndUpdate` returns `null`, and the service throws `ConflictException('This request changed while
you were submitting. Reload and try again.')` rather than blindly overwriting.

**Duplicate-key translation on create.** The create path relies on the two partial unique indexes above
for correctness under concurrent first-time filings; a resulting Mongo duplicate-key error (code 11000,
recognized via `isDuplicateKeyError`) is caught and re-thrown as
`ConflictException('Another request for this ULB was just filed. Reload and try again.')` instead of
leaking a raw Mongo error to the client.

**Document write and audit-log insert share one transaction.** `finalSubmit` writes the document and
inserts one `xvifc_eligibility_exemption_form_logs` row per submitted `formId` inside the same Mongo
session/transaction, so an abort undoes both together — the log is meant to be a complete, gap-free audit
trail, so it must never end up out of sync with what the main document actually holds.

## Consumers

- **Inside this module**: `RequestExemptionService.finalSubmit` — the only writer on the STATE side.
- **Outside this module**: `RequestExemptionMohuaService` (`mohua/request-exemption/`) writes the same
  document shape on approve/reject (updating `currentFormStatus`/`decidedBy`/`decidedAt`/`mohuaRemarks`
  on the relevant entry) and must stay compatible with these invariants — same entry shape, same
  wholesale-replace-not-edit convention on the next STATE resubmission of a returned entry.

## Consequences

- A future change to the entry shape (`XviFcEligibilityExemptionEntry`) or the status set it can hold
  must be checked against `RequestExemptionMohuaService`'s writer too, not just this module — they read
  and write the same documents.
- Removing or loosening either partial unique index reopens a double-request race for that shape (two
  concurrent first-time filings for the same `{ulb,year}` or `{state,year}` could both succeed).
- Skipping the transaction pairing on `finalSubmit` would let the audit log and the document diverge —
  e.g. a log row for a submission whose document write then failed, or vice versa.
