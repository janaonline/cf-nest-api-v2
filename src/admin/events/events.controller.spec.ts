import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { EventStatus } from 'src/schemas/events.schema';
import { Role } from 'src/module/auth/enum/role.enum';

const mockUser = {
  _id: new Types.ObjectId().toHexString(),
  email: 'admin@test.com',
  role: Role.ADMIN,
} as any;

const baseEvent = {
  _id: new Types.ObjectId(),
  webinarId: 'webinar_001',
  title: 'Test Event',
  eventStatus: EventStatus.ACTIVE,
  startAt: new Date('2025-06-01T10:00:00Z'),
  endAt: new Date('2025-06-01T11:00:00Z'),
};

describe('EventsController', () => {
  let controller: EventsController;
  let service: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const mockEventsService = {
      create: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        { provide: EventsService, useValue: mockEventsService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EventsController>(EventsController);
    service = module.get(EventsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    const dto = {
      webinarId: 'w1',
      title: 'Webinar',
      desc: 'Desc',
      eventStatus: EventStatus.ACTIVE,
      startAt: new Date('2025-06-01'),
      endAt: new Date('2025-06-02'),
      redirectionLink: 'https://example.com',
    } as any;

    it('should call service.create and return result', async () => {
      service.create.mockResolvedValue(baseEvent as any);
      const result = await controller.create(dto, mockUser);
      expect(service.create).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toEqual(baseEvent);
    });

    it('should propagate BadRequestException from service', async () => {
      service.create.mockRejectedValue(new BadRequestException('Validation failed'));
      await expect(controller.create(dto, mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne and return event', async () => {
      const response = { success: true, message: 'Event fetched successfully', data: baseEvent };
      service.findOne.mockResolvedValue(response as any);
      const result = await controller.findOne('webinar_001', mockUser);
      expect(service.findOne).toHaveBeenCalledWith('webinar_001');
      expect(result).toEqual(response);
    });

    it('should propagate exception from service', async () => {
      service.findOne.mockRejectedValue(new BadRequestException());
      await expect(controller.findOne('bad', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should call service.findAll and return paginated result', async () => {
      const response = { success: true, data: [baseEvent], total: 1, page: 1, limit: 10, pages: 1, message: '' };
      service.findAll.mockResolvedValue(response as any);
      const query = { page: 1, limit: 10 } as any;
      const result = await controller.findAll(query);
      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(response);
    });
  });

  describe('update', () => {
    const id = new Types.ObjectId().toHexString();
    const dto = { title: 'Updated' } as any;

    it('should call service.update and return result', async () => {
      const response = {
        success: true,
        message: 'Event fetched successfully',
        data: { ...baseEvent, title: 'Updated' },
      };
      service.update.mockResolvedValue(response as any);
      const result = await controller.update(id, dto);
      expect(service.update).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(response);
    });

    it('should propagate NotFoundException from service', async () => {
      service.update.mockRejectedValue(new NotFoundException('Event not found!'));
      await expect(controller.update(id, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    const id = new Types.ObjectId().toHexString();

    it('should call service.deactivate and return success', async () => {
      service.deactivate.mockResolvedValue({ success: true, message: 'Success!' });
      const result = await controller.remove(id);
      expect(service.deactivate).toHaveBeenCalledWith(id);
      expect(result).toEqual({ success: true, message: 'Success!' });
    });

    it('should propagate NotFoundException from service', async () => {
      service.deactivate.mockRejectedValue(new NotFoundException('Event not found'));
      await expect(controller.remove(id)).rejects.toThrow(NotFoundException);
    });
  });
});
