/**
 * One-off backfill: denormalizes `Ulb.censusCode` onto every existing `ledgerlogs` (AFS) and
 * `xvfc_ptax_reviews` (Ptax) document that has review activity, the same way `ulb`/`ulb_code`/
 * `state` are already denormalized — powers the new `censusCode` filter on both admin list
 * endpoints and the combined admin Overview dashboard.
 *
 * Safe to re-run — only touches documents where `censusCode` is still unset.
 *
 * Usage:
 *   npm run backfill:xv-fc-census-code
 */
import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const ulbs = db.collection('ulbs');

  const results = await Promise.all([
    backfillCollection(db.collection('ledgerlogs'), ulbs, { xvFcReview: { $ne: null }, censusCode: { $exists: false } }),
    backfillCollection(db.collection('xvfc_ptax_reviews'), ulbs, { censusCode: { $exists: false } }),
  ]);

  console.log(`ledgerlogs: updated ${results[0].updated}, skipped ${results[0].skipped} (no matching ULB)`);
  console.log(`xvfc_ptax_reviews: updated ${results[1].updated}, skipped ${results[1].skipped} (no matching ULB)`);

  await mongoose.disconnect();
}

async function backfillCollection(
  collection: mongoose.mongo.Collection,
  ulbs: mongoose.mongo.Collection,
  filter: Record<string, unknown>,
): Promise<{ updated: number; skipped: number }> {
  const cursor = collection.find(filter, { projection: { ulb_id: 1 } });
  let updated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    const ulb = await ulbs.findOne({ _id: doc.ulb_id }, { projection: { censusCode: 1 } });
    if (!ulb?.censusCode) {
      skipped++;
      continue;
    }
    await collection.updateOne({ _id: doc._id }, { $set: { censusCode: ulb.censusCode } });
    updated++;
  }

  return { updated, skipped };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
