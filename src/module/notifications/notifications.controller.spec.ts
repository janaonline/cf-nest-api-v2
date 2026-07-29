import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './services/notification.service';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../auth/enum/role.enum';
import type { INotification } from './interfaces/notification.interface';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<NotificationService>;

  const user: IAuthUser = {
    _id: new Types.ObjectId().toString(),
    email: 'user@test.com',
    role: Role.ULB,
  };

  beforeEach(async () => {
    const mockService = {
      getUserNotifications: jest.fn(),
      getUnreadNotificationCount: jest.fn(),
      markAllNotificationsAsRead: jest.fn(),
      markNotificationAsRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationService, useValue: mockService }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get(NotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNotifications', () => {
    const notifications = [{ _id: new Types.ObjectId() } as unknown as INotification];

    it('parses defaults and calls service with page 1, limit 20, unreadOnly false', async () => {
      service.getUserNotifications.mockResolvedValue({ notifications, total: 1, unreadCount: 1 });

      const result = await controller.getNotifications('1', '20', 'false', user);

      expect(service.getUserNotifications).toHaveBeenCalledWith(user._id, 1, 20, false);
      expect(result).toEqual({ notifications, total: 1, unreadCount: 1 });
    });

    it('parses unreadOnly=true correctly', async () => {
      service.getUserNotifications.mockResolvedValue({ notifications: [], total: 0, unreadCount: 0 });

      await controller.getNotifications('2', '10', 'true', user);

      expect(service.getUserNotifications).toHaveBeenCalledWith(user._id, 2, 10, true);
    });

    it('caps limit at 100 when a larger value is requested', async () => {
      service.getUserNotifications.mockResolvedValue({ notifications: [], total: 0, unreadCount: 0 });

      await controller.getNotifications('1', '500', 'false', user);

      expect(service.getUserNotifications).toHaveBeenCalledWith(user._id, 1, 100, false);
    });

    it('propagates errors from the service', async () => {
      service.getUserNotifications.mockRejectedValue(new Error('DB error'));

      await expect(controller.getNotifications('1', '20', 'false', user)).rejects.toThrow('DB error');
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count from the service', async () => {
      service.getUnreadNotificationCount.mockResolvedValue(4);

      const result = await controller.getUnreadCount(user);

      expect(service.getUnreadNotificationCount).toHaveBeenCalledWith(user._id);
      expect(result).toBe(4);
    });
  });

  describe('markAllAsRead', () => {
    it('calls service.markAllNotificationsAsRead with the current user id', async () => {
      service.markAllNotificationsAsRead.mockResolvedValue(undefined);

      await controller.markAllAsRead(user);

      expect(service.markAllNotificationsAsRead).toHaveBeenCalledWith(user._id);
    });
  });

  describe('markAsRead', () => {
    it('calls service.markNotificationAsRead with notificationId and user id', async () => {
      const notificationId = new Types.ObjectId().toString();
      service.markNotificationAsRead.mockResolvedValue(undefined);

      await controller.markAsRead(notificationId, user);

      expect(service.markNotificationAsRead).toHaveBeenCalledWith(notificationId, user._id);
    });

    it('propagates NotFoundException from the service', async () => {
      const notificationId = new Types.ObjectId().toString();
      service.markNotificationAsRead.mockRejectedValue(new Error('Notification not found'));

      await expect(controller.markAsRead(notificationId, user)).rejects.toThrow('Notification not found');
    });
  });
});
