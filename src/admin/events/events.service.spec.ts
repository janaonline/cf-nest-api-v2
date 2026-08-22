import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { EventsService } from './events.service';
import { Events, EventStatus } from 'src/schemas/events.schema';

const makeId = () => new Types.ObjectId().toHexString();

const baseEvent = {
  _id: new Types.ObjectId(),
  webinarId: 'webinar_001',
  title: 'Test Webinar',
  desc: 'A test webinar description',
  eventStatus: EventStatus.ACTIVE,
  startAt: new Date('2025-06-01T10:00:00Z'),
  endAt: new Date('2025-06-01T11:00:00Z'),
  history: [],
  redirectionLink: 'https://example.com',
};

describe('EventsService', () => {
  let service: EventsService;
  let mockEventModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    countDocuments: jest.Mock;
  };

  beforeEach(async () => {
    const chainMock = { lean: jest.fn() };

    mockEventModel = {
      create: jest.fn(),
      findOne: jest.fn().mockReturnValue(chainMock),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      }),
      findById: jest.fn().mockReturnValue({ lean: jest.fn() }),
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: jest.fn() }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: getModelToken(Events.name), useValue: mockEventModel },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const user = { _id: makeId(), email: 'admin@test.com', role: 'ADMIN' } as any;
    const dto = {
      webinarId: 'w1',
      title: 'Webinar',
      desc: 'Desc',
      eventStatus: EventStatus.ACTIVE,
      startAt: new Date('2025-06-01'),
      endAt: new Date('2025-06-02'),
      redirectionLink: 'https://example.com',
    };

    it('should create and return the event', async () => {
      mockEventModel.create.mockResolvedValue({ ...baseEvent });
      const result = await service.create(dto, user);
      expect(mockEventModel.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ webinarId: baseEvent.webinarId });
    });

    it('should throw BadRequestException when neither redirectionLink nor formId', async () => {
      const badDto = { ...dto, redirectionLink: undefined, formId: undefined };
      await expect(service.create(badDto, user)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when endAt is before startAt', async () => {
      const badDto = {
        ...dto,
        startAt: new Date('2025-06-02'),
        endAt: new Date('2025-06-01'),
      };
      await expect(service.create(badDto, user)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on duplicate webinarId', async () => {
      const dupErr = new MongoServerError({ message: 'dup key' });
      dupErr.code = 11000;
      mockEventModel.create.mockRejectedValue(dupErr);
      await expect(service.create(dto, user)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on other create errors', async () => {
      mockEventModel.create.mockRejectedValue(new Error('DB error'));
      await expect(service.create(dto, user)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return event response when found', async () => {
      mockEventModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseEvent) });
      const result = await service.findOne('webinar_001');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(baseEvent);
    });

    it('should return null data when event not found', async () => {
      mockEventModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const result = await service.findOne('missing_webinar');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should throw BadRequestException when webinarId is empty', async () => {
      await expect(service.findOne('')).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException on DB error', async () => {
      mockEventModel.findOne.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db fail')) });
      await expect(service.findOne('w1')).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    const query = { page: 1, limit: 10, sortBy: 'startAt', sortDir: 1 } as any;

    it('should return paginated response', async () => {
      mockEventModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([baseEvent]),
      });
      mockEventModel.countDocuments.mockResolvedValue(1);

      const result = await service.findAll(query);
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should cap limit at 15', async () => {
      mockEventModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      mockEventModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ ...query, limit: 100 });
      const limitSpy = mockEventModel.find.mock.results[0].value.limit;
      expect(limitSpy).toHaveBeenCalledWith(15);
    });

    it('should add text search filter when title is provided', async () => {
      const findSpy = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      mockEventModel.find = findSpy;
      mockEventModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ ...query, title: 'Webinar' });
      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg).toHaveProperty('$text');
    });

    it('should throw InternalServerErrorException on DB error', async () => {
      mockEventModel.find.mockImplementation(() => { throw new Error('db fail'); });
      await expect(service.findAll(query)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    const validId = new Types.ObjectId().toHexString();
    const dto = { title: 'Updated Title' } as any;

    it('should update and return event', async () => {
      mockEventModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseEvent) });
      const updatedEvent = { ...baseEvent, title: 'Updated Title', history: [] };
      mockEventModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(updatedEvent) });

      const result = await service.update(validId, dto);
      expect(result.success).toBe(true);
    });

    it('should throw BadRequestException for invalid id', async () => {
      await expect(service.update('bad-id', dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when dto is empty', async () => {
      await expect(service.update(validId, {})).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when event not found', async () => {
      mockEventModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.update(validId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when endAt is before startAt', async () => {
      const event = { ...baseEvent, startAt: new Date('2025-06-01'), endAt: new Date('2025-06-02') };
      mockEventModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(event) });
      const badDto = { startAt: '2025-06-03', endAt: '2025-06-01' } as any;
      await expect(service.update(validId, badDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException on DB error during update', async () => {
      mockEventModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseEvent) });
      mockEventModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('db fail')),
      });
      await expect(service.update(validId, dto)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ─── deactivate ────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    const validId = new Types.ObjectId().toHexString();

    it('should deactivate event and return success', async () => {
      mockEventModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseEvent) });
      const result = await service.deactivate(validId);
      expect(result).toEqual({ success: true, message: 'Success!' });
    });

    it('should throw BadRequestException for invalid id', async () => {
      await expect(service.deactivate('bad-id')).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException when event not found', async () => {
      mockEventModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.deactivate(validId)).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException on DB error', async () => {
      mockEventModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('db fail')),
      });
      await expect(service.deactivate(validId)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
