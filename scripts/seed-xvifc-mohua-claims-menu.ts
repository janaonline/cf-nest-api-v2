/**
 * Adds a "Grant Management" group to the MoHUA sidebar, right after Profile, with a "Claims & Submissions"
 * item under it, for every year that has a MoHUA XVI-FC menu (the sidebar lives in the `sidemenus`
 * collection, one row set per year).
 *
 * - Items after Profile are moved down one place to make room for the group.
 * - Idempotent: a year that already has the item (featureKey `claims-submission`) is skipped.
 * - The side menu is cached with no TTL — after applying, run DELETE xvi-fc/admin/cache/side-menu.
 * - Run it only once the UI with the `claims-submission` route is deployed.
 *
 * Usage:
 *   npm run seed:xvifc-mohua-claims-menu                       # apply to every MoHUA menu year
 *   npm run seed:xvifc-mohua-claims-menu -- --dry-run          # report only
 *   npm run seed:xvifc-mohua-claims-menu -- --year <yearId>    # one year only
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const COLLECTION = 'sidemenus';
const MODULE = 'XVI-FC';
const ROLE = 'MOHUA';
const FEATURE_KEY = 'claims-submission';
const GROUP_NAME = 'Grant Management';
const AFTER_GROUP_NAME = 'Profile';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  const dryRun = process.argv.includes('--dry-run');
  const yearFlag = process.argv.includes('--year');
  const yearArg = yearFlag ? process.argv[process.argv.indexOf('--year') + 1] : undefined;
  // A bare `--year` must fail, not silently write to every year.
  if (yearFlag && !mongoose.isValidObjectId(yearArg)) throw new Error(`--year "${yearArg ?? ''}" is not a valid id`);

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const menu = mongoose.connection.db!.collection(COLLECTION);

  const scope = { module: MODULE, role: ROLE };
  const years = (await menu.distinct('year', scope)).filter(
    (year) => !yearArg || String(year) === yearArg,
  ) as mongoose.Types.ObjectId[];
  console.log(`${years.length} MoHUA menu year(s)${yearArg ? ` (limited to ${yearArg})` : ''}`);

  let added = 0;
  for (const year of years) {
    if (await menu.countDocuments({ ...scope, year, featureKey: FEATURE_KEY })) {
      console.log(`  ${String(year)}: already has the item — skipped`);
      continue;
    }

    const topLevel = { ...scope, year, section: 'top', parentId: null };
    const existingGroup = await menu.findOne({ ...topLevel, type: 'group', name: GROUP_NAME });
    const after = await menu.findOne(
      { ...topLevel, type: 'group', name: AFTER_GROUP_NAME },
      { projection: { sequence: 1 } },
    );
    const last = await menu.find(topLevel).sort({ sequence: -1 }).limit(1).next();
    const sequence = after ? Number(after.sequence) + 1 : Number(last?.sequence ?? 0) + 1;
    const toShift = existingGroup ? 0 : await menu.countDocuments({ ...topLevel, sequence: { $gte: sequence } });
    console.log(
      existingGroup
        ? `  ${String(year)}: add the item under the existing "${GROUP_NAME}" group`
        : `  ${String(year)}: add the "${GROUP_NAME}" group at position ${sequence}, moving ${toShift} item(s) down`,
    );

    if (dryRun) continue;

    const now = new Date();
    let groupId = existingGroup?._id;
    if (!existingGroup) {
      await menu.updateMany({ ...topLevel, sequence: { $gte: sequence } }, { $inc: { sequence: 1 } });
      groupId = (
        await menu.insertOne({
          ...scope,
          year,
          name: GROUP_NAME,
          icon: 'bi bi-cash-coin',
          section: 'top',
          type: 'group',
          parentId: null,
          featureKey: null,
          routerLink: null,
          isActive: true,
          sequence,
          createdAt: now,
          modifiedAt: now,
        })
      ).insertedId;
    }

    const siblings = await menu.countDocuments({ ...scope, year, parentId: groupId });
    await menu.insertOne({
      ...scope,
      year,
      name: 'Claims & Submissions',
      icon: 'bi bi-file-earmark-text',
      section: 'top',
      type: 'item',
      parentId: groupId,
      featureKey: FEATURE_KEY,
      routerLink: null,
      isActive: true,
      sequence: siblings + 1,
      createdAt: now,
      modifiedAt: now,
    });
    added++;
  }

  console.log(
    dryRun ? 'Dry run — nothing written.' : `Added to ${added} year(s). Now run DELETE xvi-fc/admin/cache/side-menu.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
