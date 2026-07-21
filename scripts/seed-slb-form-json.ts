/**
 * Seeds (or updates) the SLB FormJson document in the `formjsons` collection.
 * Run metadata (design_year, formId, type, isActive) comes from
 * scripts/seed-data/slb-form-json.json; the field data comes from DEFAULT_SLB_FIELDS,
 * the single source of truth for SLB field config, so the two can't drift apart.
 * Upserts on the {design_year, formId} unique index, so it's safe to re-run after
 * editing the seed file or DEFAULT_SLB_FIELDS.
 *
 * Usage:
 *   npm run seed:slb-form-json
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import mongoose, { Types } from 'mongoose';
import { DEFAULT_SLB_FIELDS } from 'src/module/xvi-fc/ulb/slb/constants/slb-form.constants';

const COLLECTION = 'formjsons';
const SEED_FILE = path.join(process.cwd(), 'scripts', 'seed-data', 'slb-form-json.json');

interface SlbFormJsonSeedMeta {
  design_year: string;
  formId: number;
  type: string;
  isActive: boolean;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  const meta: SlbFormJsonSeedMeta = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  if (!meta.design_year || meta.formId === undefined) {
    throw new Error('Seed file is missing design_year or formId');
  }
  const seed = { ...meta, data: DEFAULT_SLB_FIELDS };

  await mongoose.connect(uri);
  const collection = mongoose.connection.db!.collection(COLLECTION);

  const designYear = new Types.ObjectId(seed.design_year);
  const filter = { design_year: designYear, formId: seed.formId };

  const result = await collection.updateOne(
    filter,
    {
      $set: {
        type: seed.type,
        isActive: seed.isActive ?? true,
        data: seed.data,
        modifiedAt: new Date(),
      },
      $setOnInsert: {
        design_year: designYear,
        formId: seed.formId,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  if (result.upsertedId) {
    console.log(`Inserted new FormJson document (_id: ${result.upsertedId._id}) for formId ${seed.formId}.`);
  } else {
    console.log(`Updated existing FormJson document for formId ${seed.formId} (matched: ${result.matchedCount}).`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
