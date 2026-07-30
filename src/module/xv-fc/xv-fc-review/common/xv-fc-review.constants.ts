import type { HeadOfAccountType } from '../../../../schemas/line-item.schema';

// Sentinel targetCodes used for the two document uploads this feature has —
// distinguishes them from a real line-item code in the shared
// presign/confirm/signed-url endpoints. There is no per-line-item upload.
export const DECLARATION_TARGET_CODE = 'DECLARATION';
export const SUPPORTING_DOCUMENT_TARGET_CODE = 'SUPPORTING_DOCUMENT';

// The AFS review window is a fixed 5-year business range, not something
// to infer from which ledgerlogs documents already happen to exist — MaGC
// digitization for later years may not have landed yet, but the ULB still
// needs to see all 5 tabs (with a "no data yet" state for years not loaded).
export const XV_FC_REVIEWABLE_YEARS = ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24'] as const;

// The `lineitems` master catalog's headOfAccount values (Revenue/Tax/Expense/
// Asset/Liability/Debt) are internal bookkeeping categories; the FE groups
// the statement into two visible sections matching a standard income
// statement + balance sheet split — "INCOME" and "EXPENSE" for the two shown
// in the prototype, "ASSET"/"LIABILITY" for the remaining catalog categories.
export const XV_FC_LINE_ITEM_SECTION = ['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY'] as const;
export type XvFcLineItemSection = (typeof XV_FC_LINE_ITEM_SECTION)[number];

const SECTION_BY_HEAD_OF_ACCOUNT: Record<HeadOfAccountType, XvFcLineItemSection> = {
  Revenue: 'INCOME',
  Tax: 'INCOME',
  Expense: 'EXPENSE',
  Asset: 'ASSET',
  Liability: 'LIABILITY',
  Debt: 'LIABILITY',
  Other: 'ASSET', // not expected to appear — "Other" codes are document/schedule markers, never present in ledgerlogs.lineItems
};

export function mapHeadOfAccountToSection(
  headOfAccount: HeadOfAccountType | null | undefined,
): XvFcLineItemSection | null {
  if (!headOfAccount) return null;
  return SECTION_BY_HEAD_OF_ACCOUNT[headOfAccount] ?? null;
}

// A handful of line items are themselves a breakdown/schedule of a parent
// code (e.g. 11001-11018 break down code 110 "Tax Revenue"; 33000-33004
// break down code 330 "Secured Loans"; 33100-33104 break down code 331
// "Unsecured Loans"; 31001/31002 are grouped as their own "Others" schedule).
// Their `section` already resolves correctly via headOfAccount, but the FE
// needs to render them as their own named sub-group rather than flattened
// into the parent section — stakeholder feedback on the AFS review screen.
export const XV_FC_LINE_ITEM_SUBSECTION = [
  'TAX_REVENUE_BREAKDOWN',
  'SECURED_LOANS_PARTICULARS',
  'UNSECURED_LOANS_PARTICULARS',
  'OTHERS',
] as const;
export type XvFcLineItemSubSection = (typeof XV_FC_LINE_ITEM_SUBSECTION)[number];

const SUBSECTION_CODES: Record<XvFcLineItemSubSection, ReadonlySet<string>> = {
  TAX_REVENUE_BREAKDOWN: new Set([
    '11001',
    '11002',
    '11003',
    '11004',
    '11005',
    '11006',
    '11007',
    '11008',
    '11009',
    '11010',
    '11011',
    '11012',
    '11013',
    '11014',
    '11015',
    '11016',
    '11017',
    '11018',
  ]),
  SECURED_LOANS_PARTICULARS: new Set(['33000', '33001', '33002', '33003', '33004']),
  UNSECURED_LOANS_PARTICULARS: new Set(['33100', '33101', '33102', '33103', '33104']),
  OTHERS: new Set(['31001', '31002']),
};

export function mapCodeToSubSection(code: string): XvFcLineItemSubSection | null {
  for (const subSection of XV_FC_LINE_ITEM_SUBSECTION) {
    if (SUBSECTION_CODES[subSection].has(code)) return subSection;
  }
  return null;
}
