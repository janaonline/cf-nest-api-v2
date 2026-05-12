import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { IAuthUser } from '../common/interfaces/auth-user.interface';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../module/auth/decorators/current-user.decorator';
import type { INotification } from './interfaces/notification.interface';
import { NotificationService } from './services/notification.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications', description: 'Show paginated notifications for the logged-in user.' })
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
  @ApiOperation({
    summary: 'Get unread count',
    description: 'Show the number of unread notifications for the logged-in user.',
  })
  getUnreadCount(@CurrentUser() user: IAuthUser): Promise<number> {
    return this.notificationService.getUnreadNotificationCount(user._id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all as read', description: 'Marks all notifications as read for the logged-in user.' })
  markAllAsRead(@CurrentUser() user: IAuthUser): Promise<void> {
    return this.notificationService.markAllNotificationsAsRead(user._id);
  }

  @Patch(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Marks one notification as read for the logged-in user.',
  })
  markAsRead(
    @Param('notificationId', ParseObjectIdPipe) notificationId: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<void> {
    return this.notificationService.markNotificationAsRead(notificationId, user._id);
  }
}
