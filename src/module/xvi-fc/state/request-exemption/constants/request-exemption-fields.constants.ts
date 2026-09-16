import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { REQUEST_EXEMPTION_REASON_FORM_IDS } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';

/**
 * Fixed field set for the Request Exemption form. Unlike SFC Status/FC Unspent Declaration, this
 * isn't admin-configurable via a `formJsons` document — the field set is small and fixed (TS-133's
 * "Requested" conditions), so a hardcoded constant (same technique the frontend mock this replaces
 * already used) avoids a `formJsons` seed round-trip for no real benefit.
 *
 * `reasonForExemption`'s options are exactly REQUEST_EXEMPTION_REASON_FORM_IDS (23/30/31) — SFC
 * (22) is deliberately excluded; see `xvi-fc-eligibility-exemption.schema.ts`'s doc-comment.
 */

/** Single source of truth for each reason formId's display label — used both for this form's
 *  `reasonForExemption` options below and for the "Exemption Status" list's per-row labels
 *  (`RequestExemptionService.list`), so the two can never drift out of sync. */
export const REQUEST_EXEMPTION_REASON_LABELS: Record<number, string> = {
  23: 'Election / duly constituted ULB exemption',
  30: 'Audited Financial Statement',
  31: 'Provisional Financial Statement',
};

// TODO: Add to form json collection and remove this constant once the form jsons are available.
export const REQUEST_EXEMPTION_FIELDS: FieldConfig[] = [
  {
    // Debounced search-as-you-type against master/ulb (already state-scoped for a STATE user) —
    // not a preloaded `select`: the ULB list is per-state, can run into the hundreds, and can
    // change at any time, so nothing is baked into this fixed constant beyond where/how to search.
    // `isActive: true` alone is the right candidate-set filter here — a STATE-submitted ULB is
    // `isActive: false` until ADMIN-approved and stays `isActive: false` if rejected (`ulb.service.ts`
    // `create()`/`reject()`), so `isActive: true` already implies approved. Adding
    // `approvalStatus: 'APPROVED'` on top would be redundant *and* wrong: legacy ULBs that predate
    // the approval workflow (`isExistingUser`, no `approval` field at all) are real, active ULBs
    // but never carry `approval.status: 'APPROVED'`, and an explicit `approvalStatus` filter would
    // wrongly exclude them from the picker.
    formFieldType: 'autocomplete',
    key: 'ulb',
    label: 'ULB',
    placeholder: 'Search a ULB',
    remoteSearch: {
      endpoint: 'master/ulb',
      extraParams: { isActive: true },
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    layout: { variant: 'inline', labelWidth: 'lg' },
  },
  {
    formFieldType: 'select',
    multiple: true,
    key: 'reasonForExemption',
    label: 'Reason for Exemption',
    options: REQUEST_EXEMPTION_REASON_FORM_IDS.map((id) => ({
      id: String(id),
      label: REQUEST_EXEMPTION_REASON_LABELS[id],
    })),
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    layout: { variant: 'inline', labelWidth: 'lg' },
  },
  {
    formFieldType: 'textarea',
    key: 'supportingDetails',
    label: 'Supporting Details',
    placeholder: 'Briefly describe the grounds for this exemption.',
    validations: [
      { name: 'required', validator: null, message: 'This field is required.' },
      { name: 'minlength', validator: 3, message: 'Minimum 3 characters required.' },
      { name: 'maxlength', validator: 500, message: 'Maximum 500 characters allowed.' },
    ],
    layout: { variant: 'inline', labelWidth: 'lg' },
  },
  {
    formFieldType: 'file',
    key: 'supportingFile',
    label: 'Supporting Document',
    allowedFileTypes: ['pdf'],
    maxFileSize: 5,
    folderPathKey: 'req-exemption/supporting-doc',
    value: { originalName: '', path: '', mimeType: '', sizeKb: null, pageCount: null },
    validations: [],
    appearance: { color: 'danger', variant: 'soft' },
    layout: { variant: 'inline', labelWidth: 'lg' },
  },
];
