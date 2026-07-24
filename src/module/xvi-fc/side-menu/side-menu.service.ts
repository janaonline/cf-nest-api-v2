import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SideMenu, SideMenuDocument } from '../../../schemas/side-menu.schema';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from '../cache/xvi-fc-cache.service';
import { CreateSideMenuDto } from './dto/create-side-menu.dto';
import { UpdateSideMenuDto } from './dto/update-side-menu.dto';
import { QuerySideMenuDto } from './dto/query-side-menu.dto';

const MODULE = 'XVI-FC';

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
}

@Injectable()
export class SideMenuService {
  constructor(
    @InjectModel(SideMenu.name)
    private readonly sideMenuModel: Model<SideMenuDocument>,
    private readonly cache: XviFcCacheService,
  ) {}

  // The admin API keeps `label` as the field name for backwards compatibility;
  // internally it's stored as `name` since it's shared with the legacy Sidemenu collection.
  // Legacy 15th-FC-only fields (code, url, category, ...) are intentionally left out of the response.
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
    await this.cache.delete(`${XVIFC_CACHE_KEY_PREFIX}:/xvi-fc/sidebar/${role}?yearId=${yearId}`);
  }
}
