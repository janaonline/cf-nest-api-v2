import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

import { XviFcService } from './xvi-fc.service';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { SideMenuResponseDto } from './dto/side-menu.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { MenuRole } from '../../schemas/side-menu.schema';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger/dist/decorators';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

@ApiTags('XVI-FC')
@Controller('xvi-fc')
export class XviFcController {
  constructor(private readonly xviFcService: XviFcService) {}

  @ApiBearerAuth()
  @Get('state/:stateId')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateWiseData(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StateWiseResponseDto> {
    return this.xviFcService.getStateWiseData(stateId, user);
  }

  @ApiBearerAuth()
  @Get('sidebar/:role')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getSideMenu(@Param('role') role: MenuRole, @Query('yearId') yearId: string): Promise<SideMenuResponseDto> {
    return this.xviFcService.getSideMenu(role, yearId);
  }

  @ApiBearerAuth()
  @Get('years')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getYears(): Promise<{ _id: string; year: string }[]> {
    return this.xviFcService.getYears();
  }

  @ApiBearerAuth()
  @Get('ulb/:ulbId')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getUlbById(@Param('ulbId', ParseObjectIdPipe) ulbId: string) {
    return this.xviFcService.getUlbById(ulbId);
  }

  @ApiBearerAuth()
  @Get('state-info/:stateId')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateById(@Param('stateId', ParseObjectIdPipe) stateId: string) {
    return this.xviFcService.getStateById(stateId);
  }

  @ApiBearerAuth()
  @Get('form-status/:ulbId/:designYearId')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getFormStatus(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('designYearId', ParseObjectIdPipe) designYearId: string,
  ) {
    return this.xviFcService.getFormStatus(ulbId, designYearId);
  }

  @ApiBearerAuth()
  @Get('support-hours')
  @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getSupportHours(): ReturnType<XviFcService['getSupportHours']> {
    return this.xviFcService.getSupportHours();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear XVI-FC page cache (Admin only)' })
  @ApiQuery({
    name: 'pattern',
    required: false,
    description:
      'Substring to match against cached request URLs, e.g. "sidebar" or "xvi-fc/sidebar". ' +
      'Matches anywhere in the URL (no need to include the app route prefix or add wildcards). ' +
      'Omit to clear all XVI-FC cache.',
  })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin scope required' })
  @Delete('admin/cache')
  @UseGuards(PermissionGuard)
  clearPageCache(@CurrentUser() user: AuthUser, @Query('pattern') pattern?: string): Promise<{ message: string }> {
    return this.xviFcService.clearPageCache(user, pattern);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear FormJson config cache (Admin only)' })
  @ApiQuery({
    name: 'designYearId',
    required: false,
    description: 'Limit clearing to this design year. Omit to match every year.',
  })
  @ApiQuery({
    name: 'formId',
    required: false,
    description: 'Limit clearing to this form. Omit to match every form.',
  })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin scope required' })
  @Delete('admin/cache/form-json')
  @UseGuards(PermissionGuard)
  clearFormJsonCache(
    @CurrentUser() user: AuthUser,
    @Query('designYearId') designYearId?: string,
    @Query('formId') formId?: string,
  ): Promise<{ message: string }> {
    return this.xviFcService.clearFormJsonCache(user, designYearId, formId ? Number(formId) : undefined);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear side-menu cache (Admin only)' })
  @ApiQuery({
    name: 'role',
    required: false,
    description: 'Limit clearing to this role. Omit to match every role.',
  })
  @ApiQuery({
    name: 'yearId',
    required: false,
    description: 'Limit clearing to this year. Omit to match every year.',
  })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin scope required' })
  @Delete('admin/cache/side-menu')
  @UseGuards(PermissionGuard)
  clearSideMenuCache(
    @CurrentUser() user: AuthUser,
    @Query('role') role?: string,
    @Query('yearId') yearId?: string,
  ): Promise<{ message: string }> {
    return this.xviFcService.clearSideMenuCache(user, role, yearId);
  }
}
