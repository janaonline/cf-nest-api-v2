/**
 * One-off migration: renames the PMU role value XVIFC_PMU -> MOHUA_PMU in the two collections that
 * drive access — `users.role` and `sidemenus.role` (the PMU sidebar rows).
 *
 * Historical audit snapshots (e.g. `userInfo.role` on upload history / form logs) are deliberately left
 * as written: they record the role name at the time of the action.
 *
 * Re-runnable: only documents still on the old value are matched.
 *
 * Afterwards clear the side-menu cache (it has no TTL, keyed by role):
 *   DELETE xvi-fc/admin/cache/side-menu?role=XVIFC_PMU   and   ...?role=MOHUA_PMU
 * PMU users must log in again — existing tokens still carry the old role.
 *
 * Usage:
 *   npm run migrate:pmu-role-rename             # apply
 *   npm run migrate:pmu-role-rename -- --dry-run # count only
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const OLD_ROLE = 'XVIFC_PMU';
const NEW_ROLE = 'MOHUA_PMU';
const COLLECTIONS = ['users', 'sidemenus'];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  console.log(`DB: ${process.env.MONGO_DB_NAME}${dryRun ? ' (dry run)' : ''}`);

  for (const name of COLLECTIONS) {
    const col = mongoose.connection.db!.collection(name);
    const matched = await col.countDocuments({ role: OLD_ROLE });
    if (dryRun || matched === 0) {
      console.log(`${name}: ${matched} document(s) on ${OLD_ROLE}${dryRun ? ' — would update' : ''}`);
      continue;
    }
    const res = await col.updateMany({ role: OLD_ROLE }, { $set: { role: NEW_ROLE } });
    console.log(`${name}: ${res.modifiedCount} of ${matched} updated to ${NEW_ROLE}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
