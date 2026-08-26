import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SideMenuController } from './side-menu.controller';
import { SideMenuService, SideMenuAdminItem } from './side-menu.service';
import { CreateSideMenuDto, MenuItemType, MenuSection } from './dto/create-side-menu.dto';
import { QuerySideMenuDto } from './dto/query-side-menu.dto';

describe('SideMenuController', () => {
  let controller: SideMenuController;
  let service: jest.Mocked<SideMenuService>;

  const mockItem: SideMenuAdminItem = {
    _id: new Types.ObjectId(),
    role: 'ULB',
    year: new Types.ObjectId(),
    section: 'top',
    sequence: 1,
    type: 'item',
    label: 'Overview',
    icon: 'bi bi-speedometer2',
    featureKey: 'overview',
    routerLink: ['/xvifc'],
    parentId: null,
    isActive: true,
  };

  beforeEach(async () => {
    const mockSideMenuService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      bulkCreate: jest.fn(),
      update: jest.fn(),
      toggleActive: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SideMenuController],
      providers: [{ provide: SideMenuService, useValue: mockSideMenuService }],
    }).compile();

    controller = module.get<SideMenuController>(SideMenuController);
    service = module.get(SideMenuService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to service.findAll with the query dto', async () => {
      const query: QuerySideMenuDto = { role: 'ULB' };
      service.findAll.mockResolvedValue([mockItem]);

      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual([mockItem]);
    });
  });

  describe('findOne', () => {
    it('delegates to service.findOne with the id', async () => {
      const id = mockItem._id.toString();
      service.findOne.mockResolvedValue(mockItem);

      const result = await controller.findOne(id);

      expect(service.findOne).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockItem);
    });

    it('propagates NotFoundException from the service', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('Menu item x not found'));
      await expect(controller.findOne('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('delegates to service.create with the dto', async () => {
      const dto: CreateSideMenuDto = {
        role: 'ULB',
        year: new Types.ObjectId().toString(),
        section: MenuSection.TOP,
        sequence: 1,
        type: MenuItemType.ITEM,
        label: 'Overview',
      };
      service.create.mockResolvedValue(mockItem);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockItem);
    });
  });

  describe('bulkCreate', () => {
    it('delegates to service.bulkCreate with the items array', async () => {
      const items: CreateSideMenuDto[] = [
        {
          role: 'ULB',
          year: new Types.ObjectId().toString(),
          section: MenuSection.TOP,
          sequence: 1,
          type: MenuItemType.ITEM,
          label: 'Overview',
        },
      ];
      service.bulkCreate.mockResolvedValue([mockItem]);

      const result = await controller.bulkCreate(items);

      expect(service.bulkCreate).toHaveBeenCalledWith(items);
      expect(result).toEqual([mockItem]);
    });
  });

  describe('update', () => {
    it('delegates to service.update with id and dto', async () => {
      const id = mockItem._id.toString();
      const dto = { label: 'Renamed' };
      service.update.mockResolvedValue({ ...mockItem, label: 'Renamed' });

      const result = await controller.update(id, dto);

      expect(service.update).toHaveBeenCalledWith(id, dto);
      expect(result.label).toBe('Renamed');
    });

    it('propagates NotFoundException from the service', async () => {
      service.update.mockRejectedValue(new NotFoundException('Menu item x not found'));
      await expect(controller.update('x', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleActive', () => {
    it('delegates to service.toggleActive with the id', async () => {
      const id = mockItem._id.toString();
      service.toggleActive.mockResolvedValue({ ...mockItem, isActive: false });

      const result = await controller.toggleActive(id);

      expect(service.toggleActive).toHaveBeenCalledWith(id);
      expect(result.isActive).toBe(false);
    });
  });

  describe('remove', () => {
    it('delegates to service.remove with the id and returns the deleted flag', async () => {
      const id = mockItem._id.toString();
      service.remove.mockResolvedValue({ deleted: true });

      const result = await controller.remove(id);

      expect(service.remove).toHaveBeenCalledWith(id);
      expect(result).toEqual({ deleted: true });
    });

    it('propagates NotFoundException from the service', async () => {
      service.remove.mockRejectedValue(new NotFoundException('Menu item x not found'));
      await expect(controller.remove('x')).rejects.toThrow(NotFoundException);
    });
  });
});
