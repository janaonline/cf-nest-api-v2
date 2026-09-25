import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UlbType, UlbTypeDocument } from 'src/schemas/ulb-type.schema';

/**
 * Central place to decide whether a ULB may participate in a given grant cycle (e.g. `'XVIFC'`).
 * Every method takes `grantCycle` as a parameter rather than hardcoding one — this is the first
 * caller (Cantonment Board / XVI FC), but a future grant cycle with its own exclusions reuses these
 * same methods with its own cycle code; nothing here needs to change.
 *
 * Deliberately does NOT cache anything ULB-specific (`ulb.isActive`/`ulb.ulbType` are always read
 * fresh per call) — only the tiny, near-static "which UlbType ids are excluded from this cycle"
 * lookup is cached, so correctness can't drift on stale ULB data.
 *
 * Cached in Redis (not the in-memory `CACHE_MANAGER`), purely event-driven — no TTL is ever set, the
 * key lives until `invalidate()` explicitly deletes it (called from `admin/ulb-types`'s CRUD on every
 * create/update/remove). Redis is a single store shared by every app instance, so one instance's
 * `invalidate()` is instantly visible to every other instance's next read — an in-memory,
 * per-process cache (`CACHE_MANAGER`'s default store) can't do that: only the instance that served the
 * admin's CRUD request would ever see the change, and every other replica would go stale forever with
 * no TTL left to self-heal it.
 */
@Injectable()
export class UlbEligibilityService {
  constructor(
    @InjectModel(UlbType.name) private readonly ulbTypeModel: Model<UlbTypeDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    private readonly redisService: RedisService,
  ) {}

  private cacheKey(grantCycle: string): string {
    return `ulb-eligibility:ineligible-ulb-type-ids:${grantCycle}`;
  }

  /** Cached set of `UlbType._id`s excluded from `grantCycle`. */
  async getIneligibleUlbTypeIds(grantCycle: string): Promise<Types.ObjectId[]> {
    const key = this.cacheKey(grantCycle);
    const cached = await this.redisService.get(key);
    if (cached) return (JSON.parse(cached) as string[]).map((id) => new Types.ObjectId(id));

    const docs = await this.ulbTypeModel.find({ ineligibleForGrantCycles: grantCycle }).select('_id').lean().exec();
    const ids = docs.map((d) => d._id);
    // No ttl passed — RedisService.set() then issues a plain SET with no expiry, so this key lives
    // until invalidate() explicitly deletes it.
    await this.redisService.set(key, ids.map(String));
    return ids;
  }

  /** Use when the ULB doc is already loaded — avoids a second DB round trip. */
  async isUlbEligibleForGrantCycle(ulb: Pick<Ulb, 'isActive' | 'ulbType'>, grantCycle: string): Promise<boolean> {
    if (!ulb.isActive) return false;
    const ineligibleIds = await this.getIneligibleUlbTypeIds(grantCycle);
    return !ineligibleIds.some((id) => id.equals(ulb.ulbType));
  }

  /** Use when only a ULB id is on hand (e.g. write-path guards). Throws before any caller can mutate. */
  async assertUlbEligibleForGrantCycle(
    ulbId: string | Types.ObjectId,
    grantCycle: string,
    message?: string,
  ): Promise<void> {
    const ulb = await this.ulbModel.findById(ulbId).select('isActive ulbType').lean().exec();
    if (!ulb || !(await this.isUlbEligibleForGrantCycle(ulb, grantCycle))) {
      throw new ForbiddenException(message ?? `This ULB is not eligible for ${grantCycle}.`);
    }
  }

  /** Mongo filter for "ULBs in `stateId` eligible for `grantCycle`" — for list/template/count queries. */
  async getEligibleUlbFilter(stateId: string | Types.ObjectId, grantCycle: string): Promise<FilterQuery<UlbDocument>> {
    const ineligibleIds = await this.getIneligibleUlbTypeIds(grantCycle);
    return {
      state: new Types.ObjectId(stateId),
      isActive: true,
      ...(ineligibleIds.length ? { ulbType: { $nin: ineligibleIds } } : {}),
    };
  }

  /** Drop the cached ineligible-type-id set for a cycle. Called by `admin/ulb-types`'s CRUD on every
   *  create/update/remove that touches `ineligibleForGrantCycles` — the only way this cache ever
   *  clears, since no TTL is set. */
  async invalidate(grantCycle: string): Promise<void> {
    await this.redisService.del(this.cacheKey(grantCycle));
  }
}
