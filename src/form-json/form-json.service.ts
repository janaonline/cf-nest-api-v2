import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FormJson, FormJsonDocument } from './schemas/form-json.schema';
import type { IFormJson } from './interfaces/form-json.interface';
import type { CreateFormJsonDto } from './dto/create-form-json.dto';
import type { UpdateFormJsonDto } from './dto/update-form-json.dto';
import type { QueryFormJsonDto } from './dto/query-form-json.dto';
import { RedisService } from 'src/core/services/redis/redis.service';

@Injectable()
export class FormJsonService {
  /** Namespaces cache keys per environment; dev and stg share the same Redis instance. */
  private readonly env: string;

  constructor(
    @InjectModel(FormJson.name)
    private readonly model: Model<FormJsonDocument>,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.env = this.config.get<string>('NODE_ENV') ?? 'production';
  }

  private getFormJsonCacheKey(designYearId: string, formId: number): string {
    return `formJson:${this.env}:${designYearId}:${formId}`;
  }

  /**
   * Fetches the active FormJson for a specific design year and formId.
   * Returns the cached value from Redis when available (No TTL).
   * Cache key format: `formJson:<env>:<designYearId>:<formId>`.
   */
  async findActiveByDesignYearAndFormId(designYearId: string, formId: number): Promise<IFormJson> {
    const key = this.getFormJsonCacheKey(designYearId, formId);
    const cached = await this.redis.get(key);
    if (cached !== null) return JSON.parse(cached) as IFormJson;

    const doc = (await this.model
      .findOne({ design_year: new Types.ObjectId(designYearId), formId, isActive: true })
      .lean()
      .exec()) as unknown as IFormJson | null;
    if (!doc) throw new NotFoundException(`FormJson for year ${designYearId} and formId ${formId} not found`);

    await this.redis.set(key, JSON.stringify(doc));
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
   * and reusable by any future claim-participating form, not claim-letter-specific. Small
   * multi-document query (today: length 1, Devolution's entry), so unlike
   * `findActiveByDesignYearAndFormId` this deliberately skips the Redis single-doc cache path.
   */
  findEnabledClaimEligibilitySources(designYearId: string): Promise<IFormJson[]> {
    // TODO: Add to cache.
    return this.model
      .find({
        design_year: new Types.ObjectId(designYearId),
        isActive: true,
        'claimEligibility.enabled': true,
      })
      .lean()
      .exec() as unknown as Promise<IFormJson[]>;
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
      await this.redis.set(key, JSON.stringify(doc));
    }

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
      await this.redis.del(this.getFormJsonCacheKey(String(existing.design_year), existing.formId));
    }
    if (updated.formId !== undefined) {
      const newKey = this.getFormJsonCacheKey(String(updated.design_year), updated.formId);
      const oldKey =
        existing?.formId !== undefined ? this.getFormJsonCacheKey(String(existing.design_year), existing.formId) : null;
      if (newKey !== oldKey) {
        await this.redis.del(newKey);
      }
    }

    return updated;
  }

  /**
   * Deletes the Redis cache entry for a specific formJson by designYearId + formId.
   * Useful for admin cache-clear endpoints.
   */
  async clearCache(designYearId: string, formId: number): Promise<void> {
    await this.redis.del(this.getFormJsonCacheKey(designYearId, formId));
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
      await this.redis.del(this.getFormJsonCacheKey(String(existing.design_year), existing.formId));
    }
  }
}
