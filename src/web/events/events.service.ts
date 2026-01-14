import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventDocument, EventStatus } from 'src/schemas/events.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { toIST } from 'src/shared/files/constant';

@Injectable()
export class EventsService {
  private logger = new Logger();

  constructor(
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
  ) {}

  /**
   * Creates a new event.
   * @param user The authenticated user creating the event
   * @param dto The event creation data
   * @returns The created event
   */
  async create(dto: CreateEventDto) {
    // TODO: get user from token - allow only admin to create event.
    // Create a middleware - that takes array of user role and validates them.
    // In controller.
    const user = { _id: '6402dd7803b5a6b6c2cb6d43' };
    if (!user || !Types.ObjectId.isValid(user._id)) {
      throw new UnauthorizedException('You must be logged in to create an event.');
    }

    if (!dto.redirectionLink && !dto.formId) {
      throw new BadRequestException('redirectionLink or formJson id is mandatory.');
    }

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (endAt && endAt < startAt) {
      throw new BadRequestException('endAt must be after startAt.');
    }

    const eventData = {
      ...dto,
      startAt,
      endAt,
      createdBy: user._id,
    };

    try {
      const createdEvent = await this.eventModel.create(eventData);
      return createdEvent;
    } catch (error) {
      this.logger.error('Failed to create event: ', error);
      throw new BadRequestException('Failed to create event');
    }
  }

  async find({ page = 1, limit = 10 }): Promise<unknown[]> {
    try {
      // TODO: Add sort feature
      // Search by title
      // Search by eventStatus: active/ draft donot allow inactive search
      // Search between date range

      limit = Math.min(limit, 15);
      const skip = (page - 1) * limit;

      const events = await this.eventModel
        .find({ eventStatus: { $ne: EventStatus.INACTIVE } }, { history: false })
        .sort({ startAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();

      return events.map((event) => {
        const e = event as any;
        return {
          ...e,
          startAt: toIST(e.startAt),
          endAt: toIST(e.endAt),
          createdAt: toIST(e.createdAt),
          updatedAt: toIST(e.updatedAt),
        };
      });
    } catch (error) {
      this.logger.error('Failed to fetch events: ', error);
      throw new InternalServerErrorException('Unable to fetch events at this time.');
    }
  }

  // findOne(id: number) {
  //   return `This action returns a #${id} event`;
  // }

  update(id: number, updateEventDto: UpdateEventDto) {
    return `This action updates a #${id} event`;
  }

  async deactivate(id: string) {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid or missing event id!');
    }

    try {
      const deactivate = await this.eventModel
        .findOneAndUpdate({ _id: new Types.ObjectId(id) }, { $set: { eventStatus: EventStatus.INACTIVE } })
        .lean();

      if (!deactivate) {
        throw new NotFoundException('Event not found');
      }

      return { success: true, message: 'Success!' };
    } catch (error) {
      this.logger.error('Failed to delete event: ', error);
      throw new InternalServerErrorException('Unable to delete event at this time.');
    }
  }
}
