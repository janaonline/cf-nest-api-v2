import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { RequestExemptionService } from './request-exemption.service';
import { SaveRequestExemptionDto } from './dto/save-request-exemption.dto';
import { GetRequestExemptionListQueryDto } from './dto/get-request-exemption-list-query.dto';

@ApiTags('XVI-FC - State Forms - Request Exemption')
@ApiBearerAuth()
@Controller('xvi-fc/state/request-exemption')
export class RequestExemptionController {
  constructor(private readonly requestExemptionService: RequestExemptionService) {}

  @ApiOperation({ summary: 'Submit a Request Exemption (no draft step - the only write path for this form)' })
  @ApiBody({ type: SaveRequestExemptionDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.RECOMMEND_EXEMPTIONS)
  finalSubmit(
    @Body() dto: SaveRequestExemptionDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.requestExemptionService.finalSubmit(dto, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Get Request Exemption field config for starting a new request' })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requestExemptionService.getForm(stateId, yearId, user);
  }

  @ApiOperation({ summary: "Paginated list of this state's own Request Exemption requests for the year" })
  @Get(':stateId/:yearId/list')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  list(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetRequestExemptionListQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requestExemptionService.list(stateId, yearId, query, user);
  }

  @ApiOperation({ summary: "This year's Reason for Exemption options, for the Exemption Status list's filter" })
  @Get(':stateId/:yearId/reason-options')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getReasonOptions(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requestExemptionService.getReasonOptions(stateId, yearId, user);
  }
}
