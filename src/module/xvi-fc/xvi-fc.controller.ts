/* eslint-disable prettier/prettier */
import { Controller, Delete, ForbiddenException, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

import { XviFcService } from './xvi-fc.service';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { SideMenuResponseDto } from './dto/side-menu.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { MenuRole } from '../../schemas/xvi-fc/xvi-fc-side-menu.schema';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger/dist/decorators';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { XviFcCacheInterceptor, XviFcCacheTTL } from './cache/xvi-fc-cache.interceptor';

@ApiTags('XVI-FC')
@Controller('xvi-fc')
export class XviFcController {
  constructor(private readonly xviFcService: XviFcService) {}

  @ApiBearerAuth()
  @Get('state/:stateId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateWiseData(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StateWiseResponseDto> {
    return this.xviFcService.getStateWiseData(stateId, user);
  }

  @ApiBearerAuth()
  @Get('sidebar/:role')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  @UseInterceptors(XviFcCacheInterceptor)
  @XviFcCacheTTL(600)
  async getSideMenu(@Param('role') role: MenuRole, @Query('yearId') yearId: string): Promise<SideMenuResponseDto> {
    return this.xviFcService.getSideMenu(role, yearId);
  }

  @ApiBearerAuth()
  @Get('years')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getYears(): Promise<{ _id: string; year: string }[]> {
    return this.xviFcService.getYears();
  }

  @ApiBearerAuth()
  @Get('ulb/:ulbId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getUlbById(@Param('ulbId', ParseObjectIdPipe) ulbId: string) {
    return this.xviFcService.getUlbById(ulbId);
  }

  @ApiBearerAuth()
  @Get('state-info/:stateId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateById(@Param('stateId', ParseObjectIdPipe) stateId: string) {
    return this.xviFcService.getStateById(stateId);
  }

  @ApiBearerAuth()
  @Get('support-hours')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getSupportHours(): ReturnType<XviFcService['getSupportHours']> {
    return this.xviFcService.getSupportHours();
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Clear XVI-FC cache (Admin only)',
    description: 'Clears cached API responses from Redis. Pass a URL pattern to clear specific cache (e.g. /xvi-fc/sidebar/*), or omit to clear all XVI-FC cache.',
  })
  @ApiQuery({ name: 'pattern', required: false, description: 'URL pattern to clear, e.g. /xvi-fc/sidebar/*. Omit to clear all XVI-FC cache.' })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin scope required' })
  @Delete('admin/cache')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.MANAGE_USERS)
  async clearCache(
    @CurrentUser() user: AuthUser,
    @Query('pattern') pattern?: string,
  ): Promise<{ message: string }> {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only admins can clear the cache');
    }
    await this.xviFcService.clearCache(pattern);
    const cleared = pattern ? `pattern: ${pattern}` : 'all XVI-FC cache';
    return { message: `Cache cleared for ${cleared}` };
  }
}
