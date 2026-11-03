/**
 * Moves the State forms' return reason into the one field every reviewer now writes, `rejectionRemarks`: PMU's
 * `pmuRemarks` (SFC Status, Elected Body, Devolution, FC Unspent, GTC) and the `mohuaRemarks` that Devolution and
 * FC Unspent also had (the older MoHUA review and the SO return). Both old fields are removed afterwards.
 *
 * - Which reason wins when a form has both: the one matching its current status — `mohuaRemarks` while it is
 *   RETURNED_BY_MOHUA (6) or RETURNED_BY_SO (16), otherwise `pmuRemarks`; the other is the fallback. A
 *   `rejectionRemarks` already written by the new code is kept as is.
 * - Re-runnable: only documents that still carry `pmuRemarks` or `mohuaRemarks` are touched.
 * - Only these 5 State form collections; the claim letter's own `mohuaRemarks` and the exemption requests' are untouched.
 *
 * Usage:
 *   npm run migrate:xvifc-rejection-remarks              # migrate
 *   npm run migrate:xvifc-rejection-remarks -- --dry-run # count per collection, write nothing
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const COLLECTIONS = [
  'xvifc_sfc',
  'xvifc_elected_ulb_forms',
  'xvifc_devolution_forms',
  'xvifc_unspent_state_forms',
  'xvifc_gtc',
];

const RETURNED_BY_MOHUA = 6;
const RETURNED_BY_SO = 16;

const FILTER = { $or: [{ pmuRemarks: { $exists: true } }, { mohuaRemarks: { $exists: true } }] };

const PIPELINE = [
  {
    $set: {
      rejectionRemarks: {
        $ifNull: [
          '$rejectionRemarks',
          {
            $cond: [
              { $in: ['$currentFormStatus', [RETURNED_BY_MOHUA, RETURNED_BY_SO]] },
              { $ifNull: ['$mohuaRemarks', '$pmuRemarks', null] },
              { $ifNull: ['$pmuRemarks', '$mohuaRemarks', null] },
            ],
          },
        ],
      },
    },
  },
  { $unset: ['pmuRemarks', 'mohuaRemarks'] },
];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const db = mongoose.connection.db!;

  for (const name of COLLECTIONS) {
    const collection = db.collection(name);
    const pending = await collection.countDocuments(FILTER);
    if (dryRun || !pending) {
      console.log(`${name}: ${pending} document(s) to migrate`);
      continue;
    }
    const result = await collection.updateMany(FILTER, PIPELINE);
    console.log(`${name}: migrated ${result.modifiedCount} of ${pending} document(s)`);
  }

  if (dryRun) console.log('Dry run — nothing written.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
