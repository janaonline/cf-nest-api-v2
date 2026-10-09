import { Controller, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { MohuaOverviewService } from './mohua-overview.service';

@ApiTags('XVI-FC - MoHUA Overview')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/overview')
export class MohuaOverviewController {
  constructor(private readonly overviewService: MohuaOverviewService) {}

  @ApiOperation({ summary: 'Cross-state overview: stage, allocation and condition-form statuses for every state' })
  @Get(':yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getOverview(@Param('yearId', ParseObjectIdPipe) yearId: string, @CurrentUser() user: AuthUser) {
    // STATE users also hold VIEW_STATUS_REPORTS, but this view spans every state — MoHUA/ADMIN only.
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Access denied');
    }
    return xviFcSuccess('MoHUA overview fetched.', await this.overviewService.getOverview(yearId));
  }
}
