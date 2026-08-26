import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SideMenu, SideMenuDocument, MenuRole } from '../../../schemas/side-menu.schema';
import { NamespacedCacheService } from '../../../core/services/redis/namespaced-cache.service';
import { SideMenuItemDto, SideMenuResponseDto } from '../dto/side-menu.dto';
import { CreateSideMenuDto } from './dto/create-side-menu.dto';
import { UpdateSideMenuDto } from './dto/update-side-menu.dto';
import { QuerySideMenuDto } from './dto/query-side-menu.dto';

const MODULE = 'XVI-FC';
const CACHE_NAMESPACE = 'sidemenu';

export interface SideMenuAdminItem {
  _id: Types.ObjectId;
  role: string;
  year: Types.ObjectId;
  section: string;
  sequence: number;
  type: string;
  label: string;
  icon?: string | null;
  featureKey?: string | null;
  routerLink?: string[] | null;
  parentId?: Types.ObjectId | null;
  isActive: boolean;
  url?: string | null;
  target?: '_blank' | '_self' | null;
}

@Injectable()
export class SideMenuService {
  constructor(
    @InjectModel(SideMenu.name)
    private readonly sideMenuModel: Model<SideMenuDocument>,
    private readonly cache: NamespacedCacheService,
  ) {}

  private getSideMenuCacheKey(role: string, yearId: string): string {
    return this.cache.buildKey(CACHE_NAMESPACE, role, yearId);
  }

  /** Same shape as getSideMenuCacheKey, but `*` for either part clearCache leaves unspecified. */
  private getSideMenuCachePattern(role?: string, yearId?: string): string {
    return this.cache.buildPattern(CACHE_NAMESPACE, role, yearId);
  }

  /**
   * Fetches the sidebar menu for a role+year, tree-shaped into top/bottom sections.
   * Returns the cached value from Redis when available (No TTL) — same scheme as
   * FormJsonService.findActiveByDesignYearAndFormId: a key built from domain values (not the
   * request URL), read/write/invalidate all in this one file, so they can never drift apart.
   * Cache key format: `sidemenu:<env>:<role>:<yearId>`.
   */
  async getSideMenu(role: MenuRole, yearId: string): Promise<SideMenuResponseDto> {
    if (!yearId) throw new NotFoundException('yearId is required');

    const key = this.getSideMenuCacheKey(role, yearId);
    const cached = await this.cache.get<SideMenuResponseDto>(key);
    if (cached !== null) return cached;

    const docs = await this.sideMenuModel
      .find({ module: MODULE, role, year: new Types.ObjectId(yearId), isActive: true })
      .sort({ sequence: 1 })
      .lean()
      .exec();

    if (!docs.length) throw new NotFoundException(`No menu configured for role ${role}`);

    const result = this.buildMenuTree(docs);
    await this.cache.set(key, result);
    return result;
  }

  /**
   * Deletes side-menu cache entries matching role and/or yearId — omit either to clear more
   * broadly. Pattern-based so it still works when a caller under- or over-specifies; returns the
   * number of keys actually deleted so a caller can tell a real clear from a no-op.
   */
  async clearCache(role?: string, yearId?: string): Promise<number> {
    return this.cache.delByPattern(this.getSideMenuCachePattern(role, yearId));
  }

  private buildMenuTree(docs: Array<SideMenu & { _id: Types.ObjectId }>): SideMenuResponseDto {
    return {
      topModel: this.buildSection(docs, 'top'),
      bottomModel: this.buildSection(docs, 'bottom'),
    };
  }

  private buildSection(
    docs: Array<SideMenu & { _id: Types.ObjectId }>,
    section: 'top' | 'bottom',
  ): SideMenuItemDto[] {
    const sectionDocs = docs.filter((d) => d.section === section);
    const topLevel = sectionDocs.filter((d) => !d.parentId).sort((a, b) => a.sequence! - b.sequence!);
    const children = sectionDocs.filter((d) => d.parentId);

    return topLevel.map((doc) => {
      if (doc.type === 'separator') {
        return { label: '_', separator: true };
      }

      const item: SideMenuItemDto = { label: doc.name };
      if (doc.icon) item.icon = doc.icon;
      if (doc.routerLink?.length) item.routerLink = doc.routerLink;
      if (doc.featureKey) item.featureKey = doc.featureKey;
      if (doc.url) {
        item.url = doc.url;
        if (doc.target) item.target = doc.target;
      }

      if (doc.type === 'group') {
        item.items = children
          .filter((c) => c.parentId!.toString() === doc._id.toString())
          .sort((a, b) => a.sequence! - b.sequence!)
          .map((c) => {
            const child: SideMenuItemDto = { label: c.name };
            if (c.icon) child.icon = c.icon;
            if (c.featureKey) child.featureKey = c.featureKey;
            if (c.url) {
              child.url = c.url;
              if (c.target) child.target = c.target;
            }
            return child;
          });
      }

      return item;
    });
  }

