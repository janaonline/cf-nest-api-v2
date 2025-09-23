import { Injectable } from '@nestjs/common';

@Injectable()
export class QueryTemplates {
  popCatQuerySwitch = (populationKey: string) => {
    return {
      $switch: {
        branches: [
          { case: { $lt: [populationKey, 100000] }, then: '<100K' },
          {
            case: {
              $and: [
                { $gte: [populationKey, 100000] },
                { $lt: [populationKey, 500000] },
              ],
            },
            then: '100K-500K',
          },
          {
            case: {
              $and: [
                { $gte: [populationKey, 500000] },
                { $lt: [populationKey, 1000000] },
              ],
            },
            then: '500K-1M',
          },
          {
            case: {
              $and: [
                { $gte: [populationKey, 1000000] },
                { $lt: [populationKey, 4000000] },
              ],
            },
            then: '1M-4M',
          },
          { case: { $gte: [populationKey, 4000000] }, then: '4M+' },
        ],
        default: 'Unknown',
      },
    };
  };
}
