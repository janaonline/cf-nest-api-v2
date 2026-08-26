import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FormJson, FormJsonDocument } from '../../schemas/form-json.schema';
import type { IFormJson } from './interfaces/form-json.interface';
import type { CreateFormJsonDto } from './dto/create-form-json.dto';
import type { UpdateFormJsonDto } from './dto/update-form-json.dto';
import type { QueryFormJsonDto } from './dto/query-form-json.dto';
import { NamespacedCacheService } from 'src/core/services/redis/namespaced-cache.service';

const CACHE_NAMESPACE = 'formJson';

@Injectable()
export class FormJsonService {
  constructor(
    @InjectModel(FormJson.name)
    private readonly model: Model<FormJsonDocument>,
    private readonly cache: NamespacedCacheService,
  ) {}

  private getFormJsonCacheKey(designYearId: string, formId: number): string {
    return this.cache.buildKey(CACHE_NAMESPACE, designYearId, formId);
  }

  /** Same shape as getFormJsonCacheKey, but `*` for either part clearCache leaves unspecified. */
  private getFormJsonCachePattern(designYearId?: string, formId?: number): string {
    return this.cache.buildPattern(CACHE_NAMESPACE, designYearId, formId);
  }

  /** Fixed literal suffix instead of a formId, so this can never collide with a per-form cache key. */
  private getClaimEligibilitySourcesCacheKey(designYearId: string): string {
    return this.cache.buildKey(CACHE_NAMESPACE, designYearId, 'claimEligibilitySources');
  }

  /**
   * Fetches the active FormJson for a specific design year and formId.
   * Returns the cached value from Redis when available (No TTL).
   * Cache key format: `formJson:<env>:<designYearId>:<formId>`.
   */
  async findActiveByDesignYearAndFormId(designYearId: string, formId: number): Promise<IFormJson> {
    const key = this.getFormJsonCacheKey(designYearId, formId);
    const cached = await this.cache.get<IFormJson>(key);
    if (cached !== null) return cached;

    const doc = (await this.model
      .findOne({ design_year: new Types.ObjectId(designYearId), formId, isActive: true })
      .lean()
      .exec()) as unknown as IFormJson | null;
    if (!doc) throw new NotFoundException(`FormJson for year ${designYearId} and formId ${formId} not found`);

    await this.cache.set(key, doc);
    return doc;
  }

  /** Returns all documents matching the provided filters. O(n). */
  findAll(query: QueryFormJsonDto): Promise<IFormJson[]> {
    const filter: FilterQuery<FormJsonDocument> = {};
    if (query.type !== undefined) filter['type'] = query.type;
    if (query.design_year !== undefined) filter['design_year'] = new Types.ObjectId(query.design_year);
    if (query.isActive !== undefined) filter['isActive'] = query.isActive;
    return this.model.find(filter).lean().exec() as unknown as Promise<IFormJson[]>;
  }

  /**
   * Bulk lookup of every enabled claim-eligibility source for a design year (plan §2) — generic
   * and reusable by any future claim-participating form, not claim-letter-specific. Cached the
   * same way as `findActiveByDesignYearAndFormId` (Redis, no TTL, invalidated on write below) —
   * this is called twice concurrently, with identical arguments, from every eligibility-summary-
   * style read (`evaluateStateLevelGate` + `resolveUlbLevelEligibility` both call it), so caching
   * turns the second call into a Redis hit instead of a duplicate Mongo round trip.
   */
  async findEnabledClaimEligibilitySources(designYearId: string): Promise<IFormJson[]> {
    const key = this.getClaimEligibilitySourcesCacheKey(designYearId);
    const cached = await this.cache.get<IFormJson[]>(key);
    if (cached !== null) return cached;

    const result = (await this.model
      .find({
        design_year: new Types.ObjectId(designYearId),
        isActive: true,
        'claimEligibility.enabled': true,
      })
      .lean()
      .exec()) as unknown as IFormJson[];
    await this.cache.set(key, result);
    return result;
  }

  /** Fetches one document by _id; throws 404 when absent. O(1). */
  async findById(id: string): Promise<IFormJson> {
    const doc = (await this.model.findById(id).lean().exec()) as unknown as IFormJson | null;
    if (!doc) throw new NotFoundException(`FormJson ${id} not found`);
    return doc;
  }

  /** Fetches the active document matching type; hits the {type, isActive} compound index. O(1). */
  async findByType(type: string): Promise<IFormJson> {
    const doc = (await this.model.findOne({ type, isActive: true }).lean().exec()) as unknown as IFormJson | null;
    if (!doc) throw new NotFoundException(`FormJson of type "${type}" not found`);
    return doc;
  }

