/**
 * Builds a MongoDB aggregation `$switch` expression to categorize a population
 *
 * Population categories:
 * - < 1,00,000          → "<100K"
 * - 1,00,000-4,99,999   → "100K-500K"
 * - 5,00,000–9,99,999   → "500K-1M"
 * - 10,00,000–39,99,999 → "1M-4M"
 * - ≥ 40,00,000         → "4M+"
 *
 * If the population value is missing or does not match any condition,
 * the category defaults to "Unknown".
 *
 * @param populationKey - MongoDB aggregation field reference (e.g. "$population")
 * @returns MongoDB `$switch` aggregation expression
 */
export const popCatQuerySwitch = (populationKey: string) => {
  return {
    $switch: {
      branches: [
        {
          case: { $lt: [populationKey, 100000] },
          then: '<100K',
        },
        {
          case: { $and: [{ $gte: [populationKey, 100000] }, { $lt: [populationKey, 500000] }] },
          then: '100K-500K',
        },
        {
          case: { $and: [{ $gte: [populationKey, 500000] }, { $lt: [populationKey, 1000000] }] },
          then: '500K-1M',
        },
        {
          case: { $and: [{ $gte: [populationKey, 1000000] }, { $lt: [populationKey, 4000000] }] },
          then: '1M-4M',
        },
        {
          case: { $gte: [populationKey, 4000000] },
          then: '4M+',
        },
      ],
      default: 'Unknown',
    },
  };
};
