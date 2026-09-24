# GTC (Grant Transfer Certificate)

State-facing feature: tracks when the State actually transferred an installment's grant money
down to its ULBs. One GTC form document per (state, year, installment) - form-level, no rows,
same shape as SFC Status plus Devolution Formula's installment scoping.

Content rule: a GTC submission at installment N of year Y always certifies the transfer of the
immediately preceding installment - installment 2 of year Y certifies installment 1 of the same
year; installment 1 of year Y certifies installment 2 of year Y-1 (or, for the very first design
year 2026-27, the prior Finance Commission's final installment). This is a content/business rule
enforced by whoever authors each year's formJson question set - the schema itself has no
knowledge of it.

## Layout

Flat - no `services/`/`helpers/` subfolders (same reasoning as `sfc-status`):

- `gtc.controller.ts` - 5 endpoints: `GET questions` (static config), `GET :stateId/:yearId/:installment`
  (hydrated read), `GET :stateId/:yearId/:installment/gtc-template` (static template download),
  `POST save-draft`, `POST final-submit`.
- `gtc.service.ts` - all business logic. Each write endpoint follows the same pattern as SFC
  Status: existence check -> upsert -> separate history-insert call.
- `dto/`, `types/`, `constants/` - request DTOs, response shapes, formId/installment/action-id
  constants.

## Why form-level + installment is a new combination, not new infrastructure

Two already-proven patterns combine here:

- **Form-level, no rows** (`XviFcSfcStatus`, collection `xvifc_sfc`): a single `data: Mixed` bag
  per document, so the schema never needs a migration when a year's questionnaire grows - only
  the design-year `formJson` document changes.
- **Installment scoping** (`DevolutionFormulaForm`, collection `xvifc_devolution_forms`): a plain
  `installment: {type: Number, enum: [1,2], required: true}` field folded into the uniqueness
  index, with `:installment` as a third route segment (see `parseInstallment` in this
  controller and in `devolution-formula.controller.ts`).

`XviFcGtc` (`src/schemas/xvi-fc/state/gtc-form.schema.ts`) is exactly these two combined - a
dedicated collection (like Devolution's, not SFC's shared-collection-with-`formType` shape), so
there is no `formType` discriminator field.

## Static template download (`gtc-template`)

2026-27 installment 1 is a one-off: the State downloads a static, admin-uploaded Word doc, gets
it signed, and uploads the signed PDF - no questionnaire. Every other submission (installment 2
of 2026-27 onward) is an ordinary questionnaire.

The download orchestration (`GtcService.getTemplate`/`resolveTemplateMeta`) rebuilds State FC
Unspent Declaration's pre-`01739664` static-template pattern (that orchestration was later
replaced there by on-the-fly DOCX generation, which doesn't fit GTC - GTC's template is a
genuinely static legal document with nothing to embed). The primitives it uses are still live,
generic infrastructure: `S3Service.headObject` (existence check), `FileTokenService.signFileUrl`
(signed download token), and the shared `findSupportingAction`/`applyActionVisibility`/
`stripSupportingContentMeta` helpers (`common/utils/xvi-fc-supporting-content-visibility.util.ts`).

A field carries the template by adding a `download-template` supporting action with a
backend-only `meta` object - stripped before any response reaches the client. Example for the
2026-27 installment-1 formJson field:

```jsonc
{
  "formFieldType": "file",
  "key": "i2GtcFile",
  "label": "Upload Signed GTC of installment 2 of FY 2025-26",
  "allowedFileTypes": ["pdf"],
  "maxFileSize": 5,
  "folderPathKey": "gtc/i2-gtc",
  "validations": [{ "name": "required", "validator": null, "message": "This field is required." }],
  "supportingContent": [
    {
      "type": "actions",
      "position": "before",
      "description": "Download the Grant Transfer Certificate template, then upload the signed copy below.",
      "actions": [
        {
          "id": "download-template",
          "label": "Download the GTC template",
          "icon": "bi bi-file-earmark-word",
          "meta": {
            "path": "xvi-fc/state/common/2026-27/gtc/gtc-template/<uploaded-filename>.docx",
            "fileName": "GTC-Template-2026-27.docx",
            "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }
        }
      ]
    }
  ]
}
```

The `common` segment in the S3 path (in place of a real state id) is the existing shared-template
convention - one template serves every state for that design year. `getTemplate` works generically
for any field carrying this action; it does not hardcode a field key like `i2GtcFile`, so a later
design year's questionnaire could reuse the same action on a differently-named field.

`resolveTemplateMeta` returns `undefined` (not an error) when a field has no such action or a
malformed `meta` - the expected, legitimate state for every ordinary questionnaire submission.
`getTemplate` turns that into a `templateNotConfigured` validation error only when the caller
actually asked for a template on a design year/installment that isn't configured for one.

## Claim eligibility

Wired entirely through `formJson.claimEligibility` - no GTC-specific code exists in
`ClaimEligibilityEvaluatorService`. Same-installment gating (`applicableInstallments: [1, 2]`,
`evaluator.config.installmentField: 'installment'`) - claiming installment N of a design year
requires GTC installment N to already be submitted, exactly mirroring Devolution's
`installmentField` mechanism.

## The one tradeoff worth knowing before touching writes

`saveDraft`/`finalSubmit` update the form document and insert a history record as two separate,
**non-transactional** writes, and `createHistoryEntry` no-ops when `fromStatus === toStatus` -
identical tradeoff to SFC Status; see that module's CLAUDE.md for the full reasoning. `action`
uses the shared `FormHistoryAction` enum (`src/common/constants/form-status.constants.ts`).

The form update itself is guarded against a concurrent status change the same way SFC Status is -
see `xvi-fc-concurrent-write.util.ts`.

No ADRs exist for this module - there's no cross-cutting concurrency machinery (no transactions,
locking, idempotency keys, or batch/reservation logic) that would warrant one, same reasoning as
`sfc-status`.

## Known gaps (tracked as a TODO in code, not implemented here)

Installment 2 is unconditionally locked (`installmentAccess.installment2.locked: true` on every
`getForm` response, and `finalSubmit` rejects `installment: 2` with `installment2Locked`) via a
hardcoded stub (`isInstallment2Unlocked` in `gtc.service.ts`) - the same stub pattern
`devolution-formula.service.ts` uses for its own installment 2. Unlike Devolution's stub (pending
a real claim-letter-acknowledgment integration), GTC's is pending a design year's installment-2
questionnaire actually being authored in `formJson.data` - the schema has no installment-specific
question set yet (see "Why form-level + installment is a new combination" above), so there is
nothing meaningful to unlock into until that content exists.
