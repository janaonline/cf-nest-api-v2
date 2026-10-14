import { RUPEES_PER_CRORE } from './mohua-overview.constants';

/** A year's allocation is basic + performance, rounded to whole rupees as every other xvi-fc read of grantAllocation does. */
export function allocationRupees(allocation: { basic: number; performance: number }): number {
  return Math.round(allocation.basic + allocation.performance);
}

/** Stored amounts are whole rupees; the MoHUA pages show crore, to 2 decimals. */
export function toCrore(rupees: number): number {
  return Math.round((rupees / RUPEES_PER_CRORE) * 100) / 100;
}
