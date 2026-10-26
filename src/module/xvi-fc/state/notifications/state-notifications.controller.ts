import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { StateNotificationsService } from './state-notifications.service';

@ApiTags('XVI-FC - State Notifications')
@ApiBearerAuth()
@Controller('xvi-fc/state')
@UseGuards(PermissionGuard)
export class StateNotificationsController {
  constructor(private readonly service: StateNotificationsService) {}

  @ApiOperation({ summary: 'Status of the five State forms plus the ULB forms awaiting State review (bell + sidebar dots)' })
  @Get(':stateId/:yearId/notifications')
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getNotifications(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getNotifications(stateId, yearId, user);
  }
}
