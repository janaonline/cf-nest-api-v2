import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { XviFcSideMenu, XviFcSideMenuDocument } from '../../../schemas/xvi-fc/xvi-fc-side-menu.schema';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from '../cache/xvi-fc-cache.service';
import { CreateSideMenuDto } from './dto/create-side-menu.dto';
import { UpdateSideMenuDto } from './dto/update-side-menu.dto';
import { QuerySideMenuDto } from './dto/query-side-menu.dto';

@Injectable()
export class SideMenuService {
  constructor(
    @InjectModel(XviFcSideMenu.name)
    private readonly sideMenuModel: Model<XviFcSideMenuDocument>,
    private readonly cache: XviFcCacheService,
  ) {}

  async findAll(query: QuerySideMenuDto): Promise<XviFcSideMenu[]> {
    const filter: Record<string, any> = { module: 'XVI-FC' };

    if (query.role) filter.role = query.role;
    if (query.yearId) filter.year = new Types.ObjectId(query.yearId);
    if (!query.includeInactive) filter.isActive = true;

    return this.sideMenuModel.find(filter).sort({ role: 1, sequence: 1 }).lean().exec();
  }

  async findOne(id: string): Promise<XviFcSideMenu> {
    const doc = await this.sideMenuModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException(`Menu item ${id} not found`);
    return doc;
  }

  async create(dto: CreateSideMenuDto): Promise<XviFcSideMenu> {
    const doc = await this.sideMenuModel.create({
      ...dto,
      module: 'XVI-FC',
      year: new Types.ObjectId(dto.year),
      parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : null,
      isActive: dto.isActive ?? true,
    });
    await this.invalidateCache(dto.role, dto.year);
    return doc.toObject();
  }

  async bulkCreate(items: CreateSideMenuDto[]): Promise<XviFcSideMenu[]> {
    const docs = items.map((item) => ({
      ...item,
      module: 'XVI-FC',
      year: new Types.ObjectId(item.year),
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

    return inserted.map((d) => d.toObject());
  }

  async update(id: string, dto: UpdateSideMenuDto): Promise<XviFcSideMenu> {
    const existing = await this.sideMenuModel.findById(id).lean().exec();
    if (!existing) throw new NotFoundException(`Menu item ${id} not found`);

    const updated = await this.sideMenuModel
      .findByIdAndUpdate(
        id,
        {
          ...dto,
          ...(dto.year && { year: new Types.ObjectId(dto.year) }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : null }),
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

    return updated!;
  }

  async toggleActive(id: string): Promise<XviFcSideMenu> {
    const doc = await this.sideMenuModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException(`Menu item ${id} not found`);

    const updated = await this.sideMenuModel
      .findByIdAndUpdate(id, { isActive: !doc.isActive }, { new: true })
      .lean()
      .exec();

    await this.invalidateCache(doc.role, doc.year.toString());
    return updated!;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const doc = await this.sideMenuModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException(`Menu item ${id} not found`);

    await this.sideMenuModel.findByIdAndDelete(id).exec();
    await this.invalidateCache(doc.role, doc.year.toString());
    return { deleted: true };
  }

  private async invalidateCache(role: string, yearId: string): Promise<void> {
    await this.cache.delete(`${XVIFC_CACHE_KEY_PREFIX}:/xvi-fc/sidebar/${role}?yearId=${yearId}`);
  }
}
