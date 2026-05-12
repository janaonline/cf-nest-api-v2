import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { toObjectId } from '../../common/utils/objectid.util';
import { INotifyAudienceOptions } from '../../common/types/workflow.types';
import { INotification } from '../interfaces/notification.interface';
import { Notification, NotificationDocument } from '../schemas/notification.schema';
import { NotificationAudienceResolver } from './notification-audience.resolver';

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly audienceResolver: NotificationAudienceResolver,
  ) {}

  /**
   * Resolves the target audience and bulk-inserts notifications for all matched users.
   * Uses insertMany for performance; skips silently if no recipients are found.
   * @param options Notification payload including audience filters, context, title, and message.
   */
  async notifyAudience(options: INotifyAudienceOptions): Promise<void> {
    const recipientIds = await this.audienceResolver.resolveAudience(options.audience);
    if (recipientIds.length === 0) return;

    const contextId = typeof options.contextId === 'string' ? new Types.ObjectId(options.contextId) : options.contextId;

    const docs = recipientIds.map((userId) => ({
      recipientUserId: new Types.ObjectId(userId),
      type: options.type,
      title: options.title,
      message: options.message,
      contextType: options.contextType,
      contextId,
      threadId: options.threadId ? new Types.ObjectId(options.threadId.toString()) : undefined,
      financialYear: options.financialYear,
      redirectUrl: options.redirectUrl,
      isRead: false,
    }));

    const insertOptions: { session?: ClientSession } = options.session ? { session: options.session } : {};
    await this.notificationModel.insertMany(docs, insertOptions);
  }

  /**
   * Fetches a paginated list of notifications for a user with optional unread filtering.
   * @param userId Recipient whose notifications to fetch.
   * @param page Page number (1-indexed).
   * @param limit Notifications per page.
   * @param unreadOnly When true, returns only unread notifications.
   * @returns Paginated notifications, total count, and total unread count.
   */
  async getUserNotifications(
    userId: string,
    page: number,
    limit: number,
    unreadOnly = false,
  ): Promise<{ notifications: INotification[]; total: number; unreadCount: number }> {
    const filter: Record<string, unknown> = {
      recipientUserId: toObjectId(userId, 'userId'),
    };
    if (unreadOnly) filter['isRead'] = false;

    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);

    const unreadCount = unreadOnly
      ? total
      : await this.notificationModel
          .countDocuments({ recipientUserId: toObjectId(userId, 'userId'), isRead: false })
          .exec();

    return {
      notifications: notifications as unknown as INotification[],
      total,
      unreadCount,
    };
  }

  async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
    const result = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: toObjectId(notificationId, 'notificationId'),
          recipientUserId: toObjectId(userId, 'userId'),
        },
        { isRead: true, readAt: new Date() },
      )
      .exec();

    if (!result) {
      throw new NotFoundException('Notification not found');
    }
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        { recipientUserId: toObjectId(userId, 'userId'), isRead: false },
        { isRead: true, readAt: new Date() },
      )
      .exec();
  }

  /**
   * Returns the count of unread notifications for a user.
   * @param userId User to count unread notifications for.
   */
  async getUnreadNotificationCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({ recipientUserId: toObjectId(userId, 'userId'), isRead: false })
      .exec();
  }
}
