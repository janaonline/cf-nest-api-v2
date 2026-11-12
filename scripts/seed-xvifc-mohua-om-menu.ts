/**
 * Adds an "OM Generation" group to the MoHUA sidebar, right after "Grant Management", with "Generate OM" and
 * "OM Generation History" under it, for every year that has a MoHUA XVI-FC menu (`sidemenus`, one row set per year).
 *
 * - Items after Grant Management (or after Profile, when a year has no Grant Management group) move down one place.
 * - Idempotent: an item a year already has (by featureKey) is skipped; the group is reused when it exists.
 * - The side menu is cached with no TTL — after applying, run DELETE xvi-fc/admin/cache/side-menu.
 * - Run it only once the UI with the `om-generation` and `om-history` routes is deployed.
 *
 * Usage:
 *   npm run seed:xvifc-mohua-om-menu                       # apply to every MoHUA menu year
 *   npm run seed:xvifc-mohua-om-menu -- --dry-run          # report only
 *   npm run seed:xvifc-mohua-om-menu -- --year <yearId>    # one year only
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const COLLECTION = 'sidemenus';
const MODULE = 'XVI-FC';
const ROLE = 'MOHUA';
const GROUP_NAME = 'OM Generation';
const AFTER_GROUP_NAMES = ['Grant Management', 'Profile'];
const ITEMS = [
  { featureKey: 'om-generation', name: 'Generate OM', icon: 'bi bi-file-earmark-plus' },
  { featureKey: 'om-history', name: 'OM Generation History', icon: 'bi bi-clock-history' },
];

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
    const missing: (typeof ITEMS)[number][] = [];
    for (const item of ITEMS) {
      if (!(await menu.countDocuments({ ...scope, year, featureKey: item.featureKey }))) missing.push(item);
    }
    if (!missing.length) {
      console.log(`  ${String(year)}: already has the OM items — skipped`);
      continue;
    }

    const topLevel = { ...scope, year, section: 'top', parentId: null };
    const existingGroup = await menu.findOne({ ...topLevel, type: 'group', name: GROUP_NAME });
    let after: mongoose.mongo.WithId<mongoose.mongo.BSON.Document> | null = null;
    for (const name of AFTER_GROUP_NAMES) {
      after = await menu.findOne({ ...topLevel, type: 'group', name }, { projection: { sequence: 1 } });
      if (after) break;
    }
    const last = await menu.find(topLevel).sort({ sequence: -1 }).limit(1).next();
    const sequence = after ? Number(after.sequence) + 1 : Number(last?.sequence ?? 0) + 1;
    const toShift = existingGroup ? 0 : await menu.countDocuments({ ...topLevel, sequence: { $gte: sequence } });
    console.log(
      existingGroup
        ? `  ${String(year)}: add ${missing.map((i) => i.name).join(', ')} under the existing "${GROUP_NAME}" group`
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
          icon: 'bi bi-file-earmark-ruled',
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

    let siblings = await menu.countDocuments({ ...scope, year, parentId: groupId });
    for (const item of missing) {
      await menu.insertOne({
        ...scope,
        year,
        name: item.name,
        icon: item.icon,
        section: 'top',
        type: 'item',
        parentId: groupId,
        featureKey: item.featureKey,
        routerLink: null,
        isActive: true,
        sequence: ++siblings,
        createdAt: now,
        modifiedAt: now,
      });
    }
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
