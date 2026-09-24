import { Body, Controller, Headers, Ip, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { RequestExemptionMohuaService } from './request-exemption-mohua.service';
import { RejectRequestExemptionDto } from './dto/reject-request-exemption.dto';

@ApiTags('XVI-FC - MoHUA Review - Request Exemption')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/request-exemption')
export class RequestExemptionMohuaController {
  constructor(private readonly service: RequestExemptionMohuaService) {}

  @ApiOperation({ summary: 'Approve one discretionary exemption entry' })
  @Post(':requestId/:formId/approve')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  approve(
    @Param('requestId', ParseObjectIdPipe) requestId: string,
    @Param('formId', ParseIntPipe) formId: number,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.service.approve(requestId, formId, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Reject one discretionary exemption entry' })
  @ApiBody({ type: RejectRequestExemptionDto })
  @Post(':requestId/:formId/reject')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  reject(
    @Param('requestId', ParseObjectIdPipe) requestId: string,
    @Param('formId', ParseIntPipe) formId: number,
    @Body() dto: RejectRequestExemptionDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.service.reject(requestId, formId, dto.mohuaRemarks, user, ip, userAgent);
  }
}
