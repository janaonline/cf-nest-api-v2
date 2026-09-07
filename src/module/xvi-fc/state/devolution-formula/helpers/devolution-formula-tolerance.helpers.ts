/**
 * Float-equality backstop for totalAllocatedSum vs. totalMoHUAAllocation. Devolution Formula rows
 * are whole Rupees (enforced by DevolutionFormulaValidator/`@IsInt()`), so totalAllocatedSum is
 * always an exact integer sum — the row-level `inst1 + inst2 === total` check uses plain `===`,
 * not this helper. totalMoHUAAllocation, however, comes from GrantAllocation, a collection this
 * codebase can't validate (external writer — see grant-allocation.schema.ts); Math.round() is
 * applied everywhere it's read, but amountsAreEqual stays as a last-resort backstop in case a
 * stray decimal ever slips through anyway.
 *
 * FLOAT_EQUALITY_EPSILON only absorbs IEEE-754 float noise (`0.1 + 0.2 !== 0.3`), not real
 * discrepancies — far tighter than a paisa.
 *
 * Also backs `snapToWholeRupee` below, which applies this same tolerance one level earlier — at
 * ingestion of a single Excel cell value, rather than at comparison of two summed totals.
 */
export const FLOAT_EQUALITY_EPSILON = 0.001;

export function amountsAreEqual(a: number, b: number, epsilon: number = FLOAT_EQUALITY_EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}

/**
 * Snaps a value to the nearest whole Rupee when it's within FLOAT_EQUALITY_EPSILON of one —
 * absorbs IEEE-754 float noise from spreadsheet formulas (e.g. a 50/50 installment split landing
 * on 63579869.999999996 instead of 63579870, invisible in Excel's own display formatting) without
 * accepting a genuine fractional Rupee amount, which is always far larger than this epsilon.
 * Non-numeric, NaN, or Infinity input is returned unchanged so required-field and type checks
 * downstream (DevolutionFormulaValidator) still see it correctly.
 */
export function snapToWholeRupee(v: unknown): unknown {
  if (typeof v !== 'number' || !isFinite(v)) return v;
  const rounded = Math.round(v);
  return amountsAreEqual(v, rounded) ? rounded : v;
}
