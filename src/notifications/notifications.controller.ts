import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import type { IAuthUser } from '../common/interfaces/auth-user.interface';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../module/auth/decorators/current-user.decorator';
import type { INotification } from './interfaces/notification.interface';
import { NotificationService } from './services/notification.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  getNotifications(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('unreadOnly') unreadOnly = 'false',
    @CurrentUser() user: IAuthUser,
  ): Promise<{ notifications: INotification[]; total: number; unreadCount: number }> {
    return this.notificationService.getUserNotifications(
      user._id,
      parseInt(page, 10),
      Math.min(parseInt(limit, 10), 100),
      unreadOnly === 'true',
    );
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: IAuthUser): Promise<number> {
    return this.notificationService.getUnreadNotificationCount(user._id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllAsRead(@CurrentUser() user: IAuthUser): Promise<void> {
    return this.notificationService.markAllNotificationsAsRead(user._id);
  }

  @Patch(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  markAsRead(
    @Param('notificationId', ParseObjectIdPipe) notificationId: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<void> {
    return this.notificationService.markNotificationAsRead(notificationId, user._id);
  }
}
