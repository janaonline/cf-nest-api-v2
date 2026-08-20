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
 */
export const FLOAT_EQUALITY_EPSILON = 0.001;

export function amountsAreEqual(a: number, b: number, epsilon: number = FLOAT_EQUALITY_EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}
