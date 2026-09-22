/** formId for the DUR (Detailed Utilisation Report) formJson document — see CLAUDE.md's formId
 *  registry (22 SFC, 23 EULB, 24 Devolution, 25 FC Unspent, 26 Claim Letter, 30/31 Annual Account,
 *  32 SLB, 33 Bank Account, 36 DUR). */
export const DUR_FORM_ID = 36;

export const DUR_DOC_LABELS: Record<'tiedGrant' | 'untiedGrant', string> = {
  tiedGrant: 'Tied Grant Utilisation Report',
  untiedGrant: 'Untied Grant Utilisation Report',
};

/** Maps a DUR docId to the `grant_type` value the dur-validation API expects ('tied'/'untied') —
 *  added to the API's payload contract 2026-09-22 (confirmed via network capture), alongside
 *  financial_year, so the extracted document is checked against the grant type it was uploaded for. */
export const DUR_DOC_ID_TO_GRANT_TYPE: Record<'tiedGrant' | 'untiedGrant', 'tied' | 'untied'> = {
  tiedGrant: 'tied',
  untiedGrant: 'untied',
};

/** DUR always reports on FY 2025-26 — the final year of the 15th FC award period — regardless of
 *  which 16th-FC design year is currently selected in the portal. Not derived from any per-request
 *  input: a client-supplied value here was the root cause of a financial_year_mismatch (we sent
 *  '2026-27' as "expected" while the document, correctly, extracted '2025-26'). */
export const DUR_REPORTING_FINANCIAL_YEAR = '2025-26';
