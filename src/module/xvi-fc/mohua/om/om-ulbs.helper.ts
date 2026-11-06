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
