import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationService } from './notification.service';
import { Notification } from '../schemas/notification.schema';
import { NotificationAudienceResolver } from './notification-audience.resolver';
import { INotifyAudienceOptions } from '../../../common/types/workflow.types';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockNotificationModel: {
    insertMany: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateMany: jest.Mock;
    sort: jest.Mock;
    skip: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  };
  let mockAudienceResolver: { resolveAudience: jest.Mock };

  beforeEach(async () => {
    mockNotificationModel = {
      insertMany: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(),
      sort: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn(),
    };
    // Chainable query builder methods all return `this` by default.
    mockNotificationModel.find.mockReturnValue(mockNotificationModel);
    mockNotificationModel.sort.mockReturnValue(mockNotificationModel);
    mockNotificationModel.skip.mockReturnValue(mockNotificationModel);
    mockNotificationModel.limit.mockReturnValue(mockNotificationModel);
    mockNotificationModel.lean.mockReturnValue(mockNotificationModel);
    mockNotificationModel.countDocuments.mockReturnValue(mockNotificationModel);
    mockNotificationModel.findOneAndUpdate.mockReturnValue(mockNotificationModel);
    mockNotificationModel.updateMany.mockReturnValue(mockNotificationModel);

    mockAudienceResolver = { resolveAudience: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getModelToken(Notification.name), useValue: mockNotificationModel },
        { provide: NotificationAudienceResolver, useValue: mockAudienceResolver },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── notifyAudience ───────────────────────────────────────────────────

  describe('notifyAudience', () => {
    const baseOptions: INotifyAudienceOptions = {
      audience: { orgType: 'ULB', orgId: new Types.ObjectId().toString() },
      type: 'SUBMISSION',
      title: 'Title',
      message: 'Message',
      contextType: 'ANNUAL_ACCOUNT',
      contextId: new Types.ObjectId().toString(),
      redirectUrl: '/xvi-fc/ulb',
    };

    it('resolves the audience and bulk-inserts a notification per recipient', async () => {
      const userId1 = new Types.ObjectId().toString();
      const userId2 = new Types.ObjectId().toString();
      mockAudienceResolver.resolveAudience.mockResolvedValue([userId1, userId2]);
      mockNotificationModel.insertMany.mockResolvedValue([]);

      await service.notifyAudience(baseOptions);

      expect(mockAudienceResolver.resolveAudience).toHaveBeenCalledWith(baseOptions.audience);
      expect(mockNotificationModel.insertMany).toHaveBeenCalledTimes(1);
      const [docs, options] = mockNotificationModel.insertMany.mock.calls[0];
      expect(docs).toHaveLength(2);
      expect(docs[0]).toMatchObject({
        type: 'SUBMISSION',
        title: 'Title',
        message: 'Message',
        contextType: 'ANNUAL_ACCOUNT',
        isRead: false,
      });
      expect(docs[0].recipientUserId).toBeInstanceOf(Types.ObjectId);
      expect(docs[0].contextId).toBeInstanceOf(Types.ObjectId);
      expect(options).toEqual({});
    });

    it('skips insertMany silently when no recipients are resolved', async () => {
      mockAudienceResolver.resolveAudience.mockResolvedValue([]);

      await service.notifyAudience(baseOptions);

      expect(mockNotificationModel.insertMany).not.toHaveBeenCalled();
    });

    it('passes the session through to insertMany when provided', async () => {
      const session = { id: 'fake-session' } as any;
      mockAudienceResolver.resolveAudience.mockResolvedValue([new Types.ObjectId().toString()]);
      mockNotificationModel.insertMany.mockResolvedValue([]);

      await service.notifyAudience({ ...baseOptions, session });

      const [, options] = mockNotificationModel.insertMany.mock.calls[0];
      expect(options).toEqual({ session });
    });

    it('converts a string threadId to an ObjectId on each doc', async () => {
      const threadId = new Types.ObjectId().toString();
      mockAudienceResolver.resolveAudience.mockResolvedValue([new Types.ObjectId().toString()]);
      mockNotificationModel.insertMany.mockResolvedValue([]);

      await service.notifyAudience({ ...baseOptions, threadId });

      const [docs] = mockNotificationModel.insertMany.mock.calls[0];
      expect(docs[0].threadId).toBeInstanceOf(Types.ObjectId);
      expect(docs[0].threadId.toString()).toBe(threadId);
    });

    it('leaves threadId undefined when not provided', async () => {
      mockAudienceResolver.resolveAudience.mockResolvedValue([new Types.ObjectId().toString()]);
      mockNotificationModel.insertMany.mockResolvedValue([]);

      await service.notifyAudience(baseOptions);

      const [docs] = mockNotificationModel.insertMany.mock.calls[0];
      expect(docs[0].threadId).toBeUndefined();
    });

    it('accepts a contextId already as an ObjectId instance', async () => {
      const contextId = new Types.ObjectId();
      mockAudienceResolver.resolveAudience.mockResolvedValue([new Types.ObjectId().toString()]);
      mockNotificationModel.insertMany.mockResolvedValue([]);

      await service.notifyAudience({ ...baseOptions, contextId });

      const [docs] = mockNotificationModel.insertMany.mock.calls[0];
      expect(docs[0].contextId).toBe(contextId);
    });

    it('propagates errors from insertMany', async () => {
      mockAudienceResolver.resolveAudience.mockResolvedValue([new Types.ObjectId().toString()]);
      mockNotificationModel.insertMany.mockRejectedValue(new Error('insert failed'));

      await expect(service.notifyAudience(baseOptions)).rejects.toThrow('insert failed');
    });
  });

  // ─── getUserNotifications ─────────────────────────────────────────────

  describe('getUserNotifications', () => {
    const userId = new Types.ObjectId().toString();

    it('returns paginated notifications, total, and unreadCount when unreadOnly is false', async () => {
      const docs = [{ _id: new Types.ObjectId() }];
      mockNotificationModel.exec
        .mockResolvedValueOnce(docs) // find(...).exec()
        .mockResolvedValueOnce(5) // countDocuments(filter).exec()
        .mockResolvedValueOnce(2); // unread countDocuments(...).exec()

      const result = await service.getUserNotifications(userId, 1, 20, false);

      expect(mockNotificationModel.find).toHaveBeenCalledWith({ recipientUserId: expect.any(Types.ObjectId) });
      expect(mockNotificationModel.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(mockNotificationModel.skip).toHaveBeenCalledWith(0);
      expect(mockNotificationModel.limit).toHaveBeenCalledWith(20);
      expect(result).toEqual({ notifications: docs, total: 5, unreadCount: 2 });
    });

    it('applies isRead: false to the filter when unreadOnly is true and reuses total as unreadCount', async () => {
      const docs: unknown[] = [];
      mockNotificationModel.exec
        .mockResolvedValueOnce(docs) // find(...).exec()
        .mockResolvedValueOnce(3); // countDocuments(filter).exec() -- used directly as unreadCount

      const result = await service.getUserNotifications(userId, 1, 20, true);

      const filterArg = mockNotificationModel.find.mock.calls[0][0];
      expect(filterArg.isRead).toBe(false);
      expect(result).toEqual({ notifications: docs, total: 3, unreadCount: 3 });
      // Only 2 exec() calls: no extra unread-count query when unreadOnly is true.
      expect(mockNotificationModel.exec).toHaveBeenCalledTimes(2);
    });

    it('computes skip from page and limit', async () => {
      mockNotificationModel.exec.mockResolvedValueOnce([]).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await service.getUserNotifications(userId, 3, 10, false);

      expect(mockNotificationModel.skip).toHaveBeenCalledWith(20);
      expect(mockNotificationModel.limit).toHaveBeenCalledWith(10);
    });

    it('throws BadRequestException for an invalid userId', async () => {
      await expect(service.getUserNotifications('not-an-object-id', 1, 20, false)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── markNotificationAsRead ───────────────────────────────────────────

  describe('markNotificationAsRead', () => {
    const notificationId = new Types.ObjectId().toString();
    const userId = new Types.ObjectId().toString();

    it('marks the notification read when found', async () => {
      mockNotificationModel.exec.mockResolvedValue({ _id: notificationId, isRead: true });

      await expect(service.markNotificationAsRead(notificationId, userId)).resolves.toBeUndefined();

      const [filter, update] = mockNotificationModel.findOneAndUpdate.mock.calls[0];
      expect(filter.recipientUserId).toBeInstanceOf(Types.ObjectId);
      expect(filter._id).toBeInstanceOf(Types.ObjectId);
      expect(update.isRead).toBe(true);
      expect(update.readAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when no matching notification exists', async () => {
      mockNotificationModel.exec.mockResolvedValue(null);

      await expect(service.markNotificationAsRead(notificationId, userId)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for an invalid notificationId', async () => {
      await expect(service.markNotificationAsRead('bad-id', userId)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── markAllNotificationsAsRead ───────────────────────────────────────

  describe('markAllNotificationsAsRead', () => {
    it('updates all unread notifications for the user', async () => {
      const userId = new Types.ObjectId().toString();
      mockNotificationModel.exec.mockResolvedValue({ modifiedCount: 3 });

      await service.markAllNotificationsAsRead(userId);

      const [filter, update] = mockNotificationModel.updateMany.mock.calls[0];
      expect(filter.recipientUserId).toBeInstanceOf(Types.ObjectId);
      expect(filter.isRead).toBe(false);
      expect(update.isRead).toBe(true);
    });

    it('throws BadRequestException for an invalid userId', async () => {
      await expect(service.markAllNotificationsAsRead('bad-id')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getUnreadNotificationCount ───────────────────────────────────────

  describe('getUnreadNotificationCount', () => {
    it('returns the unread count for the user', async () => {
      const userId = new Types.ObjectId().toString();
      mockNotificationModel.exec.mockResolvedValue(7);

      const result = await service.getUnreadNotificationCount(userId);

      expect(result).toBe(7);
      const filterArg = mockNotificationModel.countDocuments.mock.calls[0][0];
      expect(filterArg.isRead).toBe(false);
    });

    it('throws BadRequestException for an invalid userId', async () => {
      await expect(service.getUnreadNotificationCount('bad-id')).rejects.toThrow(BadRequestException);
    });
  });
});
