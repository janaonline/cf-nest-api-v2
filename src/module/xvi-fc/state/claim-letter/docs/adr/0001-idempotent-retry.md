# 0001 - Idempotent retry semantics

## Status

Accepted

## Context

Claim-letter mutations run over the network from a client UI. A dropped connection or a client
retry after a timeout must never create a duplicate claim batch or double-submit a claim — the
underlying action is a legally binding grant claim, not an idempotent-by-nature read.

## Decision

Two different mechanisms cover the two mutation shapes in this feature:

**Create (`ClaimLetterAssemblyService.createDraft`) — client-supplied idempotency key.**
The caller may pass a `buildRequestId`; a fresh one is generated when omitted. On retry with the
same key:
- If a batch with that `buildRequestId` already reached `READY`, its current state is returned —
  no new batch is created.
- If a batch with that `buildRequestId` exists but isn't `READY` (still `BUILDING`, or failed), the
  retry is rejected with a conflict asking for a fresh key — reusing a key against a failed/stuck
  build is treated as caller error, not silently retried server-side.

The lookup is scoped by **`state` + `buildRequestId` together, not `buildRequestId` alone.**
`buildRequestId` is client-suppliable and only unique at the DB level across *all* states — without
the `state` scope, a caller who (accidentally or otherwise) reuses another state's idempotency key
would get that other state's claim batch back, bypassing the access-control check on the URL's
`stateId`. This is a security property, not just a correctness one — any change to this lookup must
preserve the combined scope.

**Submit (`ClaimLetterService.submit`) — natural idempotency, no client key needed.**
If the claim is already `UNDER_REVIEW_BY_MOHUA`, `submit` returns the current state instead of
throwing. This covers the case where the original submit's response was lost in transit but the
transition had already committed server-side — the client's retry just observes the already-true
outcome rather than erroring.

**Edit (`PATCH .../draft`, `ClaimLetterAssemblyService.updateDraft`) — deliberately NOT
idempotency-key based.**
Edits use optimistic concurrency (`revision`) instead — see the `expectedRevision` field on
`UpdateClaimLetterDraftDto`. Edits are expected to be sequential, user-driven, single-shot updates
where "did my specific edit apply" matters more than "is this the same request replayed" — a
mismatched `revision` means someone else changed the draft first, which the idempotency-key model
doesn't distinguish from "this is my own retry."

## Consequences

- Dropping the `state` scope from the `createDraft` idempotency lookup reintroduces a cross-state
  data leak, not just a duplicate-claim bug.
- Any new mutating endpoint added to this feature needs an explicit decision between these two
  models (or "neither, single-shot only") — don't assume idempotency is free.
