/**
 * Helper to convert a numeric population into a human-readable category.
 */

export type PopulationCategory = '<100K' | '100K-500K' | '500K-1M' | '1M-4M' | '4M+';

/**
 * Return population category for a given population number.
 * Accepts number | null | undefined. Non-finite or negative values are treated as 0.
 */
export function getPopulationCategory(population?: number | null): PopulationCategory {
  const pop = Number.isFinite(population as number) && (population as number) > 0 ? (population as number) : 0;

  if (pop < 100_000) return '<100K';
  if (pop < 500_000) return '100K-500K';
  if (pop < 1_000_000) return '500K-1M';
  if (pop < 4_000_000) return '1M-4M';
  return '4M+';
}

export function buildPopulationMatch(populationCategory: string) {
  switch (populationCategory) {
    case '4M+':
      return { population: { $gte: 4000000 } };
    case '1M-4M':
      return { population: { $gte: 1000000, $lt: 4000000 } };
    case '500K-1M':
      return { population: { $gte: 500000, $lt: 1000000 } };
    case '100K-500K':
      return { population: { $gte: 100000, $lt: 500000 } };
    case '<100K':
      return { population: { $lt: 100000 } };
  }
}
