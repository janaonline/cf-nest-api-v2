import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { GetStateDashboardParamsDto } from './dto/get-state-dashboard-params.dto';
import { StateDashboardService } from './state-dashboard.service';
import type { StateDashboardApiResponse } from './state-dashboard.types';

@ApiTags('XVI-FC State Dashboard')
@ApiBearerAuth()
@Controller('xvi-fc/state')
@UseGuards(PermissionGuard)
export class StateDashboardController {
  constructor(private readonly stateDashboardService: StateDashboardService) {}

  @Get(':stateId/:yearId/dashboard')
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  @ApiOperation({
    summary: 'Fetch the XVI-FC State dashboard',
  })
  @ApiParam({ name: 'stateId', description: 'MongoDB ObjectId of the State.' })
  @ApiParam({ name: 'yearId', description: 'MongoDB ObjectId of the XVI-FC design year.' })
  @ApiResponse({ status: 200, description: 'State dashboard fetched successfully.' })
  @ApiResponse({ status: 400, description: 'State or year ID is invalid.' })
  @ApiResponse({ status: 401, description: 'Authentication is required.' })
  @ApiResponse({ status: 403, description: 'The requested State is outside the authenticated scope.' })
  @ApiResponse({ status: 404, description: 'The active State or design year was not found.' })
  getDashboard(
    @Param() params: GetStateDashboardParamsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<StateDashboardApiResponse> {
    return this.stateDashboardService.getDashboard(params, user);
  }
}
