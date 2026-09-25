import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FormJsonConfig, FormJsonConfigDocument } from '../../schemas/form-json-config.schema';
import type { IExemptableFormJsonConfig, IFormJsonConfig } from './interfaces/form-json-config.interface';
import type { CreateFormJsonConfigDto } from './dto/create-form-json-config.dto';
import type { UpdateFormJsonConfigDto } from './dto/update-form-json-config.dto';
import { NamespacedCacheService } from 'src/core/services/redis/namespaced-cache.service';
import { getFormLabel } from './constants/form-labels.constants';

const CACHE_NAMESPACE = 'formJsonConfig';

/**
 * Backs xvi-fc Dynamic Year Access. Docs: ./CLAUDE.md (fields, formId registry, how to add a
 * new form) and module/xvi-fc/common/services/CLAUDE.md + its ADR (the mechanism, why).
 */
@Injectable()
export class FormJsonConfigService {
  constructor(
    @InjectModel(FormJsonConfig.name)
    private readonly model: Model<FormJsonConfigDocument>,
    private readonly cache: NamespacedCacheService,
  ) {}

  private getCacheKey(formId: number): string {
    return this.cache.buildKey(CACHE_NAMESPACE, formId);
  }

  /** Unique index on formId makes this a single-document lookup; Redis cached with no TTL, invalidated on write below. */
  async findByFormId(formId: number): Promise<IFormJsonConfig | null> {
    const key = this.getCacheKey(formId);
    const cached = await this.cache.get<IFormJsonConfig>(key);
    if (cached !== null) return cached;

    const doc = (await this.model
      .findOne({ formId, isActive: true })
      .lean()
      .exec()) as unknown as IFormJsonConfig | null;
    if (!doc) return null;

    await this.cache.set(key, doc);
    return doc;
  }

  /**
   * All exemptable formIds - the small, currently-known list an admin ticks from at ULB approval
   * or on the Edit ULB screen. This collection only grows when a new form type is deliberately
   * wired into the exemption mechanism, never on an annual cycle, so a full scan stays cheap.
   * Each row is enriched with a computed, non-persisted `label` (`getFormLabel`) so callers (e.g.
   * the ULB review dialog's exemption checklist) don't need their own formId -> label map.
   */
  async findAllExemptable(): Promise<IExemptableFormJsonConfig[]> {
    const configs = (await this.model
      .find({ isApplicableForExemption: true, isActive: true })
      .lean()
      .exec()) as unknown as IFormJsonConfig[];
    return configs.map((config) => ({ ...config, label: getFormLabel(config.formId) }));
  }

  findAll(): Promise<IFormJsonConfig[]> {
    return this.model.find().lean().exec() as unknown as Promise<IFormJsonConfig[]>;
  }

  async create(dto: CreateFormJsonConfigDto): Promise<IFormJsonConfig> {
    const created = await this.model.create({
      formId: dto.formId,
      isApplicableForExemption: dto.isApplicableForExemption ?? false,
      exemptionGraceYears: dto.exemptionGraceYears ?? 1,
      submissionScope: dto.submissionScope ?? 'PER_YEAR',
      isActive: dto.isActive ?? true,
    });
    const doc = created.toObject() as unknown as IFormJsonConfig;

    if (doc.isActive) await this.cache.set(this.getCacheKey(doc.formId), doc);
    return doc;
  }

  async update(id: string, dto: UpdateFormJsonConfigDto): Promise<IFormJsonConfig> {
    const patch: Record<string, unknown> = {};
    if (dto.isApplicableForExemption !== undefined) patch['isApplicableForExemption'] = dto.isApplicableForExemption;
    if (dto.exemptionGraceYears !== undefined) patch['exemptionGraceYears'] = dto.exemptionGraceYears;
    if (dto.submissionScope !== undefined) patch['submissionScope'] = dto.submissionScope;
    if (dto.isActive !== undefined) patch['isActive'] = dto.isActive;

    const updated = (await this.model
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean()
      .exec()) as unknown as IFormJsonConfig | null;
    if (!updated) throw new NotFoundException(`FormJsonConfig ${id} not found`);

    await this.cache.del(this.getCacheKey(updated.formId));
    return updated;
  }

  /** Soft delete - sets isActive false, drops the cache entry so findByFormId stops returning it. */
  async remove(id: string): Promise<void> {
    const existing = (await this.model
      .findByIdAndUpdate(id, { $set: { isActive: false } })
      .lean()
      .exec()) as unknown as IFormJsonConfig | null;
    if (!existing) throw new NotFoundException(`FormJsonConfig ${id} not found`);

    await this.cache.del(this.getCacheKey(existing.formId));
  }
}