  /**
   * Creates a new FormJson; unique (design_year + formId) enforcement is delegated to MongoDB.
   * Populates the Redis cache for the new document when formId is present and isActive is true.
   */
  async create(dto: CreateFormJsonDto): Promise<IFormJson> {
    const created = await this.model.create({
      design_year: new Types.ObjectId(dto.design_year),
      formId: dto.formId,
      type: dto.type,
      data: dto.data ?? [],
      meta: dto.meta,
      claimEligibility: dto.claimEligibility,
      isActive: dto.isActive ?? true,
    });
    const doc = created.toObject() as unknown as IFormJson;

    if (doc.formId !== undefined && doc.isActive) {
      const key = this.getFormJsonCacheKey(String(doc.design_year), doc.formId);
      await this.cache.set(key, doc);
    }

    // A new document can add itself to (or, if claimEligibility.enabled, change) that design
    // year's enabled-sources list — the cached list from `findEnabledClaimEligibilitySources` is
    // now stale and must be dropped so the next read repopulates it.
    await this.cache.del(this.getClaimEligibilitySourcesCacheKey(String(doc.design_year)));

    return doc;
  }

  /**
   * Applies a sparse $set update; only provided fields are written. Throws 404 when absent.
   * Fetches the existing document first to compute the old cache key, then deletes both the
   * old and new cache keys after the update (design_year or formId may have changed).
   */
  async update(id: string, dto: UpdateFormJsonDto): Promise<IFormJson> {
    const existing = (await this.model.findById(id).lean().exec()) as unknown as IFormJson | null;

    const patch: Record<string, unknown> = {};
    if (dto.design_year !== undefined) patch['design_year'] = new Types.ObjectId(dto.design_year);
    if (dto.formId !== undefined) patch['formId'] = dto.formId;
    if (dto.type !== undefined) patch['type'] = dto.type;
    if (dto.data !== undefined) patch['data'] = dto.data;
    if (dto.meta !== undefined) patch['meta'] = dto.meta;
    if (dto.claimEligibility !== undefined) patch['claimEligibility'] = dto.claimEligibility;
    if (dto.isActive !== undefined) patch['isActive'] = dto.isActive;

    const updated = (await this.model
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean()
      .exec()) as unknown as IFormJson | null;
    if (!updated) throw new NotFoundException(`FormJson ${id} not found`);

    if (existing?.formId !== undefined) {
      await this.cache.del(this.getFormJsonCacheKey(String(existing.design_year), existing.formId));
    }
    if (updated.formId !== undefined) {
      const newKey = this.getFormJsonCacheKey(String(updated.design_year), updated.formId);
      const oldKey =
        existing?.formId !== undefined ? this.getFormJsonCacheKey(String(existing.design_year), existing.formId) : null;
      if (newKey !== oldKey) {
        await this.cache.del(newKey);
      }
    }

    // `claimEligibility`, `isActive`, or `design_year` may have changed — any of those can change
    // whether this document belongs in either design year's enabled-sources list, so both the old
    // and new year's cached list (if different) must be dropped.
    await this.cache.del(this.getClaimEligibilitySourcesCacheKey(String(updated.design_year)));
    if (existing && String(existing.design_year) !== String(updated.design_year)) {
      await this.cache.del(this.getClaimEligibilitySourcesCacheKey(String(existing.design_year)));
    }

    return updated;
  }

  /**
   * Deletes FormJson cache entries matching designYearId and/or formId — omit either to clear
   * more broadly (e.g. every form for a year, or one form across every year). Pattern-based
   * (not an exact single-key delete) so it still works when a caller under- or over-specifies;
   * returns the number of keys actually deleted so a caller can tell a real clear from a no-op.
   */
  async clearCache(designYearId?: string, formId?: number): Promise<number> {
    return this.cache.delByPattern(this.getFormJsonCachePattern(designYearId, formId));
  }

  /**
   * Sets isActive=false without deleting the document. Throws 404 when absent.
   * Returns the pre-update document from MongoDB (no extra query) to derive the cache key
   * and delete it immediately after the soft-delete.
   */
  async remove(id: string): Promise<void> {
    const existing = (await this.model
      .findByIdAndUpdate(id, { $set: { isActive: false } })
      .lean()
      .exec()) as unknown as IFormJson | null;
    if (!existing) throw new NotFoundException(`FormJson ${id} not found`);

    if (existing.formId !== undefined) {
      await this.cache.del(this.getFormJsonCacheKey(String(existing.design_year), existing.formId));
    }

    // Soft-deleting (isActive:false) removes this document from its design year's enabled-sources
    // list — drop the cached list so the next read reflects that.
    await this.cache.del(this.getClaimEligibilitySourcesCacheKey(String(existing.design_year)));
  }
}
