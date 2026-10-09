import { Controller, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { MohuaUlbFormsService } from './mohua-ulb-forms.service';

@ApiTags('XVI-FC - MoHUA ULB Forms')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/ulb')
export class MohuaUlbFormsController {
  constructor(private readonly ulbFormsService: MohuaUlbFormsService) {}

  @ApiOperation({ summary: "One ULB's five forms for MoHUA: status text and whether each is submitted to the State" })
  @Get(':ulbId/:yearId/forms')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getUlbForms(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // STATE users also hold VIEW_STATUS_REPORTS, but this view reads any ULB — MoHUA/ADMIN only.
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Access denied');
    }
    return xviFcSuccess('MoHUA ULB forms fetched.', await this.ulbFormsService.get(ulbId, yearId));
  }
}
