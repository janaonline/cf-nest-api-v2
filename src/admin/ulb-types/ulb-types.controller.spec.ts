import { Test, TestingModule } from '@nestjs/testing';
import { UlbTypesController } from './ulb-types.controller';
import { UlbTypesService } from './ulb-types.service';
import { CreateUlbTypeDto } from './dto/create-ulb-type.dto';
import { UpdateUlbTypeDto } from './dto/update-ulb-type.dto';

describe('UlbTypesController', () => {
  let controller: UlbTypesController;
  let service: jest.Mocked<UlbTypesService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UlbTypesController],
      providers: [
        {
          provide: UlbTypesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UlbTypesController>(UlbTypesController);
    service = module.get(UlbTypesService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('delegates to service.create', async () => {
      const dto: CreateUlbTypeDto = { name: 'Cantonment Board', ineligibleForGrantCycles: ['XVIFC'] };
      const created = { _id: 't1', ...dto, isActive: true };
      service.create.mockResolvedValue(created as never);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('propagates ConflictException from service.create', async () => {
      const dto: CreateUlbTypeDto = { name: 'Dup' };
      service.create.mockRejectedValue(new Error('A ULB type named "Dup" already exists'));

      await expect(controller.create(dto)).rejects.toThrow('already exists');
    });
  });

  describe('findAll', () => {
    it('delegates to service.findAll with pagination', async () => {
      const paginated = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      service.findAll.mockResolvedValue(paginated as never);

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(service.findAll).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual(paginated);
    });
  });

  describe('findOne', () => {
    it('delegates to service.findOne', async () => {
      const type = { _id: 't1', name: 'Cantonment Board' };
      service.findOne.mockResolvedValue(type as never);

      const result = await controller.findOne('t1');

      expect(service.findOne).toHaveBeenCalledWith('t1');
      expect(result).toEqual(type);
    });

    it('propagates NotFoundException from service.findOne', async () => {
      service.findOne.mockRejectedValue(new Error('ULB type not found'));

      await expect(controller.findOne('missing')).rejects.toThrow('ULB type not found');
    });
  });

  describe('update', () => {
    it('delegates to service.update', async () => {
      const dto: UpdateUlbTypeDto = { ineligibleForGrantCycles: ['XVIFC'] };
      const updated = { _id: 't1', name: 'Cantonment Board', ...dto };
      service.update.mockResolvedValue(updated as never);

      const result = await controller.update('t1', dto);

      expect(service.update).toHaveBeenCalledWith('t1', dto);
      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('delegates to service.remove', async () => {
      const message = { message: 'ULB type "Cantonment Board" deactivated' };
      service.remove.mockResolvedValue(message);

      const result = await controller.remove('t1');

      expect(service.remove).toHaveBeenCalledWith('t1');
      expect(result).toEqual(message);
    });
  });
});
