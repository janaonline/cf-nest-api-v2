import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

export interface RequestExemptionPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface RequestExemptionGetResponseData {
  stateId: string;
  yearId: string;
  stateName: string;
  fields: HydratedFieldConfig[];
  permissions: RequestExemptionPermissions;
}

export interface RequestExemptionSaveResponseData {
  _id: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
}

/** Sourced live from `formjsons` — see CLAUDE.md's "Reason options are sourced live" section. */
export interface RequestExemptionReasonOption {
  id: number;
  label: string;
}

/**
 * One row of `GET :stateId/:yearId/list` — backs the "Exemption Status" landing table. One row per
 * `(document, data[] entry)` pair, not one row per document — a ULB with two requested reasons
 * shows as two rows. `_id` is a stable synthetic `${requestId}_${formId}` key (not a real document
 * id on its own); the real addressable pair for any future decide endpoint is `{requestId, formId}`.
 */
export interface RequestExemptionListItem {
  _id: string;
  requestId: string;
  formId: number;
  /** `censusCode` falls back to `sbCode` server-side when the census code isn't set. */
  ulb: { _id: string; name: string; censusCode: string | null } | null;
  /** Display label for `formId`, resolved server-side via `loadReasonOptions` (see
   *  `RequestExemptionReasonOption`) — the frontend list page never needs its own formId->label
   *  lookup. */
  reasonForExemptionLabel: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  submittedAt: string | null;
  createdAt: string;
}

export interface RequestExemptionListResponseData {
  stateName: string;
  items: RequestExemptionListItem[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  /** Same permission save-draft/final-submit are already gated on (`Permission.RECOMMEND_EXEMPTIONS`)
   *  — lets the frontend disable/hide the "Request Exemption" button without a second round trip. */
  canCreate: boolean;
}
