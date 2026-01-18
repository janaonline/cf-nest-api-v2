import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventDocument, EventStatus } from 'src/schemas/events.schema';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, ProjectionType, Types } from 'mongoose';
import { FindEventDto } from './dto/find-event-dto';
import { EventListItemDto, PaginatedResponse } from './dto/interface';
import { toIST } from 'src/shared/utils/date.utils';

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
  async create(dto: CreateEventDto, user: any) {
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
      createdBy: user?._id,
    };

    try {
      const createdEvent = await this.eventModel.create(eventData);
      return createdEvent;
    } catch (error) {
      this.logger.error('Failed to create event: ', error);
      throw new BadRequestException('Failed to create event');
    }
  }

  /**
   * Fetch a paginated list of events from the DB.
   * Supports filtering by event status, searching by title, and sorting by config fields.
   * Also converts date fields from UTC to IST before returning.
   *
   * @param query - DTO containing optional filters, pagination, and sorting options
   * @returns A paginated response with event items and metadata (page, limit, total, pages)
   * @throws InternalServerErrorException if database operation fails
   */
  async find(query: FindEventDto): Promise<PaginatedResponse<EventListItemDto>> {
    try {
      const page = query.page ?? 1;
      const limit = Math.min(query.limit, 15);
      const skip = (page - 1) * limit;

      // DB filter and projection.
      const projection: ProjectionType<EventDocument> = { history: 0 };
      const filter: FilterQuery<EventDocument> = {
        eventStatus: { $ne: EventStatus.INACTIVE },
      };

      // If eventStatus is provided, override the base filter.
      if (query.eventStatus) {
        filter.eventStatus = query.eventStatus;
      }

      // Use case-sensitive regex.
      const title = query.title?.trim();
      if (title) {
        // Escaping regex to avoid regex DoS patterns
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.title = { $regex: escaped, $options: 'i' };
      }

      // Determine sort field and direction.
      const sortBy = query.sortBy ?? 'startAt';
      const sortDir = query.sortDir ?? 1;

      // Build MongoDB query with filtering, sorting, pagination
      const findQuery = this.eventModel
        .find(filter, projection)
        .sort({ [sortBy]: sortDir })
        .skip(skip)
        .limit(limit);

      // Execute queries in parallel: fetch items(events) and count total.
      const [items, total] = await Promise.all([findQuery.lean(), this.eventModel.countDocuments(filter)]);

      // Convert all date fields to IST timezone before returning (DB returns UTC)
      const eventListWithIST: EventListItemDto[] = items.map((item) => {
        const e = item as any;
        return {
          ...e,
          startAt: toIST(e.startAt),
          endAt: toIST(e.endAt),
          createdAt: toIST(e.createdAt),
          updatedAt: toIST(e.updatedAt),
        };
      });

      return {
        items: eventListWithIST,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error('Failed to fetch events: ', error);
      throw new InternalServerErrorException('Unable to fetch events at this time.');
    }
  }

  update(id: string, updateEventDto: UpdateEventDto) {
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
