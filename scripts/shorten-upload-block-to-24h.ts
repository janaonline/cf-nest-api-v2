/**
 * One-off migration (TS-933): shortens every already-active post-rejection upload block from the old
 * 7-day cooldown to the new POST_REJECTION_COOLDOWN_HOURS (24h), measured from the 3rd failed attempt.
 *
 * Only `uploadBlockedUntil` (3rd attempt + 7 days) is stored, so the 3rd-attempt moment is recovered as
 * `uploadBlockedUntil - 7d`, and the new end is `uploadBlockedUntil - (7d - 24h)`.
 *
 * - A slot already past that new end ends up with a past `uploadBlockedUntil`, i.e. unlocked. The date is
 *   deliberately kept (not nulled): a non-null `uploadBlockedUntil` is what tells the OCR processor /
 *   DUR writer that the next failure opens a fresh batch of attempts rather than re-locking at once.
 * - Re-runnable: only slots whose block ends more than 24h from now are touched. Under the new policy no
 *   block can end later than that, so any such slot is legacy and a shifted one is never shifted twice.
 *
 * Covers both forms that share the policy: xvifc_annualaccounts and xvifc_dur_forms.
 *
 * Usage:
 *   npm run migrate:xvifc-upload-block-24h             # apply
 *   npm run migrate:xvifc-upload-block-24h -- --dry-run # count only
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { POST_REJECTION_COOLDOWN_HOURS } from '../src/common/utils/manual-review-cooldown.util';

const COLLECTIONS = ['xvifc_annualaccounts', 'xvifc_dur_forms'];
const HOUR_MS = 60 * 60 * 1000;
const OLD_COOLDOWN_MS = 7 * 24 * HOUR_MS;
const NEW_COOLDOWN_MS = POST_REJECTION_COOLDOWN_HOURS * HOUR_MS;
const SHIFT_MS = OLD_COOLDOWN_MS - NEW_COOLDOWN_MS;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const db = mongoose.connection.db!;

  const legacyCutoff = new Date(Date.now() + NEW_COOLDOWN_MS);
  const filter = { documents: { $elemMatch: { uploadBlockedUntil: { $gt: legacyCutoff } } } };

  for (const name of COLLECTIONS) {
    const collection = db.collection(name);

    if (dryRun) {
      console.log(`${name}: ${await collection.countDocuments(filter)} form doc(s) with a legacy block (dry run, nothing changed)`);
      continue;
    }

    const result = await collection.updateMany(filter, [
      {
        $set: {
          documents: {
            $map: {
              input: '$documents',
              as: 'd',
              in: {
                $cond: [
                  { $gt: ['$$d.uploadBlockedUntil', legacyCutoff] },
                  { $mergeObjects: ['$$d', { uploadBlockedUntil: { $subtract: ['$$d.uploadBlockedUntil', SHIFT_MS] } }] },
                  '$$d',
                ],
              },
            },
          },
        },
      },
    ]);
    console.log(`${name}: matched ${result.matchedCount}, updated ${result.modifiedCount} form doc(s)`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
