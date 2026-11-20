import type { ClientSession, Model, Types } from 'mongoose';
import type { OmUlb } from 'src/schemas/xvi-fc/mohua/om-ulb.schema';
import type { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';

type ClaimUlbLean = Pick<
  ClaimLetterBatchUlb,
  'state' | 'year' | 'installment' | 'ulbId' | 'ulbSnapshot' | 'allocatedAmount' | 'claimedAmount'
> & { _id: Types.ObjectId };

/**
 * Copies a verified claim letter's ULBs into `xvifc_om_ulbs` (om: null), in the caller's session. Runs on the SO's
 * approval, and again on Generate OM for a letter verified before this collection existed; a letter that already has
 * its rows is left as it is. The claim letter keeps its own rows. Returns how many rows the letter now has.
 */
export async function copyClaimLetterUlbsToOm(
  batchUlbModel: Model<ClaimLetterBatchUlb>,
  omUlbModel: Model<OmUlb>,
  claimLetter: Types.ObjectId,
  session: ClientSession,
): Promise<number> {
  const existing = await omUlbModel.countDocuments({ claimLetter }).session(session);
  if (existing) return existing;

  const children = await batchUlbModel
    .find({ claimLetter })
    .select('state year installment ulbId ulbSnapshot allocatedAmount claimedAmount')
    .session(session)
    .lean<ClaimUlbLean[]>()
    .exec();
  if (!children.length) return 0;

  // A ULB already in another letter's OM rows breaks the unique index and aborts the caller's transaction.
  await omUlbModel.insertMany(
    children.map((child) => ({
      claimLetter,
      claimLetterUlb: child._id,
      state: child.state,
      year: child.year,
      installment: child.installment,
      ulbId: child.ulbId,
      ulbSnapshot: child.ulbSnapshot,
      allocatedAmount: child.allocatedAmount,
      claimedAmount: child.claimedAmount,
      om: null,
    })),
    { session },
  );
  return children.length;
}

/** A ULB of this letter whose OM row another letter holds, the clash on the unique index above. */
export interface OmUlbHeldElsewhere {
  ulbName: string;
  heldBy: Types.ObjectId;
}

/**
 * The letter's ULBs that already have an OM row from another letter for the same installment. Read only after the
 * copy failed on the unique index, so a successful approval runs no extra query. Nothing deletes OM rows, so this is
 * stale data (e.g. a test reset) or, once built, MoHUA's return of a verified letter.
 */
export async function findOmUlbsHeldElsewhere(
  batchUlbModel: Model<ClaimLetterBatchUlb>,
  omUlbModel: Model<OmUlb>,
  claimLetter: Types.ObjectId,
): Promise<OmUlbHeldElsewhere[]> {
  const children = await batchUlbModel
    .find({ claimLetter })
    .select('state year installment ulbId ulbSnapshot.name')
    .lean<Pick<ClaimUlbLean, 'state' | 'year' | 'installment' | 'ulbId' | 'ulbSnapshot'>[]>()
    .exec();
  if (!children.length) return [];

  const { state, year, installment } = children[0];
  const held = await omUlbModel
    .find({ state, year, installment, ulbId: { $in: children.map((c) => c.ulbId) }, claimLetter: { $ne: claimLetter } })
    .select('ulbId claimLetter')
    .lean<{ ulbId: Types.ObjectId; claimLetter: Types.ObjectId }[]>()
    .exec();
  if (!held.length) return [];

  const nameByUlb = new Map(children.map((c) => [String(c.ulbId), c.ulbSnapshot?.name ?? String(c.ulbId)]));
  return held.map((row) => ({
    ulbName: nameByUlb.get(String(row.ulbId)) ?? String(row.ulbId),
    heldBy: row.claimLetter,
  }));
}
