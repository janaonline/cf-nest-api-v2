/**
 * One-off config change for the SO review stage: lets a form count toward a claim letter at its new
 * "ready" status, by editing `formjsons.claimEligibility` for the matching forms.
 *
 * - State forms SFC (22), Elected Body (23), Devolution (24), FC Unspent (25), GTC (35):
 *   `acceptedFormStatuses` -> [15, 5, 7] (PMU approval now lands on 15, UNDER_REVIEW_BY_SO).
 * - Elected Body (23) and FC Unspent (25): also add 15 to
 *   `evaluator.config.rowAcceptedFormStatuses` (rows PMU approved sit at 15 too). Existing values stay.
 * - SLB (32): `acceptedFormStatuses` -> [8, 5, 7]. It was [3], which a submitted SLB (8) never matches.
 *
 * Afterwards clears the FormJson Redis cache (no TTL, so a stale copy would be served forever): every
 * `formJson:<NODE_ENV>:*` key, including each year's `claimEligibilitySources` list. Skip that with
 * `--no-cache-clear` and call DELETE xvi-fc/admin/cache instead.
 *
 * Only active documents are touched. Re-runnable: a document that already matches is left alone and
 * reported as unchanged. A formId with no active document is reported, never created.
 *
 * Usage:
 *   npm run migrate:xvifc-so-claim-statuses                    # apply + clear cache
 *   npm run migrate:xvifc-so-claim-statuses -- --dry-run       # report only, writes nothing
 *   npm run migrate:xvifc-so-claim-statuses -- --no-cache-clear
 */
import 'dotenv/config';
import Redis from 'ioredis';
import mongoose from 'mongoose';

const FORMJSON_COLLECTION = 'formjsons';
const CACHE_NAMESPACE = 'formJson';

const UNDER_REVIEW_BY_SO = 15;

interface FormChange {
  formId: number;
  label: string;
  /** Exact list `claimEligibility.acceptedFormStatuses` must end up with. */
  acceptedFormStatuses: number[];
  /** Statuses added (never removed) to `claimEligibility.evaluator.config.rowAcceptedFormStatuses`. */
  rowStatusesToAdd?: number[];
}

const CHANGES: FormChange[] = [
  { formId: 22, label: 'SFC Status', acceptedFormStatuses: [15, 5, 7] },
  { formId: 23, label: 'Elected Body', acceptedFormStatuses: [15, 5, 7], rowStatusesToAdd: [UNDER_REVIEW_BY_SO] },
  { formId: 24, label: 'Devolution Formula', acceptedFormStatuses: [15, 5, 7] },
  { formId: 25, label: 'FC Unspent', acceptedFormStatuses: [15, 5, 7], rowStatusesToAdd: [UNDER_REVIEW_BY_SO] },
  { formId: 35, label: 'GTC', acceptedFormStatuses: [15, 5, 7] },
  { formId: 32, label: 'SLB', acceptedFormStatuses: [8, 5, 7] },
];

interface FormJsonDoc {
  _id: mongoose.Types.ObjectId;
  design_year?: mongoose.Types.ObjectId;
  claimEligibility?: {
    acceptedFormStatuses?: number[];
    evaluator?: { config?: { rowAcceptedFormStatuses?: number[] } };
  };
}

const sameSet = (a: number[] | undefined, b: number[]): boolean =>
  !!a && a.length === b.length && b.every((v) => a.includes(v));

async function applyChanges(dryRun: boolean): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const forms = mongoose.connection.db!.collection<FormJsonDoc>(FORMJSON_COLLECTION);

  let changed = 0;
  for (const change of CHANGES) {
    const docs = await forms
      .find({ formId: change.formId, isActive: true, 'claimEligibility.enabled': true })
      .project<FormJsonDoc>({ design_year: 1, claimEligibility: 1 })
      .toArray();
    if (docs.length === 0) {
      console.log(`formId ${change.formId} (${change.label}): no active document with claimEligibility — skipped`);
      continue;
    }

    for (const doc of docs) {
      const ce = doc.claimEligibility;
      const set: Record<string, unknown> = {};
      const notes: string[] = [];

      if (!sameSet(ce?.acceptedFormStatuses, change.acceptedFormStatuses)) {
        set['claimEligibility.acceptedFormStatuses'] = change.acceptedFormStatuses;
        notes.push(
          `acceptedFormStatuses [${(ce?.acceptedFormStatuses ?? []).join(',')}] -> [${change.acceptedFormStatuses.join(',')}]`,
        );
      }

      if (change.rowStatusesToAdd) {
        const current = ce?.evaluator?.config?.rowAcceptedFormStatuses;
        if (!current) {
          // Without rowFormStatusField/rowAcceptedFormStatuses there is no row status check to widen.
          console.log(
            `formId ${change.formId} (${change.label}) ${String(doc._id)}: no rowAcceptedFormStatuses configured — row list left alone`,
          );
        } else {
          const merged = [...new Set([...current, ...change.rowStatusesToAdd])];
          if (merged.length !== current.length) {
            set['claimEligibility.evaluator.config.rowAcceptedFormStatuses'] = merged;
            notes.push(`rowAcceptedFormStatuses [${current.join(',')}] -> [${merged.join(',')}]`);
          }
        }
      }

      if (notes.length === 0) {
        console.log(`formId ${change.formId} (${change.label}) ${String(doc._id)}: already up to date`);
        continue;
      }
      console.log(`formId ${change.formId} (${change.label}) ${String(doc._id)}: ${notes.join('; ')}`);
      if (!dryRun) await forms.updateOne({ _id: doc._id }, { $set: set });
      changed += 1;
    }
  }

  console.log(dryRun ? `Dry run — ${changed} document(s) would change.` : `Updated ${changed} document(s).`);
  await mongoose.disconnect();
}

async function clearFormJsonCache(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn(
      'REDIS_URL is not set — cache NOT cleared. Call DELETE xvi-fc/admin/cache before relying on the change.',
    );
    return;
  }
  const pattern = `${CACHE_NAMESPACE}:${process.env.NODE_ENV ?? 'production'}:*`;
  const redis = new Redis(redisUrl);
  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== '0');
    console.log(`Cleared ${deleted} FormJson cache key(s) matching ${pattern}.`);
  } finally {
    redis.disconnect();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipCache = process.argv.includes('--no-cache-clear');

  await applyChanges(dryRun);
  if (dryRun) return;
  if (skipCache) {
    console.log('Cache not cleared (--no-cache-clear): call DELETE xvi-fc/admin/cache.');
    return;
  }
  await clearFormJsonCache();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
