/**
 * Lets a ULB act on a form the MoHUA Section Officer returned with its claim letter (RETURNED_BY_SO, 16) the same way
 * it does on one the State returned (4): adds 16 to the ULB document gates (upload, reupload, retry, delete) in
 * `xvifc_action_gates`. Those gates decide which Upload / Re-upload / Retry / Delete buttons the UI shows.
 *
 * - Only touches ULB rows of scope 'document' whose `statusIds` already contain 4 (RETURNED_BY_STATE).
 * - Re-runnable: `$addToSet`, so a row that already has 16 is left as is.
 * - The gates are read on every request (no cache), so nothing to clear afterwards.
 *
 * Usage:
 *   npm run migrate:xvifc-so-action-gates              # update
 *   npm run migrate:xvifc-so-action-gates -- --dry-run # list what would change, write nothing
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const RETURNED_BY_STATE = 4;
const RETURNED_BY_SO = 16;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const gates = mongoose.connection.db!.collection('xvifc_action_gates');
  const filter = {
    module: 'XVI-FC',
    role: 'ULB',
    scope: 'document',
    statusIds: { $all: [RETURNED_BY_STATE], $ne: RETURNED_BY_SO },
  };

  const rows = await gates.find(filter).project({ action: 1, formId: 1, docKey: 1, statusIds: 1 }).toArray();
  console.log(`${rows.length} ULB gate row(s) missing ${RETURNED_BY_SO}`);
  for (const row of rows) {
    console.log(`  ${String(row._id)}  action=${row.action}  formId=${row.formId}  statusIds=${JSON.stringify(row.statusIds)}`);
  }

  if (dryRun) {
    console.log('Dry run — nothing written.');
  } else if (rows.length) {
    const result = await gates.updateMany(filter, { $addToSet: { statusIds: RETURNED_BY_SO } });
    console.log(`Updated ${result.modifiedCount} row(s).`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
