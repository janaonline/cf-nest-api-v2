import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { FilterQuery, Model, ProjectionType, Types, UpdateQuery } from 'mongoose';
import { User } from 'src/module/auth/enum/role.enum';
import { EventChange, EventDocument, Events, EventStatus } from 'src/schemas/events.schema';
import { toValidDate } from 'src/shared/utils/date.utils';
import { isDeepEqual } from 'src/shared/utils/equality.utils';
import { CreateEventDto } from './dto/create-event.dto';
import { FindEventDto } from './dto/find-event-dto';
import { EventReponse, PaginatedResponse } from './dto/interface';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  private logger = new Logger();
  private readonly EventStatusCheck = { $in: [EventStatus.ACTIVE, EventStatus.DRAFT] };

  constructor(
    @InjectModel(Events.name)
    private readonly eventModel: Model<EventDocument>,
  ) {}

  /**
   * Creates a new event.
   * @param user The authenticated user creating the event
   * @param dto The event creation data
   * @returns The created event
   */
  async create(dto: CreateEventDto, user: User) {
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
      createdBy: user?._id || '5eb53b3f6ffdf8c7cf01bf82',
    };

    try {
      const createdEvent = await this.eventModel.create(eventData);
      return createdEvent;
    } catch (error: unknown) {
      // MongoDB duplicate key error
      if (error instanceof MongoServerError && error.code === 11000) {
        this.logger.warn(`Duplicate webinarId detected: ${dto.webinarId}`);
        throw new BadRequestException('An event with this webinarId already exists.');
      }
      this.logger.error('Failed to create event: ', error);
      throw new BadRequestException('Failed to create event');
    }
  }

  /**
   * Fetch a single event by its id.
   * @param id - MongoDB ObjectId of the event
   * @returns The event document or null if not found
   */
  async findOne(webinarId: string): Promise<EventReponse> {
    if (!webinarId) {
      throw new BadRequestException('Invalid or missing event id!');
    }

    try {
      const event = await this.eventModel
        .findOne({ webinarId: webinarId, eventStatus: this.EventStatusCheck }, { history: 0 })
        .lean<Events>();
      return {
        success: true,
        message: 'Event fetched successfully',
        data: event,
      };
    } catch (error) {
      this.logger.error('Failed to fetch event: ', error);
      throw new InternalServerErrorException('Unable to fetch event at this time.');
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
  async findAll(query: FindEventDto): Promise<PaginatedResponse<Events>> {
    try {
      const page = query.page ?? 1;
      const limit = Math.min(query.limit, 15);
      const skip = (page - 1) * limit;

      // DB filter and projection.
      const projection: ProjectionType<EventDocument> = { history: 0 };
      const filter: FilterQuery<EventDocument> = { eventStatus: this.EventStatusCheck };

      // If eventStatus is provided, override the base filter.
      if (query.eventStatus) {
        filter.eventStatus = query.eventStatus;
      }

      // Use case-sensitive regex.
      const title = query.title?.trim();
      if (title) {
        // Escaping regex to avoid regex DoS patterns
        // const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // filter.title = { $regex: escaped, $options: 'i' };
        filter.$text = { $search: title };
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
      const [data, total] = await Promise.all([findQuery.lean<Events[]>(), this.eventModel.countDocuments(filter)]);

      // // Convert all date fields to IST timezone before returning (DB returns UTC)
      // const eventListWithIST: EventListItemDto[] = items.map((item) => ({
      //   ...item,
      //   startAt: toIST(item.startAt),
      //   endAt: toIST(item.endAt),
      //   createdAt: toIST(item.createdAt),
      //   updatedAt: toIST(item.updatedAt),
      // }));

      return {
        data,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        success: true,
        message: 'Event fetched successfully',
      };
    } catch (error) {
      this.logger.error('Failed to fetch events: ', error);
      throw new InternalServerErrorException('Unable to fetch events at this time.');
    }
  }

  /**
   * Update an existing event by its id.
   *
   * Responsibilities:
   * - Validate input (id + payload)
   * - Convert and validate date fields
   * - Ensure startAt <= endAt
   * - Track field-level change history
   * - Persist update atomically
   *
   * @param id MongoDB ObjectId of the event
   * @param dto Partial update payload
   * @returns Updated event document
   */
  async update(id: string, dto: UpdateEventDto): Promise<EventReponse> {
    // Validate id (must be an ObjectId)
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid or missing event id!');
    }

    // Prevent "empty update"
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update.');
    }

    // Load existing document
    const _id = new Types.ObjectId(id);
    const event = await this.eventModel.findById(_id).lean<EventDocument>();
    if (!event) {
      throw new NotFoundException('Event not found!');
    }

    // Create patch object from dto.
    const patch: Partial<Events> = { ...dto };

    // Convert ISO strings to Date obj.
    if (dto.startAt) {
      patch.startAt = toValidDate(dto.startAt?.toString());
    }
    if (dto.endAt) {
      patch.endAt = toValidDate(dto.endAt?.toString());
    }

    // Validate date relationship.
    if (patch.startAt || patch.endAt) {
      const startAt = patch.startAt ?? event.startAt;
      const endAt = patch.endAt ?? event.endAt;

      if (endAt && new Date(endAt) < new Date(startAt)) {
        throw new BadRequestException('endAt must be after startAt.');
      }
    }

    // Prepare History obj
    const historyEntry: { changeAt: Date; changes: EventChange<Event> } = { changeAt: new Date(), changes: {} };
    for (const key of Object.keys(patch) as (keyof Events)[]) {
      const newValue = patch[key];
      const oldValue = event[key];

      if (isDeepEqual(oldValue, newValue)) {
        continue;
      }

      historyEntry.changes[key] = {
        old: oldValue,
        new: newValue,
      };
    }

    // If startAt & endAt both are changed then only add to history.
    const dateKeys = ['startAt', 'endAt'];
    const changedKeys = Object.keys(historyEntry.changes);
    const shouldPushHistory = changedKeys.length > 0 && dateKeys.every((k) => changedKeys.includes(k));

    const updateQuery: UpdateQuery<EventDocument> = {
      $set: patch,
      ...(shouldPushHistory ? { $push: { history: historyEntry } } : {}),
    };

    try {
      const updatedEvent = await this.eventModel
        .findOneAndUpdate({ _id } as FilterQuery<EventDocument>, updateQuery, {
          new: true,
          runValidators: true,
          context: 'query',
        })
        .lean();

      if (!updatedEvent) {
        throw new NotFoundException('Event not found!');
      }

      // Remove history from response
      updatedEvent.history = [];

      return {
        data: updatedEvent,
        success: true,
        message: 'Event fetched successfully',
      };
    } catch (error: unknown) {
      this.logger.error({ msg: 'Failed to update event', id, error });
      throw new InternalServerErrorException('Failed to update event!');
    }
  }

  /**
   * Deactivates an event by setting its `eventStatus` to INACTIVE.
   *
   * @param string id - The MongoDB ObjectId of the event to deactivate.
   * @throws BadRequestException If the `id` is missing or not a valid ObjectId.
   * @throws NotFoundException If no event is found with the given `id`.
   * @throws InternalServerErrorException If the update operation fails unexpectedly.
   *
   * @returns Promise<{ success: boolean; message: string }> A success response if the event is deactivated.
   */
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
