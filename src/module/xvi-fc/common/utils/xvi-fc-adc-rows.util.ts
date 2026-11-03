import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import type { AdcDocument } from 'src/schemas/adc.schema';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { canDecideUlb } from './xvi-fc-state-access.util';

/**
 * Adds the two ADC fields every `state/ulb-submissions` row carries: `adcName` (null when the State owns the
 * ULB) and `canReview` — whether *this caller* may approve/return/undo the row: they hold
 * APPROVE_ULB_SUBMISSIONS and own the ULB (the State sees an ADC-owned ULB read-only). Pass
 * `decidable: false` for a form with no decision step (SLB), so no row is reviewable.
 * Rows must already project `adcId` (the ULB's current `adc`).
 *
 * The lists are scoped to the caller's state, so a row's state is the caller's own; ADMIN always can.
 */
export async function attachAdcOwnership<T extends { adcId?: Types.ObjectId | null }>(
  rows: T[],
  user: AuthUser,
  adcModel: Model<AdcDocument>,
  { decidable = true }: { decidable?: boolean } = {},
): Promise<(T & { adcName: string | null; canReview: boolean })[]> {
  const adcIds = [...new Set(rows.map((r) => toObjectIdString(r.adcId)).filter((id): id is string => !!id))];
  const adcs = adcIds.length
    ? await adcModel
        .find({ _id: { $in: adcIds } }, { name: 1 })
        .lean()
        .exec()
    : [];
  const nameById = new Map(adcs.map((a) => [String(a._id), a.name]));
  const canApprove = decidable && getEffectivePermissions(user).includes(Permission.APPROVE_ULB_SUBMISSIONS);

  return rows.map((row) => {
    const adcId = toObjectIdString(row.adcId);
    return {
      ...row,
      adcName: adcId ? (nameById.get(adcId) ?? null) : null,
      canReview: canApprove && canDecideUlb(user, { state: user.state, adc: adcId }),
    };
  });
}
