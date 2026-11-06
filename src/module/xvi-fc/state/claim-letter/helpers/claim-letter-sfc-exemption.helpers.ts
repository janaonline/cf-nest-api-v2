import type { Types } from 'mongoose';
import {
  DISCRETIONARY_COUNTED_STATUSES,
  type ExemptionResolverService,
} from 'src/module/xvi-fc/common/services/exemption-resolver.service';
import { SFC_FORM_ID } from 'src/schemas/xvi-fc/state/sfc-status.schema';

/** The State's Entire State SFC exemption status when it counts for the claim (5 under MoHUA review,
 *  7 approved), else null: the State gate's rule. One indexed query. */
export async function resolveSfcExemptionStatus(
  resolver: Pick<ExemptionResolverService, 'resolveDiscretionary'>,
  stateId: Types.ObjectId,
  yearId: Types.ObjectId,
): Promise<number | null> {
  const entry = await resolver.resolveDiscretionary(null, yearId, SFC_FORM_ID, stateId);
  return entry && DISCRETIONARY_COUNTED_STATUSES.includes(entry.currentFormStatus) ? entry.currentFormStatus : null;
}
