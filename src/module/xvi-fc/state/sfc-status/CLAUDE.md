# SFC Status

State-facing feature: a single SFC Status form document per (state, year). No batching, no
multi-document workflow — a State reads the form, saves a draft, and final-submits it.

## Layout

Flat — no `services/`/`helpers/` subfolders (unlike `claim-letter`, which needs them for its
multi-service pipeline):

- `sfc-status.controller.ts` — 5 endpoints: `GET questions` (static config), `GET dump` (Excel
  export), `GET :stateId/:yearId` (hydrated read), `POST save-draft`, `POST final-submit`.
- `sfc-status.service.ts` — all business logic. Each write endpoint follows the same pattern:
  existence check → upsert → separate history-insert call.
- `dto/`, `types/` — request DTOs and response shapes.

## The one tradeoff worth knowing before touching writes

`saveDraft`/`finalSubmit` update the form document and insert a history record as two separate,
**non-transactional** writes — if the history insert fails, the form update has already persisted.
This is a deliberate, accepted tradeoff, not an oversight; see the comment on
`sfc-status.service.ts`'s `createHistoryEntry` for the reasoning. If you're adding a new write path
here, decide explicitly whether it needs the same treatment or genuinely needs transactional
atomicity — don't assume one or the other.

No ADRs exist for this module (unlike `claim-letter`) — there's no cross-cutting concurrency
machinery (no transactions, locking, idempotency keys, or batch/reservation logic) that would
warrant one.
