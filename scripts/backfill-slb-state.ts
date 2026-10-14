/**
 * One-off backfill: sets `state` on every existing xvifc_slb_forms document that predates the field.
 *
 * `state` is copied from the document's ULB (`ulbs.state`) in a single set-based aggregation
 * ($lookup + $merge back by _id), not a per-document loop.
 *
 * - Documents whose ULB is missing, or has no state, cannot be resolved: they are left untouched and
 *   listed, so they can be looked at by hand.
 * - Re-runnable: only documents still missing `state` are matched, so a second run is a no-op for
 *   anything already backfilled.
 *
 * Needs MongoDB 4.4+ ($merge into the collection being aggregated).
 *
 * Usage:
 *   npm run migrate:xvifc-slb-state             # apply
 *   npm run migrate:xvifc-slb-state -- --dry-run # count only
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const SLB_COLLECTION = 'xvifc_slb_forms';
const ULB_COLLECTION = 'ulbs';
const ORPHAN_LIST_LIMIT = 20;

// `state: null` matches both a missing field and an explicit null.
const MISSING_STATE = { state: null };

const withUlbState = [
  { $match: MISSING_STATE },
  { $lookup: { from: ULB_COLLECTION, localField: 'ulb', foreignField: '_id', as: 'ulbDoc' } },
  { $addFields: { resolvedState: { $arrayElemAt: ['$ulbDoc.state', 0] } } },
];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const slb = mongoose.connection.db!.collection(SLB_COLLECTION);

  const missing = await slb.countDocuments(MISSING_STATE);
  const resolvable = await slb
    .aggregate([...withUlbState, { $match: { resolvedState: { $type: 'objectId' } } }, { $count: 'n' }])
    .toArray();
  const resolvableCount = (resolvable[0]?.n as number | undefined) ?? 0;
  const orphanCount = missing - resolvableCount;

  console.log(`${missing} SLB document(s) missing state: ${resolvableCount} resolvable, ${orphanCount} orphan(s)`);

  if (orphanCount > 0) {
    const orphans = await slb
      .aggregate([
        ...withUlbState,
        { $match: { resolvedState: { $not: { $type: 'objectId' } } } },
        { $project: { _id: 1, ulb: 1, year: 1 } },
        { $limit: ORPHAN_LIST_LIMIT },
      ])
      .toArray();
    console.log(`Orphans (first ${ORPHAN_LIST_LIMIT}) — ULB missing or has no state, left untouched:`);
    for (const doc of orphans) console.log(`  ${doc._id} (ulb=${doc.ulb}, year=${doc.year})`);
  }

  if (dryRun) {
    console.log('Dry run — nothing written.');
  } else if (resolvableCount > 0) {
    await slb
      .aggregate([
        ...withUlbState,
        { $match: { resolvedState: { $type: 'objectId' } } },
        { $project: { state: '$resolvedState' } },
        { $merge: { into: SLB_COLLECTION, on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } },
      ])
      .toArray();
    const stillMissing = await slb.countDocuments(MISSING_STATE);
    console.log(
      `Backfilled ${resolvableCount} document(s). ${stillMissing} still missing state (orphans). Re-running is safe.`,
    );
  } else {
    console.log('Nothing to backfill.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
