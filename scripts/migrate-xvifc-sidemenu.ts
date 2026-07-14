/**
 * One-off migration: copies documents from the retired `xvifc_side_menus` collection
 * into the shared `sidemenus` collection (renaming `label` -> `name`, keeping the same
 * `_id` so existing `parentId` references stay valid).
 *
 * Usage:
 *   npm run migrate:xvifc-side-menu           # copy only (safe, re-runnable)
 *   npm run migrate:xvifc-side-menu -- --drop  # copy, then drop the old collection
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const OLD_COLLECTION = 'xvifc_side_menus';
const NEW_COLLECTION = 'sidemenus';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  const shouldDrop = process.argv.includes('--drop');

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const oldCollection = db.collection(OLD_COLLECTION);
  const newCollection = db.collection(NEW_COLLECTION);

  const docs = await oldCollection.find({}).toArray();
  console.log(`Found ${docs.length} document(s) in ${OLD_COLLECTION}`);

  let migrated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const { label, ...rest } = doc as Record<string, any>;

    const existing = await newCollection.findOne({ _id: doc._id });
    if (existing) {
      skipped++;
      continue;
    }

    await newCollection.insertOne({
      ...rest,
      name: label,
    });
    migrated++;
  }

  console.log(`Migrated ${migrated} document(s), skipped ${skipped} already-present document(s).`);

  if (shouldDrop) {
    await oldCollection.drop();
    console.log(`Dropped ${OLD_COLLECTION}.`);
  } else {
    console.log(`Old collection left in place. Re-run with --drop once you've verified the migration.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
