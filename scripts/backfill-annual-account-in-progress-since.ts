/**
 * One-off backfill: sets `inProgressSince` on every existing `IN_PROGRESS` (form_status_id 2)
 * xvifc_annualaccounts document that predates this field (added for the ULB in-progress reminder
 * cron — see src/module/xvi-fc/common/reminders/ulb-in-progress-reminder.service.ts).
 *
 * Without this field, `inProgressSince: { $ne: null }` in that cron's due-check excludes these
 * records permanently — MongoDB treats a missing field the same as null for that comparison, and
 * nothing else will ever set it on a record that's already sitting in IN_PROGRESS (it's only set
 * once, at the moment a section first transitions into that status).
 *
 * The true historical transition moment isn't recoverable, so this uses `createdAt` as the best
 * available approximation — safe and re-runnable (only ever touches documents where
 * `inProgressSince` is still null, so running it again after some records have already been
 * backfilled is a no-op for those).
 *
 * Usage:
 *   npm run migrate:xvifc-in-progress-since
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const COLLECTION = 'xvifc_annualaccounts';
const IN_PROGRESS_FORM_STATUS_ID = 2;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const collection = db.collection(COLLECTION);

  const candidates = await collection
    .find({ form_status_id: IN_PROGRESS_FORM_STATUS_ID, inProgressSince: null })
    .project({ _id: 1, ulb: 1, sectionType: 1, createdAt: 1 })
    .toArray();

  console.log(`Found ${candidates.length} IN_PROGRESS record(s) missing inProgressSince`);

  let updated = 0;
  for (const doc of candidates) {
    const fallback = (doc.createdAt as Date | undefined) ?? new Date();
    await collection.updateOne({ _id: doc._id }, { $set: { inProgressSince: fallback } });
    console.log(`  ${doc._id} (ulb=${doc.ulb}, section=${doc.sectionType}) -> inProgressSince=${fallback.toISOString()}`);
    updated++;
  }

  console.log(`Backfilled ${updated} record(s). Re-running this script later is safe — it only touches records still missing inProgressSince.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
