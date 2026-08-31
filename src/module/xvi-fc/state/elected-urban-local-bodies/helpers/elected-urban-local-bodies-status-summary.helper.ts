import { Model, Types } from 'mongoose';
import { EulbRowDocument } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import type { EulbStatusSummary } from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

/**
 * Returns status counts for all active rows in the active dataset, unaffected by eligibility,
 * search, or pagination. Uses a single aggregation: groups by electedBodyStatus and sums counts.
 * Unknown/null statuses are included in totalUlbCount but not in the named status counts.
 *
 * Shared by the post-submission-update rows endpoint and the main form's `getForm` — a free
 * function (rather than a method on either service) so neither service has to depend on the
 * other's DI graph just to reuse this aggregation.
 *
 * @param electedBodyStatuses `[constituted, notConstituted, exempt]`-ordered tuple, derived via
 *   `deriveElectedBodyStatuses` from the DB-backed `electedBodyStatus` field's options.
 */
export async function computeEulbStatusSummary(
  rowModel: Model<EulbRowDocument>,
  formId: Types.ObjectId,
  stateId: string,
  yearId: string,
  activeVersion: number,
  electedBodyStatuses: string[],
): Promise<EulbStatusSummary> {
  const [constituted, notConstituted, exempt] = electedBodyStatuses;

  const groups = await rowModel
    .aggregate<{ _id: string | null; count: number }>([
      {
        $match: {
          form: formId,
          state: new Types.ObjectId(stateId),
          year: new Types.ObjectId(yearId),
          datasetVersion: activeVersion,
          isActive: true,
        },
      },
      { $group: { _id: '$electedBodyStatus', count: { $sum: 1 } } },
    ])
    .exec();

  let totalUlbCount = 0;
  let constitutedCount = 0;
  let notConstitutedCount = 0;
  let exemptCount = 0;

  for (const g of groups) {
    totalUlbCount += g.count;
    if (g._id === constituted) constitutedCount = g.count;
    else if (g._id === notConstituted) notConstitutedCount = g.count;
    else if (g._id === exempt) exemptCount = g.count;
  }

  return { totalUlbCount, constitutedCount, notConstitutedCount, exemptCount };
}
