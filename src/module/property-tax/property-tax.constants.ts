// The "Property Tax* (Cr.)" trend chart's fixed year range — independent of xv-fc-review's
// XV_FC_REVIEWABLE_YEARS (which starts a year later, at 2019-20) since this module is
// deliberately not coupled to xv-fc-review at all.
export const PROPERTY_TAX_CHART_YEARS = ['2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24'] as const;

// Per product spec: the chart's "Property Tax" figure is Total Property Tax Collection, sourced
// from propertytaxopmappers.displayPriority = "1.20" — not from ledgerlogs, and not the same
// code as AFS's line-item 11001 ("Property Tax" under Tax Revenue Breakdown), which is a
// different catalog entirely.
export const PROPERTY_TAX_COLLECTION_DISPLAY_PRIORITY = '1.20';
