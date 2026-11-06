# MoHUA Office Memorandum (OM)

One OM per claim letter the SO verified (claim letter at status 5, READY, not abandoned, not superseded). The OM is
MoHUA's recommendation to the Department of Expenditure to release the installment for the letter's ULBs; MoHUA sends
the generated PDF through e-Office for signature and uploads the signed PDF back.

## Data
- `xvifc_om_ulbs` (`schemas/xvi-fc/mohua/om-ulb.schema.ts`): one row per ULB of a verified letter, copied from the
  claim letter's ULB rows by `copyClaimLetterUlbsToOm` (`om-ulbs.helper.ts`) inside the SO's approve transaction
  (`mohua/claim-letters` `approve()`). Generate stamps `om` on them. The unique `{state, year, installment, ulbId}`
  index is the OM lock. A letter verified before this collection existed gets its rows on Generate (same helper, no
  backfill script needed).
- `xvifc_oms` (`schemas/xvi-fc/mohua/om.schema.ts`): status DRAFT (MoHUA filling the boxes) → GENERATED → SIGNED_UPLOADED.
  One per claim letter (unique). On Generate it gets `sequence` (per State + year) and `refNo` `OM/<STATE>/<FY>/<n>`,
  and `content` is frozen: every later download re-renders that frozen content, so no file is stored.
- `xvifc_om_logs`: GENERATED / SIGNED_UPLOADED rows.

## Content
`om-content.builder.ts` builds the OM from the claim letter's own full document
(`ClaimLetterDocumentService.buildFullDocument`): rows A-K are the letter's compliance rows, printed as plain text
(the letter's own letter-detail boxes are dropped). Fixed text (letterhead, address, signatory, addressee) is in
`om.constants.ts`. The year allocation printed is the State's **basic** grant from `grantAllocation`.

## The download: one PDF
Generate and `GET :omId/pdf` return one PDF: the OM, then the claim letter's ULB lists (rows J and K), then its
annexures (Elected Body, GTC, Unspent Declaration, ATR... - formjson 26 `meta.mergeDocuments`).
- The ULB lists (eligible / ineligible) are frozen in `content.ulbLists` on Generate and drawn on landscape pages with
  the claim letter's own column widths and alignment (`claim-letter-annexure-columns.helpers.ts`, shared with its
  .docx), followed by a note (`OM_ULB_LISTS_FOOTNOTE`, frozen with them). "₹" prints as "Rs." (the PDF's standard fonts have no rupee sign). The editor view leaves them out. An OM
  generated before they were frozen prints without them.
- `om-pdf.service.ts` draws the OM with `pdfkit` in the claim letter's .docx layout (A4, 1" margins, Times 12pt / 11pt
  tables, bordered tables whose header repeats on each page). There is no Word version: the server has no
  Word-to-PDF converter.
- The annexures are never looked up again in the State forms. They are the pages of the letter's stored
  `finalClaimPdf` (frozen at submit, what the SO verified) after its signed covering letter's pages (`signedClaimFile`,
  also frozen), appended with `pdf-lib` (`OmService.loadAnnexures`).
- A letter submitted before the final PDF existed has no `finalClaimPdf`: its OM is issued alone (logged). An
  unreadable stored PDF is a 422.

## Boxes
Only the "No." (`omNumber`, the e-Office file number) is required; "Dated" (`omDate`) defaults to today (IST).
`OM_FIELDS` is in the shape the portal's inline letter boxes read. Drafts autosave through `PATCH .../draft`;
once generated the OM can no longer be edited (the upsert hits the one-OM-per-letter index → 409).

## Access
Reads: MoHUA / DoE (read-only) / ADMIN (`isMohuaViewScope`). Writes: `ISSUE_OFFICE_MEMORANDUM` + MoHUA scope
(`assertReviewerAccess`); DoE writes are blocked globally by `DoeReadOnlyGuard`.

## Not built yet
DoE status (history shows PENDING), excluding cities from an OM (an OM always covers every ULB on its letter),
moving the claim letter past 5.