  // The admin API keeps `label` as the field name for backwards compatibility;
  // internally it's stored as `name` since it's shared with the legacy Sidemenu collection.
  // Legacy 15th-FC-only fields (code, category, ...) are intentionally left out of the response.
  // `url`/`target` are the one exception — XVI-FC items now use them for external links (e.g.
  // Submit Feedback), so the admin API needs to surface and accept them like any other field.
  private toAdminItem(doc: SideMenu & { _id: Types.ObjectId }): SideMenuAdminItem {
    return {
      _id: doc._id,
      role: doc.role,
      year: doc.year,
      section: doc.section!,
      sequence: doc.sequence!,
      type: doc.type!,
      label: doc.name,
      icon: doc.icon,
      featureKey: doc.featureKey,
      routerLink: doc.routerLink,
      parentId: doc.parentId,
      isActive: doc.isActive,
      url: doc.url,
      target: doc.target,
    };
  }

  async findAll(query: QuerySideMenuDto): Promise<SideMenuAdminItem[]> {
    const filter: Record<string, any> = { module: MODULE };

    if (query.role) filter.role = query.role;
    if (query.yearId) filter.year = new Types.ObjectId(query.yearId);
    if (!query.includeInactive) filter.isActive = true;

    const docs = await this.sideMenuModel.find(filter).sort({ role: 1, sequence: 1 }).lean().exec();
    return docs.map((d) => this.toAdminItem(d));
  }

  async findOne(id: string): Promise<SideMenuAdminItem> {
    const doc = await this.sideMenuModel.findOne({ _id: id, module: MODULE }).lean().exec();
    if (!doc) throw new NotFoundException(`Menu item ${id} not found`);
    return this.toAdminItem(doc);
  }

  async create(dto: CreateSideMenuDto): Promise<SideMenuAdminItem> {
    const doc = await this.sideMenuModel.create({
      name: dto.label,
      role: dto.role,
      year: new Types.ObjectId(dto.year),
      section: dto.section,
      sequence: dto.sequence,
      type: dto.type,
      icon: dto.icon,
      featureKey: dto.featureKey,
      routerLink: dto.routerLink,
      module: MODULE,
      parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : null,
      isActive: dto.isActive ?? true,
      url: dto.url,
      target: dto.target,
    });
    await this.invalidateCache(dto.role, dto.year);
    return this.toAdminItem(doc.toObject());
  }

  async bulkCreate(items: CreateSideMenuDto[]): Promise<SideMenuAdminItem[]> {
    const docs = items.map((item) => ({
      name: item.label,
      role: item.role,
      year: new Types.ObjectId(item.year),
      section: item.section,
      sequence: item.sequence,
      type: item.type,
      icon: item.icon,
      featureKey: item.featureKey,
      routerLink: item.routerLink,
      module: MODULE,
      parentId: item.parentId ? new Types.ObjectId(item.parentId) : null,
      isActive: item.isActive ?? true,
      url: item.url,
      target: item.target,
    }));

    const inserted = await this.sideMenuModel.insertMany(docs);

    const seen = new Set<string>();
    for (const item of items) {
      const key = `${item.role}:${item.year}`;
      if (!seen.has(key)) {
        seen.add(key);
        await this.invalidateCache(item.role, item.year);
      }
    }

    return inserted.map((d) => this.toAdminItem(d.toObject()));
  }

  async update(id: string, dto: UpdateSideMenuDto): Promise<SideMenuAdminItem> {
    const existing = await this.sideMenuModel.findOne({ _id: id, module: MODULE }).lean().exec();
    if (!existing) throw new NotFoundException(`Menu item ${id} not found`);

    const { label, parentId, year, ...restDto } = dto;

    const updated = await this.sideMenuModel
      .findByIdAndUpdate(
        id,
        {
          ...restDto,
          ...(label !== undefined && { name: label }),
          ...(year && { year: new Types.ObjectId(year) }),
          ...(parentId !== undefined && { parentId: parentId ? new Types.ObjectId(parentId) : null }),
        },
        { new: true },
      )
      .lean()
      .exec();

    // Invalidate for both old and new role/year in case they changed
    await this.invalidateCache(existing.role, existing.year.toString());
    if (dto.role || dto.year) {
      await this.invalidateCache(dto.role ?? existing.role, dto.year ?? existing.year.toString());
    }

    return this.toAdminItem(updated!);
  }

  async toggleActive(id: string): Promise<SideMenuAdminItem> {
    const doc = await this.sideMenuModel.findOne({ _id: id, module: MODULE }).lean().exec();
    if (!doc) throw new NotFoundException(`Menu item ${id} not found`);

    const updated = await this.sideMenuModel
      .findByIdAndUpdate(id, { isActive: !doc.isActive }, { new: true })
      .lean()
      .exec();

    await this.invalidateCache(doc.role, doc.year.toString());
    return this.toAdminItem(updated!);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const doc = await this.sideMenuModel.findOne({ _id: id, module: MODULE }).lean().exec();
    if (!doc) throw new NotFoundException(`Menu item ${id} not found`);

    await this.sideMenuModel.findByIdAndDelete(id).exec();
    await this.invalidateCache(doc.role, doc.year.toString());
    return { deleted: true };
  }

  private async invalidateCache(role: string, yearId: string): Promise<void> {
    await this.cache.del(this.getSideMenuCacheKey(role, yearId));
  }
}
