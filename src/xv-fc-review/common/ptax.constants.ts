// Fixed business scope, not derived from what data happens to exist — same
// reasoning as XV_FC_REVIEWABLE_YEARS.
export const PTAX_REVIEWABLE_YEARS = ['2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24'] as const;

export const PTAX_METRICS = [
  {
    code: '1.9',
    label:
      'Total Property Tax Demand (including cess, other taxes, and excluding user charges if user charges are collected with property tax)',
  },
  {
    code: '1.10',
    label:
      'Current Property Tax Demand (including cess, other taxes, and excluding user charges if user charges are collected with property tax)',
  },
  {
    code: '1.17',
    label:
      'Total Property Tax Collection (including cess, other taxes, and excluding user charges if user charges are collected with property tax)',
  },
  {
    code: '1.18',
    label:
      'Current Property Tax Collection (including cess, other taxes, and excluding user charges if user charges are collected with property tax)',
  },
  { code: '2.3', label: 'Total Number of Properties from which Property Tax was Demanded' },
  { code: '2.4', label: 'Total Number of Properties from which Property Tax was Collected' },
] as const;

export const PTAX_METRIC_CODES = PTAX_METRICS.map((m) => m.code);

// Per-metric bounds for the ULB-proposed value (and the admin's
// correctedValue on ACCEPT) — provided by product/FE. 2.3/2.4 are property
// counts (decimalLimit: 0 → whole numbers only, isRupee: false); the rest
// are currency figures.
export interface PtaxMetricValidationRule {
  min: number;
  max: number;
  decimalLimit: number;
  isRupee: boolean;
}

export const PTAX_METRIC_VALIDATION: Record<string, PtaxMetricValidationRule> = {
  '1.9': { min: 0, max: 9999999, decimalLimit: 2, isRupee: true },
  '1.10': { min: 0, max: 9999999, decimalLimit: 2, isRupee: true },
  '1.17': { min: 0, max: 9999999, decimalLimit: 2, isRupee: true },
  '1.18': { min: 0, max: 9999999, decimalLimit: 2, isRupee: true },
  '2.3': { min: 0, max: 999999999999999, decimalLimit: 0, isRupee: false },
  '2.4': { min: 0, max: 999999999999999, decimalLimit: 0, isRupee: false },
};

// Returns a human-readable error, or null when the value satisfies the
// metric's rule. Shared by the ULB draft-save path and the admin's
// correctedValue-on-ACCEPT path, so both enforce the exact same bounds.
export function validatePtaxMetricValue(code: string, value: number): string | null {
  const rule = PTAX_METRIC_VALIDATION[code];
  if (!rule) return null;

  if (value < rule.min) return `Value must be at least ${rule.min}`;
  if (value > rule.max) return `Value must not exceed ${rule.max}`;

  const decimalPlaces = (String(value).split('.')[1] ?? '').length;
  if (decimalPlaces > rule.decimalLimit) {
    return rule.decimalLimit === 0
      ? 'Value must be a whole number'
      : `Value must have at most ${rule.decimalLimit} decimal place${rule.decimalLimit === 1 ? '' : 's'}`;
  }

  return null;
}

// Cross-field ordering rules: the "current"/"collected" figure can never
// exceed its "total"/"demanded" counterpart. Checked against the *merged*
// state (existing stored proposedValue + whatever this call is changing),
// since the two sides of a pair are often saved in separate draft calls.
export const PTAX_METRIC_ORDER_PAIRS: Array<{ greater: string; lesser: string }> = [
  { greater: '1.9', lesser: '1.10' },
  { greater: '1.17', lesser: '1.18' },
  { greater: '2.3', lesser: '2.4' },
];

export function validatePtaxMetricOrder(valuesByCode: Record<string, number | null | undefined>): string | null {
  for (const pair of PTAX_METRIC_ORDER_PAIRS) {
    const greaterVal = valuesByCode[pair.greater];
    const lesserVal = valuesByCode[pair.lesser];
    if (greaterVal != null && lesserVal != null && lesserVal > greaterVal) {
      return `Metric ${pair.lesser} cannot be greater than metric ${pair.greater}`;
    }
  }
  return null;
}

// Metric codes contain literal dots ('1.9', '2.3', ...), but MongoDB's dot
// notation treats every '.' in an update path as a nesting separator —
// `$set: {'metricReviews.1.9.flagged': true}` would be parsed as
// metricReviews -> '1' -> '9' -> flagged, silently fragmenting the Map.
// Sanitize to/from an underscore-safe key for every dynamic path string;
// the dotted `code` form is only ever used in API request/response payloads.
export function toMetricKey(code: string): string {
  return code.replace(/\./g, '_');
}

export function fromMetricKey(key: string): string {
  return key.replace(/_/g, '.');
}
