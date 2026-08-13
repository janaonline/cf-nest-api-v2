import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';

export const FC_UNSPENT_FORM_ID = 25;

/**
 * Fallback default eligibility threshold, used only when a design year's form-json document has
 * no `meta.eligibilityThresholdPercent` override (see FC_UNSPENT_ELIGIBILITY_THRESHOLD_META_KEY).
 * Never read directly for eligibility computation — go through
 * FcUnspentDeclarationFormJsonService.getEligibilityThresholdPercent().
 */
export const FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT = 0;

/** Key read off `formJson.meta` to override FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT per design year. */
export const FC_UNSPENT_ELIGIBILITY_THRESHOLD_META_KEY = 'eligibilityThresholdPercent';

export const FC_UNSPENT_PAGINATION_DEFAULT_PAGE = 1;
export const FC_UNSPENT_PAGINATION_DEFAULT_LIMIT = 20;
export const FC_UNSPENT_PAGINATION_MAX_LIMIT = 200;

/**
 * Design-year label -> applicable FC cycle. Resolved via YearIdToLabel[yearId]
 * (src/core/constants/years.ts), same 404-on-unmapped-year pattern every sibling
 * state form already uses. Only 2026-27 has a real seeded yearId today; the rest
 * are inert until added to years.ts.
 */
export const FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL: Record<string, ApplicableFc> = {
  '2026-27': '14TH_FC',
  '2027-28': '14TH_FC',
  '2028-29': '15TH_FC',
  '2029-30': '15TH_FC',
  '2030-31': '15TH_FC',
};

export const FC_UNSPENT_DEVOLUTION_INSTALLMENT = 1;

export const FC_UNSPENT_BLOCKING_MESSAGE_MISSING_DEVOLUTION =
  'ULB-wise Allocation (Installment 1) must be validated with an active dataset before FC Unspent Declaration can be edited.';
export const FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_RETURNED =
  'ULB-wise Allocation (Installment 1) has been returned by MoHUA. You may keep editing and save a draft, but final submit is blocked until ULB-wise Allocation is resubmitted and back under MoHUA review.';
export const FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_NOT_READY =
  'ULB-wise Allocation (Installment 1) must be under review by MoHUA before FC Unspent Declaration can be finalized.';

/**
 * Supporting-content action id the No-branch `fcDeclaration` field exposes for template download.
 * The actual template asset (S3 path/fileName/mimeType) lives in this action's DB-driven `meta` —
 * see `findSupportingAction`/`stripSupportingContentMeta` in
 * `common/utils/xvi-fc-supporting-content-visibility.util.ts`. Every design year's own form-json
 * document carries its own `meta` (or none) — there is no fallback from one year to another.
 */
export const FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID = 'download-template';
