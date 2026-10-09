import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { MohuaStateDetailService } from './mohua-state-detail.service';
import { MohuaStateUlbsService } from './mohua-state-ulbs.service';
import { GetMohuaStateUlbsQueryDto } from './mohua-state-ulbs-query.dto';

@ApiTags('XVI-FC - MoHUA State Detail')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/state')
export class MohuaStateDetailController {
  constructor(
    private readonly stateDetailService: MohuaStateDetailService,
    private readonly stateUlbsService: MohuaStateUlbsService,
  ) {}

  @ApiOperation({ summary: 'One state for MoHUA: allocation, state-condition forms and ULB form submission counts' })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateDetail(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertMohuaScope(user);
    return xviFcSuccess('MoHUA state detail fetched.', await this.stateDetailService.getDetail(stateId, yearId));
  }

  @ApiOperation({ summary: "The state's ULBs for MoHUA: allocation, elected body and per-form submission, paginated" })
  @Get(':stateId/:yearId/ulbs')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateUlbs(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetMohuaStateUlbsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertMohuaScope(user);
    return xviFcSuccess('MoHUA state ULBs fetched.', await this.stateUlbsService.list(stateId, yearId, query));
  }

  /** STATE users also hold VIEW_STATUS_REPORTS, but these views read any state — MoHUA/ADMIN only. */
  private assertMohuaScope(user: AuthUser): void {
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Access denied');
    }
  }
}
