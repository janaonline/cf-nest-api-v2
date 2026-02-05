import { isDeepStrictEqual } from 'node:util';

/**
 * Performs a deep, strict equality comparison between two values.
 *
 * This is a thin wrapper around Node.js `util.isDeepStrictEqual`, which:
 * - Compares nested objects, arrays, maps, sets, and dates
 * - Uses strict equality semantics (`===`)
 * - Correctly handles edge cases like `NaN` and `-0`
 * - Is cycle-safe and optimized by Node.js
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 */
export const isDeepEqual = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b);
