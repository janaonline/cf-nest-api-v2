import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';

export const FC_UNSPENT_FORM_NAME = 'FC Unspent Declaration';
export const FC_UNSPENT_FORM_ID = 25;
export const FC_UNSPENT_ROUTE_BASE = 'xvi-fc/state/fc-unspent-declaration';

/** Single declaration point — never duplicate this literal elsewhere. */
export const FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT = 10;

export const FC_UNSPENT_DECLARATION_ALLOWED_FILE_EXTENSIONS = ['pdf'] as const;
export const FC_UNSPENT_DECLARATION_ALLOWED_MIME_TYPES = ['application/pdf'] as const;
export const FC_UNSPENT_DECLARATION_MAX_FILE_SIZE_MB = 5;
export const FC_UNSPENT_DECLARATION_MAX_FILE_SIZE_BYTES = FC_UNSPENT_DECLARATION_MAX_FILE_SIZE_MB * 1024 * 1024;

export const FC_UNSPENT_DECLARATION_FOLDER_PATH_KEY = 'fc-unspent/fc-declaration';

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
  'Devolution Formula (Installment 1) must be validated with an active dataset before FC Unspent Declaration can be edited.';
export const FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_RETURNED =
  'Devolution Formula (Installment 1) has been returned by MoHUA. You may keep editing and save a draft, but final submit is blocked until Devolution Formula is resubmitted and back under MoHUA review.';
export const FC_UNSPENT_BLOCKING_MESSAGE_DEVOLUTION_NOT_READY =
  'Devolution Formula (Installment 1) must be under review by MoHUA before FC Unspent Declaration can be finalized.';

/** One per-design-year declaration-template asset. Raw S3-relative `path` — never a signed URL. */
export interface FcUnspentDeclarationTemplateConfig {
  path: string;
  fileName: string;
  mimeType: string;
}

/** Supporting-content action id the No-branch `fcDeclaration` field exposes for template download. */
export const FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID = 'download-template';

/**
 * Design-year label -> the state-level declaration DOCX template asset. Every design year needs its
 * own explicitly-approved asset — there is no fallback from one year to another. Only 2026-27 has an
 * approved asset today; later years are added here once their DOCX is provided, never inferred.
 */
export const FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR: Record<string, FcUnspentDeclarationTemplateConfig> = {
  '2026-27': {
    path: 'xvi-fc/state/common/2026-27/fc-unspent/fc-declaration-template/FC-Unspent-Declaration_9ef58a73-82ef-43b7-991f-02257fcde890.docx',
    fileName: 'FC-Unspent-Declaration-2026-27.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
};
