import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SideMenuService } from './side-menu.service';
import { SideMenu } from '../../../schemas/side-menu.schema';
import { NamespacedCacheService } from '../../../core/services/redis/namespaced-cache.service';
import { CreateSideMenuDto, MenuItemType, MenuSection } from './dto/create-side-menu.dto';

/** Mirrors NamespacedCacheService.buildKey/buildPattern exactly, so assertions below read off
 *  the same key shape the real service would produce (namespace:env:part1:part2). */
function buildKey(namespace: string, ...parts: Array<string | number | undefined>): string {
  return [namespace, 'test', ...parts.map((p) => p ?? '*')].join(':');
}

describe('SideMenuService', () => {
  let service: SideMenuService;
  let mockSideMenuModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    insertMany: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let mockCache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    delByPattern: jest.Mock;
    buildKey: jest.Mock;
    buildPattern: jest.Mock;
  };

  function q<T>(value: T) {
    return {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(value),
    };
  }

  function rawDoc(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      _id: new Types.ObjectId(),
      name: 'Overview',
      role: 'ULB',
      year: new Types.ObjectId(),
      section: 'top',
      sequence: 1,
      type: 'item',
      icon: 'bi bi-speedometer2',
      featureKey: 'overview',
      routerLink: ['/xvifc'],
      parentId: null,
      isActive: true,
      module: 'XVI-FC',
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockSideMenuModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(null)),
      create: jest.fn(),
      insertMany: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue(q(null)),
      findByIdAndDelete: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };
    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      del: jest.fn(),
      delByPattern: jest.fn(),
      buildKey: jest.fn(buildKey),
      buildPattern: jest.fn(buildKey),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SideMenuService,
        { provide: getModelToken(SideMenu.name), useValue: mockSideMenuModel },
        { provide: NamespacedCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(SideMenuService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('always filters by module XVI-FC and defaults to active-only', async () => {
      const chain = q([]);
      mockSideMenuModel.find.mockReturnValue(chain);

      await service.findAll({});

      expect(mockSideMenuModel.find).toHaveBeenCalledWith({ module: 'XVI-FC', isActive: true });
      expect(chain.sort).toHaveBeenCalledWith({ role: 1, sequence: 1 });
    });

    it('adds a role filter when provided', async () => {
      await service.findAll({ role: 'ULB' });
      expect(mockSideMenuModel.find).toHaveBeenCalledWith({ module: 'XVI-FC', role: 'ULB', isActive: true });
    });

    it('adds a year filter converted to ObjectId when yearId provided', async () => {
      const yearId = new Types.ObjectId().toString();
      await service.findAll({ yearId });
      expect(mockSideMenuModel.find).toHaveBeenCalledWith({
        module: 'XVI-FC',
        year: new Types.ObjectId(yearId),
        isActive: true,
      });
    });

    it('omits the isActive filter when includeInactive is true', async () => {
      await service.findAll({ includeInactive: true });
      expect(mockSideMenuModel.find).toHaveBeenCalledWith({ module: 'XVI-FC' });
    });

    it('maps documents to admin items, using name as label', async () => {
      const doc = rawDoc({ name: 'Dashboard' });
      mockSideMenuModel.find.mockReturnValue(q([doc]));

      const result = await service.findAll({});

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Dashboard');
      expect(result[0]._id).toBe(doc._id);
    });
  });

  describe('getSideMenu', () => {
    const yearId = new Types.ObjectId().toString();

    it('should return ULB side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      expect(result).toHaveProperty('topModel');
      expect(result).toHaveProperty('bottomModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return STATE side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('STATE', yearId);
      expect(result).toHaveProperty('topModel');
      expect(Array.isArray(result.topModel)).toBe(true);
    });

    it('should return MOHUA side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('MOHUA', yearId);
      expect(result).toHaveProperty('topModel');
    });

    it('should return DOE side menu', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('DOE', yearId);
      expect(result).toHaveProperty('topModel');
    });

    it('should throw NotFoundException for unknown role', async () => {
      await expect(service.getSideMenu('UNKNOWN' as any, yearId)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when yearId is missing', async () => {
      await expect(service.getSideMenu('ULB', '')).rejects.toThrow(NotFoundException);
    });

    it('returns the cached value without querying the model on a cache hit', async () => {
      const cached = { topModel: [{ label: 'Cached' }], bottomModel: [] };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getSideMenu('ULB', yearId);

      expect(result).toBe(cached);
      expect(mockSideMenuModel.find).not.toHaveBeenCalled();
    });

    it('populates the cache on a miss, keyed by role+yearId', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );

      const result = await service.getSideMenu('ULB', yearId);

      expect(mockCache.set).toHaveBeenCalledWith(buildKey('sidemenu', 'ULB', yearId), result);
    });

    it('copies url/target onto a top-level external-link item', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([
          {
            _id: new Types.ObjectId(),
            name: 'Submit Feedback',
            section: 'top',
            type: 'item',
            sequence: 1,
            url: 'https://tally.so/r/44d28O',
            target: '_blank',
          },
        ]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      expect(result.topModel[0]).toEqual(
        expect.objectContaining({ label: 'Submit Feedback', url: 'https://tally.so/r/44d28O', target: '_blank' }),
      );
    });

    it('copies url/target onto a child item nested under a group', async () => {
      const groupId = new Types.ObjectId();
      mockSideMenuModel.find.mockReturnValue(
        q([
          { _id: groupId, name: 'Support', section: 'top', type: 'group', sequence: 1, parentId: null },
          {
            _id: new Types.ObjectId(),
            name: 'Submit Feedback',
            section: 'top',
            type: 'item',
            sequence: 2,
            parentId: groupId,
            url: 'https://tally.so/r/44d28O',
            target: '_blank',
          },
        ]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      const group = result.topModel.find((i) => i.label === 'Support');
      expect(group?.items?.[0]).toEqual(
        expect.objectContaining({ label: 'Submit Feedback', url: 'https://tally.so/r/44d28O', target: '_blank' }),
      );
    });

    it('omits url/target for an item that does not set them', async () => {
      mockSideMenuModel.find.mockReturnValue(
        q([{ _id: new Types.ObjectId(), name: 'Overview', section: 'top', type: 'item', sequence: 1 }]),
      );
      const result = await service.getSideMenu('ULB', yearId);
      expect(result.topModel[0].url).toBeUndefined();
      expect(result.topModel[0].target).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('returns the mapped item when found', async () => {
      const doc = rawDoc();
      mockSideMenuModel.findOne.mockReturnValue(q(doc));

      const result = await service.findOne(doc._id.toString());

      expect(mockSideMenuModel.findOne).toHaveBeenCalledWith({ _id: doc._id.toString(), module: 'XVI-FC' });
      expect(result.label).toBe(doc.name);
    });

    it('throws NotFoundException when not found', async () => {
      mockSideMenuModel.findOne.mockReturnValue(q(null));
      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto: CreateSideMenuDto = {
      role: 'ULB',
      year: new Types.ObjectId().toString(),
      section: MenuSection.TOP,
      sequence: 1,
      type: MenuItemType.ITEM,
      label: 'Overview',
    };

    it('creates a document mapping label->name and defaults isActive to true', async () => {
      const created = rawDoc({ name: dto.label, year: new Types.ObjectId(dto.year) });
      mockSideMenuModel.create.mockResolvedValue({ toObject: () => created });

      const result = await service.create(dto);

      expect(mockSideMenuModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Overview',
          role: 'ULB',
          module: 'XVI-FC',
          parentId: null,
          isActive: true,
        }),
      );
      expect(result.label).toBe('Overview');
    });

    it('converts a provided parentId to an ObjectId', async () => {
      const parentId = new Types.ObjectId().toString();
      const created = rawDoc();
      mockSideMenuModel.create.mockResolvedValue({ toObject: () => created });

      await service.create({ ...dto, parentId });

      expect(mockSideMenuModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: new Types.ObjectId(parentId) }),
      );
    });

    it('invalidates the cache for the new item role+year', async () => {
      const created = rawDoc();
      mockSideMenuModel.create.mockResolvedValue({ toObject: () => created });

      await service.create(dto);

      expect(mockCache.del).toHaveBeenCalledWith(buildKey('sidemenu', dto.role, dto.year));
    });

    it('passes url/target through to the created document', async () => {
      const created = rawDoc({ url: 'https://tally.so/r/44d28O', target: '_blank' });
      mockSideMenuModel.create.mockResolvedValue({ toObject: () => created });

      const result = await service.create({ ...dto, url: 'https://tally.so/r/44d28O', target: '_blank' });

      expect(mockSideMenuModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://tally.so/r/44d28O', target: '_blank' }),
      );
      expect(result.url).toBe('https://tally.so/r/44d28O');
      expect(result.target).toBe('_blank');
    });
  });

  describe('bulkCreate', () => {
    it('inserts all items and invalidates the cache once per unique role+year pair', async () => {
      const yearA = new Types.ObjectId().toString();
      const yearB = new Types.ObjectId().toString();
      const items: CreateSideMenuDto[] = [
        { role: 'ULB', year: yearA, section: MenuSection.TOP, sequence: 1, type: MenuItemType.ITEM, label: 'A' },
        { role: 'ULB', year: yearA, section: MenuSection.TOP, sequence: 2, type: MenuItemType.ITEM, label: 'B' },
        { role: 'STATE', year: yearB, section: MenuSection.TOP, sequence: 1, type: MenuItemType.ITEM, label: 'C' },
      ];
      const insertedDocs = items.map((item) => ({ toObject: () => rawDoc({ name: item.label }) }));
      mockSideMenuModel.insertMany.mockResolvedValue(insertedDocs);

      const result = await service.bulkCreate(items);

      expect(mockSideMenuModel.insertMany).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3);
      expect(mockCache.del).toHaveBeenCalledTimes(2);
      expect(mockCache.del).toHaveBeenCalledWith(buildKey('sidemenu', 'ULB', yearA));
      expect(mockCache.del).toHaveBeenCalledWith(buildKey('sidemenu', 'STATE', yearB));
    });

    it('returns an empty array and skips cache invalidation when items is empty', async () => {
      mockSideMenuModel.insertMany.mockResolvedValue([]);

      const result = await service.bulkCreate([]);

      expect(result).toEqual([]);
      expect(mockCache.del).not.toHaveBeenCalled();
    });

    it('passes url/target through for each item', async () => {
      const items: CreateSideMenuDto[] = [
        {
          role: 'ULB',
          year: new Types.ObjectId().toString(),
          section: MenuSection.TOP,
          sequence: 2,
          type: MenuItemType.ITEM,
          label: 'Submit Feedback',
          url: 'https://tally.so/r/44d28O',
          target: '_blank',
        },
      ];
      mockSideMenuModel.insertMany.mockResolvedValue([{ toObject: () => rawDoc({ name: 'Submit Feedback' }) }]);

      await service.bulkCreate(items);

      expect(mockSideMenuModel.insertMany).toHaveBeenCalledWith([
        expect.objectContaining({ url: 'https://tally.so/r/44d28O', target: '_blank' }),
      ]);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the item does not exist', async () => {
      mockSideMenuModel.findOne.mockReturnValue(q(null));
      await expect(service.update('missing-id', { label: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('maps label->name and updates via findByIdAndUpdate, invalidating the existing role+year cache', async () => {
      const existing = rawDoc({ role: 'ULB' });
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      const updated = rawDoc({ ...existing, name: 'Renamed' });
      mockSideMenuModel.findByIdAndUpdate.mockReturnValue(q(updated));

      const result = await service.update(existing._id.toString(), { label: 'Renamed' });

      expect(mockSideMenuModel.findByIdAndUpdate).toHaveBeenCalledWith(
        existing._id.toString(),
        expect.objectContaining({ name: 'Renamed' }),
        { new: true },
      );
      expect(result.label).toBe('Renamed');
      expect(mockCache.del).toHaveBeenCalledWith(buildKey('sidemenu', 'ULB', existing.year.toString()));
    });

    it('invalidates both old and new role+year caches when role changes', async () => {
      const existing = rawDoc({ role: 'ULB' });
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      mockSideMenuModel.findByIdAndUpdate.mockReturnValue(q(rawDoc({ ...existing, role: 'STATE' })));

      await service.update(existing._id.toString(), { role: 'STATE' });

      expect(mockCache.del).toHaveBeenCalledTimes(2);
      expect(mockCache.del).toHaveBeenCalledWith(buildKey('sidemenu', 'ULB', existing.year.toString()));
      expect(mockCache.del).toHaveBeenCalledWith(buildKey('sidemenu', 'STATE', existing.year.toString()));
    });

    it('converts parentId to ObjectId when provided, and to null when explicitly cleared', async () => {
      const existing = rawDoc();
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      mockSideMenuModel.findByIdAndUpdate.mockReturnValue(q(rawDoc()));

      const parentId = new Types.ObjectId().toString();
      await service.update(existing._id.toString(), { parentId });
      expect(mockSideMenuModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ parentId: new Types.ObjectId(parentId) }),
        expect.anything(),
      );

      await service.update(existing._id.toString(), { parentId: null as unknown as string });
      expect(mockSideMenuModel.findByIdAndUpdate).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ parentId: null }),
        expect.anything(),
      );
    });

    it('converts a provided year to an ObjectId', async () => {
      const existing = rawDoc();
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      mockSideMenuModel.findByIdAndUpdate.mockReturnValue(q(rawDoc()));

      const newYear = new Types.ObjectId().toString();
      await service.update(existing._id.toString(), { year: newYear });

      expect(mockSideMenuModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ year: new Types.ObjectId(newYear) }),
        expect.anything(),
      );
    });
  });

  describe('toggleActive', () => {
    it('throws NotFoundException when the item does not exist', async () => {
      mockSideMenuModel.findOne.mockReturnValue(q(null));
      await expect(service.toggleActive('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('flips isActive true->false and invalidates the cache', async () => {
      const existing = rawDoc({ isActive: true });
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      mockSideMenuModel.findByIdAndUpdate.mockReturnValue(q(rawDoc({ ...existing, isActive: false })));

      const result = await service.toggleActive(existing._id.toString());

      expect(mockSideMenuModel.findByIdAndUpdate).toHaveBeenCalledWith(
        existing._id.toString(),
        { isActive: false },
        { new: true },
      );
      expect(result.isActive).toBe(false);
      expect(mockCache.del).toHaveBeenCalledWith(
        buildKey('sidemenu', existing.role as string, existing.year.toString()),
      );
    });

    it('flips isActive false->true', async () => {
      const existing = rawDoc({ isActive: false });
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      mockSideMenuModel.findByIdAndUpdate.mockReturnValue(q(rawDoc({ ...existing, isActive: true })));

      await service.toggleActive(existing._id.toString());

      expect(mockSideMenuModel.findByIdAndUpdate).toHaveBeenCalledWith(
        existing._id.toString(),
        { isActive: true },
        { new: true },
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the item does not exist', async () => {
      mockSideMenuModel.findOne.mockReturnValue(q(null));
      await expect(service.remove('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('deletes the item, invalidates the cache, and returns deleted: true', async () => {
      const existing = rawDoc();
      mockSideMenuModel.findOne.mockReturnValue(q(existing));
      const deleteExec = jest.fn().mockResolvedValue(existing);
      mockSideMenuModel.findByIdAndDelete.mockReturnValue({ exec: deleteExec });

      const result = await service.remove(existing._id.toString());

      expect(mockSideMenuModel.findByIdAndDelete).toHaveBeenCalledWith(existing._id.toString());
      expect(deleteExec).toHaveBeenCalled();
      expect(mockCache.del).toHaveBeenCalledWith(
        buildKey('sidemenu', existing.role as string, existing.year.toString()),
      );
      expect(result).toEqual({ deleted: true });
    });
  });
});
